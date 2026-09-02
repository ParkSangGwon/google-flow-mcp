import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, expandHome, loadConfig } from '../../src/config.js';

describe('config', () => {
  it('uses defaults when there is no file and no env', () => {
    const cfg = loadConfig({}, path.join(os.tmpdir(), 'does-not-exist.json'));
    expect(cfg).toEqual(defaultConfig());
  });

  it('file overrides defaults and env overrides file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flow-cfg-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify({ cdpPort: 9444, logLevel: 'debug', userDataDir: '~/chrome-x' }));
    const cfg = loadConfig({ FLOW_MCP_CDP_PORT: '9555', FLOW_MCP_LOG_LEVEL: '' }, file);
    expect(cfg.cdpPort).toBe(9555);
    expect(cfg.logLevel).toBe('debug');
    expect(cfg.userDataDir).toBe(path.join(os.homedir(), 'chrome-x'));
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ FLOW_MCP_CDP_PORT: '80' }, path.join(os.tmpdir(), 'nope.json'))).toThrow();
    expect(() => loadConfig({ FLOW_MCP_LOG_LEVEL: 'loud' }, path.join(os.tmpdir(), 'nope.json'))).toThrow();
  });

  it('expands ~ only at the start', () => {
    expect(expandHome('~/x')).toBe(path.join(os.homedir(), 'x'));
    expect(expandHome('/a/~/x')).toBe('/a/~/x');
  });
});
