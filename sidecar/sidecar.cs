// KelvinRGB sensor + fan sidecar. Talks JSON lines over stdio to the Electron app.
// Built with the .NET Framework csc.exe that ships with Windows (C# 5), see build.ps1.
//
// In:  {"cmd":"ping"} | {"cmd":"set","id":"/lpc/nct6798d/0/control/1","duty":45} | {"cmd":"auto","id":"..."} | {"cmd":"autoAll"}
// Out: {"type":"ready",...} | {"type":"tick","hw":[...],"controls":[...]} | {"type":"log","msg":"..."}
//
// Safety:
//  - duty is clamped to [floor, 100]; floor comes from --floor (default 25).
//  - no message from the app for 5 s, stdin closed, exception, or process exit -> every fan we touched goes back to BIOS.
//  - a marker file lists fans in software mode. If a previous sidecar was hard-killed (marker left behind,
//    same boot), "back to BIOS" is not reliable, so those fans are held at 100% instead until reboot.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Web.Script.Serialization;
using LibreHardwareMonitor.Hardware;
using HidSharp;

static class Program
{
    static void Main(string[] args)
    {
        string libDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "lib");
        // Load our copies of dependencies whatever version is asked for (stands in for binding redirects).
        // Registered before Core is touched, since Core's fields reference LibreHardwareMonitorLib types.
        AppDomain.CurrentDomain.AssemblyResolve += delegate (object s, ResolveEventArgs e)
        {
            string p = Path.Combine(libDir, new AssemblyName(e.Name).Name + ".dll");
            return File.Exists(p) ? Assembly.LoadFrom(p) : null;
        };
        int floor = 25;
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i] == "--floor") floor = Math.Max(20, Math.Min(100, int.Parse(args[i + 1])));
        Core.Run(floor);
    }
}

static class Core
{
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object OutLock = new object();
    static readonly object FanLock = new object();
    static readonly Dictionary<string, ISensor> Controls = new Dictionary<string, ISensor>();
    static readonly HashSet<string> Touched = new HashSet<string>();
    static Computer computer;
    static NzxtHub hub; // NZXT fan hub, when one is connected (case fans often sit on it, not on the board)
    static int floor = 25;
    static bool unclean;
    static string markerPath;

    public static void Run(int floorArg)
    {
        floor = floorArg;
        markerPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KelvinRGB", "fans-in-software-mode.txt");
        Directory.CreateDirectory(Path.GetDirectoryName(markerPath));

        Pump.Guard(RestoreAll, Log);

        computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMemoryEnabled = true,
            IsMotherboardEnabled = true,
            IsControllerEnabled = true,
        };
        computer.Open();
        Update();

        foreach (IHardware hw in AllHardware())
            foreach (ISensor s in hw.Sensors)
                if (s.SensorType == SensorType.Control && s.Control != null && IsBoardFan(hw))
                    Controls[s.Identifier.ToString()] = s;

        try { hub = NzxtHub.Open(Log); } catch (Exception ex) { Log("nzxt hub: " + ex.Message); }
        CheckMarker();

