import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRequire } from 'node:module';
import type { AppContext } from '../context.js';
import { tools } from '../tools/index.js';
import { registerTools } from './tool.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { name: string; version: string };

export function createServer(ctx: AppContext): McpServer {
  const server = new McpServer(
    { name: pkg.name, version: pkg.version },
    {
      instructions:
        'Drives Google Flow (labs.google) in a real Chrome session that the user is logged into. ' +
        "Tools that generate media spend the user's Flow credits: call them with auto_confirm=false first to preview, " +
        'then auto_confirm=true to generate. Results are JSON with ok=true or ok=false plus a machine-readable code.',
    },
  );
  registerTools(server, ctx, tools);
  return server;
}

export const PACKAGE_VERSION = pkg.version;
