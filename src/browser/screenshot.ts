import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';

// Never throws: a screenshot is diagnostics, not a step that may fail the tool call
export async function takeScreenshot(
  page: Page,
  dir: string,
  label: string,
  fullPage = false,
): Promise<string | undefined> {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${stamp}_${label.replace(/[^\w.-]+/g, '-')}.png`);
    await page.screenshot({ path: file, fullPage });
    return file;
  } catch {
    return undefined;
  }
}
