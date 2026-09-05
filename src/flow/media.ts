import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import { FlowError } from '../lib/errors.js';

// Flow serves grid media from flow.google.com/asb/<token> (2026-09-05; it used to be a media uuid on
// media.getMediaUrlRedirect). The token is an address, not an identity: it is re-signed from time to time,
// and only image tiles still carry the uuid, so nothing here keys media by token.
export const MEDIA_RE = /flow\.google\.com\/asb\/([A-Za-z0-9_-]{20,})/;

// The uuid address survives re-signing and still serves both kinds; it is what flow_media_download takes.
export function mediaUrl(uuid: string): string {
  return `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${uuid}`;
}

export type MediaKind = 'video' | 'image';

// URL option that selects the original: itag 22 is the 720p h264 Flow itself offers as "original size",
// s0 the unscaled image. A bare token returns a small poster jpeg for both kinds.
const ORIGINAL: Record<MediaKind, string> = { video: 'mm,22,15', image: 's0' };

export interface MediaTile {
  index: number; // grid position, newest first
  kind: MediaKind;
  title: string; // the tile's accessible name: the prompt summary, or the file name for uploads
  url: string; // flow.google.com/asb/<token>, without the option suffix
  uuid?: string; // Flow's own media id — image tiles still carry it, video tiles no longer do
}

export function tileUrl(tile: MediaTile): string {
  return `${tile.url}=${ORIGINAL[tile.kind]}`;
}

const EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// The project grid, newest first. A video tile shows a poster <img> until it is hovered, when a <video>
// takes over; only the tile element says which kind it is.
export async function mediaTiles(page: Page): Promise<MediaTile[]> {
  return page
    .evaluate((source) => {
      const re = new RegExp(source);
      const out: { index: number; kind: 'video' | 'image'; title: string; url: string; uuid?: string }[] = [];
      for (const tile of document.querySelectorAll('flow-video-tile, flow-image-tile')) {
        const el = tile.querySelector('img, video');
        const m = re.exec((el as HTMLImageElement | null)?.currentSrc || (el as HTMLImageElement | null)?.src || '');
        if (!m?.[1]) continue;
        const uuid = el?.getAttribute('data-media-id');
        out.push({
          index: out.length,
          kind: tile.tagName === 'FLOW-VIDEO-TILE' ? 'video' : 'image',
          title: tile.closest('flow-grid-tile-container')?.getAttribute('aria-label') ?? '',
          url: `https://flow.google.com/asb/${m[1]}`,
          ...(uuid ? { uuid } : {}),
        });
      }
      return out;
    }, MEDIA_RE.source)
    .catch((): MediaTile[] => []);
}

export interface MediaElement {
  url: string;
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileRect {
  x: number; // centre
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

// A tile's rectangle, scrolled into view. Grid <video> elements are lazy and count as invisible to
// Playwright, so tiles are clicked by geometry.
export async function mediaTileCentre(page: Page, url: string): Promise<TileRect | null> {
  return page
    .evaluate(
      (src) => {
        const el = document.querySelector(`img[src*="${src}"], video[src*="${src}"]`);
        const tile = el?.closest('flow-grid-tile-container');
        if (!tile) return null;
        tile.scrollIntoView({ block: 'center' });
        const r = tile.getBoundingClientRect();
        return {
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
          left: Math.round(r.x),
          top: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      },
      url.replace('https://flow.google.com/asb/', ''),
    )
    .catch(() => null);
}

// Every laid-out element serving Flow media, with its position — used to find the scene view's clip poster,
// which is not a grid tile.
export async function mediaElements(page: Page): Promise<MediaElement[]> {
  return page
    .evaluate((source) => {
      const re = new RegExp(source);
      const out: MediaElement[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('img, video')) {
        const m = re.exec((el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || '');
        if (!m?.[1]) continue;
        const box = el.getBoundingClientRect();
        out.push({
          url: `https://flow.google.com/asb/${m[1]}`,
          tag: el.tagName,
          x: Math.round(box.x),
          y: Math.round(box.y),
          w: Math.round(box.width),
          h: Math.round(box.height),
        });
      }
      return out;
    }, MEDIA_RE.source)
    .catch((): MediaElement[] => []);
}

export interface Downloaded {
  path: string;
  content_type: string;
  bytes: number;
  media_id: string;
}

export type DownloadAttempt = { outcome: 'ok'; file: Downloaded } | { outcome: 'retry'; reason: string };

// Media ids are a digest of the file itself: Flow's tile addresses are re-signed over time and its uuids are
// not exposed for videos, so the bytes are the only identity that survives a reload or a restart.
export function contentKey(body: Buffer): string {
  return crypto.createHash('sha1').update(body).digest('hex').slice(0, 8);
}

export function fileNameFor(id: string, suffix: string): string {
  return `flow_${id}_${suffix}`;
}

// GET through the browser context so the user's Flow cookies authorize the request
export async function tryDownload(
  context: BrowserContext,
  url: string,
  kind: MediaKind,
  outDir: string,
  suffix: string,
): Promise<DownloadAttempt> {
  try {
    const res = await context.request.get(url, { maxRedirects: 10, timeout: 120_000 });
    const contentType = res.headers()['content-type'] ?? '';
    if (!res.ok()) return { outcome: 'retry', reason: `HTTP ${res.status()}` };
    if (!contentType.startsWith(`${kind}/`)) return { outcome: 'retry', reason: `content-type ${contentType}` };
    return { outcome: 'ok', file: save(await res.body(), contentType, kind, outDir, suffix) };
  } catch (err) {
    return { outcome: 'retry', reason: err instanceof Error ? err.message : String(err) };
  }
}

function save(body: Buffer, contentType: string, kind: MediaKind, outDir: string, suffix: string): Downloaded {
  const id = contentKey(body);
  fs.mkdirSync(outDir, { recursive: true });
  const ext = EXT[contentType.split(';')[0] ?? ''] ?? (kind === 'video' ? 'mp4' : 'bin');
  const file = path.join(outDir, `${fileNameFor(id, suffix)}.${ext}`);
  fs.writeFileSync(file, body);
  return { path: file, content_type: contentType, bytes: body.length, media_id: id };
}

// flow_media_download's entry point: a uuid address, whose kind is only known once the bytes arrive
export async function downloadByUuid(
  context: BrowserContext,
  uuid: string,
  outDir: string,
  suffix: string,
): Promise<Downloaded> {
  const res = await context.request.get(mediaUrl(uuid), { maxRedirects: 10, timeout: 120_000 });
  const contentType = res.headers()['content-type'] ?? '';
  if (!res.ok()) {
    throw new FlowError('DOWNLOAD_FAILED', `media ${uuid} download failed: HTTP ${res.status()}`, { media_id: uuid });
  }
  if (!contentType.startsWith('video/') && !contentType.startsWith('image/')) {
    throw new FlowError('DOWNLOAD_FAILED', `media ${uuid} is ${contentType}, not video or image`, {
      media_id: uuid,
      content_type: contentType,
    });
  }
  return save(await res.body(), contentType, contentType.startsWith('video/') ? 'video' : 'image', outDir, suffix);
}

// Ids already on disk (from an earlier attempt) must not be downloaded a second time
export function downloadedPrefixes(outDir: string): Set<string> {
  if (!fs.existsSync(outDir)) return new Set();
  const out = new Set<string>();
  for (const f of fs.readdirSync(outDir)) {
    const m = /^flow_([a-f0-9]{8})_/.exec(f);
    if (m?.[1]) out.add(m[1]);
  }
  return out;
}
