import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { Config } from '../config.js';
import { FlowError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { cdpReachable, cdpUrl, launchChrome } from './chrome.js';

export interface SessionStatus {
  connected: boolean;
  attached_existing: boolean;
  url: string | undefined;
}

// Owns exactly one tab in the shared Chrome. Other processes (other MCP sessions) own their own tabs;
// touching pages we did not create is what caused cross-project media mix-ups in the past.
export class BrowserSession {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private attachedExisting = false;

  constructor(
    private readonly config: Config,
    private readonly log: Logger,
  ) {}

  isConnected(): boolean {
    return this.page !== undefined && !this.page.isClosed() && this.browser?.isConnected() === true;
  }

  status(): SessionStatus {
    return {
      connected: this.isConnected(),
      attached_existing: this.attachedExisting,
      url: this.isConnected() ? this.page?.url() : undefined,
    };
  }

  async ensureConnected(): Promise<Page> {
    if (this.isConnected() && this.page) return this.page;
    this.reset();
    const endpoint = cdpUrl(this.config.cdpPort);
    this.attachedExisting = await cdpReachable(this.config.cdpPort);
    if (!this.attachedExisting) await launchChrome(this.config, this.log);
    try {
      this.browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
    } catch (err) {
      throw new FlowError('BROWSER_NOT_CONNECTED', `CDP connect failed: ${errMessage(err)}`, { endpoint });
    }
    this.browser.on('disconnected', () => {
      this.log.warn('browser disconnected');
      this.reset();
    });
    this.context = this.browser.contexts()[0] ?? (await this.browser.newContext());
    this.page = await this.context.newPage();
    this.log.info('browser connected', { endpoint, attached_existing: this.attachedExisting });
    return this.page;
  }

  getPage(): Page {
    if (!this.isConnected() || !this.page) {
      throw new FlowError('BROWSER_NOT_CONNECTED', 'Browser not connected; call flow_connect first');
    }
    return this.page;
  }

  getContext(): BrowserContext {
    if (!this.isConnected() || !this.context) {
      throw new FlowError('BROWSER_NOT_CONNECTED', 'Browser not connected; call flow_connect first');
    }
    return this.context;
  }

  // Close only our tab; browser.close() over CDP merely detaches and leaves Chrome running for other sessions
  async close(): Promise<void> {
    const { page, browser } = this;
    this.reset();
    try {
      if (page && !page.isClosed()) await page.close();
    } catch (err) {
      this.log.warn('page close failed', { error: errMessage(err) });
    }
    try {
      if (browser?.isConnected()) await browser.close();
    } catch (err) {
      this.log.warn('browser detach failed', { error: errMessage(err) });
    }
  }

  private reset(): void {
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
