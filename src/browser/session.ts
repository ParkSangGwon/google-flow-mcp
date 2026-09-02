import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { Config } from '../config.js';
import { FlowError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { RawCdp } from './cdp.js';
import { cdpReachable, cdpUrl, launchChrome } from './chrome.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
  private targetId: string | undefined;
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
    // Remember the tab's CDP target id while it is healthy so close() can still kill it if the renderer hangs
    try {
      const cdp = await this.context.newCDPSession(this.page);
      const info = (await cdp.send('Target.getTargetInfo')) as { targetInfo: { targetId: string } };
      this.targetId = info.targetInfo.targetId;
      await cdp.detach();
    } catch (err) {
      this.log.warn('could not read tab target id', { error: errMessage(err) });
    }
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

  // Close only our tab; browser.close() over CDP merely detaches and leaves Chrome running for other sessions.
  // A tab left behind with a hung renderer blocks every future connectOverCDP (Playwright attaches to all tabs),
  // so if the polite close does not finish quickly the tab is closed at the browser level instead.
  async close(): Promise<void> {
    const { page, browser, targetId } = this;
    this.reset();
    let closed = false;
    try {
      if (page && !page.isClosed()) {
        closed = await Promise.race([page.close().then(() => true), sleep(5000).then(() => false)]);
      } else {
        closed = true;
      }
    } catch (err) {
      this.log.warn('page close failed', { error: errMessage(err) });
    }
    if (!closed && targetId) {
      try {
        const cdp = await RawCdp.connect(this.config.cdpPort);
        this.log.warn('tab did not close politely; closing via CDP', { targetId, ok: await cdp.closeTarget(targetId) });
        cdp.close();
      } catch (err) {
        this.log.warn('CDP close failed', { error: errMessage(err) });
      }
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
    this.targetId = undefined;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
