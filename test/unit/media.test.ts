import { describe, expect, it } from 'vitest';
import { MEDIA_RE, contentKey, downloadedPrefixes, fileNameFor, mediaUrl, tileUrl } from '../../src/flow/media.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('media addresses', () => {
  const token = 'AB-nOUYQkX1GUtM_4G1zyBcPqPzUAPttiWAHf3ZmTigl2YUoGKmPEov85c7kkwpcuhVh';

  it('extracts the tile address whatever option suffix it carries', () => {
    for (const src of [
      `https://flow.google.com/asb/${token}`,
      `https://flow.google.com/asb/${token}=s512-rw`,
      `https://flow.google.com/asb/${token}=mm,22,15`,
    ]) {
      expect(MEDIA_RE.exec(src)?.[1]).toBe(token);
    }
  });

  it('ignores unrelated URLs', () => {
    expect(MEDIA_RE.exec('https://flow.google.com/project/abc')).toBeNull();
    expect(MEDIA_RE.exec('blob:https://flow.google.com/1234')).toBeNull();
  });

  it('asks a tile address for the original of its kind', () => {
    const url = `https://flow.google.com/asb/${token}`;
    expect(tileUrl({ index: 0, kind: 'video', title: 't', url })).toBe(`${url}=mm,22,15`);
    expect(tileUrl({ index: 1, kind: 'image', title: 't', url })).toBe(`${url}=s0`);
  });

  it('addresses a media uuid through the redirect endpoint', () => {
    const uuid = '3d2c4b1a-9f8e-4d7c-b6a5-0f1e2d3c4b5a';
    expect(mediaUrl(uuid)).toBe(`https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${uuid}`);
  });

  it('identifies media by the bytes, so the same clip keeps its name', () => {
    const key = contentKey(Buffer.from('clip'));
    expect(key).toMatch(/^[a-f0-9]{8}$/);
    expect(contentKey(Buffer.from('clip'))).toBe(key);
    expect(contentKey(Buffer.from('other'))).not.toBe(key);
    expect(fileNameFor(key, 'job1')).toBe(`flow_${key}_job1`);
  });

  it('reads already-downloaded ids from an output dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-media-'));
    fs.writeFileSync(path.join(dir, 'flow_3d2c4b1a_job1.mp4'), '');
    fs.writeFileSync(path.join(dir, 'other.mp4'), '');
    expect([...downloadedPrefixes(dir)]).toEqual(['3d2c4b1a']);
    expect(downloadedPrefixes(path.join(dir, 'missing')).size).toBe(0);
  });
});
