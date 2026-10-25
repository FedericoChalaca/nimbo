// Nimbo como barra de tareas: lista las ventanas abiertas (las mismas que muestra Alt+Tab), cambia entre ellas y prende o apaga el
// auto-ocultar de la barra de Windows. Lo compila windows.js con el csc.exe que trae Windows (sin instalar nada) y lo lanza Nimbo.
// Escribe una línea JSON con la lista cada vez que cambia: [{"h":"123","t":"título","p":"C:\\ruta.exe","d":"descripción","m":false,"f":true}]
// Lee órdenes por la entrada estándar: focus <h> · min <h> · close <h> · autohide 1|0 · state
// Argumento: el id del proceso de Nimbo; si Nimbo deja de existir, este programa se cierra solo.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Ventanas {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder s, ref int n);

  [StructLayout(LayoutKind.Sequential)]
  struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public int left, top, right, bottom; public IntPtr lParam; }
  [DllImport("shell32.dll")] static extern IntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
  const uint ABM_GETSTATE = 4, ABM_SETSTATE = 10;

  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000, WS_EX_NOACTIVATE = 0x8000000;
  const uint GW_OWNER = 4;
  const int SW_RESTORE = 9, SW_MINIMIZE = 6;
  const uint WM_CLOSE = 0x10;

  static readonly Dictionary<uint, string> paths = new Dictionary<uint, string>();
  static readonly Dictionary<string, string> descs = new Dictionary<string, string>();
  static readonly object outLock = new object();

  static string PathOf(uint pid) {
    string p;
    if (paths.TryGetValue(pid, out p)) return p;
    p = "";
    IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
    if (h != IntPtr.Zero) {
      var sb = new StringBuilder(1024); int n = sb.Capacity;
      if (QueryFullProcessImageName(h, 0, sb, ref n)) p = sb.ToString();
      CloseHandle(h);
    }
    paths[pid] = p;
    return p;
  }
  static string DescOf(string path) {
    if (path == "") return "";
    string d;
    if (descs.TryGetValue(path, out d)) return d;
    try { d = FileVersionInfo.GetVersionInfo(path).FileDescription ?? ""; } catch { d = ""; }
    descs[path] = d.Trim();
    return descs[path];
  }

  // Las mismas reglas que Alt+Tab: visible, sin dueño, que no sea ventana de herramientas y que no esté "escondida" por Windows (cloaked).
  static bool IsAppWindow(IntPtr h) {
    if (!IsWindowVisible(h) || GetWindow(h, GW_OWNER) != IntPtr.Zero) return false;
    int ex = GetWindowLong(h, GWL_EXSTYLE);
    if ((ex & WS_EX_TOOLWINDOW) != 0 && (ex & WS_EX_APPWINDOW) == 0) return false;
    if ((ex & WS_EX_NOACTIVATE) != 0 && (ex & WS_EX_APPWINDOW) == 0) return false;
    int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
    var t = new StringBuilder(8); if (GetWindowText(h, t, 8) == 0) return false;
    var c = new StringBuilder(64); GetClassName(h, c, 64);
    string cls = c.ToString();
    return cls != "Progman" && cls != "Shell_TrayWnd" && cls != "Shell_SecondaryTrayWnd";
  }

  static string Esc(string s) {
    var sb = new StringBuilder(s.Length + 8);
    foreach (char ch in s) {
      if (ch == '"' || ch == '\\') { sb.Append('\\').Append(ch); }
      else if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
      else sb.Append(ch);
    }
    return sb.ToString();
  }

  static string List() {
    var fg = GetForegroundWindow();
    var sb = new StringBuilder("[");
    bool first = true;
    EnumWindows((h, l) => {
      if (!IsAppWindow(h)) return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      uint pid; GetWindowThreadProcessId(h, out pid);
      string path = PathOf(pid);
      // Apps de la Tienda: la ventana es de ApplicationFrameHost; el programa real es su ventana hija de otro proceso.
      if (path.EndsWith("ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase)) {
        uint host = pid;
        EnumChildWindows(h, (c, l2) => { uint p2; GetWindowThreadProcessId(c, out p2); if (p2 != host) { path = PathOf(p2); return false; } return true; }, IntPtr.Zero);
      }
      if (!first) sb.Append(',');
      first = false;
      sb.Append("{\"h\":\"").Append(h.ToInt64()).Append("\",\"t\":\"").Append(Esc(t.ToString())).Append("\",\"p\":\"").Append(Esc(path))
        .Append("\",\"d\":\"").Append(Esc(DescOf(path))).Append("\",\"m\":").Append(IsIconic(h) ? "true" : "false")
        .Append(",\"f\":").Append(h == fg ? "true" : "false").Append('}');
      return true;
    }, IntPtr.Zero);
    return sb.Append(']').ToString();
  }

  static void Say(string line) { lock (outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); } }

  // Traer una ventana al frente: Windows no deja que cualquier proceso "robe" el foco; se une un momento a la cola de entrada de la
  // ventana que lo tiene (AttachThreadInput) y, si aun así no lo suelta, se simula soltar la tecla Alt (truco conocido y sin efectos).
  static void Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
    IntPtr fg = GetForegroundWindow();
    uint pid; uint fgThread = GetWindowThreadProcessId(fg, out pid), me = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    BringWindowToTop(h);
    bool ok = SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);
    if (!ok) { keybd_event(0x12, 0, 0x2, UIntPtr.Zero); SetForegroundWindow(h); }
  }

  static int AutoHide() {
    var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
    return (SHAppBarMessage(ABM_GETSTATE, ref d).ToInt32() & 1) != 0 ? 1 : 0;
  }
  static void SetAutoHide(bool on) {
    var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
    d.hWnd = FindWindow("Shell_TrayWnd", null);
    d.lParam = (IntPtr)(on ? 1 : 2); // ABS_AUTOHIDE · ABS_ALWAYSONTOP
    SHAppBarMessage(ABM_SETSTATE, ref d);
  }

  static void Main(string[] args) {
    int parent = args.Length > 0 ? int.Parse(args[0]) : 0;
    Console.OutputEncoding = new UTF8Encoding(false);
    var reader = new Thread(() => {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        var parts = line.Trim().Split(' ');
        try {
          IntPtr h = parts.Length > 1 ? new IntPtr(long.Parse(parts[1])) : IntPtr.Zero;
          switch (parts[0]) {
            case "focus": if (IsWindow(h) && IsAppWindow(h)) Focus(h); break;
            case "min": if (IsWindow(h) && IsAppWindow(h)) ShowWindow(h, SW_MINIMIZE); break;
            case "close": if (IsWindow(h) && IsAppWindow(h)) PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero); break;
            case "autohide": SetAutoHide(parts.Length > 1 && parts[1] == "1"); Say("{\"autohide\":" + AutoHide() + "}"); break;
            case "state": Say("{\"autohide\":" + AutoHide() + "}"); break;
          }
        } catch { }
      }
      Environment.Exit(0); // Nimbo cerró la entrada: se terminó
    });
    reader.IsBackground = true;
    reader.Start();
    string last = "";
    while (true) {
      if (parent != 0) { try { Process.GetProcessById(parent); } catch { return; } }
      string now = List();
      if (now != last) { last = now; Say("{\"windows\":" + now + "}"); }
      Thread.Sleep(400);
    }
  }
}
