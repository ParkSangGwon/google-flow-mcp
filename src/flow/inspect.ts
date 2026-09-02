import type { Page } from 'playwright-core';
import { type Region, inRegion } from './ui.js';

export interface Row {
  tag: string;
  role: string;
  text: string;
  aria: string;
  state: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const SELECTOR =
  'button, [role="button"], [role="menuitem"], [role="option"], [role="radio"], [role="tab"], [role="switch"], ' +
  '[role="combobox"], [role="dialog"], [role="menu"], [role="slider"], input, select, textarea, [contenteditable="true"], a[href]';

// One line per element, stable enough to diff before/after an action and to paste into an issue
export async function snapshot(page: Page, region: Region = 'all'): Promise<Row[]> {
  const rows = await page
    .evaluate((selector) => {
      const out: Row[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const input = el as HTMLInputElement;
        const text = (el.innerText || input.value || el.getAttribute('placeholder') || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 80);
        const state = [
          el.getAttribute('aria-checked') ?? el.getAttribute('aria-selected') ?? '',
          el.getAttribute('aria-disabled') === 'true' || input.disabled ? 'disabled' : '',
          el.getAttribute('aria-expanded') === 'true' ? 'expanded' : '',
        ]
          .filter(Boolean)
          .join(',');
        out.push({
          tag: el.tagName,
          role: el.getAttribute('role') ?? '',
          text,
          aria: el.getAttribute('aria-label') ?? '',
          state,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
      return out;
    }, SELECTOR)
    .catch((): Row[] => []);
  if (region === 'all') return rows;
  const { vw, vh } = await page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
  return rows.filter((r) => inRegion({ x: r.x, y: r.y, width: r.w, height: r.h }, vw, vh, region));
}

export function rowKey(r: Row): string {
  return `${r.tag}|${r.role}|${r.text}|aria=${r.aria}|${r.state}|@${r.x},${r.y} ${r.w}x${r.h}`;
}

export function diffRows(before: Row[], after: Row[]): { added: string[]; removed: string[] } {
  const b = new Set(before.map(rowKey));
  const a = new Set(after.map(rowKey));
  return { added: [...a].filter((k) => !b.has(k)), removed: [...b].filter((k) => !a.has(k)) };
}

export interface TextMatch {
  text: string;
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Text nodes matching a regex (card items, menu labels) that are not necessarily buttons
export async function findText(page: Page, pattern: string, region: Region = 'all', limit = 40): Promise<TextMatch[]> {
  const matches = await page
    .evaluate(
      ({ source, max }) => {
        const re = new RegExp(source);
        const out: TextMatch[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node && out.length < max) {
          const text = (node.textContent ?? '').trim().replace(/\s+/g, ' ');
          const parent = node.parentElement;
          if (text && parent && re.test(text)) {
            const r = parent.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              out.push({
                text: text.slice(0, 120),
                tag: parent.tagName,
                x: Math.round(r.x),
                y: Math.round(r.y),
                w: Math.round(r.width),
                h: Math.round(r.height),
              });
            }
          }
          node = walker.nextNode();
        }
        return out;
      },
      { source: pattern, max: limit },
    )
    .catch((): TextMatch[] => []);
  if (region === 'all') return matches;
  const { vw, vh } = await page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
  return matches.filter((m) => inRegion({ x: m.x, y: m.y, width: m.w, height: m.h }, vw, vh, region));
}