        Emit(new Dictionary<string, object> {
            { "type", "ready" }, { "floor", floor }, { "unclean", unclean },
            { "admin", new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent()).IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator) },
            { "controls", Controls.Count + (hub != null ? 3 : 0) }
        });

        Pump.Run(Handle, RestoreAll, delegate { return Touched.Count; }, delegate { Update(); EmitTick(); }, Log, 5000);
    }

    static void Handle(string line)
    {
        Dictionary<string, object> m;
        try { m = Json.Deserialize<Dictionary<string, object>>(line); }
        catch (Exception ex) { Log("bad json: " + ex.Message); return; }
        string cmd = m.ContainsKey("cmd") ? m["cmd"] as string : null;
        try
        {
            lock (FanLock)
            {
                if (cmd == "set") SetDuty(m["id"] as string, Convert.ToDouble(m["duty"]));
                else if (cmd == "auto") Restore(m["id"] as string);
            }
            if (cmd == "autoAll") RestoreAll();
            else if (cmd == "openrgb") Pump.ChildPid = Convert.ToInt32(m["pid"]); // the OpenRGB server the app started, 0 before a planned stop
        }
        catch (Exception ex) { Log(cmd + " failed: " + ex.Message); }
    }

    static bool IsBoardFan(IHardware hw)
    {
        // Only Super I/O (motherboard headers). GPU fans stay with the driver.
        return hw.HardwareType == HardwareType.SuperIO;
    }

    static IEnumerable<IHardware> AllHardware()
    {
        foreach (IHardware h in computer.Hardware)
        {
            yield return h;
            foreach (IHardware sub in h.SubHardware) yield return sub;
        }
    }

    static void Update()
    {
        foreach (IHardware h in computer.Hardware)
        {
            h.Update();
            foreach (IHardware sub in h.SubHardware) sub.Update();
        }
    }

    static void SetDuty(string id, double duty)
    {
        ISensor s;
        float v = (float)Math.Max(floor, Math.Min(100, duty));
        if (hub != null && hub.Has(id)) hub.Set(id, (int)Math.Round(v));
        else if (id == null || !Controls.TryGetValue(id, out s)) { Log("unknown control " + id); return; }
        else s.Control.SetSoftware(v);
        if (Touched.Add(id)) WriteMarker();
    }

    static void Restore(string id)
    {
        ISensor s;
        if (hub != null && hub.Has(id)) { hub.Set(id, 100); Touched.Remove(id); WriteMarker(); return; } // the hub has no BIOS: its own default is 100%
        if (id == null || !Controls.TryGetValue(id, out s)) return;
        if (unclean) s.Control.SetSoftware(100); // BIOS state was lost with the killed sidecar: hold full speed
        else s.Control.SetDefault();
        Touched.Remove(id);
        WriteMarker();
    }

    static void RestoreAll()
    {
        lock (FanLock)
        {
            foreach (string id in Touched.ToList())
            {
                try { Restore(id); } catch (Exception ex) { Log("restore failed " + id + ": " + ex.Message); }
            }
        }
    }

    // Marker: line 1 = boot time ticks, line 2 = clean|unclean, then one control id per line.
    // "unclean" sticks until reboot: once BIOS state is lost, every later restore means 100%.
    static void WriteMarker()
    {
        if (Touched.Count == 0 && !unclean) { try { File.Delete(markerPath); } catch { } return; }
        var lines = new List<string> { BootTime().Ticks.ToString(), unclean ? "unclean" : "clean" };
        lines.AddRange(Touched);
        File.WriteAllLines(markerPath, lines);
    }

    static void CheckMarker()
    {
        if (!File.Exists(markerPath)) return;
        string[] lines = File.ReadAllLines(markerPath);
        long ticks;
        bool sameBoot = lines.Length > 0 && long.TryParse(lines[0], out ticks) && Math.Abs(ticks - BootTime().Ticks) < TimeSpan.FromMinutes(1).Ticks;
        if (!sameBoot) { File.Delete(markerPath); return; } // a reboot gave the BIOS its fans back
        unclean = lines.Length > 2 || (lines.Length > 1 && lines[1] == "unclean");
        foreach (string id in lines.Skip(2))
        {
            ISensor s;
            if (hub != null && hub.Has(id)) { hub.Set(id, 100); Touched.Add(id); }
            else if (Controls.TryGetValue(id, out s)) { s.Control.SetSoftware(100); Touched.Add(id); }
        }
        WriteMarker();
        if (unclean) Log("previous sidecar exited without restoring fans; holding them at 100% until reboot or until the app sets a curve");
    }

    static DateTime BootTime() { return Pump.BootTime(); }

    static void EmitTick()
    {
        var hws = new List<object>();
        foreach (IHardware h in AllHardware())
        {
            var sensors = new List<object>();
            foreach (ISensor s in h.Sensors)
            {
                if (!s.Value.HasValue) continue;
                sensors.Add(new Dictionary<string, object> {
                    { "id", s.Identifier.ToString() }, { "name", s.Name }, { "type", s.SensorType.ToString() },
                    { "index", s.Index }, { "value", Math.Round(s.Value.Value, 2) }
                });
            }
            hws.Add(new Dictionary<string, object> {
                { "id", h.Identifier.ToString() }, { "name", h.Name }, { "type", h.HardwareType.ToString() }, { "sensors", sensors }
            });
        }
        var controls = new List<object>();
        foreach (var kv in Controls)
        {
            ISensor s = kv.Value;
            controls.Add(new Dictionary<string, object> {
                { "id", kv.Key }, { "name", s.Name }, { "hw", s.Hardware.Name }, { "index", s.Index },
                { "value", s.Value.HasValue ? Math.Round(s.Value.Value, 1) : -1 },
                { "mode", s.Control.ControlMode.ToString() }, { "ours", Touched.Contains(kv.Key) }
            });
        }
        if (hub != null)
        {
            var rpms = new List<object>();
            for (int i = 0; i < 3; i++)
            {
                if (hub.Mode[i] == 0) continue; // nothing plugged into this channel
                string id = NzxtHub.Prefix + (i + 1);
                rpms.Add(new Dictionary<string, object> { { "id", id + "/rpm" }, { "name", "Fan " + (i + 1) }, { "type", "Fan" }, { "index", i + 1 }, { "value", hub.Rpm[i] } });
                controls.Add(new Dictionary<string, object> {
                    { "id", id }, { "name", "Hub fan " + (i + 1) }, { "hw", hub.Name }, { "index", i + 1 }, { "value", hub.Duty[i] },
                    { "mode", hub.Mode[i] == 2 ? "PWM" : "DC" }, { "ours", Touched.Contains(id) }, { "kind", "hub" }
                });
            }
            hws.Add(new Dictionary<string, object> { { "id", "/nzxt" }, { "name", hub.Name }, { "type", "FanController" }, { "sensors", rpms } });
        }
        Emit(new Dictionary<string, object> { { "type", "tick" }, { "unclean", unclean }, { "hw", hws }, { "controls", controls } });
    }

    static void Log(string msg)
    {
        Emit(new Dictionary<string, object> { { "type", "log" }, { "msg", msg } });
    }

    static void Emit(object o)
    {
        lock (OutLock)
        {
            try { Console.Out.WriteLine(Json.Serialize(o)); Console.Out.Flush(); } catch { }
        }
    }
}

