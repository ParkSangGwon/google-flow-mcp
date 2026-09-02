import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Live checks against a real Chrome + Google Flow account. Opt in with FLOW_E2E=1; FLOW_E2E_PROJECT_URL selects the
// project; FLOW_E2E_CREDITS (default 0) is the credit budget: 0 keeps every call a dry run.
const enabled = process.env.FLOW_E2E === '1';
const projectUrl = process.env.FLOW_E2E_PROJECT_URL ?? '';
const credits = Number(process.env.FLOW_E2E_CREDITS ?? '0');

interface Body {
  ok: boolean;
  code?: string;
  [key: string]: unknown;
}

describe.skipIf(!enabled)('google flow live', () => {
  const client = new Client({ name: 'live-test', version: '0.0.0' });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-live-'));

  const call = async (name: string, args: Record<string, unknown>): Promise<Body> => {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 1_900_000 });
    const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text ?? '{}';
    return JSON.parse(text) as Body;
  };

  beforeAll(async () => {
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/cli.js')], stderr: 'inherit' }),
    );
  });

  afterAll(async () => {
    await client.close();
  });

  it('connects and is logged in', async () => {
    const body = await call('flow_connect', {});
    expect(body).toMatchObject({ ok: true, logged_in: true });
  });

  it.skipIf(!projectUrl)('opens the project and prepares a video without spending credits', async () => {
    const open = await call('flow_project_open', { project_url: projectUrl });
    expect(open.ok).toBe(true);
    const dry = await call('flow_generate_video', {
      prompt: 'A quiet harbour at dawn, slow push-in',
      project_url: projectUrl,
      output_dir: outDir,
      auto_confirm: false,
    });
    expect(dry).toMatchObject({ ok: true, status: 'ready_for_confirmation', references_attached: 0 });
  });

  it.skipIf(!projectUrl)('reports a missing reference image before sending', async () => {
    const body = await call('flow_generate_video', {
      prompt: 'x',
      project_url: projectUrl,
      output_dir: outDir,
      reference_images: [path.join(outDir, 'missing.jpg')],
      auto_confirm: false,
    });
    expect(body).toMatchObject({ ok: false, code: 'REFERENCE_NOT_ATTACHED' });
  });

  it.skipIf(!projectUrl || credits < 5)('generates one Veo 3.1 Lite clip (5 credits)', async () => {
    const body = await call('flow_generate_video', {
      prompt: 'A quiet harbour at dawn, slow push-in',
      model: 'veo-3.1-lite',
      duration: 4,
      project_url: projectUrl,
      output_dir: outDir,
      auto_confirm: true,
    });
    expect(body).toMatchObject({ ok: true, status: 'completed' });
    const files = body.files as string[];
    expect(files.length).toBeGreaterThan(0);
    expect(fs.statSync(files[0] ?? '').size).toBeGreaterThan(100_000);
  });
});
