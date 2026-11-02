import { ExamConfiguration, DEFAULT_EXAM_CONFIGURATION } from '../Configuration/ExamConfiguration';
import { KeyboardPolicy, KeyInputEvent, KeyDecision } from '../Security/KeyboardPolicy';
import { ClipboardPolicy } from '../Security/ClipboardPolicy';
import { WindowPolicy } from '../Security/WindowPolicy';
import { DeveloperToolsPolicy } from '../Security/DeveloperToolsPolicy';
import { DownloadPolicy, DownloadDecision } from '../Security/DownloadPolicy';
import { NavigationGuard, NavigationDecision } from '../Browser/NavigationGuard';
import { BrowserPolicy } from '../Browser/BrowserPolicy';
import { Logger } from './Logger';

export class ExamPolicy {
  private static readonly logger = Logger.getInstance();

  private config: ExamConfiguration;
  public readonly keyboard: KeyboardPolicy;
  public readonly clipboard: ClipboardPolicy;
  public readonly window: WindowPolicy;
  public readonly devTools: DeveloperToolsPolicy;
  public readonly download: DownloadPolicy;
  public readonly navigation: NavigationGuard;
  public readonly browser: BrowserPolicy;

  constructor(config: ExamConfiguration = DEFAULT_EXAM_CONFIGURATION) {
    this.config = config;
    this.keyboard = new KeyboardPolicy(config);
    this.clipboard = new ClipboardPolicy(config);
    this.window = new WindowPolicy(config);
    this.devTools = new DeveloperToolsPolicy(config);
    this.download = new DownloadPolicy(config);
    this.navigation = new NavigationGuard(config);
    this.browser = new BrowserPolicy(config);

    ExamPolicy.logger.info('ExamPolicy', 'Initialized central exam policy engine');
  }

  public updateConfiguration(config: ExamConfiguration): void {
    this.config = config;
    this.keyboard.updateConfiguration(config);
    this.clipboard.updateConfiguration(config);
    this.window.updateConfiguration(config);
    this.devTools.updateConfiguration(config);
    this.download.updateConfiguration(config);
    this.navigation.updateConfiguration(config);
    this.browser.updateConfiguration(config);

    ExamPolicy.logger.info('ExamPolicy', 'Updated central exam policy engine configuration', {
      startUrl: config.startUrl,
      fullscreen: config.fullscreen,
      allowDevTools: config.developerTools,
    });
  }

  public getConfiguration(): ExamConfiguration {
    return this.config;
  }

  // Unified convenience methods for decision making
  public evaluateKey(event: KeyInputEvent): KeyDecision {
    return this.keyboard.evaluateKeyEvent(event);
  }

  public evaluateNavigation(url: string): NavigationDecision {
    return this.navigation.evaluateNavigation(url);
  }

  public evaluateDownload(url: string, filename: string): DownloadDecision {
    return this.download.evaluateDownload(url, filename);
  }
}

