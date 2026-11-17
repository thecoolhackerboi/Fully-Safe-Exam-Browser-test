export interface ClipboardConfig {
  copy: boolean;
  paste: boolean;
  selectAll: boolean;
}

export interface NavigationConfig {
  allowReload: boolean;
  allowBackForward: boolean;
  blockPopups: boolean;
}

export interface BrowserConfig {
  allowAudio: boolean;
  allowVideo: boolean;
  allowSpellCheck: boolean;
}

export interface TaskbarConfig {
  showTaskBar: boolean;
  taskBarHeight: number;
  showQuitButton: boolean;
  showReloadButton: boolean;
  showTime: boolean;
  allowWlan: boolean;
  audioControlEnabled: boolean;
  quitUrl: string;
}

export interface SebCompatibilityConfig {
  sebVersion: string;
  platform: string;
}

export interface ExamConfiguration {
  /**
   * Primary entry point URL for the exam
   */
  startUrl: string;

  /**
   * Explicitly permitted URL prefixes, origins, or wildcards
   */
  allowedUrls: string[];

  /**
   * Launch and maintain fullscreen examination terminal mode
   */
  fullscreen: boolean;

  /**
   * Clipboard operational permissions
   */
  clipboard: ClipboardConfig;

  /**
   * Allow normal operating system window switching (Alt+Tab)
   */
  windowSwitching: boolean;

  /**
   * Chromium Developer Tools availability
   */
  developerTools: boolean;

  /**
   * Unrestricted file download permission
   */
  downloads: boolean;

  /**
   * Browser navigation controls
   */
  navigation: NavigationConfig;

  /**
   * Browser media and input features
   */
  browser: BrowserConfig;

  /**
   * Authentic SEB bottom taskbar docking configuration
   */
  taskbar: TaskbarConfig;

  /**
   * Safe Exam Browser version and platform compatibility emulation
   */
  compatibility: SebCompatibilityConfig;

  /**
   * Display title or name of the exam
   */
  examTitle?: string;

  /**
   * Optional institution or origin description
   */
  institution?: string;

  /**
   * Raw parsed configuration keys (for debugging/diagnostics)
   */
  rawSettings?: Record<string, unknown>;
}

export const DEFAULT_EXAM_CONFIGURATION: ExamConfiguration = {
  startUrl: '',
  allowedUrls: [],
  fullscreen: true,
  clipboard: {
    copy: true,
    paste: true,
    selectAll: true,
  },
  windowSwitching: true,
  developerTools: false,
  downloads: false,
  navigation: {
    allowReload: true,
    allowBackForward: false,
    blockPopups: true,
  },
  browser: {
    allowAudio: true,
    allowVideo: true,
    allowSpellCheck: false,
  },
  taskbar: {
    showTaskBar: true,
    taskBarHeight: 40,
    showQuitButton: true,
    showReloadButton: true,
    showTime: true,
    allowWlan: true,
    audioControlEnabled: true,
    quitUrl: '/quit-seb',
  },
  compatibility: {
    sebVersion: '3.10.2',
    platform: 'SEB_Windows_3.10.2',
  },
};
