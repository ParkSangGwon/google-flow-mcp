import fs from 'node:fs';
import path from 'node:path';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  level: LogLevel;
  dir?: string;
}

// stdout is the MCP stdio transport, so every log line goes to stderr and (optionally) a daily file
export function createLogger(opts: LoggerOptions): Logger {
  const threshold = LOG_LEVELS.indexOf(opts.level);
  const dir = opts.dir;
  if (dir) fs.mkdirSync(dir, { recursive: true });

  const write = (level: LogLevel, msg: string, data?: Record<string, unknown>): void => {
    if (LOG_LEVELS.indexOf(level) < threshold) return;
    const ts = new Date().toISOString();
    const line = `${ts} ${level.toUpperCase().padEnd(5)} ${msg}${data ? ' ' + safeJson(data) : ''}`;
    process.stderr.write(line + '\n');
    if (dir) {
      const file = path.join(dir, `server-${ts.slice(0, 10)}.log`);
      try {
        fs.appendFileSync(file, line + '\n');
      } catch {
        // a broken log file must never break a tool call
      }
    }
  };

  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}

const noop = (): void => undefined;
export const silentLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };

function safeJson(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data);
  } catch {
    return '[unserializable]';
  }
}
