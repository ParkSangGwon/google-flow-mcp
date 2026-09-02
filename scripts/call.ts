// Dev loop: run one tool (or a JSON array of {tool, args} steps sharing one server process) against the built
// server over real stdio and print each JSON body.
//   npx tsx scripts/call.ts flow_connect
//   npx tsx scripts/call.ts flow_inspect '{"action":"click","target":"tune","region":"right"}'
//   npx tsx scripts/call.ts '[{"tool":"flow_project_open","args":{"project_url":"..."}},{"tool":"flow_inspect","args":{"action":"click","target":"tune"}}]'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';

interface Step {
  tool: string;
  args?: Record<string, unknown>;
}

const [first, json] = process.argv.slice(2);
if (!first) {
  process.stderr.write('usage: tsx scripts/call.ts <tool_name> [json-args] | tsx scripts/call.ts <json-steps>\n');
  process.exit(2);
}
const steps: Step[] = first.trimStart().startsWith('[')
  ? (JSON.parse(first) as Step[])
  : [{ tool: first, args: json ? (JSON.parse(json) as Record<string, unknown>) : {} }];

const client = new Client({ name: 'google-flow-mcp-call', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('dist/cli.js')],
    env: { ...process.env } as Record<string, string>,
    stderr: 'inherit',
  }),
);

let failed = false;
for (const step of steps) {
  const res = await client.callTool({ name: step.tool, arguments: step.args ?? {} }, undefined, { timeout: 1_900_000 });
  const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text ?? '';
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // plain text (e.g. SDK validation error) is printed as is
  }
  process.stdout.write(`### ${step.tool}\n${pretty}\n`);
  if (res.isError) {
    failed = true;
    break;
  }
}
await client.close();
process.exit(failed ? 1 : 0);
