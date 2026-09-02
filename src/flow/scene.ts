import path from 'node:path';
import type { Page } from 'playwright-core';
import { takeScreenshot } from '../browser/screenshot.js';
import type { AppContext } from '../context.js';
import { FlowError } from '../lib/errors.js';
import { label } from './labels.js';
import { type Downloaded, fileNameFor, mediaElements, mediaIds, mediaTileCentre, tryDownload } from './media.js';
import { ensureOnProject, ensureOnScene, parseFlowUrl } from './project.js';
import { bodyText, isVisible, pressEscape, sleep } from './ui.js';

// Scene Builder (observed 2026-09): a project media tile's "⋮" menu has "장면에 추가 → 장면 만들기" which creates a
// scene card in the grid; opening it lands on /project/<id>/scene/<id>. The scene view shows a timeline of clip
// blocks (width ∝ duration), a "+" after the last clip with "클립 추가 | 확장(Veo 3.1 - Lite)", a bottom prompt box
// and a "다운로드" button in the top bar. Extensions are generated as separate 7 s project media items.

export const EXTEND_HOP_SECONDS = 7;
export const EXTEND_MODEL_LABEL = 'Veo 3.1 - Lite';

export interface SceneClip {
  index: number;
  duration_s: number;
  media_id?: string;
}

export interface Timeline {
  clips: SceneClip[];
  total_duration_s: number;
  generating: boolean;
}

interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

// Timeline clip blocks: role=button DIVs in the lower band whose height matches the strip (~62px)
async function timelineBlocks(page: Page): Promise<Block[]> {
  const blocks = await page
    .evaluate(() => {
      const out: Block[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('[role="button"]')) {
        const r = el.getBoundingClientRect();
        if (r.y < window.innerHeight * 0.55 || r.height < 50 || r.height > 80 || r.width < 60) continue;
        out.push({
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        });
      }
      return out.sort((a, b) => a.x - b.x);
    })
    .catch((): Block[] => []);
  return blocks;
}

// The transport shows "mm:ss:ff"; the last such label is the scene's total length
async function totalDurationSeconds(page: Page): Promise<number | undefined> {
  const labels = await page
    .evaluate(() => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const t = (node.textContent ?? '').trim();
        if (/^\d\d:\d\d:\d\d$/.test(t)) out.push(t);
        node = walker.nextNode();
      }
      return out;
    })
    .catch((): string[] => []);
  const last = labels.at(-1);
  if (!last) return undefined;
  const [mm = '0', ss = '0', ff = '0'] = last.split(':');
  return Number(mm) * 60 + Number(ss) + Number(ff) / 24;
}

