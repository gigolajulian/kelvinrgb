// The sidecar's safety loop, kept apart from LibreHardwareMonitor so test/sidecar.test.js can compile and run it
// alone (sidecar/selftest.cs) with fake fans. sidecar.cs hands in the real fan actions.
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

static class Pump
{
    [DllImport("kernel32.dll")] static extern ulong GetTickCount64();

    // Uptime as 64-bit ms: Environment.TickCount wraps after 24.9 days, which made a later restart look like a new boot.
    public static DateTime BootTime() { return BootTime(DateTime.UtcNow, GetTickCount64()); }
    public static DateTime BootTime(DateTime utcNow, ulong uptimeMs) { return utcNow - TimeSpan.FromMilliseconds(uptimeMs); }

    // Exception or process exit -> fans back.
    public static void Guard(Action restoreAll, Action<string> log)
    {
        AppDomain.CurrentDomain.UnhandledException += delegate (object s, UnhandledExceptionEventArgs e)
        {
            log("crash: " + e.ExceptionObject);
            restoreAll();
        };
        AppDomain.CurrentDomain.ProcessExit += delegate { restoreAll(); };
        Console.CancelKeyPress += delegate { restoreAll(); };
    }

    // Reads lines from stdin and hands each to handle. stdin closed (the app quit or was killed) -> restoreAll, return.
    // No line for watchdogMs while touched() > 0 (the app hung) -> restoreAll. tick runs about once a second.
    public static void Run(Action<string> handle, Action restoreAll, Func<int> touched, Action tick, Action<string> log, int watchdogMs)
    {
        var inbox = new ConcurrentQueue<string>();
        var eof = new ManualResetEventSlim();
        var reader = new Thread(delegate ()
        {
            string line;
            while ((line = Console.In.ReadLine()) != null) inbox.Enqueue(line);
            eof.Set();
        });
        reader.IsBackground = true;
        reader.Start();

        var lastMsg = Stopwatch.StartNew();
        var lastTick = Stopwatch.StartNew();
        while (true)
        {
            string line;
            while (inbox.TryDequeue(out line))
            {
                lastMsg.Restart();
                try { handle(line); } catch (Exception ex) { log("message failed: " + ex.Message); }
            }
            if (eof.IsSet && inbox.IsEmpty) { restoreAll(); return; }
            if (lastMsg.ElapsedMilliseconds > watchdogMs && touched() > 0)
            {
                log("watchdog: app silent for " + watchdogMs / 1000.0 + " s, fans back to BIOS");
                restoreAll();
            }
            if (lastTick.ElapsedMilliseconds >= 1000)
            {
                lastTick.Restart();
                tick();
            }
            Thread.Sleep(50);
        }
    }
}
