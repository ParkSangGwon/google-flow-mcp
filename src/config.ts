import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { LOG_LEVELS } from './lib/logger.js';

const DEFAULT_CHROME: Record<string, string> = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};

export const ConfigSchema = z.object({
  chromePath: z.string().min(1).describe('Chrome executable used for the dedicated Flow session'),
  userDataDir: z.string().min(1).describe('Dedicated Chrome user-data-dir; holds the Google login cookies'),
  profileDirectory: z.string().min(1).describe('Chrome profile directory inside userDataDir'),
  cdpPort: z.number().int().min(1024).max(65535).describe('Chrome remote-debugging port'),
  flowUrl: z.url().describe('Google Flow home URL'),
  stateDir: z.string().min(1).describe('Where logs, screenshots and job records are written'),
  generationTimeoutMs: z.number().int().positive().describe('Max wait for a video/image generation'),
  pollIntervalMs: z.number().int().positive().describe('Polling interval while waiting for outputs'),
  lockWaitMs: z.number().int().positive().describe('How long a tool waits for the browser lock before BUSY'),
  logLevel: z.enum(LOG_LEVELS),
});

export type Config = z.infer<typeof ConfigSchema>;

export function defaultConfig(): Config {
  return {
    chromePath: DEFAULT_CHROME[process.platform] ?? 'google-chrome',
    userDataDir: path.join(os.homedir(), '.google-flow-chrome'),
    profileDirectory: 'Default',
    cdpPort: 9333,
    flowUrl: 'https://flow.google.com',
    stateDir: path.join(os.homedir(), '.google-flow-mcp'),
    generationTimeoutMs: 1_800_000,
    pollIntervalMs: 6_000,
    lockWaitMs: 10_000,
    logLevel: 'info',
  };
}

export function configPath(): string {
  return process.env.FLOW_MCP_CONFIG ?? path.join(os.homedir(), '.config', 'google-flow-mcp', 'config.json');
}

const ENV_KEYS: Record<string, keyof Config> = {
  FLOW_MCP_CHROME_PATH: 'chromePath',
  FLOW_MCP_USER_DATA_DIR: 'userDataDir',
  FLOW_MCP_PROFILE_DIRECTORY: 'profileDirectory',
  FLOW_MCP_CDP_PORT: 'cdpPort',
  FLOW_MCP_FLOW_URL: 'flowUrl',
  FLOW_MCP_STATE_DIR: 'stateDir',
  FLOW_MCP_GENERATION_TIMEOUT_MS: 'generationTimeoutMs',
  FLOW_MCP_POLL_INTERVAL_MS: 'pollIntervalMs',
  FLOW_MCP_LOCK_WAIT_MS: 'lockWaitMs',
  FLOW_MCP_LOG_LEVEL: 'logLevel',
};

// Precedence: defaults < config file < FLOW_MCP_* environment variables
export function loadConfig(env: NodeJS.ProcessEnv = process.env, file: string = configPath()): Config {
  const merged: Record<string, unknown> = { ...defaultConfig() };
  if (fs.existsSync(file)) {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`config file must be a JSON object: ${file}`);
    }
    Object.assign(merged, raw);
  }
  for (const [envKey, key] of Object.entries(ENV_KEYS)) {
    const value = env[envKey];
    if (value === undefined || value === '') continue;
    merged[key] = key.endsWith('Ms') || key === 'cdpPort' ? Number(value) : value;
  }
  for (const key of ['chromePath', 'userDataDir', 'stateDir'] as const) {
    const value = merged[key];
    if (typeof value === 'string') merged[key] = expandHome(value);
  }
  return ConfigSchema.parse(merged);
}

export function writeDefaultConfig(file: string = configPath()): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(defaultConfig(), null, 2) + '\n');
  return file;
}

export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}
