import type { BrowserSession } from './browser/session.js';
import type { Config } from './config.js';
import type { JobStore } from './flow/jobs.js';
import type { Logger } from './lib/logger.js';
import type { Mutex } from './lib/mutex.js';

// Built once per process by the CLI and handed to every tool; nothing loads config at import time
export interface AppContext {
  config: Config;
  log: Logger;
  session: BrowserSession;
  jobs: JobStore;
  lock: Mutex;
}
