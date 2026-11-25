// Lists running processes for the Apex guard and the conflict check, in the shape of `tasklist /FO CSV /NH`,
// every N ms (default 2000), each list ending with a blank line. Starting tasklist.exe every 4 s cost the app
// about 300 ms of CPU per start; listing from inside one long-lived process costs a few ms.
// No LibreHardwareMonitor, no drivers: it keeps running while the guard has the sidecar stopped.
// Exits when stdin closes (the app quit or died), so it never outlives KelvinRGB.
using System;
using System.Diagnostics;
using System.Text;
using System.Threading;

static class ProcWatch
{
    static void Main(string[] args)
    {
        int ms = args.Length > 0 ? int.Parse(args[0]) : 2000;
        var reader = new Thread(delegate () { while (Console.In.ReadLine() != null) { } Environment.Exit(0); });
        reader.IsBackground = true;
        reader.Start();
        var o = Console.Out;
        while (true)
        {
            var sb = new StringBuilder();
            foreach (var p in Process.GetProcesses())
            {
                // ProcessName drops ".exe"; tasklist shows the image name, which is what the guard and conflict lists match
                sb.Append('"').Append(p.ProcessName).Append(".exe\",\"").Append(p.Id).Append("\"\n");
                p.Dispose();
            }
            sb.Append('\n');
            o.Write(sb.ToString());
            o.Flush();
            Thread.Sleep(ms);
        }
    }
}
