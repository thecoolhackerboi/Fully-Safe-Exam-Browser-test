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
        private const int VK_F4 = 0x73;

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
        private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);

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

        // COM Interop for Windows 10/11 Virtual Desktop Pinning
        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("6D5140C1-7436-11CE-8034-00AA006009FA")]
        private interface IServiceProvider
        {
            [PreserveSig]
            int QueryService(ref Guid guidService, ref Guid riid, out IntPtr ppvObject);
        }

        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("1841C6D7-4F9D-42C0-AF41-8747538F10E5")]
        private interface IApplicationViewCollection
        {
            void GetViews(out IntPtr array);
            void GetViewForHwnd(IntPtr hwnd, out IntPtr view);
        }

        [ComImport]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("4CE81583-1E4C-4632-A621-07A53543148F")]
        private interface IVirtualDesktopPinnedApps
        {
            bool IsAppIdPinned(string appId);
            void PinAppID(string appId);
            void UnpinAppID(string appId);
            bool IsViewPinned(IntPtr applicationView);
            void PinView(IntPtr applicationView);
            void UnpinView(IntPtr applicationView);
        }

        private static IntPtr _hookId = IntPtr.Zero;
        private static LowLevelKeyboardProc _hookCallback;
        private static volatile bool _isLocked = false;
        private static IntPtr _fsebHwnd = IntPtr.Zero;

        // Modifier key states tracked directly in the hook (handles both physical and injected keys)
        private static volatile bool _winDown = false;
        private static volatile bool _ctrlDown = false;
        private static volatile bool _altDown = false;

        private static int _origFourFingerSlide = 2;
        private static int _origThreeFingerSlide = 65535;
        private static bool _savedTouchpad = false;

        public static void Main(string[] args)
        {
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

            // Background thread to snap foreground back if anything attempts to defocus FSEB
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
                                PinWindowToAllDesktops(_fsebHwnd);
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
                        IntPtr fg = GetForegroundWindow();
                        if (fg != _fsebHwnd && fg != IntPtr.Zero)
                        {
                            // Reclaim foreground immediately
                            SetWindowPos(_fsebHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW);
                            SetForegroundWindow(_fsebHwnd);
                        }
                    }
                }
                catch {}
                Thread.Sleep(25);
            }
        }

        private static void PinWindowToAllDesktops(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return;
            try
            {
                Guid CLSID_ImmersiveShell = new Guid("C2F03A33-21F5-47FA-B4BB-156362A2F239");
                Type shellType = Type.GetTypeFromCLSID(CLSID_ImmersiveShell);
                object shell = Activator.CreateInstance(shellType);
                IServiceProvider sp = (IServiceProvider)shell;

                Guid IID_IApplicationViewCollection = new Guid("1841C6D7-4F9D-42C0-AF41-8747538F10E5");
                Guid IID_IVirtualDesktopPinnedApps = new Guid("4CE81583-1E4C-4632-A621-07A53543148F");

                IntPtr pViewCollection;
                sp.QueryService(ref IID_IApplicationViewCollection, ref IID_IApplicationViewCollection, out pViewCollection);
                IntPtr pPinnedApps;
                sp.QueryService(ref IID_IVirtualDesktopPinnedApps, ref IID_IVirtualDesktopPinnedApps, out pPinnedApps);

                if (pViewCollection != IntPtr.Zero && pPinnedApps != IntPtr.Zero)
                {
                    IApplicationViewCollection viewCollection = (IApplicationViewCollection)Marshal.GetObjectForIUnknown(pViewCollection);
                    IVirtualDesktopPinnedApps pinnedApps = (IVirtualDesktopPinnedApps)Marshal.GetObjectForIUnknown(pPinnedApps);
                    IntPtr view;
                    viewCollection.GetViewForHwnd(hWnd, out view);
                    if (view != IntPtr.Zero && !pinnedApps.IsViewPinned(view))
                    {
                        pinnedApps.PinView(view);
                    }
                }
            }
            catch {}
        }

        private static void CloseExtraVirtualDesktops()
        {
            // Closes any secondary/ghost virtual desktops (Ctrl+Win+F4)
            // Once all other virtual desktops are closed, 4-finger swipes have nowhere to switch
            for (int i = 0; i < 6; i++)
            {
                keybd_event((byte)VK_CONTROL, 0, 0, UIntPtr.Zero);
                keybd_event((byte)VK_LWIN, 0, 0, UIntPtr.Zero);
                keybd_event((byte)VK_F4, 0, 0, UIntPtr.Zero);

                keybd_event((byte)VK_F4, 0, 2 /* KEYEVENTF_KEYUP */, UIntPtr.Zero);
                keybd_event((byte)VK_LWIN, 0, 2, UIntPtr.Zero);
                keybd_event((byte)VK_CONTROL, 0, 2, UIntPtr.Zero);
                Thread.Sleep(20);
            }
        }

        private static void ApplyLockdown()
        {
            _isLocked = true;

            // 1. Hide Windows Taskbar
            HideWindowsTaskbar(true);

            // 2. Close any extra virtual desktops so only Desktop 1 remains
            CloseExtraVirtualDesktops();

            // 3. Pin FSEB window to all virtual desktops
            if (_fsebHwnd != IntPtr.Zero)
            {
                PinWindowToAllDesktops(_fsebHwnd);
                SetWindowPos(_fsebHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW);
                SetForegroundWindow(_fsebHwnd);
            }

            // 4. In-memory registry lockdown for precision touchpad
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad", true))
                {
                    if (key != null)
                    {
                        if (!_savedTouchpad)
                        {
                            object val4 = key.GetValue("FourFingerSlideEnabled");
                            if (val4 is int) _origFourFingerSlide = (int)val4;
                            object val3 = key.GetValue("ThreeFingerSlideEnabled");
                            if (val3 is int) _origThreeFingerSlide = (int)val3;
                            _savedTouchpad = true;
                        }

                        key.SetValue("FourFingerSlideEnabled", 0, RegistryValueKind.DWord);
                        key.SetValue("ThreeFingerSlideEnabled", 0, RegistryValueKind.DWord);
                        key.SetValue("FourFingerTapEnabled", 0, RegistryValueKind.DWord);
                        key.SetValue("ThreeFingerTapEnabled", 0, RegistryValueKind.DWord);
                        key.SetValue("FourFingerUp", 0, RegistryValueKind.DWord);
                        key.SetValue("FourFingerDown", 0, RegistryValueKind.DWord);
                        key.SetValue("FourFingerLeft", 0, RegistryValueKind.DWord);
                        key.SetValue("FourFingerRight", 0, RegistryValueKind.DWord);
                        key.SetValue("ThreeFingerUp", 0, RegistryValueKind.DWord);
                        key.SetValue("ThreeFingerDown", 0, RegistryValueKind.DWord);
                        key.SetValue("ThreeFingerLeft", 0, RegistryValueKind.DWord);
                        key.SetValue("ThreeFingerRight", 0, RegistryValueKind.DWord);
                    }
                }
                UIntPtr res;
                SendMessageTimeout((IntPtr)0xffff, 0x001A, UIntPtr.Zero, "Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad", 2, 50, out res);
            }
            catch {}
        }

        private static void RestoreLockdown()
        {
            _isLocked = false;

            // 1. Show Windows Taskbar
            HideWindowsTaskbar(false);

            // 2. Restore Touchpad
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad", true))
                {
                    if (key != null && _savedTouchpad)
                    {
                        key.SetValue("FourFingerSlideEnabled", _origFourFingerSlide, RegistryValueKind.DWord);
                        key.SetValue("ThreeFingerSlideEnabled", _origThreeFingerSlide, RegistryValueKind.DWord);
                        key.SetValue("FourFingerUp", 2, RegistryValueKind.DWord);
                        key.SetValue("FourFingerDown", 3, RegistryValueKind.DWord);
                        key.SetValue("FourFingerLeft", 4, RegistryValueKind.DWord);
                        key.SetValue("FourFingerRight", 4, RegistryValueKind.DWord);
                    }
                }
                UIntPtr res;
                SendMessageTimeout((IntPtr)0xffff, 0x001A, UIntPtr.Zero, "Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad", 2, 50, out res);
            }
            catch {}
        }

        private static void RestoreSystem()
        {
            _isLocked = false;
            if (_hookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_hookId);
                _hookId = IntPtr.Zero;
            }
            HideWindowsTaskbar(false);
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad", true))
                {
                    if (key != null && _savedTouchpad)
                    {
                        key.SetValue("FourFingerSlideEnabled", _origFourFingerSlide, RegistryValueKind.DWord);
                        key.SetValue("ThreeFingerSlideEnabled", _origThreeFingerSlide, RegistryValueKind.DWord);
                        key.SetValue("FourFingerUp", 2, RegistryValueKind.DWord);
                        key.SetValue("FourFingerDown", 3, RegistryValueKind.DWord);
                        key.SetValue("FourFingerLeft", 4, RegistryValueKind.DWord);
                        key.SetValue("FourFingerRight", 4, RegistryValueKind.DWord);
                    }
                }
                UIntPtr res;
                SendMessageTimeout((IntPtr)0xffff, 0x001A, UIntPtr.Zero, "Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad", 2, 50, out res);
            }
            catch {}
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

                // Track modifier key states from actual event stream (works for both physical and synthetic inputs)
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
                }
            }

            return CallNextHookEx(_hookId, nCode, wParam, lParam);
        }
    }
}
