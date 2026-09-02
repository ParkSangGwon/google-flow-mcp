import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobStore } from '../../src/flow/jobs.js';

describe('JobStore', () => {
  it('creates, updates and finds in-flight jobs across instances', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-jobs-'));
    const store = new JobStore(dir);
    const job = store.create({
      kind: 'video',
      phase: 'sending',
      project_url: 'https://labs.google/fx/tools/flow/project/x',
      output_dir: '/tmp/out',
      prompt: 'p',
      model: 'Veo 3.1 - Fast',
      baseline_media_ids: ['a'],
    });
    store.update(job.job_id, { phase: 'sent', baseline_media_ids: ['a', 'b'] });
    const again = new JobStore(dir);
    expect(again.inFlight().map((j) => j.job_id)).toEqual([job.job_id]);
    expect(again.get(job.job_id)?.baseline_media_ids).toEqual(['a', 'b']);
    again.update(job.job_id, { phase: 'done', result: { files: [] } });
    expect(again.inFlight()).toEqual([]);
    expect(again.findLatest((j) => j.output_dir === '/tmp/out')?.phase).toBe('done');
  });
});
