import * as path from 'path';
import { BrowserWindow, dialog, ipcMain, app } from 'electron';
import { ExamSession, SessionState } from '../Core/ExamSession';
import { BrowserHost } from '../Browser/BrowserHost';
import { SebLoader } from '../Configuration/SebLoader';
import { AppConfiguration } from '../Core/AppConfiguration';
import { Logger } from '../Core/Logger';

export class MainWindow {
  private static readonly logger = Logger.getInstance();
  private window: BrowserWindow | null = null;
  private splashWindow: BrowserWindow | null = null;
  private browserHost: BrowserHost | null = null;
  private readonly session: ExamSession;
  private currentSebPath: string | null = null;
  private pendingTarget: string | null = null;

  constructor(session: ExamSession) {
    this.session = session;
    this.registerIpcHandlers();
    this.subscribeToSessionEvents();
  }

  public getWindow(): BrowserWindow | null {
    return this.window;
  }

  public setInitialTarget(target: string): void {
    this.pendingTarget = target;
  }

  /**
   * Creates and initializes the primary desktop window and authentic startup splash
   */
  public createWindow(): BrowserWindow {
    MainWindow.logger.info('MainWindow', 'Creating splash and main windows...');

    // Stage 1 (Image 1): Native centered floating splash card over the desktop
    this.splashWindow = new BrowserWindow({
      title: 'FSEB',
      width: 490,
      height: 255,
      frame: false,
      resizable: false,
      center: true,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#ffffff',
      hasShadow: true,
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const splashPath = path.join(__dirname, 'views/splash.html');
    this.splashWindow.loadFile(splashPath);

    this.splashWindow.once('ready-to-show', () => {
      this.splashWindow?.show();
    });

    // Main window for Stages 2, 3, 4, 5, 6
    this.window = new BrowserWindow({
      title: 'FSEB — Fully Safe Exam Browser',
      width: 1024,
      height: 768,
      minWidth: 800,
      minHeight: 600,
      center: true,
      backgroundColor: '#d1d5db',
      show: false,
      autoHideMenuBar: true,
      frame: false,
      webPreferences: {
        preload: path.join(__dirname, '../Preload/preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    // Initialize Chromium BrowserHost for exam viewing
    this.browserHost = new BrowserHost({
      parentWindow: this.window,
      policy: this.session.getPolicy(),
      onPageTitleUpdated: (title) => {
        if (this.window && !this.window.isDestroyed()) {
          this.window.setTitle(`${title} — Safe Exam Browser`);
        }
      },
      onLoadError: (errorDesc) => {
        this.session.transitionTo(SessionState.ERROR, { error: `Network error: ${errorDesc}` });
      },
      onQuitRequested: () => {
        this.showQuitConfirmation();
      },
    });

    // Window focus and blur handling
    this.window.on('focus', () => {
      this.session.handleFocusChange(true);
    });

    this.window.on('blur', () => {
      this.session.handleFocusChange(false);
    });

    this.window.on('resize', () => {
      if (this.session.getState() === SessionState.EXAM_RUNNING && this.browserHost) {
        this.browserHost.resizeToParent();
      }
    });

    // Load initial UI shell
    const viewPath = path.join(__dirname, 'views/index.html');
    this.window.loadFile(viewPath);

    // Multi-stage startup sequence coordinator
    this.window.once('ready-to-show', async () => {
      // Stage 1 duration: Allow floating splash card on user desktop to display
      await new Promise((resolve) => setTimeout(resolve, 1400));

      if (!this.window || this.window.isDestroyed()) return;

      // Stage 2 & 3 (Images 2 & 3): Fullscreen light grey background with sliding blue bar
      this.window.setFullScreen(true);
      this.window.show();
      this.window.webContents.send('fseb:state-update', { state: 'SPLASH_GREY' });

      // Close floating splash window
      if (this.splashWindow && !this.splashWindow.isDestroyed()) {
        this.splashWindow.close();
        this.splashWindow = null;
      }

      const targetToLoad = this.pendingTarget;
      this.pendingTarget = null;

      if (targetToLoad) {
        // Load the specified exam configuration
        await this.loadExamFromTarget(targetToLoad);
      } else {
        // Continue unconfigured startup splash sequence
        await new Promise((resolve) => setTimeout(resolve, 2200));
        if (!this.window || this.window.isDestroyed()) return;

        // Stage 4 (Image 4): Solid pitch black background with green bar at 100%
        this.window.webContents.send('fseb:state-update', { state: 'SPLASH_BLACK' });

        await new Promise((resolve) => setTimeout(resolve, 1600));
        if (!this.window || this.window.isDestroyed()) return;

        // Stage 5 & 6 (Images 5 & 6): Transition to authentic unconfigured screen with bottom taskbar
        this.session.transitionTo(SessionState.READY);
      }
    });

    this.window.on('closed', () => {
      this.browserHost?.destroy();
      this.browserHost = null;
      this.window = null;
      if (this.splashWindow && !this.splashWindow.isDestroyed()) {
        this.splashWindow.close();
        this.splashWindow = null;
      }
    });

    return this.window;
  }

  /**
   * Loads an exam from a target (.seb file path, seb:// / sebs:// protocol URL, or web URL)
   */
  public async loadExamFromTarget(target: string): Promise<boolean> {
    this.currentSebPath = target;
    MainWindow.logger.info('MainWindow', `Initiating exam load from target: ${target}`);

    if (this.splashWindow && !this.splashWindow.isDestroyed()) {
      this.splashWindow.close();
      this.splashWindow = null;
    }

    if (this.window && !this.window.isDestroyed()) {
      if (!this.window.isVisible()) {
        this.window.setFullScreen(true);
        this.window.show();
      }
      this.window.webContents.send('fseb:state-update', { state: 'SPLASH_GREY' });
    }

    this.session.transitionTo(SessionState.LOADING_CONFIGURATION, { target });

    const loadResult = await SebLoader.loadFromTarget(target);
    if (!loadResult.success || !loadResult.configuration) {
      MainWindow.logger.error('MainWindow', 'Failed to load or validate target configuration', { error: loadResult.error });
      this.session.transitionTo(SessionState.ERROR, {
        error: loadResult.error || 'Failed to load configuration.',
      });
      return false;
    }

    this.session.transitionTo(SessionState.VALIDATING_CONFIGURATION);
    const config = loadResult.configuration;
    this.session.attachConfiguration(config);

    if (this.browserHost) {
      this.browserHost.updatePolicy(this.session.getPolicy());
    }

    if (this.window) {
      this.session.getPolicy().window.applyPolicyToWindow(this.window);
    }

    // Wait for the blue validating bar animation
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (this.window && !this.window.isDestroyed()) {
      // Stage 4: Solid pitch black background with green bar at 100%
      this.window.webContents.send('fseb:state-update', { state: 'SPLASH_BLACK' });
    }

    this.session.transitionTo(SessionState.STARTING_EXAM, { startUrl: config.startUrl });

    // Allow Stage 4 black screen with 100% green bar to display
    await new Promise((resolve) => setTimeout(resolve, 1500));

    try {
      if (!this.browserHost) {
        throw new Error('Browser host is not initialized');
      }

      this.browserHost.show();
      this.session.transitionTo(SessionState.EXAM_RUNNING, { startUrl: config.startUrl });

      await this.browserHost.loadExamUrl(config.startUrl);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('ERR_ABORTED') ||
        msg.includes('-3') ||
        msg.includes('ERR_BLOCKED_BY_RESPONSE') ||
        msg.includes('-27') ||
        msg.includes('ERR_BLOCKED_BY_CLIENT') ||
        msg.includes('-20')
      ) {
        this.browserHost?.show();
        this.session.transitionTo(SessionState.EXAM_RUNNING, { startUrl: config.startUrl });
        return true;
      }
      MainWindow.logger.error('MainWindow', `Failed to start exam session: ${msg}`);
      this.session.transitionTo(SessionState.ERROR, { error: `Failed to load exam start URL: ${msg}` });
      return false;
    }
  }

  public async loadExamFromSeb(filePath: string): Promise<boolean> {
    return this.loadExamFromTarget(filePath);
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('fseb:open-file-picker', async () => {
      if (!this.window) return null;

      const result = await dialog.showOpenDialog(this.window, {
        title: 'Open Exam Configuration',
        buttonLabel: 'Select Configuration',
        filters: [
          { name: 'Safe Exam Browser Config (*.seb)', extensions: ['seb'] },
          { name: 'JSON Exam Config (*.json)', extensions: ['json'] },
          { name: 'All Files (*.*)', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return null;
    });

    ipcMain.handle('fseb:start-exam', async (_event, filePath: string) => {
      return this.loadExamFromSeb(filePath);
    });

    ipcMain.handle('fseb:retry-loading', async () => {
      if (this.currentSebPath) {
        await this.loadExamFromSeb(this.currentSebPath);
      } else {
        this.session.resetToReady();
      }
    });

    ipcMain.handle('fseb:reload-exam', async () => {
      this.browserHost?.reloadExam();
    });

    ipcMain.handle('fseb:request-quit-confirm', async () => {
      await this.showQuitConfirmation();
    });

    ipcMain.handle('fseb:close-app', async () => {
      await this.showQuitConfirmation();
    });

    ipcMain.handle('fseb:get-app-info', async () => {
      const appConfig = AppConfiguration.getInstance();
      return {
        name: appConfig.metadata.name,
        version: appConfig.metadata.version,
      };
    });

  }

  public async showQuitConfirmation(): Promise<void> {
    if (!this.window) return;
    const result = await dialog.showMessageBox(this.window, {
      type: 'question',
      buttons: ['Quit Exam', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Quit Safe Exam Browser',
      message: 'Are you sure you want to quit the exam session?',
      detail: 'Exiting now will terminate your exam attempt. Any unsaved answers may be lost.',
      noLink: true,
    });
    if (result.response === 0) {
      MainWindow.logger.info('MainWindow', 'User confirmed exam quit. Closing application.');
      this.session.transitionTo(SessionState.CLOSING);
      app.quit();
    }
  }

  private subscribeToSessionEvents(): void {
    this.session.on('stateChange', (event) => {
      // Notify renderer
      if (this.window && !this.window.isDestroyed() && this.window.webContents) {
        this.window.webContents.send('fseb:state-update', {
          state: event.currentState,
          details: event.metadata,
        });
      }

      // Hide browser view if returned to ERROR, READY, or LOADING
      if (
        event.currentState === SessionState.ERROR ||
        event.currentState === SessionState.READY ||
        event.currentState === SessionState.LOADING_CONFIGURATION
      ) {
        this.browserHost?.hide();
      }
    });
  }
}
