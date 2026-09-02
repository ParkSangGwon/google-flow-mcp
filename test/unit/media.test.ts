import { describe, expect, it } from 'vitest';
import { MEDIA_RE, downloadedPrefixes, fileNameFor, mediaUrl } from '../../src/flow/media.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('media ids', () => {
  const id = '3d2c4b1a-9f8e-4d7c-b6a5-0f1e2d3c4b5a';

  it('extracts the uuid from redirect URLs on img/video/a', () => {
    for (const src of [
      `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${id}`,
      `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${id}&size=thumb`,
    ]) {
      expect(MEDIA_RE.exec(src)?.[1]).toBe(id);
    }
  });

  it('ignores unrelated URLs', () => {
    expect(MEDIA_RE.exec('https://labs.google/fx/tools/flow/project/abc')).toBeNull();
    expect(MEDIA_RE.exec('blob:https://labs.google/1234')).toBeNull();
  });

  it('builds the download URL and file names', () => {
    expect(mediaUrl(id)).toBe(`https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${id}`);
    expect(fileNameFor(id, 'job1')).toBe('flow_3d2c4b1a_job1');
  });

  it('reads already-downloaded id prefixes from an output dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-media-'));
    fs.writeFileSync(path.join(dir, 'flow_3d2c4b1a_job1.mp4'), '');
    fs.writeFileSync(path.join(dir, 'other.mp4'), '');
    expect([...downloadedPrefixes(dir)]).toEqual(['3d2c4b1a']);
    expect(downloadedPrefixes(path.join(dir, 'missing')).size).toBe(0);
  });
});
