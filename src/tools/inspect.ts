import path from 'node:path';
import { z } from 'zod';
import { takeScreenshot } from '../browser/screenshot.js';
import { diffRows, findText, rowKey, snapshot } from '../flow/inspect.js';
import { sleep } from '../flow/ui.js';
import { FlowError } from '../lib/errors.js';
import { defineTool } from '../server/tool.js';

const REGIONS = ['all', 'right', 'bottom-right', 'left'] as const;

export const inspect = defineTool({
  name: 'flow_inspect',
  title: 'Inspect the Flow UI',
  description:
    'Snapshot interactive elements, optionally perform one action (click/hover a button matched by text or aria-label regex, ' +
    'press a key, or navigate), then return the elements that appeared/disappeared. This is how selectors are discovered ' +
    'when Flow changes its UI; paste the rows into a bug report. Never generates anything.',
  input: {
    action: z.enum(['none', 'click', 'hover', 'press', 'goto']).default('none'),
    target: z
      .string()
      .optional()
      .describe('Regex matched against button/menu item text and aria-label (for click/hover)'),
    key: z.string().optional().describe('Key to press for action=press, e.g. Escape'),
    url: z.url().optional().describe('URL for action=goto'),
    find: z.string().optional().describe('Regex over visible text nodes; matches are returned with their position'),
    region: z.enum(REGIONS).default('all').describe('Restrict rows to a viewport region'),
    screenshot: z.boolean().default(false),
    settle_ms: z
      .number()
      .int()
      .min(0)
      .max(15000)
      .default(1500)
      .describe('Wait after the action before the second snapshot'),
  },
  output: {
    url: z.string(),
    before_count: z.number(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    rows: z.array(z.string()).describe('All rows in the region after the action (capped at 300)'),
    matches: z.array(z.string()).optional(),
    screenshot: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    const page = await ctx.session.ensureConnected();
    const before = await snapshot(page, args.region);
    if (args.action === 'goto') {
      if (!args.url) throw new FlowError('UI_NOT_FOUND', 'action=goto needs url');
      await page.goto(args.url, { waitUntil: 'domcontentloaded' });
    } else if (args.action === 'press') {
      if (!args.key) throw new FlowError('UI_NOT_FOUND', 'action=press needs key');
      await page.keyboard.press(args.key);
    } else if (args.action === 'click' || args.action === 'hover') {
      if (!args.target) throw new FlowError('UI_NOT_FOUND', `action=${args.action} needs target`);
      const re = new RegExp(args.target);
      // Buttons/menu items by text first, then aria-label (icon-only buttons), then any text node
      const byText = page
        .locator('button, [role="button"], [role="menuitem"], [role="option"], [role="tab"], a[href]')
        .filter({ hasText: re })
        .first();
      const byLabel = page.getByLabel(re).first();
      const candidate =
        (await byText.count()) > 0 ? byText : (await byLabel.count()) > 0 ? byLabel : page.getByText(re).first();
      if ((await candidate.count()) === 0) {
        throw new FlowError('UI_NOT_FOUND', `no element matches /${args.target}/`, {
          rows: before.slice(0, 50).map(rowKey),
        });
      }
      if (args.action === 'click') await candidate.click({ timeout: 10_000 });
      else await candidate.hover({ timeout: 10_000 });
    }
    await sleep(args.settle_ms);
    const after = await snapshot(page, args.region);
    const { added, removed } = diffRows(before, after);
    const result: {
      url: string;
      before_count: number;
      added: string[];
      removed: string[];
      rows: string[];
      matches?: string[];
      screenshot?: string;
    } = { url: page.url(), before_count: before.length, added, removed, rows: after.slice(0, 300).map(rowKey) };
    if (args.find) {
      result.matches = (await findText(page, args.find, args.region)).map(
        (m) => `${m.tag}|${m.text}|@${m.x},${m.y} ${m.w}x${m.h}`,
      );
    }
    if (args.screenshot) {
      const file = await takeScreenshot(page, path.join(ctx.config.stateDir, 'screenshots'), `inspect-${args.action}`);
      if (file) result.screenshot = file;
    }
    return result;
  },
});
