// Nimbo como barra de tareas: lista las ventanas abiertas (las mismas que muestra Alt+Tab), cambia entre ellas y prende o apaga el
// auto-ocultar de la barra de Windows. Lo compila windows.js con el csc.exe que trae Windows (sin instalar nada) y lo lanza Nimbo.
// Escribe una línea JSON con la lista cada vez que cambia: [{"h":"123","t":"título","p":"C:\\ruta.exe","d":"descripción","m":false,"f":true}]
// Lee órdenes por la entrada estándar: focus <h> · min <h> · close <h> · autohide 1|0 · state
// Argumentos: el id del proceso de Nimbo (si Nimbo deja de existir, este programa se cierra solo) y "hide": esconder la barra de Windows
// mientras corre. El auto-ocultar de Windows NO basta: con un botón parpadeando (WhatsApp, Brave pidiendo atención) la barra se queda
// a la vista. Así que se esconde de verdad y solo sale con el mouse en el borde de abajo (o con Inicio abierto); al salir se devuelve.
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
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder s, ref int n);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetApplicationUserModelId(IntPtr h, ref uint n, StringBuilder s);
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32 e);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32 e);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct PROCESSENTRY32 { public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID, cntThreads, th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT mon, work; public uint flags; }

  [StructLayout(LayoutKind.Sequential)]
  struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public int left, top, right, bottom; public IntPtr lParam; }
  [DllImport("shell32.dll")] static extern IntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
  const uint ABM_GETSTATE = 4, ABM_SETSTATE = 10;

  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000, WS_EX_NOACTIVATE = 0x8000000;
  const uint GW_OWNER = 4;
  const int SW_RESTORE = 9, SW_MINIMIZE = 6, SW_HIDE = 0, SW_SHOWNA = 8;
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
  // Apps de la Tienda: su identificador (AUMID). Con él Nimbo puede abrirlas cuando están ancladas y cerradas (shell:AppsFolder\<id>).
  static readonly Dictionary<uint, string> aumids = new Dictionary<uint, string>();
  static string AumidOf(uint pid) {
    string a;
    if (aumids.TryGetValue(pid, out a)) return a;
    a = "";
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h != IntPtr.Zero) {
      var sb = new StringBuilder(256); uint n = 256;
      if (GetApplicationUserModelId(h, ref n, sb) == 0) a = sb.ToString();
      CloseHandle(h);
    }
    aumids[pid] = a;
    return a;
  }
  // Programas cuya ventana es de un proceso ayudante (Steam: steamwebhelper.exe): se usa el programa que lo abrió, que es el que
  // hay que abrir al anclarlo y el que tiene el nombre y el ícono de verdad.
  static readonly Dictionary<uint, uint> owners = new Dictionary<uint, uint>();
  static uint OwnerOf(uint pid) {
    uint o;
    if (owners.TryGetValue(pid, out o)) return o;
    o = pid;
    IntPtr snap = CreateToolhelp32Snapshot(2, 0); // TH32CS_SNAPPROCESS
    if (snap != new IntPtr(-1)) {
      var e = new PROCESSENTRY32(); e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
      for (bool ok = Process32FirstW(snap, ref e); ok; ok = Process32NextW(snap, ref e)) if (e.th32ProcessID == pid) { o = e.th32ParentProcessID; break; }
      CloseHandle(snap);
    }
    owners[pid] = o;
    return o;
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
      uint real = pid;
      for (int up = 0; up < 3 && System.IO.Path.GetFileName(path).IndexOf("helper", StringComparison.OrdinalIgnoreCase) >= 0; up++) {
        uint parentPid = OwnerOf(real);
        string pp = parentPid != real ? PathOf(parentPid) : "";
        if (pp == "") break;
        real = parentPid; path = pp;
      }
      // Apps de la Tienda: la ventana es de ApplicationFrameHost; el programa real es su ventana hija de otro proceso.
      if (path.EndsWith("ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase)) {
        uint host = pid;
        EnumChildWindows(h, (c, l2) => { uint p2; GetWindowThreadProcessId(c, out p2); if (p2 != host) { path = PathOf(p2); real = p2; return false; } return true; }, IntPtr.Zero);
      }
      if (!first) sb.Append(',');
      first = false;
      sb.Append("{\"h\":\"").Append(h.ToInt64()).Append("\",\"t\":\"").Append(Esc(t.ToString())).Append("\",\"p\":\"").Append(Esc(path))
        .Append("\",\"d\":\"").Append(Esc(DescOf(path))).Append("\",\"m\":").Append(IsIconic(h) ? "true" : "false")
        .Append(",\"f\":").Append(h == fg ? "true" : "false");
      if (path.IndexOf("\\WindowsApps\\", StringComparison.OrdinalIgnoreCase) >= 0) sb.Append(",\"a\":\"").Append(Esc(AumidOf(real))).Append('"');
      sb.Append('}');
      return true;
    }, IntPtr.Zero);
    return sb.Append(']').ToString();
  }

  // Entrada y salida directas (sin consola: Nimbo lo lanza suelto, sin ventana de consola, y Console.OutputEncoding fallaría).
  static readonly System.IO.StreamWriter output = new System.IO.StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
  static void Say(string line) { lock (outLock) { output.Write(line + "\n"); output.Flush(); } }

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

  // --- Esconder la barra de Windows (una por pantalla) ---
  static volatile bool quitting = false;
  static volatile bool watching = false;
  static int parent = 0; // el proceso de Nimbo
  // (La barra misma no cuenta: al cerrarse una ventana Windows le pasa el foco y se quedaría a la vista.)
  static readonly HashSet<string> SHELL = new HashSet<string> { "NotifyIconOverflowWindow",
    "TopLevelWindowForOverflowXamlIsland", "Xaml_WindowedPopupClass", "Windows.UI.Core.CoreWindow" }; // Inicio, búsqueda, reloj, íconos ocultos
  static string ClassOf(IntPtr h) { var c = new StringBuilder(64); GetClassName(h, c, 64); return c.ToString(); }
  static List<IntPtr> Trays() {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { string c = ClassOf(h); if (c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  static void ShowTrays() { foreach (var t in Trays()) if (!IsWindowVisible(t)) ShowWindow(t, SW_SHOWNA); }
  static void TrayLoop() {
    try { TrayTick(); } catch { quitting = true; ShowTrays(); }
  }
  static void TrayTick() {
    var near = new Dictionary<IntPtr, DateTime>(); // última vez que el mouse (o Inicio abierto en esa pantalla) la necesitó
    while (!quitting) {
      POINT p; GetCursorPos(out p);
      IntPtr fg = GetForegroundWindow();
      IntPtr fgMon = SHELL.Contains(ClassOf(fg)) ? MonitorFromWindow(fg, 2) : IntPtr.Zero;
      foreach (var t in Trays()) {
        IntPtr mon = MonitorFromWindow(t, 2);
        var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(mon, ref mi)) continue;
        RECT r; GetWindowRect(t, out r);
        bool edge = p.x >= mi.mon.l && p.x < mi.mon.r && p.y >= mi.mon.b - 2 && p.y < mi.mon.b;
        bool onBar = IsWindowVisible(t) && p.x >= r.l && p.x < r.r && p.y >= r.t && p.y < r.b;
        if (edge || onBar || mon == fgMon) near[t] = DateTime.UtcNow;
        DateTime last;
        bool keep = near.TryGetValue(t, out last) && (DateTime.UtcNow - last).TotalMilliseconds < 700;
        if (quitting) break;
        if (keep != IsWindowVisible(t)) ShowWindow(t, keep ? SW_SHOWNA : SW_HIDE);
      }
      Thread.Sleep(150);
    }
  }
  static void Quit() { quitting = true; Thread.Sleep(200); ShowTrays(); Environment.Exit(0); }

  static void Main(string[] args) {
    parent = args.Length > 0 ? int.Parse(args[0]) : 0;
    // Pase lo que pase (hasta un error), la barra de Windows no se queda escondida.
    AppDomain.CurrentDomain.UnhandledException += (s, e) => { quitting = true; ShowTrays(); };
    if (args.Length > 1 && args[1] == "hide") new Thread(TrayLoop) { IsBackground = true }.Start();
    var reader = new Thread(() => {
      string line;
      var input = new System.IO.StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
      while ((line = input.ReadLine()) != null) {
        var parts = line.Trim().Split(' ');
        try {
          IntPtr h = parts.Length > 1 ? new IntPtr(long.Parse(parts[1])) : IntPtr.Zero;
          switch (parts[0]) {
            case "focus": if (IsWindow(h) && IsAppWindow(h)) Focus(h); break;
            case "min": if (IsWindow(h) && IsAppWindow(h)) ShowWindow(h, SW_MINIMIZE); break;
            case "close": if (IsWindow(h) && IsAppWindow(h)) PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero); break;
            case "autohide": SetAutoHide(parts.Length > 1 && parts[1] == "1"); Say("{\"autohide\":" + AutoHide() + "}"); break;
            case "state": Say("{\"autohide\":" + AutoHide() + "}"); break;
            // Vigila el botón izquierdo del mouse hasta que lo suelten (mientras arrastran a Nimbo): lo avisa una sola vez.
            case "watchlb": if (!watching) { watching = true; new Thread(() => { Thread.Sleep(150); while ((GetAsyncKeyState(0x01) & 0x8000) != 0 && !quitting) Thread.Sleep(15); watching = false; Say("{\"lb\":0}"); }) { IsBackground = true }.Start(); } break;
          }
        } catch { }
      }
      Quit(); // Nimbo cerró la entrada: se terminó (y la barra vuelve)
    });
    reader.IsBackground = true;
    reader.Start();
    Say("{\"hello\":1}"); // saludo YA: Nimbo sabe que arrancó aunque la primera lista tarde (al encender el PC puede tardar)
    string last = "";
    while (true) {
      if (parent != 0) { try { Process.GetProcessById(parent); } catch { Quit(); } } // Nimbo se cerró de golpe: la barra vuelve
      string now = List();
      if (now != last) { last = now; Say("{\"windows\":" + now + "}"); }
      Thread.Sleep(400);
    }
  }
}
