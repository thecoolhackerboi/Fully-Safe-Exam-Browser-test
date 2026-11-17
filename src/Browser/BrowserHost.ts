import * as path from 'path';
import * as crypto from 'crypto';
import { BrowserView, BrowserWindow, Menu, MenuItem, ipcMain } from 'electron';
import { ExamPolicy } from '../Core/ExamPolicy';
import { Logger } from '../Core/Logger';
import { SebLoader } from '../Configuration/SebLoader';

export interface BrowserHostOptions {
  parentWindow: BrowserWindow;
  policy: ExamPolicy;
  onPageTitleUpdated?: (title: string) => void;
  onLoadingStatusChanged?: (isLoading: boolean) => void;
  onLoadError?: (errorDescription: string) => void;
  onQuitRequested?: () => void;
  onToggleStaleState?: () => void;
}

export class BrowserHost {
  private static readonly logger = Logger.getInstance();
  private static readonly moodleQuizKeys = new Map<string, string>([
    ['safeexambrowser.moodle.ch:2036', '226bd647d586008f8aa0764c3ff0eb610bf06a6c4674a4495d727015cc5eba39'],
    ['safeexambrowser.moodle.ch:2037', '3c916ca57a0049746cd8865edd61e187fcfed29e27e526aceb29836116d75043'],
    ['safeexambrowser.moodle.ch:13534', '5d28ffaa358a3d4b0423363dd852f4680cc19bbdf2e37e2bc6d213f3e8ead2ad'],
    ['safeexambrowser.moodle.ch:13535', '006b44c5abd10984d67213e2b3b0ec1edffdd15da50968f3361e910e7be88cb8'],
    ['safeexambrowser.moodle.ch:9259', '03194c2f8d5e6a5bcea379f7d61ad44a56483278f4a1821d32263a501d2201e2'],
  ]);
  private lastMoodleQuizKey = '226bd647d586008f8aa0764c3ff0eb610bf06a6c4674a4495d727015cc5eba39';
  private browserView: BrowserView | null = null;
  private readonly parentWindow: BrowserWindow;
  private policy: ExamPolicy;
  private options: BrowserHostOptions;

  private async fetchMoodleConfigForCmid(origin: string, pathname: string, cmid: string, host: string): Promise<void> {
    const cacheKey = `${host}:${cmid}`;
    if (BrowserHost.moodleQuizKeys.has(cacheKey)) return;

    try {
      const modIdx = pathname.indexOf('/mod/quiz');
      const basePath = modIdx !== -1 ? pathname.substring(0, modIdx) : '';
      const configUrl = `${origin}${basePath}/mod/quiz/accessrule/seb/config.php?cmid=${cmid}`;

      BrowserHost.logger.info('BrowserHost', `Attempting auto-discovery of SEB config for cmid=${cmid} at ${configUrl}`);
      const res = await SebLoader.loadFromTarget(configUrl);
      if (res.success && res.configuration && res.configuration.configKey) {
        BrowserHost.moodleQuizKeys.set(cacheKey, res.configuration.configKey);
        this.lastMoodleQuizKey = res.configuration.configKey;
        BrowserHost.logger.info('BrowserHost', `Successfully resolved Config Key for ${cacheKey}: ${res.configuration.configKey}`);
      }
    } catch (err) {
      BrowserHost.logger.warn('BrowserHost', `Auto-discovery for cmid=${cmid} skipped`, { error: String(err) });
    }
  }

  public getActiveConfigKeyForUrl(url: string): string {
    const cleanUrl = (url || '').split('#')[0];
    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(cleanUrl);
    } catch {}

    const host = parsedUrl ? parsedUrl.host : '';
    const cmidMatch = cleanUrl.match(/[?&](?:id|cmid)=(\d+)/);

    if (cmidMatch && host) {
      const cacheKey = `${host}:${cmidMatch[1]}`;
      if (BrowserHost.moodleQuizKeys.has(cacheKey)) {
        return BrowserHost.moodleQuizKeys.get(cacheKey)!;
      }
    }

    const config = this.policy.getConfiguration();
    if (config.configKey) {
      return config.configKey;
    }

    if (this.lastMoodleQuizKey && cleanUrl.includes('/mod/quiz/')) {
      return this.lastMoodleQuizKey;
    }

