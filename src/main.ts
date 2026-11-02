import { app, Menu, MenuItemConstructorOptions } from 'electron';
import { Logger } from './Core/Logger';
import { AppConfiguration } from './Core/AppConfiguration';
import { ExamSession, SessionState } from './Core/ExamSession';
import { MainWindow } from './UI/MainWindow';
import { WindowsIntegration } from './Platform/WindowsIntegration';

const logger = Logger.getInstance();
let mainWindow: MainWindow | null = null;
let examSession: ExamSession | null = null;

// Explicitly set application identity and AppUserModelId for Windows taskbar & OS
app.name = 'FSEB';
app.setName('FSEB');
if (process.platform === 'win32') {
  app.setAppUserModelId('org.fseb.browser');
}

// Initialize file logging
logger.initialize();

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  logger.info('Main', 'Another instance of FSEB is already active. Terminating duplicate instance.');
  app.quit();
} else {
  // Log application startup
  const appConfig = AppConfiguration.getInstance();
  logger.info('Main', '==================================================');
  logger.info('Main', `Starting ${appConfig.metadata.name} v${appConfig.metadata.version}`);
  logger.info('Main', `Platform: ${process.platform} (${process.arch}), Node: ${process.versions.node}, Electron: ${process.versions.electron}`);
  logger.info('Main', '==================================================');

  // Handle second-instance launches (e.g. user clicked "Open in Safe Exam Browser" in Chrome or double-clicked .seb)
  app.on('second-instance', async (_event, commandLine) => {
    logger.info('Main', 'Second instance event received', { args: commandLine });
    if (mainWindow) {
      const window = mainWindow.getWindow();
      if (window) {
        if (window.isMinimized()) window.restore();
        window.focus();
      }

      const target = WindowsIntegration.extractLaunchTarget(commandLine);
      if (target) {
        logger.info('Main', `Loading target from second-instance call: ${target}`);
        await mainWindow.loadExamFromTarget(target);
      }
    }
  });

  app.whenReady().then(async () => {
    // Set standard application menu with Edit accelerators so native copy/paste is bound
    const editMenuTemplate: MenuItemConstructorOptions[] = [
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(editMenuTemplate));

    examSession = new ExamSession();
    mainWindow = new MainWindow(examSession);

    // Register Windows protocol handlers (seb:// and sebs://) and registry associations
    WindowsIntegration.registerProtocolClients();
    WindowsIntegration.registerWindowsUserRegistry();

    // Check if a target (.seb file or seb:// URL) was provided in startup arguments
    const startupTarget = WindowsIntegration.extractLaunchTarget(process.argv);
    if (startupTarget) {
      logger.info('Main', `Startup argument detected target: ${startupTarget}`);
      mainWindow.setInitialTarget(startupTarget);
    }

    // Create the main window
    const window = mainWindow.createWindow();

    app.on('activate', () => {
      if (mainWindow && !mainWindow.getWindow()) {
        mainWindow.createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    logger.info('Main', 'All windows closed. Quitting application.');
    examSession?.transitionTo(SessionState.CLOSING);
    app.quit();
  });

  app.on('before-quit', () => {
    logger.info('Main', 'Application shutting down cleanly.');
  });

  // Global uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Main', 'Uncaught exception in main process', { error: error.message, stack: error.stack });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Main', 'Unhandled promise rejection', { reason: String(reason) });
  });
}
