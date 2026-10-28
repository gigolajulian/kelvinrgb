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
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Web.Script.Serialization;
using LibreHardwareMonitor.Hardware;

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
    static readonly ConcurrentQueue<string> Inbox = new ConcurrentQueue<string>();
    static readonly Dictionary<string, ISensor> Controls = new Dictionary<string, ISensor>();
    static readonly HashSet<string> Touched = new HashSet<string>();
    static Computer computer;
    static int floor = 25;
    static bool unclean;
    static string markerPath;

    public static void Run(int floorArg)
    {
        floor = floorArg;
        markerPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KelvinRGB", "fans-in-software-mode.txt");
        Directory.CreateDirectory(Path.GetDirectoryName(markerPath));

        AppDomain.CurrentDomain.UnhandledException += delegate (object s, UnhandledExceptionEventArgs e)
        {
            Log("crash: " + e.ExceptionObject);
            RestoreAll();
        };
        AppDomain.CurrentDomain.ProcessExit += delegate { RestoreAll(); };
        Console.CancelKeyPress += delegate { RestoreAll(); };

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

        CheckMarker();

        Emit(new Dictionary<string, object> {
            { "type", "ready" }, { "floor", floor }, { "unclean", unclean },
            { "admin", new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent()).IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator) },
            { "controls", Controls.Count }
        });

        var reader = new Thread(delegate ()
        {
            string line;
            while ((line = Console.In.ReadLine()) != null) Inbox.Enqueue(line);
            Inbox.Enqueue("{\"cmd\":\"eof\"}");
        });
        reader.IsBackground = true;
        reader.Start();

        var lastMsg = Stopwatch.StartNew();
        var lastTick = Stopwatch.StartNew();
        while (true)
        {
            string line;
            while (Inbox.TryDequeue(out line))
            {
                lastMsg.Restart();
                Dictionary<string, object> m;
                try { m = Json.Deserialize<Dictionary<string, object>>(line); }
                catch (Exception ex) { Log("bad json: " + ex.Message); continue; }
                string cmd = m.ContainsKey("cmd") ? m["cmd"] as string : null;
                if (cmd == "eof") { RestoreAll(); return; }
                try
                {
                    lock (FanLock)
                    {
                        if (cmd == "set") SetDuty(m["id"] as string, Convert.ToDouble(m["duty"]));
                        else if (cmd == "auto") Restore(m["id"] as string);
                    }
                    if (cmd == "autoAll") RestoreAll();
                }
                catch (Exception ex) { Log(cmd + " failed: " + ex.Message); }
            }
            if (lastMsg.ElapsedMilliseconds > 5000 && Touched.Count > 0)
            {
                Log("watchdog: app silent for 5 s, fans back to BIOS");
                RestoreAll();
            }
            if (lastTick.ElapsedMilliseconds >= 1000)
            {
                lastTick.Restart();
                Update();
                EmitTick();
            }
            Thread.Sleep(50);
        }
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
        if (id == null || !Controls.TryGetValue(id, out s)) { Log("unknown control " + id); return; }
        float v = (float)Math.Max(floor, Math.Min(100, duty));
        s.Control.SetSoftware(v);
        if (Touched.Add(id)) WriteMarker();
    }

    static void Restore(string id)
    {
        ISensor s;
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
            if (Controls.TryGetValue(id, out s)) { s.Control.SetSoftware(100); Touched.Add(id); }
        }
        WriteMarker();
        if (unclean) Log("previous sidecar exited without restoring fans; holding them at 100% until reboot or until the app sets a curve");
    }

    static DateTime BootTime()
    {
        return DateTime.UtcNow - TimeSpan.FromMilliseconds(Environment.TickCount & int.MaxValue);
    }

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
