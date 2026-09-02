import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { Config } from '../config.js';
import { FlowError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export function cdpUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function cdpReachable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`${cdpUrl(port)}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Chrome is spawned outside Playwright so navigator.webdriver stays false: Google sign-in rejects automated browsers
export async function launchChrome(config: Config, log: Logger): Promise<void> {
  if (!fs.existsSync(config.chromePath)) {
    throw new FlowError('CHROME_LAUNCH_FAILED', `Chrome not found at ${config.chromePath}`, {
      chromePath: config.chromePath,
    });
  }
  fs.mkdirSync(config.userDataDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${config.cdpPort}`,
    `--user-data-dir=${config.userDataDir}`,
    `--profile-directory=${config.profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1920,1080',
  ];
  log.info('launching chrome', {
    chromePath: config.chromePath,
    cdpPort: config.cdpPort,
    userDataDir: config.userDataDir,
  });
  const child = spawn(config.chromePath, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    log.error('chrome process error', { error: err.message });
  });
  child.unref();

  for (let attempt = 0; attempt < 20; attempt++) {
    if (await cdpReachable(config.cdpPort)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new FlowError('CHROME_LAUNCH_FAILED', `Chrome did not open CDP port ${config.cdpPort} within 20s`, {
    cdpPort: config.cdpPort,
  });
}
