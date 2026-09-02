#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { RawCdp, findHungPages } from './browser/cdp.js';
import { cdpReachable } from './browser/chrome.js';
import { BrowserSession } from './browser/session.js';
import { type Config, configPath, loadConfig, writeDefaultConfig } from './config.js';
import type { AppContext } from './context.js';
import { JobStore } from './flow/jobs.js';
import { isLoggedIn, openFlowHome } from './flow/project.js';
import { createLogger } from './lib/logger.js';
import { Mutex } from './lib/mutex.js';
import { PACKAGE_VERSION, createServer } from './server/create-server.js';

const HELP = `google-flow-mcp ${PACKAGE_VERSION}

Usage:
  google-flow-mcp            Run the MCP server on stdio (default)
  google-flow-mcp serve
  google-flow-mcp init       Write a default config file (${configPath()})
  google-flow-mcp doctor     Check Chrome, CDP port, state dir, hung tabs and Flow login
  google-flow-mcp doctor --close-hung   Also close tabs whose renderer no longer responds
  google-flow-mcp --version
`;

export function buildContext(config: Config): AppContext {
  const log = createLogger({ level: config.logLevel, dir: path.join(config.stateDir, 'logs') });
  return {
    config,
    log,
    session: new BrowserSession(config, log),
    jobs: new JobStore(path.join(config.stateDir, 'jobs')),
    lock: new Mutex(),
  };
}

async function serve(): Promise<void> {
  const ctx = buildContext(loadConfig());
  const server = createServer(ctx);
  let closing = false;
  const shutdown = (reason: string): void => {
    if (closing) return;
    closing = true;
    ctx.log.info('shutting down', { reason });
    void ctx.session.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.stdin.on('end', () => shutdown('stdin closed'));
  await server.connect(new StdioServerTransport());
  ctx.log.info('server ready', { version: PACKAGE_VERSION, cdpPort: ctx.config.cdpPort });
}

function init(): void {
  const file = configPath();
  if (fs.existsSync(file)) {
    process.stdout.write(`config already exists: ${file}\n`);
    return;
  }
  process.stdout.write(`wrote ${writeDefaultConfig(file)}\n`);
}

async function doctor(): Promise<void> {
  const config = loadConfig();
  const lines: string[] = [];
  const ok = (label: string, good: boolean, detail: string): void => {
    lines.push(`${good ? 'ok  ' : 'FAIL'} ${label}: ${detail}`);
  };
  ok('config', true, fs.existsSync(configPath()) ? configPath() : `defaults (run "init" to create ${configPath()})`);
  ok('chrome', fs.existsSync(config.chromePath), config.chromePath);
  ok(
    'user-data-dir',
    true,
    `${config.userDataDir}${fs.existsSync(config.userDataDir) ? '' : ' (will be created on first launch)'}`,
  );
  ok('state-dir', true, config.stateDir);
  const reachable = await cdpReachable(config.cdpPort);
  ok(
    'cdp',
    true,
    `port ${config.cdpPort} ${reachable ? 'already has a Chrome listening' : 'free (Chrome will be launched)'}`,
  );
  if (reachable) {
    // One tab with a hung renderer blocks every Playwright attach; surface it before trying to connect
    const hung = await findHungPages(config.cdpPort);
    if (hung.length > 0 && process.argv.includes('--close-hung')) {
      const cdp = await RawCdp.connect(config.cdpPort);
      for (const h of hung) await cdp.closeTarget(h.targetId);
      cdp.close();
      ok('tabs', true, `closed ${hung.length} hung tab(s): ${hung.map((h) => h.url).join(', ')}`);
    } else {
      ok(
        'tabs',
        hung.length === 0,
        hung.length === 0
          ? 'all tabs respond'
          : `${hung.length} hung tab(s) block new connections (re-run with --close-hung): ${hung.map((h) => h.url).join(', ')}`,
      );
    }
  }
  const ctx = buildContext({ ...config, logLevel: 'warn' });
  try {
    const page = await ctx.session.ensureConnected();
    await openFlowHome(page, config.flowUrl);
    const loggedIn = isLoggedIn(page);
    ok(
      'flow',
      loggedIn,
      loggedIn ? `logged in (${page.url()})` : 'not logged in: sign in once in the Chrome window, then re-run doctor',
    );
  } catch (err) {
    ok('flow', false, err instanceof Error ? err.message : String(err));
  } finally {
    await ctx.session.close();
  }
  process.stdout.write(lines.join('\n') + '\n');
  if (lines.some((l) => l.startsWith('FAIL'))) process.exitCode = 1;
}

const cmd = process.argv[2] ?? 'serve';
switch (cmd) {
  case 'serve':
    await serve();
    break;
  case 'init':
    init();
    break;
  case 'doctor':
    await doctor();
    break;
  case '--version':
  case '-v':
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    break;
  default:
    process.stdout.write(HELP);
    if (cmd !== '--help' && cmd !== '-h') process.exitCode = 1;
}
