import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Runs the built server (dist/cli.js) over real stdio, exactly like an MCP client or the Python pipeline would
describe('stdio contract', () => {
  const client = new Client({ name: 'contract-test', version: '0.0.0' });
  let stateDir = '';

  beforeAll(async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-state-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('dist/cli.js')],
      env: {
        ...process.env,
        FLOW_MCP_STATE_DIR: stateDir,
        FLOW_MCP_CONFIG: path.join(stateDir, 'none.json'),
        FLOW_MCP_CDP_PORT: '9999',
      },
      stderr: 'pipe',
    });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  it('lists the v1 tools with JSON schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'flow_connect',
      'flow_status',
      'flow_screenshot',
      'flow_inspect',
      'flow_project_open',
      'flow_generate_video',
      'flow_generate_image',
      'flow_media_download',
      'flow_scene_add',
      'flow_scene_status',
      'flow_scene_extend',
    ]);
    const gen = tools.find((t) => t.name === 'flow_generate_video');
    expect(gen?.inputSchema).toMatchObject({
      type: 'object',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest matchers are typed any
      required: expect.arrayContaining(['prompt', 'project_url', 'output_dir']),
    });
    expect(gen?.outputSchema).toMatchObject({ type: 'object' });
    expect(gen?.annotations).toMatchObject({ destructiveHint: true });
  });

  it('returns a structured error body without a browser', async () => {
    const res = await client.callTool({ name: 'flow_screenshot', arguments: {} });
    expect(res.isError).toBe(true);
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(JSON.parse(text)).toMatchObject({ ok: false, code: 'BROWSER_NOT_CONNECTED', recoverable: true });
  });

  it('flow_status works with no browser and reports nothing running', async () => {
    const res = await client.callTool({ name: 'flow_status', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ ok: true, connected: false, logged_in: false, jobs_in_flight: [] });
  });

  it('reports invalid arguments as an isError result with the validation message', async () => {
    // The SDK answers schema violations itself, with plain text rather than our JSON envelope
    const res = await client.callTool({ name: 'flow_generate_video', arguments: { prompt: '' } });
    expect(res.isError).toBe(true);
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).toMatch(/Input validation error/);
    expect(text).toMatch(/project_url/);
  });
});