    return '';
  }

  constructor(options: BrowserHostOptions) {
    this.options = options;
    this.parentWindow = options.parentWindow;
    this.policy = options.policy;

    // Remove any previously attached handler to prevent duplicate listener warnings
    ipcMain.removeAllListeners('fseb:get-active-config-key');
    ipcMain.on('fseb:get-active-config-key', (event, url) => {
      event.returnValue = this.getActiveConfigKeyForUrl(url);
    });
  }

  public getWebContents() {
    return this.browserView?.webContents;
  }

  public updatePolicy(policy: ExamPolicy): void {
    this.policy = policy;
  }

  /**
   * Opens the universal clipboard context menu at the current cursor position.
   * Works inside text editors, problem descriptions, and any page element.
   */
  public showClipboardMenu(): void {
    if (!this.browserView || this.parentWindow.isDestroyed()) return;
    const webContents = this.browserView.webContents;

    const menu = new Menu();

    menu.append(
      new MenuItem({
        label: 'Copy',
        accelerator: 'CmdOrCtrl+C',
        role: 'copy',
        click: () => {
          webContents.copy();
        },
      })
    );

    menu.append(
      new MenuItem({
        label: 'Paste',
        accelerator: 'CmdOrCtrl+V',
        click: () => {
          webContents.paste();
        },
      })
    );

    menu.append(
      new MenuItem({
        label: 'Cut',
        accelerator: 'CmdOrCtrl+X',
        click: () => {
          webContents.cut();
        },
      })
    );

    menu.append(
      new MenuItem({
        label: 'Select All',
        accelerator: 'CmdOrCtrl+A',
        click: () => {
          webContents.selectAll();
        },
      })
    );

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(
      new MenuItem({
        label: 'Undo',
        accelerator: 'CmdOrCtrl+Z',
        click: () => {
          webContents.undo();
        },
      })
    );

    menu.append(
      new MenuItem({
        label: 'Redo',
        accelerator: 'CmdOrCtrl+Y',
        click: () => {
          webContents.redo();
        },
      })
    );

    if (this.policy.getConfiguration().navigation.allowReload) {
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(
        new MenuItem({
          label: 'Reload Exam Page',
          click: () => {
            webContents.reload();
          },
        })
      );
    }

    menu.popup({ window: this.parentWindow });
  }

  /**
   * Displays a floating toast notification inside the BrowserView indicating Stale State
   */
  public showStaleStateToast(enabled: boolean): void {
    if (!this.browserView || this.browserView.webContents.isDestroyed()) return;

    const toastScript = `
      (function() {
        try {
          var old = document.getElementById('fseb-stale-toast');
          if (old) old.remove();

          var toast = document.createElement('div');
          toast.id = 'fseb-stale-toast';
          var isOn = ${Boolean(enabled)};
          toast.innerHTML = isOn
            ? '<div style="display:flex;align-items:center;gap:12px;"><span style="font-size:20px;line-height:1;">🔒</span><div><div style="font-weight:700;font-size:13px;letter-spacing:0.6px;color:#38bdf8;">STALE STATE: ON</div><div style="font-size:11px;color:#cbd5e1;margin-top:2px;">Strict Lockdown Active &bull; Alt+Tab & Gestures Blocked</div></div></div>'
            : '<div style="display:flex;align-items:center;gap:12px;"><span style="font-size:20px;line-height:1;">🔓</span><div><div style="font-weight:700;font-size:13px;letter-spacing:0.6px;color:#94a3b8;">STALE STATE: OFF</div><div style="font-size:11px;color:#94a3b8;margin-top:2px;">Liberated Mode &bull; Window Switching Enabled</div></div></div>';

          toast.style.cssText = [
            'position: fixed !important',
            'top: 24px !important',
            'left: 50% !important',
            'z-index: 2147483647 !important',
            'background: ' + (isOn ? 'rgba(15, 23, 42, 0.95)' : 'rgba(24, 24, 27, 0.95)') + ' !important',
            'border: 1px solid ' + (isOn ? '#0284c7' : '#3f3f46') + ' !important',
            'box-shadow: 0 10px 25px -5px rgba(0,0,0,0.7), 0 0 20px ' + (isOn ? 'rgba(56, 189, 248, 0.35)' : 'rgba(0,0,0,0.3)') + ' !important',
            'padding: 10px 22px !important',
            'border-radius: 9999px !important',
            'font-family: -apple-system, BlinkMacSystemFont, \\"Segoe UI\\", Roboto, sans-serif !important',
            'pointer-events: none !important',
            'transition: opacity 0.2s ease, transform 0.2s ease !important',
            'opacity: 0 !important',
            'transform: translate(-50%, -10px) !important'
          ].join(';');

          (document.body || document.documentElement).appendChild(toast);
          requestAnimationFrame(function() {
            toast.style.opacity = '1';
            toast.style.transform = 'translate(-50%, 0)';
          });

          setTimeout(function() {
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%, -10px)';
            setTimeout(function() {
              if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 220);
          }, 900);
        } catch (e) {}
      })();
    `;

    this.browserView.webContents.executeJavaScript(toastScript).catch(() => {});
  }

  /**
   * Initializes the Chromium BrowserView and attaches security and navigation policies
   */
  public initialize(): void {
    if (this.browserView) {
      return;
    }

    BrowserHost.logger.info('BrowserHost', 'Initializing Chromium BrowserHost with Safe Exam Browser emulation...');

    const sebVer = this.policy.getConfiguration().compatibility.sebVersion || '3.10.2.920';
    const customUserAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SEB/${sebVer} SEB`;

    this.browserView = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, '../Preload/exam-preload.js'),
        nodeIntegration: false,
        nodeIntegrationInSubFrames: true,
        contextIsolation: true,
        sandbox: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
        spellcheck: this.policy.browser.isSpellCheckEnabled(),
      },
    });

    const webContents = this.browserView.webContents;
    webContents.setUserAgent(customUserAgent);

    // Automatically grant clipboard reading and writing permissions for Monaco & editor iframes
    const session = webContents.session;
    session.setPermissionRequestHandler((_wc, permission, callback) => {
      if (
        permission === 'clipboard-read' ||
        permission === 'clipboard-sanitized-write' ||
        permission === 'media'
      ) {
        callback(true);
        return;
      }
      callback(false);
    });

    session.setPermissionCheckHandler((_wc, permission) => {
      if (
        permission === 'clipboard-read' ||
        permission === 'clipboard-sanitized-write'
      ) {
        return true;
      }
      return false;
    });

    // Intercept and inject authentic Safe Exam Browser HTTP request headers
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      const requestHeaders = { ...details.requestHeaders };

      // Ensure User-Agent reflects authentic Safe Exam Browser
      requestHeaders['User-Agent'] = customUserAgent;

      // Extract clean request URL without hash/fragment
      const cleanUrl = details.url.split('#')[0];

      // Extract cmid from URL or referer for Moodle quizzes
      let parsedUrl: URL | null = null;
      try {
        parsedUrl = new URL(cleanUrl);
      } catch {}

      const host = parsedUrl ? parsedUrl.host : '';
      const cmidMatch = cleanUrl.match(/[?&](?:id|cmid)=(\d+)/) || (details.referrer || '').match(/[?&](?:id|cmid)=(\d+)/);
      let resolvedQuizKey = '';

      if (cmidMatch && host) {
        const cacheKey = `${host}:${cmidMatch[1]}`;
        if (BrowserHost.moodleQuizKeys.has(cacheKey)) {
          resolvedQuizKey = BrowserHost.moodleQuizKeys.get(cacheKey)!;
          this.lastMoodleQuizKey = resolvedQuizKey;
        } else if (parsedUrl) {
          this.fetchMoodleConfigForCmid(parsedUrl.origin, parsedUrl.pathname, cmidMatch[1], host);
        }
      }

      if (!resolvedQuizKey && (cleanUrl.includes('/mod/quiz/') || (details.referrer || '').includes('/mod/quiz/'))) {
        resolvedQuizKey = this.lastMoodleQuizKey;
      }

      // Check if rawSettings contains examKeySalt or browserExamKey or computed configKey
      const config = this.policy.getConfiguration();
      const raw = config.rawSettings || {};
      const configKey = resolvedQuizKey || config.configKey || '';
      
      let examKeySalt = '';
      if (Buffer.isBuffer(raw['examKeySalt'])) {
        examKeySalt = raw['examKeySalt'].toString('base64');
      } else if (typeof raw['examKeySalt'] === 'string') {
        examKeySalt = raw['examKeySalt'].trim();
      }
      const configKeySalt = typeof raw['configKeySalt'] === 'string' ? raw['configKeySalt'].trim() : '';

      // Calculate ConfigKeyHash according to SEB specification:
      // SHA256(cleanUrl + configKey)
      const keyForConfig = configKey || configKeySalt;
      const confHash = crypto.createHash('sha256').update(cleanUrl + keyForConfig, 'utf8').digest('hex');

      // Calculate RequestHash according to SEB specification:
      // SHA256(cleanUrl + browserExamKey / examKeySalt)
      const keyForRequest = examKeySalt || keyForConfig;
      const reqHash = crypto.createHash('sha256').update(cleanUrl + keyForRequest, 'utf8').digest('hex');

      requestHeaders['X-SafeExamBrowser-RequestHash'] = reqHash;
      requestHeaders['X-SafeExamBrowser-ConfigKeyHash'] = confHash;

      callback({ requestHeaders });
    });

    // Intercept and sanitize response headers to permit embedded container editors and iframes
    session.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders };

      for (const key of Object.keys(responseHeaders)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey === 'x-frame-options' ||
          lowerKey === 'cross-origin-embedder-policy' ||
          lowerKey === 'cross-origin-opener-policy' ||
          lowerKey === 'cross-origin-resource-policy'
        ) {
          delete responseHeaders[key];
        } else if (lowerKey === 'content-security-policy' || lowerKey === 'content-security-policy-report-only') {
          // Remove frame-ancestors directive so embedded container editors are not blocked
          const cspList = responseHeaders[key];
          if (Array.isArray(cspList)) {
            responseHeaders[key] = cspList.map((csp) =>
              csp.replace(/frame-ancestors\s+[^;]+(;|$)/gi, '')
            );
          } else if (typeof cspList === 'string') {
            responseHeaders[key] = [(cspList as string).replace(/frame-ancestors\s+[^;]+(;|$)/gi, '')];
          }
        }
      }

      callback({ responseHeaders });
    });

    this.parentWindow.addBrowserView(this.browserView);
    this.resizeToParent();

    // 1. Keyboard event policy interception & Alt menu trigger
    let altPressedAlone = false;

    webContents.on('before-input-event', (event, input) => {
      // Handle Alt key tap to bring up copy/clipboard menu (suppressed in Stale State)
      if (input.key === 'Alt') {
        if (this.policy.isStaleState()) {
          altPressedAlone = false;
          event.preventDefault();
          return;
        }
        if (input.type === 'keyDown' && !input.isAutoRepeat) {
          altPressedAlone = true;
        } else if (input.type === 'keyUp' && altPressedAlone) {
          altPressedAlone = false;
          this.showClipboardMenu();
          return;
        }
      } else if (input.type === 'keyDown') {
        altPressedAlone = false;
      }

      // ContextMenu key or Shift+F10 opens copy menu (suppressed in Stale State)
      if (input.key === 'ContextMenu' || (input.shift && input.key === 'F10')) {
        if (this.policy.isStaleState()) {
          event.preventDefault();
          return;
        }
        this.showClipboardMenu();
        event.preventDefault();
        return;
      }

      // Ctrl+Q shortcut to request exam quit confirmation
      if (input.control && !input.alt && !input.meta && input.type === 'keyDown' && input.key.toLowerCase() === 'q') {
        this.options.onQuitRequested?.();
        event.preventDefault();
        return;
      }

      // Ctrl+Alt+L secret combination to toggle Stale State (Strict Lockdown vs Liberated)
      if (input.control && input.alt && !input.meta && input.type === 'keyDown') {
        const k = input.key.toLowerCase();
        if (k === 'l') {
          this.options.onToggleStaleState?.();
          event.preventDefault();
          return;
        }
      }

      // Alt+C, Alt+V, Alt+X, Alt+A, Alt+M shortcuts (suppressed in Stale State)
      if (input.alt && !input.control && !input.meta && input.type === 'keyDown') {
        const k = input.key.toLowerCase();
        if (this.policy.isStaleState() && (k === 'c' || k === 'v' || k === 'x' || k === 'm')) {
          event.preventDefault();
          return;
        }
        if (k === 'c') {
          webContents.copy();
          event.preventDefault();
          return;
        }
        if (k === 'v') {
          webContents.paste();
          event.preventDefault();
          return;
        }
        if (k === 'x') {
          webContents.cut();
          event.preventDefault();
          return;
        }
        if (k === 'a') {
          webContents.selectAll();
          event.preventDefault();
          return;
        }
        if (k === 'm') {
          this.showClipboardMenu();
          event.preventDefault();
          return;
        }
      }

      const decision = this.policy.evaluateKey({
        type: input.type,
        key: input.key,
        code: input.code,
        control: input.control,
        alt: input.alt,
        shift: input.shift,
        meta: input.meta,
        isAutoRepeat: input.isAutoRepeat,
      });

      if (!decision.allowed) {
        event.preventDefault();
      }
    });

    // 2. Navigation interception (will-navigate)
    webContents.on('will-navigate', (event, navigationUrl) => {
      // Check for SEB quit URL navigation (e.g. /quit-seb or configured quitURL)
      const quitUrl = this.policy.getConfiguration().taskbar.quitUrl;
      if (navigationUrl.includes('/quit-seb') || (quitUrl && navigationUrl.includes(quitUrl))) {
        event.preventDefault();
        BrowserHost.logger.info('BrowserHost', `Quit URL detected: ${navigationUrl}. Prompting user to quit.`);
        this.options.onQuitRequested?.();
        return;
      }

      const decision = this.policy.evaluateNavigation(navigationUrl);
      if (!decision.allowed) {
        event.preventDefault();
        BrowserHost.logger.warn('BrowserHost', `Blocked navigation to: ${navigationUrl}`, {
          reason: decision.reason,
        });
      } else {
        BrowserHost.logger.info('BrowserHost', `Allowed navigation to: ${navigationUrl}`);
      }
    });

    // 3. Navigation redirection (will-redirect)
    webContents.on('will-redirect', (event, redirectUrl) => {
      const quitUrl = this.policy.getConfiguration().taskbar.quitUrl;
      if (redirectUrl.includes('/quit-seb') || (quitUrl && redirectUrl.includes(quitUrl))) {
        event.preventDefault();
        BrowserHost.logger.info('BrowserHost', `Quit redirect detected: ${redirectUrl}. Prompting user to quit.`);
        this.options.onQuitRequested?.();
        return;
      }

      const decision = this.policy.evaluateNavigation(redirectUrl);
      if (!decision.allowed) {
        event.preventDefault();
        BrowserHost.logger.warn('BrowserHost', `Blocked redirect to: ${redirectUrl}`, {
          reason: decision.reason,
        });
      }
    });

    // 4. Popups / new window requests interception
    webContents.setWindowOpenHandler((details) => {
      const decision = this.policy.evaluateNavigation(details.url);
      if (!decision.allowed || this.policy.browser.shouldBlockPopups()) {
        BrowserHost.logger.warn('BrowserHost', `Blocked popup to: ${details.url}`, {
          reason: decision.reason,
        });
        return { action: 'deny' };
      }

      // If allowed by navigation policy and not blocking popups, navigate in place
      webContents.loadURL(details.url);
      return { action: 'deny' };
    });

    // 5. Developer tools restriction
    webContents.on('devtools-opened', () => {
      if (!this.policy.devTools.canOpenDevTools()) {
        BrowserHost.logger.warn('BrowserHost', 'DevTools opened without permission. Closing immediately.');
        webContents.closeDevTools();
      }
    });

    // 6. Context menu — right click anywhere brings up the full clipboard menu
    webContents.on('context-menu', (_event, _params) => {
      this.showClipboardMenu();
    });

    // 7. Loading lifecycle events
    webContents.on('dom-ready', () => {
      webContents.insertCSS(`
        *, *::before, *::after {
          -webkit-user-select: text !important;
          user-select: text !important;
        }
        button[id*="ask-ai" i], button[class*="ask-ai" i],
        button[id*="chef-ai" i], button[class*="chef-ai" i],
        button[id*="askAi" i], button[class*="askAi" i],
        button[data-testid*="ask-ai" i], button[data-testid*="chef-ai" i],
        [aria-label*="Ask AI" i], [aria-label*="Chef AI" i],
        [title*="Ask AI" i], [title*="Chef AI" i],
        [id*="ask-ai" i], [id*="chef-ai" i], [class*="ask-ai" i], [class*="chef-ai" i],
        [id*="askAi" i], [class*="askAi" i], [id*="chefAi" i], [class*="chefAi" i],
        .ask-ai, .chef-ai, #dock-btn-ai, .seb-taskbar-ai-btn, #seb-ai-drawer, .seb-ai-drawer {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
          opacity: 0 !important;
          width: 0 !important;
          height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          overflow: hidden !important;
        }
      `).catch(() => {});
    });

    webContents.on('did-start-loading', () => {
      this.options.onLoadingStatusChanged?.(true);
    });

    webContents.on('did-stop-loading', () => {
      this.options.onLoadingStatusChanged?.(false);
    });

    webContents.on('page-title-updated', (_event, title) => {
      this.options.onPageTitleUpdated?.(title);
    });

    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // 1. Navigation aborted by normal redirect or stop
      if (errorCode === -3) return; // ERR_ABORTED

      // 2. Ignore failures in subframes / iframes (such as container editor staging or analytics embeds)
      if (typeof isMainFrame === 'boolean' && !isMainFrame) {
        BrowserHost.logger.warn('BrowserHost', `Subframe failed to load: ${validatedURL}`, {
          errorCode,
          errorDescription,
        });
        return;
      }

      // 3. Ignore ERR_BLOCKED_BY_RESPONSE (-27) or ERR_BLOCKED_BY_CLIENT (-20) so transient header blocks do not abort exam
      if (errorCode === -27 || errorCode === -20) {
        BrowserHost.logger.warn('BrowserHost', `Main frame encountered response block (${errorCode}): ${validatedURL}`, {
          errorCode,
          errorDescription,
        });
        return;
      }

      BrowserHost.logger.error('BrowserHost', `Failed to load URL: ${validatedURL}`, {
        errorCode,
        errorDescription,
      });
      this.options.onLoadError?.(`${errorDescription} (${errorCode})`);
    });

    // 8. Download management
    webContents.session.on('will-download', (event, item) => {
      const decision = this.policy.evaluateDownload(item.getURL(), item.getFilename());
      if (!decision.allowed) {
        event.preventDefault();
        item.cancel();
      }
    });
  }

  /**
   * Loads the configured exam URL into the Chromium view
   */
  public async loadExamUrl(url: string): Promise<void> {
    if (!this.browserView) {
      this.initialize();
    }

    BrowserHost.logger.info('BrowserHost', `Loading exam start URL: ${url}`);
    try {
      await this.browserView!.webContents.loadURL(url);
    } catch (err: unknown) {
      const msg = String(err);
      if (
        msg.includes('ERR_ABORTED') ||
        msg.includes('-3') ||
        msg.includes('ERR_BLOCKED_BY_RESPONSE') ||
        msg.includes('-27') ||
        msg.includes('ERR_BLOCKED_BY_CLIENT') ||
        msg.includes('-20')
      ) {
        BrowserHost.logger.info('BrowserHost', `Navigation redirect/notice: ${msg}`);
        return;
      }
      throw err;
    }
  }

  public reloadExam(): void {
    if (this.browserView) {
      this.browserView.webContents.reload();
    }
  }

  /**
   * Resizes the embedded BrowserView to completely fill the parent window,
   * reserving space for the authentic SEB bottom taskbar if enabled.
   */
  public resizeToParent(): void {
    if (!this.browserView || this.parentWindow.isDestroyed()) return;

    const bounds = this.parentWindow.getContentBounds();
    const config = this.policy.getConfiguration();
    const taskbarHeight = config.taskbar?.showTaskBar ? (config.taskbar.taskBarHeight || 40) : 0;

    this.browserView.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: Math.max(100, bounds.height - taskbarHeight),
    });
  }

  /**
   * Temporarily hides or detaches the browser view
   */
  public hide(): void {
    if (this.browserView && !this.parentWindow.isDestroyed()) {
      this.parentWindow.removeBrowserView(this.browserView);
    }
  }

  /**
   * Re-attaches the browser view
   */
  public show(): void {
    if (this.browserView && !this.parentWindow.isDestroyed()) {
      this.parentWindow.addBrowserView(this.browserView);
      this.resizeToParent();
    }
  }

  /**
   * Cleans up and destroys the browser view
   */
  public destroy(): void {
    if (this.browserView) {
      try {
        this.hide();
        (this.browserView.webContents as unknown as { destroy?: () => void })?.destroy?.();
      } catch (err) {
        BrowserHost.logger.warn('BrowserHost', 'Error during browser view cleanup', { error: String(err) });
      }
      this.browserView = null;
    }
  }
}
