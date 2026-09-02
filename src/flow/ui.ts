import type { Locator, Page } from 'playwright-core';
import { ICON, type IconName, type LabelKey, type LabelMode, label } from './labels.js';

export type Region = 'all' | 'right' | 'bottom-right' | 'left';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function iconButton(page: Page, icon: IconName): Locator {
  return page.locator('button').filter({ hasText: new RegExp(ICON[icon]) });
}

export function labelButton(page: Page, key: LabelKey, mode: LabelMode = 'contains'): Locator {
  return page.locator('button').filter({ hasText: label(key, mode) });
}

export function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText).catch(() => '');
}

export async function pressEscape(page: Page, settleMs = 300): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
  await sleep(settleMs);
}

export function inRegion(box: Box, vw: number, vh: number, region: Region): boolean {
  switch (region) {
    case 'all':
      return true;
    case 'right':
      return box.x >= vw * 0.7;
    case 'bottom-right':
      return box.x >= vw * 0.7 && box.y >= vh * 0.6;
    case 'left':
      return box.x + box.width <= vw * 0.7;
  }
}

// Flow's clickable chat-card items are plain text nodes, not <button>; geometry is the only stable scope
export async function firstInRegion(page: Page, locator: Locator, region: Region, minY = 0): Promise<Locator | null> {
  const n = await locator.count();
  const { vw, vh } = await viewport(page);
  for (let i = 0; i < n; i++) {
    const el = locator.nth(i);
    const box = await el.boundingBox().catch(() => null);
    if (!box || box.y < minY || !inRegion(box, vw, vh, region)) continue;
    return el;
  }
  return null;
}

export async function viewport(page: Page): Promise<{ vw: number; vh: number }> {
  return page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight })).catch(() => ({ vw: 1920, vh: 1080 }));
}

export async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

// Waits until `count()` returns the same value `samples` times in a row (grid finished loading)
export async function waitStable(
  count: () => Promise<number>,
  samples = 3,
  intervalMs = 1500,
  maxIters = 20,
): Promise<number> {
  let prev = -1;
  let stable = 0;
  let value = 0;
  for (let i = 0; i < maxIters && stable < samples; i++) {
    await sleep(intervalMs);
    value = await count();
    stable = value === prev ? stable + 1 : 0;
    prev = value;
  }
  return value;
}
