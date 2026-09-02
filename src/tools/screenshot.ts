import path from 'node:path';
import { z } from 'zod';
import { takeScreenshot } from '../browser/screenshot.js';
import { FlowError } from '../lib/errors.js';
import { defineTool } from '../server/tool.js';

export const screenshot = defineTool({
  name: 'flow_screenshot',
  title: 'Screenshot the Flow tab',
  description:
    'Save a PNG of the tab this server owns and return its absolute path. Useful to see what the agent or Scene Builder is showing.',
  input: {
    label: z.string().max(60).optional().describe('Short label used in the file name'),
    full_page: z.boolean().optional().describe('Capture the whole scrollable page instead of the viewport'),
  },
  output: { path: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(ctx, args) {
    const page = ctx.session.getPage();
    const file = await takeScreenshot(
      page,
      path.join(ctx.config.stateDir, 'screenshots'),
      args.label ?? 'manual',
      args.full_page ?? false,
    );
    if (!file) throw new FlowError('INTERNAL', 'screenshot failed');
    return { path: file };
  },
});