const PENDING_RE = /확장\(|Extend\(|연장하세요|extend with a prompt/i;

// The timeline renders after the rest of the scene view; give it up to 15 s before reporting an empty scene
export async function readTimeline(page: Page): Promise<Timeline> {
  let blocks = await timelineBlocks(page);
  for (let i = 0; i < 10 && blocks.length === 0; i++) {
    await sleep(1500);
    blocks = await timelineBlocks(page);
  }
  const total = (await totalDurationSeconds(page)) ?? 0;
  const generating = blocks.some((b) => PENDING_RE.test(b.text));
  const widthSum = blocks.reduce((s, b) => s + b.w, 0);
  const pxPerSec = total > 0 && widthSum > 0 ? widthSum / total : 100;
  return {
    clips: blocks.map((b, index) => ({ index, duration_s: Math.round((b.w / pxPerSec) * 10) / 10 })),
    total_duration_s: Math.round(total * 10) / 10,
    generating,
  };
}

// The right-hand panel shows the selected clip's poster (a tall thumbnail) whose src carries the media id.
// Note: a clip added to a scene gets its own media id (a copy of the source), so this is the scene's id, not
// the id of the tile it was created from; both download the same content.
async function selectedMediaId(page: Page): Promise<string | undefined> {
  const els = await mediaElements(page);
  const vw = await page.evaluate(() => window.innerWidth).catch(() => 1920);
  const poster = els.filter((m) => m.x > vw * 0.75 && m.h >= 120 && m.w >= 60).sort((a, b) => b.h - a.h)[0];
  return poster?.id;
}

export async function clipMediaId(page: Page, index: number): Promise<string | undefined> {
  const blocks = await timelineBlocks(page);
  const block = blocks[index];
  if (!block) return undefined;
  await page.mouse.click(block.x + Math.min(40, block.w / 2), block.y + block.h / 2);
  await sleep(800);
  return selectedMediaId(page);
}

export interface SceneRef {
  scene_url: string;
  scene_id: string;
}

function currentScene(page: Page): SceneRef {
  const loc = parseFlowUrl(page.url());
  if (!loc?.sceneId) throw new FlowError('SCENE_NOT_FOUND', `not on a scene view: ${page.url()}`);
  return { scene_url: page.url(), scene_id: loc.sceneId };
}

// Tile "⋮" → 장면에 추가 → 장면 만들기, then open the new scene card (first card in the grid)
export async function createSceneFromMedia(ctx: AppContext, projectUrl: string, mediaId: string): Promise<SceneRef> {
  const page = await ctx.session.ensureConnected();
  const shots = path.join(ctx.config.stateDir, 'screenshots');
  await ensureOnProject(page, projectUrl, ctx.log);
  const centre = await mediaTileCentre(page, mediaId);
  if (!centre) {
    throw new FlowError('CLIP_NOT_FOUND', `media ${mediaId} is not in the project grid`, { media_id: mediaId });
  }
  await page.mouse.move(centre.x, centre.y);
  await sleep(800);
  const menuButton = await tileMenuButton(page, centre);
  if (!menuButton) {
    throw new FlowError(
      'UI_NOT_FOUND',
      'tile menu (more_vert) did not appear on hover',
      {},
      await takeScreenshot(page, shots, 'scene-add-no-menu'),
    );
  }
  await page.mouse.click(menuButton.x, menuButton.y);
  await sleep(800);
  const addItem = page
    .locator('[role="menuitem"]')
    .filter({ hasText: label('sceneAdd') })
    .first();
  if (!(await isVisible(addItem))) {
    throw new FlowError(
      'UI_NOT_FOUND',
      'menu item "Add to Scene" not found',
      { menu: await menuTexts(page) },
      await takeScreenshot(page, shots, 'scene-add-no-item'),
    );
  }
  await addItem.click();
  await sleep(800);
  const createItem = page
    .locator('[role="menuitem"]')
    .filter({ hasText: label('sceneNew') })
    .first();
  if (!(await isVisible(createItem))) {
    throw new FlowError(
      'UI_NOT_FOUND',
      'submenu item "Create scene" not found',
      { menu: await menuTexts(page) },
      await takeScreenshot(page, shots, 'scene-add-no-create'),
    );
  }
  await createItem.click();
  await sleep(3000);
  // The new scene becomes the first card of the grid (movie icon); opening it yields the scene URL
  const card = page.locator('[role="button"]').filter({ hasText: /movie/ }).first();
  if (!(await isVisible(card))) {
    throw new FlowError(
      'SCENE_NOT_FOUND',
      'scene card did not appear in the grid',
      {},
      await takeScreenshot(page, shots, 'scene-add-no-card'),
    );
  }
  await card.click();
  try {
    await page.waitForURL(/\/scenes?\/[0-9a-f-]{36}/, { timeout: 20_000 });
  } catch {
    throw new FlowError(
      'SCENE_NOT_FOUND',
      'opening the scene card did not navigate to a scene URL',
      { url: page.url() },
      await takeScreenshot(page, shots, 'scene-add-no-nav'),
    );
  }
  await sleep(4000);
  return currentScene(page);
}

async function tileMenuButton(page: Page, centre: { x: number; y: number }): Promise<{ x: number; y: number } | null> {
  const buttons = page.locator('button').filter({ hasText: /more_vert/ });
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const box = await buttons
      .nth(i)
      .boundingBox()
      .catch(() => null);
    // The tile's own menu button sits inside the tile (≈150×266) around the hovered centre
    if (box && Math.abs(box.x - centre.x) < 160 && Math.abs(box.y - centre.y) < 200) {
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
  }
  return null;
}

async function menuTexts(page: Page): Promise<string[]> {
  return page
    .locator('[role="menuitem"]')
    .allInnerTexts()
    .catch((): string[] => []);
}

export interface ExtendOutcome {
  timeline: Timeline;
  media_id: string | undefined;
  file: Downloaded | undefined;
  elapsed_ms: number;
}

// "+" after the last clip → 확장 → prompt → send, then wait for the placeholder block to become a real clip
export async function startExtend(ctx: AppContext, page: Page, prompt: string): Promise<void> {
  const shots = path.join(ctx.config.stateDir, 'screenshots');
  const plus = page
    .locator('button')
    .filter({ hasText: /클립 추가|Add clip/ })
    .last();
  if (!(await isVisible(plus))) {
    throw new FlowError(
      'UI_NOT_FOUND',
      'timeline "+" (add clip) button not found',
      {},
      await takeScreenshot(page, shots, 'scene-extend-no-plus'),
    );
  }
  await plus.click();
  await sleep(1000);
  const extendItem = page
    .locator('[role="menuitem"]')
    .filter({ hasText: label('sceneExtend') })
    .first();
  if (!(await isVisible(extendItem))) {
    throw new FlowError(
      'UI_NOT_FOUND',
      'menu item "Extend" not found',
      { menu: await menuTexts(page) },
      await takeScreenshot(page, shots, 'scene-extend-no-item'),
    );
  }
  await extendItem.click();
  await sleep(1500);
  const box = page.locator('[role="textbox"]:visible').last();
  if (!(await isVisible(box))) {
    throw new FlowError(
      'UI_NOT_FOUND',
      'extend prompt box not found',
      {},
      await takeScreenshot(page, shots, 'scene-extend-no-box'),
    );
  }
  await box.click();
  await page.keyboard.type(prompt, { delay: 5 });
  await sleep(500);
}

export async function cancelExtend(page: Page): Promise<void> {
  await pressEscape(page, 800);
}

export async function sendExtend(ctx: AppContext, page: Page): Promise<void> {
  const shots = path.join(ctx.config.stateDir, 'screenshots');
  const send = page
    .locator('button')
    .filter({ hasText: /arrow_forward/ })
    .last();
  if (!(await send.isEnabled().catch(() => false))) {
    throw new FlowError(
      'SEND_FAILED',
      'extend send button is not enabled',
      {},
      await takeScreenshot(page, shots, 'scene-extend-send-disabled'),
    );
  }
  await send.click();
  await sleep(3000);
}

// The rendering placeholder carries no text, so "done" is: the timeline has a new last block whose media id (read by
// selecting it) is not a pre-existing id and downloads as video/*. The extension is also usually listed as new project
// media, so ids new to the media strip are tried as well. Works after a restart, when the tab that sent the prompt
// is long gone.
export async function awaitExtension(
  ctx: AppContext,
  page: Page,
  clipsBefore: number,
  baselineIds: Set<string>,
  outputDir: string,
  jobId: string,
): Promise<ExtendOutcome> {
  const started = Date.now();
  const shots = path.join(ctx.config.stateDir, 'screenshots');
  const bodyBefore = await bodyText(page);
  let first = true;
  while (Date.now() - started < ctx.config.generationTimeoutMs) {
    if (!first) await sleep(ctx.config.pollIntervalMs);
    first = false;
    const fresh = await bodyText(page);
    if (fresh.length > bodyBefore.length && label('policyBlocked').test(fresh.slice(bodyBefore.length - 200))) {
      throw new FlowError(
        'POLICY_BLOCKED',
        'extension refused as a possible policy violation',
        {},
        await takeScreenshot(page, shots, 'scene-extend-policy'),
      );
    }
    const candidates = new Set<string>();
    const blocks = await timelineBlocks(page);
    if (blocks.length > clipsBefore) {
      const selected = await clipMediaId(page, blocks.length - 1);
      if (selected && !baselineIds.has(selected)) candidates.add(selected);
    }
    for (const id of await mediaIds(page)) if (!baselineIds.has(id)) candidates.add(id);
    for (const id of candidates) {
      const attempt = await tryDownload(ctx.session.getContext(), id, outputDir, fileNameFor(id, jobId), 'video');
      if (attempt.outcome === 'ok') {
        return {
          timeline: await readTimeline(page),
          media_id: id,
          file: attempt.file,
          elapsed_ms: Date.now() - started,
        };
      }
    }
  }
  throw new FlowError(
    'GENERATION_TIMEOUT',
    `extension did not finish within ${Math.round(ctx.config.generationTimeoutMs / 1000)}s`,
    { clips_before: clipsBefore },
    await takeScreenshot(page, shots, 'scene-extend-timeout'),
  );
}

export async function openScene(ctx: AppContext, sceneUrl: string): Promise<Page> {
  const page = await ctx.session.ensureConnected();
  await ensureOnScene(page, sceneUrl, ctx.log);
  return page;
}
