import { FlowError } from './errors.js';

// One browser tab per process means page-touching tools must run one at a time
export class Mutex {
  private holder: string | undefined;
  private queue: (() => void)[] = [];

  get runningTool(): string | undefined {
    return this.holder;
  }

  async run<T>(tool: string, waitMs: number, fn: () => Promise<T>): Promise<T> {
    await this.acquire(tool, waitMs);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async acquire(tool: string, waitMs: number): Promise<void> {
    if (this.holder === undefined) {
      this.holder = tool;
      return;
    }
    const running = this.holder;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.queue = this.queue.filter((w) => w !== wake);
        reject(new FlowError('BUSY', `${running} is still running; retry later`, { running_tool: running }));
      }, waitMs);
      const wake = (): void => {
        clearTimeout(timer);
        this.holder = tool;
        resolve();
      };
      this.queue.push(wake);
    });
  }

  private release(): void {
    this.holder = undefined;
    const next = this.queue.shift();
    if (next) next();
  }
}
