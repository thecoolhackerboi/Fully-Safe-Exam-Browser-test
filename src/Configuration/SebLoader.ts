import * as fs from 'fs';
import * as zlib from 'zlib';
import { PlistParser } from './PlistParser';
import { ExamConfiguration, DEFAULT_EXAM_CONFIGURATION } from './ExamConfiguration';
import { SebValidator, ValidationResult } from './SebValidator';
import { Logger } from '../Core/Logger';

export interface SebLoadResult {
  success: boolean;
  configuration?: ExamConfiguration;
  validation?: ValidationResult;
  error?: string;
}

export class SebLoader {
  private static readonly logger = Logger.getInstance();

  /**
   * Loads configuration from a file path, a seb:// / sebs:// protocol URL, or an http(s):// URL.
   */
  public static async loadFromTarget(target: string): Promise<SebLoadResult> {
    let trimmed = target.trim();

    // Strip surrounding quotes or escaped quotes
    trimmed = trimmed.replace(/^["']+|["']+$/g, '').trim();
    trimmed = trimmed.replace(/^[\\"]+|[\\"]+$/g, '').trim();

    // Strip file:/// prefix
    if (trimmed.toLowerCase().startsWith('file:///')) {
      trimmed = decodeURIComponent(trimmed.replace(/^file:\/\/\/?/i, ''));
      if (/^\/[a-zA-Z]:/.test(trimmed)) {
        trimmed = trimmed.slice(1);
      }
    }

    // 1. Check if it's a seb://, sebs://, or seb-config protocol URL
    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith('seb://') ||
      lower.startsWith('sebs://') ||
      lower.startsWith('seb-config:') ||
      lower.startsWith('seb-config?') ||
      lower.startsWith('seb-config//')
    ) {
      const httpUrl = this.normalizeSebUrl(trimmed);
      return this.loadFromRemoteUrl(httpUrl);
    }

    // 2. Check if it's a direct http:// or https:// URL
    if (trimmed.toLowerCase().startsWith('http://') || trimmed.toLowerCase().startsWith('https://')) {
      return this.loadFromRemoteUrl(trimmed);
    }

    // 3. Otherwise treat as local filesystem path
    return this.loadFromFile(trimmed);
  }

  public static normalizeSebUrl(url: string): string {
    const clean = url.trim();
    const lower = clean.toLowerCase();

    if (lower.startsWith('seb-config:')) {
      const after = clean.replace(/^seb-config:(\/\/)?/i, '');
      if (after.startsWith('http://') || after.startsWith('https://')) {
        return after;
      }
      return `https://${after}`;
    }
    if (lower.startsWith('seb-config?')) {
      return `https://${clean.replace(/^seb-config\?/i, '')}`;
    }
    if (lower.startsWith('seb-config//')) {
      return `https://${clean.replace(/^seb-config\/\//i, '')}`;
    }
    if (lower.startsWith('sebs://https://')) {
      return clean.replace(/^sebs:\/\//i, '');
    }
    if (lower.startsWith('seb://http://')) {
      return clean.replace(/^seb:\/\//i, '');
    }
    if (lower.startsWith('sebs://')) {
      return clean.replace(/^sebs:\/\//i, 'https://');
    }
    if (lower.startsWith('seb://')) {
      return clean.replace(/^seb:\/\//i, 'http://');
    }
    return clean;
  }

  public static async loadFromRemoteUrl(url: string): Promise<SebLoadResult> {
    this.logger.info('SebLoader', `Fetching exam configuration from remote URL: ${url}`);
    
    // First attempt with given URL, fallback to HTTPS if HTTP fails
    const urlsToTry = [url];
    if (url.toLowerCase().startsWith('http://')) {
      urlsToTry.push(url.replace(/^http:\/\//i, 'https://'));
    }

    let lastError = 'Failed to fetch exam configuration';

    for (const currentUrl of urlsToTry) {
      try {
        const response = await fetch(currentUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SEB/3.10.2 FSEB/0.1.0',
            'Accept': 'application/seb, application/xml, text/xml, */*',
          },
          redirect: 'follow',
        });

        if (!response.ok) {
          lastError = `Failed to fetch exam configuration: HTTP ${response.status} ${response.statusText}`;
          continue;
        }

        const rawBuffer = Buffer.from(await response.arrayBuffer());
        const parseResult = this.parseContent(rawBuffer, currentUrl);

        if (parseResult.success) {
          return parseResult;
        }

        // If parsing as .seb failed, check if the response was a direct HTML web page
        const asString = rawBuffer.toString('utf8');
        if (asString.includes('<html') || asString.includes('<!DOCTYPE html>') || asString.includes('<body')) {
          const directConfig: ExamConfiguration = {
            ...DEFAULT_EXAM_CONFIGURATION,
            startUrl: currentUrl,
            allowedUrls: [`${new URL(currentUrl).origin}/*`],
          };
          const validation = SebValidator.validate(directConfig);
          return { success: true, configuration: directConfig, validation };
        }

        return parseResult;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        this.logger.warn('SebLoader', `Error fetching ${currentUrl}: ${lastError}`);
      }
    }

    this.logger.error('SebLoader', `Failed to load remote configuration: ${lastError}`);
    return { success: false, error: `Failed to fetch remote exam: ${lastError}` };
  }

  /**
   * Loads and validates a .seb configuration file from the filesystem.
   */
  public static loadFromFile(filePath: string): SebLoadResult {
    this.logger.info('SebLoader', `Attempting to load configuration from: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      const err = `Configuration file not found: ${filePath}`;
      this.logger.error('SebLoader', err);
      return { success: false, error: err };
    }

    try {
      const rawBuffer = fs.readFileSync(filePath);
      return this.parseContent(rawBuffer, filePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('SebLoader', `Failed to read file: ${message}`);
      return { success: false, error: `Failed to read configuration file: ${message}` };
    }
  }

  /**
   * Parses raw string or buffer content into an ExamConfiguration.
   */
  public static parseContent(buffer: Buffer | string, sourceName = 'memory'): SebLoadResult {
    let workingBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf8');

    // Automatically decompress GZIP or Deflate payloads
    if (workingBuffer.length >= 2 && workingBuffer[0] === 0x1f && workingBuffer[1] === 0x8b) {
      try {
        workingBuffer = zlib.gunzipSync(workingBuffer);
        this.logger.info('SebLoader', 'Successfully decompressed GZIP configuration stream.', { source: sourceName });
      } catch (gzErr) {
        this.logger.warn('SebLoader', 'Failed to gunzip payload', { error: String(gzErr) });
      }
    } else if (
      workingBuffer.length >= 2 &&
      workingBuffer[0] === 0x78 &&
      (workingBuffer[1] === 0x9c || workingBuffer[1] === 0x01 || workingBuffer[1] === 0xda || workingBuffer[1] === 0x5e)
    ) {
      try {
        workingBuffer = zlib.inflateSync(workingBuffer);
        this.logger.info('SebLoader', 'Successfully decompressed Deflate configuration stream.', { source: sourceName });
      } catch (infErr) {
        try {
          workingBuffer = zlib.inflateRawSync(workingBuffer);
        } catch {
          this.logger.warn('SebLoader', 'Failed to inflate payload', { error: String(infErr) });
        }
      }
    }

    // Handle encoding and Byte Order Marks (BOM)
    let contentStr: string;
    if (workingBuffer.length >= 3 && workingBuffer[0] === 0xef && workingBuffer[1] === 0xbb && workingBuffer[2] === 0xbf) {
      // UTF-8 with BOM
      contentStr = workingBuffer.subarray(3).toString('utf8');
    } else if (workingBuffer.length >= 2 && workingBuffer[0] === 0xff && workingBuffer[1] === 0xfe) {
      // UTF-16LE with BOM
      contentStr = workingBuffer.subarray(2).toString('utf16le');
    } else if (workingBuffer.length >= 2 && workingBuffer[0] === 0xfe && workingBuffer[1] === 0xff) {
      // UTF-16BE with BOM: swap bytes to LE
      const swapped = Buffer.from(workingBuffer.subarray(2));
      swapped.swap16();
      contentStr = swapped.toString('utf16le');
    } else {
      contentStr = workingBuffer.toString('utf8');
    }

    // 1. Check for genuinely encrypted or binary signatures
    if (this.isEncryptedOrBinary(workingBuffer, contentStr)) {
      const errorMsg =
        'This .seb file uses encryption, certificates, or an unsupported binary format. ' +
        'FSEB supports unencrypted XML Plist and JSON configurations. ' +
        'Please export the exam configuration without password encryption.';
      this.logger.warn('SebLoader', errorMsg, { source: sourceName });
      return { success: false, error: errorMsg };
    }

    let parsedDict: Record<string, unknown> | null = null;

    // 2. Try parsing as JSON first
    const trimmed = contentStr.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        parsedDict = JSON.parse(trimmed) as Record<string, unknown>;
        this.logger.debug('SebLoader', 'Successfully parsed configuration as JSON.');
      } catch (jsonErr: unknown) {
        this.logger.debug('SebLoader', 'JSON parse attempt failed, trying Plist next.', { error: String(jsonErr) });
      }
    }

    // 3. Try parsing as XML Plist
    if (!parsedDict) {
      try {
        const plistResult = PlistParser.parse(contentStr);
        if (typeof plistResult === 'object' && plistResult !== null) {
          parsedDict = plistResult as Record<string, unknown>;
          this.logger.debug('SebLoader', 'Successfully parsed configuration as XML Plist.');
        }
      } catch (plistErr: unknown) {
        this.logger.warn('SebLoader', 'Plist parse failed.', { error: String(plistErr) });
      }
    }

    // 4. Fallback: XML regex extractor for startURL, examTitle, etc.
    if (!parsedDict || !parsedDict['startURL']) {
      const extractedUrl = this.extractStartUrlFromXml(contentStr);
      if (extractedUrl) {
        parsedDict = parsedDict || {};
        parsedDict['startURL'] = extractedUrl;
        this.logger.info('SebLoader', `Extracted startURL via fallback XML parsing: ${extractedUrl}`);
      }
    }

    if (!parsedDict) {
      const errorMsg = 'Malformed or unrecognized configuration format. Expected valid XML Plist or JSON containing an exam start URL.';
      this.logger.error('SebLoader', errorMsg, { source: sourceName });
      return { success: false, error: errorMsg };
    }

    // 5. Transform parsed dictionary to normalized ExamConfiguration
    const config = this.mapToExamConfiguration(parsedDict);

    // 6. Validate configuration
    const validation = SebValidator.validate(config);
    if (!validation.isValid) {
      const errorMsg = `Configuration validation failed: ${validation.errors.join('; ')}`;
      this.logger.error('SebLoader', errorMsg);
      return { success: false, configuration: config, validation, error: errorMsg };
    }

    this.logger.info('SebLoader', 'Successfully parsed and validated exam configuration.', {
      startUrl: config.startUrl,
      allowedUrlsCount: config.allowedUrls.length,
      fullscreen: config.fullscreen,
    });

    return {
      success: true,
      configuration: config,
      validation,
    };
  }

  /**
   * Detects if the content is genuinely encrypted SEB data or binary.
   */
  private static isEncryptedOrBinary(buffer: Buffer, contentStr: string): boolean {
    // If startURL/startUrl/url/examUrl is present in plain text, it is NOT encrypted!
    if (/<key>\s*(?:startURL|startUrl|url|examUrl|link)\s*<\/key>/i.test(contentStr)) {
      return false;
    }
    if (/"(?:startURL|startUrl|url|examUrl)"\s*:/i.test(contentStr)) {
      return false;
    }

    // Check for explicit SEB encryption key tags without any readable startURL
    if (
      contentStr.includes('<key>crypto</key>') ||
      contentStr.includes('<key>encryptedData</key>') ||
      (contentStr.includes('<key>cipher</key>') && contentStr.includes('AES'))
    ) {
      return true;
    }

    // Check for Apple binary plist signature
    if (buffer.length >= 8 && buffer.subarray(0, 8).toString('ascii') === 'bplist00') {
      return true;
    }

    return false;
  }

  /**
   * Fallback regex to find start URL in non-standard or fragmented XML
   */
  private static extractStartUrlFromXml(xml: string): string | null {
    // Check <key>startURL</key><string>...</string> (case-insensitive)
    const keyMatch = /<key>\s*(?:startURL|startUrl|url|examUrl|link)\s*<\/key>\s*<string>([^<]+)<\/string>/i.exec(xml);
    if (keyMatch) return keyMatch[1].trim();

    // Check <startURL>...</startURL> or <url>...</url>
    const tagMatch = /<(?:startURL|startUrl|url|examUrl)>([^<]+)<\/(?:startURL|startUrl|url|examUrl)>/i.exec(xml);
    if (tagMatch) return tagMatch[1].trim();

    // Check any http/https URL inside <string> that looks like an exam link
    const stringMatch = /<string>\s*(https?:\/\/[^<\s]+)\s*<\/string>/i.exec(xml);
    if (stringMatch) return stringMatch[1].trim();

    return null;
  }

  /**
   * Maps SEB plist dictionary or JSON dictionary to normalized ExamConfiguration
   */
  private static mapToExamConfiguration(dict: Record<string, unknown>): ExamConfiguration {
    const rawStartUrl =
      (dict['startURL'] as string) ||
      (dict['startUrl'] as string) ||
      (dict['url'] as string) ||
      (dict['examUrl'] as string) ||
      '';

    const startUrl = typeof rawStartUrl === 'string' ? rawStartUrl.trim() : '';

    // Extract allowed URLs or filter rules
    const allowedUrls: string[] = [];

    // If explicit allowedUrls array is present
    if (Array.isArray(dict['allowedUrls'])) {
      for (const item of dict['allowedUrls']) {
        if (typeof item === 'string' && item.trim()) {
          allowedUrls.push(item.trim());
        }
      }
    }

    // Safe Exam Browser urlFilterRules format
    if (Array.isArray(dict['urlFilterRules'])) {
      for (const rule of dict['urlFilterRules']) {
        if (typeof rule === 'object' && rule !== null) {
          const ruleObj = rule as Record<string, unknown>;
          if (ruleObj['active'] !== false && typeof ruleObj['expression'] === 'string') {
            allowedUrls.push(ruleObj['expression'].trim());
          }
        }
      }
    }

    // Always ensure the startUrl origin is in allowedUrls if not already present
    if (startUrl) {
      try {
        const parsed = new URL(startUrl);
        const originWildcard = `${parsed.protocol}//${parsed.host}/*`;
        if (!allowedUrls.includes(originWildcard) && !allowedUrls.includes(startUrl)) {
          allowedUrls.push(originWildcard);
        }
      } catch {
        // Ignored
      }
    }

    // Navigation configuration
    const allowReload = dict['browserWindowAllowReload'] !== undefined
      ? Boolean(dict['browserWindowAllowReload'])
      : true;

    // Fullscreen configuration
    const fullscreen = dict['fullscreen'] !== undefined
      ? Boolean(dict['fullscreen'])
      : true;

    // Downloads configuration
    const downloads = dict['allowDownUploads'] !== undefined
      ? Boolean(dict['allowDownUploads'])
      : false;

    // Developer tools
    const developerTools = Boolean(dict['allowDevTools'] || dict['developerTools']);

    // Title / Institution
    const examTitle = (dict['examTitle'] as string) || (dict['title'] as string) || undefined;
    const institution = (dict['institution'] as string) || undefined;

    // Taskbar configuration
    const showTaskBar = dict['showTaskBar'] !== undefined ? Boolean(dict['showTaskBar']) : true;
    const taskBarHeight = typeof dict['taskBarHeight'] === 'number' ? dict['taskBarHeight'] : 36;
    const showQuitButton = dict['showQuitButton'] !== undefined ? Boolean(dict['showQuitButton']) : true;
    const showReloadButton = dict['showReloadButton'] !== undefined ? Boolean(dict['showReloadButton']) : true;
    const showTime = dict['showTime'] !== undefined ? Boolean(dict['showTime']) : true;
    const allowWlan = dict['allowWlan'] !== undefined ? Boolean(dict['allowWlan']) : true;
    const audioControlEnabled = dict['audioControlEnabled'] !== undefined ? Boolean(dict['audioControlEnabled']) : true;
    const quitUrl = (dict['quitURL'] as string) || (dict['quitUrl'] as string) || '/quit-seb';

    return {
      ...DEFAULT_EXAM_CONFIGURATION,
      startUrl,
      allowedUrls,
      fullscreen,
      developerTools,
      downloads,
      navigation: {
        ...DEFAULT_EXAM_CONFIGURATION.navigation,
        allowReload,
      },
      clipboard: {
        // FSEB deliberately permits copy, paste, selectAll by default
        copy: dict['allowCopy'] !== undefined ? Boolean(dict['allowCopy']) : true,
        paste: dict['allowPaste'] !== undefined ? Boolean(dict['allowPaste']) : true,
        selectAll: dict['allowSelectAll'] !== undefined ? Boolean(dict['allowSelectAll']) : true,
      },
      taskbar: {
        showTaskBar,
        taskBarHeight,
        showQuitButton,
        showReloadButton,
        showTime,
        allowWlan,
        audioControlEnabled,
        quitUrl,
      },
      compatibility: {
        sebVersion: '3.10.2',
        platform: 'SEB_Windows_3.10.2',
      },
      windowSwitching: dict['windowSwitching'] !== undefined ? Boolean(dict['windowSwitching']) : true,
      examTitle,
      institution,
      rawSettings: dict,
    };
  }
}
