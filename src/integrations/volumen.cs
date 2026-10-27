// Nimbo · volumen de UNA app (la que suena): el mismo control que el "Mezclador de volumen" de Windows, sin tocar el volumen general.
// Uso:  volumen.exe get <proceso>        → {"v":0-100}   ({"v":-1} si esa app no tiene sonido abierto)
//       volumen.exe set <proceso> <0-100> → {"v":nuevo}
// <proceso> es el nombre del ejecutable sin .exe (spotify, chrome, msedge…); main.js lo elige de una lista fija.
// Lo compila windows.js con el csc de .NET Framework (viene con Windows): no hay que instalar nada.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int NotImpl1();
  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}
[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
  int NotImpl1(); int NotImpl2();
  [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
}
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator {
  [PreserveSig] int GetCount(out int count);
  [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
}
[ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
  // IAudioSessionControl (9 métodos que no se usan) y después los de la versión 2
  int N1(); int N2(); int N3(); int N4(); int N5(); int N6(); int N7(); int N8(); int N9();
  int N10(); int N11();
  [PreserveSig] int GetProcessId(out uint pid);
}
[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
  [PreserveSig] int SetMasterVolume(float level, ref Guid context);
  [PreserveSig] int GetMasterVolume(out float level);
}

static class Volumen {
  static int Main(string[] args) {
    try {
      if (args.Length < 2 || !Regex.IsMatch(args[1], "^[A-Za-z]{2,20}$")) { Console.WriteLine("{\"error\":\"uso\"}"); return 2; }
      bool set = args[0] == "set";
      float level = 0;
      if (set) { int n; if (args.Length < 3 || !int.TryParse(args[2], out n) || n < 0 || n > 100) { Console.WriteLine("{\"error\":\"uso\"}"); return 2; } level = n / 100f; }
      var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice dev;
      if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0) { Console.WriteLine("{\"v\":-1}"); return 0; } // 0 = salida, 1 = multimedia
      var iid = typeof(IAudioSessionManager2).GUID;
      object o;
      dev.Activate(ref iid, 23, IntPtr.Zero, out o); // CLSCTX_ALL
      IAudioSessionEnumerator list;
      ((IAudioSessionManager2)o).GetSessionEnumerator(out list);
      int count; list.GetCount(out count);
      float found = -1;
      for (int i = 0; i < count; i++) {
        IAudioSessionControl2 s; list.GetSession(i, out s);
        uint pid; s.GetProcessId(out pid);
        string name;
        try { name = Process.GetProcessById((int)pid).ProcessName; } catch { continue; }
        if (name.IndexOf(args[1], StringComparison.OrdinalIgnoreCase) < 0) continue;
        var vol = (ISimpleAudioVolume)s;
        if (set) { var g = Guid.Empty; vol.SetMasterVolume(level, ref g); } // todas sus sesiones (Spotify abre varias)
        float v; vol.GetMasterVolume(out v);
        if (found < 0) found = v;
      }
      Console.WriteLine("{\"v\":" + (found < 0 ? -1 : (int)Math.Round(found * 100)) + "}");
      return 0;
    } catch (Exception e) {
      Console.WriteLine("{\"error\":\"" + e.GetType().Name + "\"}");
      return 1;
    }
  }
}
