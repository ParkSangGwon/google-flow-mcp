import path from 'node:path';
import type { Locator, Page, Response } from 'playwright-core';
import { z } from 'zod';
import { takeScreenshot } from '../browser/screenshot.js';
import { diffRows, findText, rowKey, snapshot } from '../flow/inspect.js';
import { mediaTileCentre, mediaTiles } from '../flow/media.js';
import { sleep } from '../flow/ui.js';
import { FlowError } from '../lib/errors.js';
import { defineTool } from '../server/tool.js';

const REGIONS = ['all', 'right', 'bottom-right', 'left'] as const;

// Buttons/menu items by text first, then aria-label (icon-only buttons), then any text node
async function byTextOrLabel(page: Page, pattern: string): Promise<Locator> {
  const re = new RegExp(pattern);
  const byText = page
    .locator(
      'button, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="textbox"], textarea, a[href]',
    )
    .filter({ hasText: re })
    .first();
  if ((await byText.count()) > 0) return byText;
  const byLabel = page.getByLabel(re).first();
  if ((await byLabel.count()) > 0) return byLabel;
  return page.getByText(re).first();
}

export const inspect = defineTool({
  name: 'flow_inspect',
  title: 'Inspect the Flow UI',
  description:
    'Snapshot interactive elements, optionally perform one action (click/hover a button matched by text or aria-label regex, ' +
    'press a key, or navigate), then return the elements that appeared/disappeared. This is how selectors are discovered ' +
    'when Flow changes its UI; paste the rows into a bug report. Never generates anything.',
  input: {
    action: z.enum(['none', 'click', 'hover', 'press', 'type', 'goto']).default('none'),
    text: z.string().optional().describe('Text to type for action=type (after clicking target/at if given)'),
    target: z
      .string()
      .optional()
      .describe(
        'Regex matched against button/menu item text and aria-label (for click/hover), or "media:<tile title>" to target a media tile',
      ),
    at: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe('Viewport coordinates [x, y] to click/hover instead of a target (from a previous row @x,y)'),
    key: z.string().optional().describe('Key to press for action=press, e.g. Escape'),
    url: z.url().optional().describe('URL for action=goto'),
    find: z.string().optional().describe('Regex over visible text nodes; matches are returned with their position'),
    region: z.enum(REGIONS).default('all').describe('Restrict rows to a viewport region'),
    media: z.boolean().default(false).describe('Also list the project grid tiles (index, kind, title)'),
    watch_network: z
      .boolean()
      .default(false)
      .describe('Record network requests made during the action and settle window (method, status, type, URL)'),
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
    media: z.array(z.string()).optional().describe('index|kind|title for each grid tile, newest first'),
    requests: z.array(z.string()).optional().describe('METHOD status content-type URL (capped at 80)'),
    screenshot: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    const page = await ctx.session.ensureConnected();
    const requests: string[] = [];
    const onResponse = (res: Response): void => {
      if (requests.length >= 80) return;
      const req = res.request();
      const type = res.headers()['content-type'] ?? '';
      if (/\.(js|css|woff2?|png|svg|ico)(\?|$)/.test(req.url()) && !type.startsWith('video/')) return;
      requests.push(`${req.method()} ${res.status()} ${type.split(';')[0] ?? ''} ${req.url().slice(0, 220)}`);
    };
    if (args.watch_network) page.on('response', onResponse);
    const before = await snapshot(page, args.region);
    if (args.action === 'goto') {
      if (!args.url) throw new FlowError('UI_NOT_FOUND', 'action=goto needs url');
      await page.goto(args.url, { waitUntil: 'domcontentloaded' });
    } else if (args.action === 'press') {
      if (!args.key) throw new FlowError('UI_NOT_FOUND', 'action=press needs key');
      await page.keyboard.press(args.key);
    } else if (args.action === 'click' || args.action === 'hover' || args.action === 'type') {
      if (args.at) {
        const [x, y] = args.at;
        if (args.action === 'hover') await page.mouse.move(x, y);
        else await page.mouse.click(x, y);
      } else if (args.action === 'type' && !args.target) {
        // type into whatever is focused
      } else {
        if (!args.target) throw new FlowError('UI_NOT_FOUND', `action=${args.action} needs target or at`);
        if (args.target.startsWith('media:')) {
          // Grid <video> elements are lazy (preload=none, not "visible" to Playwright): act on the tile's centre instead
          const ref = args.target.slice(6);
          const tile = (await mediaTiles(page)).find((t) => t.title === ref || t.url.endsWith(ref));
          const centre = tile ? await mediaTileCentre(page, tile.url) : null;
          if (!centre) {
            throw new FlowError('UI_NOT_FOUND', `no media tile for ${args.target}`, {
              rows: before.slice(0, 50).map(rowKey),
            });
          }
          if (args.action === 'hover') await page.mouse.move(centre.x, centre.y);
          else await page.mouse.click(centre.x, centre.y);
        } else {
          const candidate = await byTextOrLabel(page, args.target);
          if ((await candidate.count()) === 0) {
            throw new FlowError('UI_NOT_FOUND', `no element matches ${args.target}`, {
              rows: before.slice(0, 50).map(rowKey),
            });
          }
          if (args.action === 'hover') await candidate.hover({ timeout: 10_000 });
          else await candidate.click({ timeout: 10_000 });
        }
      }
      if (args.action === 'type') {
        if (!args.text) throw new FlowError('UI_NOT_FOUND', 'action=type needs text');
        await page.keyboard.type(args.text, { delay: 10 });
      }
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
      media?: string[];
      requests?: string[];
      screenshot?: string;
    } = { url: page.url(), before_count: before.length, added, removed, rows: after.slice(0, 300).map(rowKey) };
    if (args.watch_network) {
      page.off('response', onResponse);
      result.requests = requests;
    }
    if (args.find) {
      result.matches = (await findText(page, args.find, args.region)).map(
        (m) => `${m.tag}|${m.text}|@${m.x},${m.y} ${m.w}x${m.h}`,
      );
    }
    if (args.media) {
      result.media = (await mediaTiles(page)).map((t) => `${t.index}|${t.kind}|${t.title}`);
    }
    if (args.screenshot) {
      const file = await takeScreenshot(page, path.join(ctx.config.stateDir, 'screenshots'), `inspect-${args.action}`);
      if (file) result.screenshot = file;
    }
    return result;
  },
});
