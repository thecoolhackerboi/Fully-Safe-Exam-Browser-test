using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32;

namespace FSEB.Native
{
    public static class Program
    {
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;

        private const int VK_TAB = 0x09;
        private const int VK_ESCAPE = 0x1B;
        private const int VK_LEFT = 0x25;
        private const int VK_UP = 0x26;
        private const int VK_RIGHT = 0x27;
        private const int VK_DOWN = 0x28;
        private const int VK_LWIN = 0x5B;
        private const int VK_RWIN = 0x5C;
        private const int VK_CONTROL = 0x11;
        private const int VK_MENU = 0x12; // Alt
        private const int VK_D = 0x44;
        private const int VK_M = 0x4D;
        private const int VK_L = 0x4C;
        private const int VK_C = 0x43;
        private const int VK_V = 0x56;
        private const int VK_X = 0x58;
        private const int VK_INSERT = 0x2D;
        private const int VK_SHIFT = 0x10;

        private const int SW_HIDE = 0;
        private const int SW_SHOW = 5;

        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_SHOWWINDOW = 0x0040;
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        private static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern void PostQuitMessage(int nExitCode);

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int pt_x;
            public int pt_y;
        }

        // Official public Win32 Virtual Desktop Manager COM interface
        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("a5cd92dd-0160-485a-9f0b-488f75f32cd8")]
        private interface IVirtualDesktopManager
        {
            [PreserveSig]
            int IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow, out bool onCurrentDesktop);

            [PreserveSig]
            int GetWindowDesktopId(IntPtr topLevelWindow, out Guid desktopId);

            [PreserveSig]
            int MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
        }

        private static readonly Guid CLSID_VirtualDesktopManager = new Guid("aa509085-ecd9-4eab-864b-1238d9634ec2");
        private static IVirtualDesktopManager _vdm = null;

        private static IntPtr _hookId = IntPtr.Zero;
        private static LowLevelKeyboardProc _hookCallback;
        private static volatile bool _isLocked = false;
        private static IntPtr _fsebHwnd = IntPtr.Zero;

        // Modifier key states tracked directly on the event stream
        private static volatile bool _winDown = false;
        private static volatile bool _ctrlDown = false;
        private static volatile bool _altDown = false;

        public static void Main(string[] args)
        {
            // Initialize IVirtualDesktopManager
            try
            {
                Type vdmType = Type.GetTypeFromCLSID(CLSID_VirtualDesktopManager);
                _vdm = (IVirtualDesktopManager)Activator.CreateInstance(vdmType);
            }
            catch {}

            // Install LowLevelKeyboardProc
            _hookCallback = HookCallback;
            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule)
            {
                _hookId = SetWindowsHookEx(WH_KEYBOARD_LL, _hookCallback, GetModuleHandle(curModule.ModuleName), 0);
            }

            // Reader thread for stdin commands from Electron
            Thread inputThread = new Thread(ProcessCommands)
            {
                IsBackground = true
            };
            inputThread.Start();

            // Background thread to snap foreground and virtual desktop back instantaneously
            Thread monitorThread = new Thread(MonitorForegroundLoop)
            {
                IsBackground = true
            };
            monitorThread.Start();

            // Notify parent ready
            Console.WriteLine("READY");
            Console.Out.Flush();

            // Win32 message pump for the hook
            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0))
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            // Cleanup on shutdown
            RestoreSystem();
        }

        private static void ProcessCommands()
        {
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (line.StartsWith("ATTACH", StringComparison.OrdinalIgnoreCase))
                    {
                        string[] parts = line.Split(' ');
                        if (parts.Length > 1)
                        {
                            long handleVal;
                            if (long.TryParse(parts[1], out handleVal))
                            {
                                _fsebHwnd = new IntPtr(handleVal);
                                Console.WriteLine("ATTACH_OK");
                                Console.Out.Flush();
                            }
                        }
                    }
                    else if (string.Equals(line, "LOCK_ON", StringComparison.OrdinalIgnoreCase))
                    {
                        ApplyLockdown();
                        Console.WriteLine("LOCK_ON_OK");
                        Console.Out.Flush();
                    }
                    else if (string.Equals(line, "LOCK_OFF", StringComparison.OrdinalIgnoreCase))
                    {
                        RestoreLockdown();
                        Console.WriteLine("LOCK_OFF_OK");
                        Console.Out.Flush();
                    }
                    else if (string.Equals(line, "QUIT", StringComparison.OrdinalIgnoreCase))
                    {
                        break;
                    }
                }
            }
            catch {}
            finally
            {
                RestoreSystem();
                PostQuitMessage(0);
                Environment.Exit(0);
            }
        }

        private static void MonitorForegroundLoop()
        {
            while (true)
            {
                try
                {
                    if (_isLocked && _fsebHwnd != IntPtr.Zero)
                    {
                        // 1. Detect if user swiped to another virtual desktop and follow them instantly
                        if (_vdm != null)
                        {
                            bool onCurrent = true;
                            int hr = _vdm.IsWindowOnCurrentVirtualDesktop(_fsebHwnd, out onCurrent);
                            if (hr == 0 && !onCurrent)
                            {
                                // The user has swiped to another virtual desktop!
                                // Read the active virtual desktop GUID from registry
                                byte[] curBytes = (byte[])Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops", "CurrentVirtualDesktop", null);
                                if (curBytes != null && curBytes.Length == 16)
                                {
                                    Guid curGuid = new Guid(curBytes);
                                    _vdm.MoveWindowToDesktop(_fsebHwnd, ref curGuid);
                                }
                                SetWindowPos(_fsebHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW);
                                SetForegroundWindow(_fsebHwnd);
                            }
                        }

                        // 2. Detect if another window or desktop background has foreground
                        IntPtr fg = GetForegroundWindow();
                        if (fg != _fsebHwnd)
                        {
                            SetWindowPos(_fsebHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW);
                            SetForegroundWindow(_fsebHwnd);
                        }
                    }
                }
                catch {}
                Thread.Sleep(15);
            }
        }

        private static void ApplyLockdown()
        {
            _isLocked = true;

            // 1. Hide Windows Taskbar
            HideWindowsTaskbar(true);

            // 2. Ensure FSEB window is on current virtual desktop and foreground
            if (_fsebHwnd != IntPtr.Zero)
            {
                SetWindowPos(_fsebHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW);
                SetForegroundWindow(_fsebHwnd);
            }
        }

        private static void RestoreLockdown()
        {
            _isLocked = false;
            // CRITICAL: DO NOT show Windows Taskbar here!
            // FSEB is still fullscreen. Showing the taskbar on toggle-off causes the Windows taskbar
            // to flash or pop up over the bottom bar. The Windows taskbar is only restored when FSEB quits.
        }

        private static void RestoreSystem()
        {
            _isLocked = false;
            if (_hookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_hookId);
                _hookId = IntPtr.Zero;
            }
            // Only restore Windows taskbar when FSEB is completely quitting
            HideWindowsTaskbar(false);
        }

        private static void HideWindowsTaskbar(bool hide)
        {
            try
            {
                int cmd = hide ? SW_HIDE : SW_SHOW;
                IntPtr tray = FindWindow("Shell_TrayWnd", null);
                if (tray != IntPtr.Zero) ShowWindow(tray, cmd);
                IntPtr secTray = FindWindow("Shell_SecondaryTrayWnd", null);
                if (secTray != IntPtr.Zero) ShowWindow(secTray, cmd);
            }
            catch {}
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                KBDLLHOOKSTRUCT kbd = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                bool isKeyDown = (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN);
                bool isKeyUp = (wParam == (IntPtr)WM_KEYUP || wParam == (IntPtr)WM_SYSKEYUP);

                // Track modifier key states from actual event stream (works for physical and driver-injected events)
                if (kbd.vkCode == VK_LWIN || kbd.vkCode == VK_RWIN)
                {
                    _winDown = isKeyDown;
                }
                else if (kbd.vkCode == VK_CONTROL)
                {
                    _ctrlDown = isKeyDown;
                }
                else if (kbd.vkCode == VK_MENU)
                {
                    _altDown = isKeyDown;
                }

                bool isAlt = _altDown || (kbd.flags & 0x20) != 0 || (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
                bool isCtrl = _ctrlDown || (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
                bool isWin = _winDown || (GetAsyncKeyState(VK_LWIN) & 0x8000) != 0 || (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0;

                // Check for Ctrl+Alt+L secret combination toggle
                if (kbd.vkCode == VK_L && isCtrl && isAlt)
                {
                    if (isKeyDown)
                    {
                        Console.WriteLine("TOGGLE");
                        Console.Out.Flush();
                    }
                    return (IntPtr)1; // Drop so it does not type 'l' into editors
                }

                if (_isLocked)
                {
                    // 1. Block Alt+Tab completely - prevents Alt+Tab menu from being displayed by Windows
                    if (kbd.vkCode == VK_TAB && (isAlt || isWin))
                    {
                        return (IntPtr)1;
                    }

                    // 2. Block all Windows keys (Start Menu, Win+D, Win+M, Win+Tab, Win+Arrows)
                    if (kbd.vkCode == VK_LWIN || kbd.vkCode == VK_RWIN || isWin)
                    {
                        return (IntPtr)1;
                    }

                    // 3. Block Virtual Desktop switching (Ctrl+Win+Left/Right, Ctrl+Alt+Left/Right, Win+Left/Right)
                    if (kbd.vkCode == VK_LEFT || kbd.vkCode == VK_RIGHT || kbd.vkCode == VK_UP || kbd.vkCode == VK_DOWN)
                    {
                        if (isWin || (isCtrl && isAlt))
                        {
                            return (IntPtr)1;
                        }
                    }

                    // 4. Block Alt+Esc, Ctrl+Esc (Task switching)
                    if (kbd.vkCode == VK_ESCAPE && (isAlt || isCtrl))
                    {
                        return (IntPtr)1;
                    }

                    // 5. Block Clipboard operations (Ctrl+C, Ctrl+V, Ctrl+X, Alt+C, Alt+V, Alt+X, Ctrl+Insert, Shift+Insert) in Stale State
                    if ((kbd.vkCode == VK_C || kbd.vkCode == VK_V || kbd.vkCode == VK_X) && (isCtrl || isAlt))
                    {
                        return (IntPtr)1;
                    }
                    if (kbd.vkCode == VK_INSERT)
                    {
                        bool isShift = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
                        if (isCtrl || isShift)
                        {
                            return (IntPtr)1;
                        }
                    }
                }
            }

            return CallNextHookEx(_hookId, nCode, wParam, lParam);
        }
    }
}
