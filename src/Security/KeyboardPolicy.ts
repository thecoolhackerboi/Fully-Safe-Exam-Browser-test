import { ExamConfiguration } from '../Configuration/ExamConfiguration';
import { Logger } from '../Core/Logger';

export interface KeyInputEvent {
  type: string;
  key: string;
  code?: string;
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  isAutoRepeat?: boolean;
}

export interface KeyDecision {
  allowed: boolean;
  reason?: string;
}

export class KeyboardPolicy {
  private static readonly logger = Logger.getInstance();
  private config: ExamConfiguration;
  private staleState: boolean = false;

  constructor(config: ExamConfiguration) {
    this.config = config;
  }

  public updateConfiguration(config: ExamConfiguration): void {
    this.config = config;
  }

  public setStaleState(enabled: boolean): void {
    this.staleState = enabled;
    KeyboardPolicy.logger.info('KeyboardPolicy', `Stale State (Strict Lockdown) set to: ${enabled ? 'ACTIVE' : 'INACTIVE'}`);
  }

  public isStaleState(): boolean {
    return this.staleState;
  }

  /**
   * Evaluates if a given keyboard input event is permitted.
   */
  public evaluateKeyEvent(event: KeyInputEvent): KeyDecision {
    if (event.type !== 'keyDown' && event.type !== 'rawKeyDown') {
      return { allowed: true };
    }

    const key = event.key.toLowerCase();
    const ctrl = Boolean(event.control);
    const alt = Boolean(event.alt);
    const shift = Boolean(event.shift);

    // 1. Explicitly permitted student clipboard & editing operations
    if (ctrl && !alt) {
      if (key === 'c' || (shift && key === 'c')) {
        if (!this.config.clipboard.copy) {
          return this.block('Copy (Ctrl+C) is disabled by exam policy.');
        }
        return { allowed: true };
      }
      if (key === 'v' || (shift && key === 'v')) {
        if (!this.config.clipboard.paste) {
          return this.block('Paste (Ctrl+V) is disabled by exam policy.');
        }
        return { allowed: true };
      }
      if (key === 'a') {
        if (!this.config.clipboard.selectAll) {
          return this.block('Select All (Ctrl+A) is disabled by exam policy.');
        }
        return { allowed: true };
      }
      if (key === 'x') {
        if (!this.config.clipboard.copy) {
          return this.block('Cut (Ctrl+X) is disabled by exam policy.');
        }
        return { allowed: true };
      }
      if (key === 'z' || key === 'y') {
        // Undo / Redo
        return { allowed: true };
      }
    }

    // 1b. Alt clipboard operations (Alt+C, Alt+V, Alt+X, Alt+A, Alt alone)
    if (alt && !ctrl && !shift) {
      if (key === 'c' || key === 'v' || key === 'x' || key === 'a' || key === 'm' || key === 'alt') {
        return { allowed: true };
      }
    }

    // 1c. Alternate Windows clipboard shortcuts (Insert, ContextMenu)
    if (key === 'insert' && (ctrl || shift)) {
      return { allowed: true };
    }
    if (key === 'contextmenu') {
      return { allowed: true };
    }

    // 2. Window switching: Alt+Tab, Win+Tab, and Ctrl+Win+Arrow (Virtual Desktops)
    const meta = Boolean(event.meta);

    // Stale State (Strict Lockdown): Block all window switches, desktop gestures, and OS navigation
    if (this.staleState) {
      if ((alt && key === 'tab') || (meta && key === 'tab')) {
        return this.block('Alt+Tab / Win+Tab window switching is locked down in Stale State.');
      }
      if (meta) {
        return this.block('Windows key combinations are locked down in Stale State.');
      }
      if (ctrl && (key === 'arrowleft' || key === 'arrowright' || key === 'left' || key === 'right')) {
        return this.block('Virtual desktop switching is locked down in Stale State.');
      }
      if (alt && key === 'escape') {
        return this.block('Window cycling (Alt+Esc) is locked down in Stale State.');
      }
      if (key === 'f11') {
        return this.block('Fullscreen toggle (F11) is locked down in Stale State.');
      }
    }

    if ((alt && key === 'tab') || (meta && key === 'tab')) {
      if (this.config.windowSwitching) {
        return { allowed: true };
      }
      return this.block('Window switching is restricted by exam policy.');
    }

    if (ctrl && meta && (key === 'arrowleft' || key === 'arrowright' || key === 'left' || key === 'right')) {
      if (this.config.windowSwitching) {
        return { allowed: true };
      }
      return this.block('Virtual desktop switching is restricted by exam policy.');
    }

    // 3. Prohibited: Developer tools
    if (!this.config.developerTools) {
      if (key === 'f12') {
        return this.block('Developer tools shortcut (F12) blocked.');
      }
      if (ctrl && shift && (key === 'i' || key === 'j' || key === 'c')) {
        return this.block(`Developer tools inspect shortcut (Ctrl+Shift+${key.toUpperCase()}) blocked.`);
      }
    }

    // 4. Prohibited: View page source
    if (ctrl && !alt && key === 'u') {
      return this.block('View Source (Ctrl+U) blocked.');
    }

    // 5. Prohibited: Page saving and printing
    if (ctrl && !alt && key === 's') {
      return this.block('Save page (Ctrl+S) blocked.');
    }
    if (ctrl && !alt && key === 'p') {
      return this.block('Print page (Ctrl+P) blocked.');
    }
    if (ctrl && !alt && key === 'o') {
      return this.block('Open file dialog (Ctrl+O) blocked.');
    }

    // 6. Prohibited: Browser history and downloads
    if (ctrl && !alt && key === 'h') {
      return this.block('Browser History (Ctrl+H) blocked.');
    }
    if (ctrl && !alt && key === 'j') {
      return this.block('Browser Downloads (Ctrl+J) blocked.');
    }

    // 7. Prohibited: Unrestricted new windows, tabs, or address bar navigation
    if (ctrl && !alt && (key === 'n' || key === 't')) {
      return this.block(`Opening new browser tab/window (Ctrl+${key.toUpperCase()}) blocked.`);
    }
    if (ctrl && shift && key === 'n') {
      return this.block('Incognito / new window (Ctrl+Shift+N) blocked.');
    }
    if (ctrl && !alt && (key === 'l' || key === 'e')) {
      return this.block('Address bar focus shortcut blocked.');
    }
    if (alt && key === 'd') {
      return this.block('Address bar shortcut (Alt+D) blocked.');
    }

    // 8. Controlled: Reloading
    if (key === 'f5' || (ctrl && !alt && key === 'r')) {
      if (!this.config.navigation.allowReload) {
        return this.block('Exam page reloading is disabled by policy.');
      }
      return { allowed: true };
    }

    // 9. Window closure attempt (Ctrl+W / Ctrl+F4)
    if ((ctrl && key === 'w') || (ctrl && key === 'f4')) {
      return this.block('Direct tab closure shortcut blocked. Use exam exit controls.');
    }

    // By default, normal typing, numbers, navigation, arrow keys, etc. are allowed
    return { allowed: true };
  }

  private block(reason: string): KeyDecision {
    KeyboardPolicy.logger.info('KeyboardPolicy', `Blocked keystroke: ${reason}`);
    return { allowed: false, reason };
  }
}
