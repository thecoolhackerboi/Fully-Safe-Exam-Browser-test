import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import { Logger } from '../Core/Logger';

export class NativeLockdown {
  private static readonly logger = Logger.getInstance();
  private static helperProcess: ChildProcess | null = null;
  private static isLocked: boolean = false;
  private static onToggleCallback: (() => void) | null = null;

  /**
   * Discovers the absolute path to FsebLockdownHelper.exe across development and packaged environments
   */
  public static getHelperBinaryPath(): string | null {
    const candidates = [
      path.resolve(__dirname, '../../bin/FsebLockdownHelper.exe'),
      path.resolve(__dirname, '../bin/FsebLockdownHelper.exe'),
      path.resolve(__dirname, 'bin/FsebLockdownHelper.exe'),
      path.join(process.cwd(), 'bin', 'FsebLockdownHelper.exe'),
    ];

    if (app && app.isPackaged) {
      candidates.unshift(
        path.join(process.resourcesPath, 'bin', 'FsebLockdownHelper.exe'),
        path.join(path.dirname(app.getPath('exe')), 'bin', 'FsebLockdownHelper.exe')
      );
    }

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Initializes the native background helper that hooks WH_KEYBOARD_LL and hides the Windows taskbar
   */
  public static initialize(onToggle?: () => void): void {
    if (process.platform !== 'win32') return;
    if (this.helperProcess) return;

    if (onToggle) {
      this.onToggleCallback = onToggle;
    }

    const helperExe = this.getHelperBinaryPath();
    if (!helperExe) {
      this.logger.warn('NativeLockdown', 'FsebLockdownHelper.exe not found on disk.');
      return;
    }

    try {
      this.helperProcess = spawn(helperExe, [], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });

      this.helperProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === 'TOGGLE') {
            this.logger.info('NativeLockdown', 'Secret combination Ctrl+Alt+L received from native low-level hook.');
            this.onToggleCallback?.();
          }
        }
      });

      this.helperProcess.on('error', (err) => {
        this.logger.warn('NativeLockdown', 'Helper process encountered an error', { error: err.message });
      });

      this.helperProcess.on('exit', () => {
        this.helperProcess = null;
      });

      this.logger.info('NativeLockdown', `Native lockdown helper process spawned from: ${helperExe}`);
    } catch (err) {
      this.logger.error('NativeLockdown', 'Failed to launch native lockdown helper', { error: String(err) });
    }
  }

  /**
   * Binds the Electron window HWND to the native helper for pinning to all virtual desktops
   * and automatic foreground reclamation
   */
  public static attachWindow(hwnd: number | bigint | string): void {
    if (!this.helperProcess || !this.helperProcess.stdin || this.helperProcess.stdin.destroyed) {
      return;
    }
    try {
      this.helperProcess.stdin.write(`ATTACH ${hwnd.toString()}\n`);
      this.logger.info('NativeLockdown', `Attached window handle ${hwnd.toString()} to native helper.`);
    } catch (err) {
      this.logger.warn('NativeLockdown', 'Failed to send window handle to native helper', { error: String(err) });
    }
  }

  /**
   * Instantly toggles strict lockdown (WH_KEYBOARD_LL swallowing Alt+Tab, Win keys, and hiding Windows taskbar)
   * Executes in sub-millisecond time via background process stdin.
   */
  public static setLockdown(enabled: boolean): void {
    if (!this.helperProcess || !this.helperProcess.stdin || this.helperProcess.stdin.destroyed) {
      return;
    }

    this.isLocked = enabled;
    const cmd = enabled ? 'LOCK_ON\n' : 'LOCK_OFF\n';
    try {
      this.helperProcess.stdin.write(cmd);
      this.logger.info('NativeLockdown', `Native low-level lockdown state set to: ${enabled ? 'ACTIVE' : 'INACTIVE'}`);
    } catch (err) {
      this.logger.warn('NativeLockdown', 'Failed to write command to native lockdown helper', { error: String(err) });
    }
  }

  public static isLockdownActive(): boolean {
    return this.isLocked;
  }

  /**
   * Gracefully restores system state (Windows taskbar, touchpad, hooks) and shuts down helper
   */
  public static shutdown(): void {
    if (this.helperProcess && this.helperProcess.stdin && !this.helperProcess.stdin.destroyed) {
      try {
        this.helperProcess.stdin.write('QUIT\n');
        this.helperProcess.stdin.end();
      } catch {}
    }
    this.helperProcess = null;
  }
}