// NZXT Smart Device V2 and RGB & Fan Controller: three fan channels over HID.
// Protocol from liquidctl (driver/smart_device.py, SmartDevice2): 64-byte reports, the first byte is the report id.
//   60 02 01 E8 01 01 E8 01   start status reports every 0.5 s
//   67 02 ...                 status: channel mode at 16.. (0 none, 1 DC, 2 PWM), rpm u16le at 24.., duty % at 40..
//   62 01 <1<<ch> d1 d2 d3    fixed duty for one channel
class NzxtHub
{
    public const string Prefix = "/nzxt/fan/";
    static readonly int[] Pids = { 0x2006, 0x200d, 0x200f, 0x2009, 0x200e, 0x2010, 0x2011, 0x2019, 0x201f, 0x2020 };
    public readonly int[] Rpm = new int[3], Duty = new int[3], Mode = new int[3];
    public string Name;
    HidStream stream;
    int outLen;

    public static NzxtHub Open(Action<string> log)
    {
        foreach (HidDevice d in DeviceList.Local.GetHidDevices(0x1e71))
        {
            if (Array.IndexOf(Pids, d.ProductID) < 0) continue;
            HidStream s;
            if (!d.TryOpen(out s)) { log("nzxt hub: could not open " + d.ProductID.ToString("x4")); continue; }
            var h = new NzxtHub { stream = s, outLen = d.GetMaxOutputReportLength() };
            try { h.Name = d.GetProductName().Trim(); } catch { h.Name = "NZXT fan hub"; }
            if (string.IsNullOrEmpty(h.Name)) h.Name = "NZXT fan hub";
            int inLen = d.GetMaxInputReportLength();
            s.ReadTimeout = 2000;
            h.Write(new byte[] { 0x60, 0x02, 0x01, 0xe8, 0x01, 0x01, 0xe8, 0x01 });
            h.Write(new byte[] { 0x60, 0x03 });
            var t = new Thread(delegate () { h.ReadLoop(inLen, log); });
            t.IsBackground = true;
            t.Start();
            log("nzxt hub: " + h.Name + " (" + d.ProductID.ToString("x4") + ")");
            return h;
        }
        return null;
    }

    void ReadLoop(int len, Action<string> log)
    {
        var buf = new byte[len];
        while (true)
        {
            int n;
            try { n = stream.Read(buf, 0, buf.Length); }
            catch (TimeoutException) { continue; }
            catch (Exception ex) { log("nzxt hub: stopped reading: " + ex.Message); return; }
            if (n < 57 || buf[0] != 0x67 || buf[1] != 0x02) continue;
            for (int i = 0; i < 3; i++)
            {
                Mode[i] = buf[16 + i] <= 2 ? buf[16 + i] : 0;
                Rpm[i] = buf[24 + 2 * i] | (buf[25 + 2 * i] << 8);
                Duty[i] = buf[40 + i];
            }
        }
    }

    public bool Has(string id)
    {
        int ch;
        return id != null && id.StartsWith(Prefix) && int.TryParse(id.Substring(Prefix.Length), out ch) && ch >= 1 && ch <= 3;
    }

    public void Set(string id, int duty)
    {
        int ch = int.Parse(id.Substring(Prefix.Length)) - 1;
        var msg = new byte[] { 0x62, 0x01, (byte)(1 << ch), 0, 0, 0 };
        msg[3 + ch] = (byte)Math.Max(0, Math.Min(100, duty));
        Write(msg);
    }

    void Write(byte[] data)
    {
        var b = new byte[outLen];
        Array.Copy(data, b, data.Length);
        lock (this) stream.Write(b);
    }
}
