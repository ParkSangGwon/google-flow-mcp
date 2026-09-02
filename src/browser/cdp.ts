import { cdpUrl } from './chrome.js';

// Minimal raw CDP client over the browser websocket. Playwright's connectOverCDP attaches to every tab in
// the shared Chrome, so one hung renderer (anyone's tab) blocks every new connection; these helpers work at
// the browser level and keep working when a page does not.

export interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
  title: string;
}

interface CdpReply {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

export class RawCdp {
  private ws: WebSocket | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, (reply: CdpReply) => void>();

  static async connect(port: number): Promise<RawCdp> {
    const res = await fetch(`${cdpUrl(port)}/json/version`, { signal: AbortSignal.timeout(3000) });
    const version = (await res.json()) as { webSocketDebuggerUrl: string };
    const cdp = new RawCdp();
    await cdp.open(version.webSocketDebuggerUrl);
    return cdp;
  }

  private open(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error('CDP websocket open timeout')), 5000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('CDP websocket error'));
      };
      ws.onmessage = (m) => {
        const reply = JSON.parse(String(m.data)) as CdpReply;
        if (reply.id !== undefined) this.pending.get(reply.id)?.(reply);
      };
    });
  }

  // Resolves with `undefined` on timeout instead of throwing: callers use it as a liveness probe
  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 4000,
  ): Promise<CdpReply | undefined> {
    const ws = this.ws;
    if (!ws) return Promise.resolve(undefined);
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(undefined);
      }, timeoutMs);
      this.pending.set(id, (reply) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(reply);
      });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async pages(): Promise<TargetInfo[]> {
    const reply = await this.send('Target.getTargets');
    const infos = (reply?.result?.targetInfos as TargetInfo[] | undefined) ?? [];
    return infos.filter((t) => t.type === 'page');
  }

  // A page whose renderer does not answer Runtime.evaluate within the timeout will wedge Playwright attach
  async probePage(targetId: string, timeoutMs = 4000): Promise<boolean> {
    const attached = await this.send('Target.attachToTarget', { targetId, flatten: true }, undefined, timeoutMs);
    const sessionId = attached?.result?.sessionId as string | undefined;
    if (!sessionId) return false;
    const evaluated = await this.send('Runtime.evaluate', { expression: '1' }, sessionId, timeoutMs);
    await this.send('Target.detachFromTarget', { sessionId }, undefined, 1000);
    return evaluated !== undefined;
  }

  async closeTarget(targetId: string): Promise<boolean> {
    const reply = await this.send('Target.closeTarget', { targetId });
    return reply?.result?.success === true;
  }

  close(): void {
    this.ws?.close();
    this.ws = undefined;
  }
}

export interface HungPage {
  targetId: string;
  url: string;
}

export async function findHungPages(port: number): Promise<HungPage[]> {
  const cdp = await RawCdp.connect(port);
  try {
    const hung: HungPage[] = [];
    for (const page of await cdp.pages()) {
      if (!(await cdp.probePage(page.targetId))) hung.push({ targetId: page.targetId, url: page.url });
    }
    return hung;
  } finally {
    cdp.close();
  }
}
