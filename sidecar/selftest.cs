// Test harness for pump.cs, built by test/sidecar.test.js with Windows' csc. Never shipped.
// Fake fans: "set" touches one, restoreAll prints how many went back. Modes:
//   pump <watchdogMs>   run the real loop; "crash" makes the next tick throw
//   boot <uptimeMs>     print the boot time pump.cs works out, as UTC ticks
using System;
using System.Threading;

static class SelfTest
{
    static int touched;

    static int Main(string[] args)
    {
        if (args[0] == "boot")
        {
            Console.WriteLine(Pump.BootTime(new DateTime(2026, 1, 31, 0, 0, 0, DateTimeKind.Utc), ulong.Parse(args[1])).Ticks);
            return 0;
        }
        bool crash = false;
        Action<string> log = delegate (string m) { Console.WriteLine("log " + m); };
        Action restoreAll = delegate { if (touched > 0) Console.WriteLine("restored " + touched); touched = 0; };
        Pump.Guard(restoreAll, log);
        Console.WriteLine("ready");
        Pump.Run(
            delegate (string line) { if (line == "set") Interlocked.Increment(ref touched); if (line == "crash") crash = true; },
            restoreAll,
            delegate { return touched; },
            delegate { if (crash) throw new InvalidOperationException("boom"); },
            log,
            int.Parse(args[1]));
        Console.WriteLine("exit");
        return 0;
    }
}
