import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import { FlowError } from '../lib/errors.js';

// Every generated or uploaded asset is served through this redirect endpoint; the uuid is the media id
export const MEDIA_RE = /media\.getMediaUrlRedirect\?name=([a-f0-9-]{20,})/;

export function mediaUrl(id: string): string {
  return `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${id}`;
}

export type MediaKind = 'video' | 'image';

const EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export async function mediaIds(page: Page): Promise<string[]> {
  return page
    .evaluate((source) => {
      const re = new RegExp(source);
      const ids = new Set<string>();
      for (const el of document.querySelectorAll('img, video, source, a')) {
        const src =
          (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || (el as HTMLAnchorElement).href || '';
        const m = re.exec(src);
        if (m?.[1]) ids.add(m[1]);
      }
      return [...ids];
    }, MEDIA_RE.source)
    .catch(() => []);
}

export interface Downloaded {
  path: string;
  content_type: string;
  bytes: number;
  media_id: string;
}

export type DownloadAttempt =
  | { outcome: 'ok'; file: Downloaded }
  | { outcome: 'wrong_kind'; content_type: string }
  | { outcome: 'retry'; reason: string };

// GET through the browser context so the user's Flow cookies authorize the redirect
export async function tryDownload(
  context: BrowserContext,
  id: string,
  outDir: string,
  filename: string,
  kind: MediaKind | 'any',
): Promise<DownloadAttempt> {
  try {
    const res = await context.request.get(mediaUrl(id), { maxRedirects: 10, timeout: 120_000 });
    const contentType = res.headers()['content-type'] ?? '';
    if (!res.ok()) return { outcome: 'retry', reason: `HTTP ${res.status()}` };
    if (kind !== 'any' && !contentType.startsWith(`${kind}/`))
      return { outcome: 'wrong_kind', content_type: contentType };
    const body = await res.body();
    fs.mkdirSync(outDir, { recursive: true });
    const ext = EXT[contentType.split(';')[0] ?? ''] ?? (contentType.startsWith('video/') ? 'mp4' : 'bin');
    const file = path.join(outDir, filename.endsWith(`.${ext}`) ? filename : `${filename}.${ext}`);
    fs.writeFileSync(file, body);
    return { outcome: 'ok', file: { path: file, content_type: contentType, bytes: body.length, media_id: id } };
  } catch (err) {
    return { outcome: 'retry', reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function downloadMedia(
  context: BrowserContext,
  id: string,
  outDir: string,
  filename: string,
  kind: MediaKind | 'any' = 'any',
): Promise<Downloaded> {
  const attempt = await tryDownload(context, id, outDir, filename, kind);
  if (attempt.outcome === 'ok') return attempt.file;
  if (attempt.outcome === 'wrong_kind') {
    throw new FlowError('DOWNLOAD_FAILED', `media ${id} is ${attempt.content_type}, expected ${kind}/*`, {
      media_id: id,
      content_type: attempt.content_type,
    });
  }
  throw new FlowError('DOWNLOAD_FAILED', `media ${id} download failed: ${attempt.reason}`, { media_id: id });
}

export function fileNameFor(id: string, suffix: string): string {
  return `flow_${id.slice(0, 8)}_${suffix}`;
}

// Ids already on disk (from an earlier attempt) must not be mistaken for a new output
export function downloadedPrefixes(outDir: string): Set<string> {
  if (!fs.existsSync(outDir)) return new Set();
  const out = new Set<string>();
  for (const f of fs.readdirSync(outDir)) {
    const m = /^flow_([a-f0-9]{8})_/.exec(f);
    if (m?.[1]) out.add(m[1]);
  }
  return out;
}
