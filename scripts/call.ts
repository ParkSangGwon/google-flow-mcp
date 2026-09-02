// Dev loop: run one tool against the built server over real stdio and print the JSON body.
//   npx tsx scripts/call.ts flow_connect
//   npx tsx scripts/call.ts flow_inspect '{"action":"click","target":"tune","region":"right"}'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';

const [tool, json] = process.argv.slice(2);
if (!tool) {
  process.stderr.write('usage: tsx scripts/call.ts <tool_name> [json-args]\n');
  process.exit(2);
}
const args: unknown = json ? JSON.parse(json) : {};

const client = new Client({ name: 'google-flow-mcp-call', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('dist/cli.js')],
    env: { ...process.env } as Record<string, string>,
    stderr: 'inherit',
  }),
);
const res = await client.callTool({ name: tool, arguments: args as Record<string, unknown> }, undefined, {
  timeout: 1_900_000,
});
const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text ?? '';
let pretty = text;
try {
  pretty = JSON.stringify(JSON.parse(text), null, 2);
} catch {
  // plain text (e.g. SDK validation error) is printed as is
}
process.stdout.write(pretty + '\n');
await client.close();
process.exit(res.isError ? 1 : 0);
