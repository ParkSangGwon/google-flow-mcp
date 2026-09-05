import path from 'node:path';
import { z } from 'zod';
import { takeScreenshot } from '../browser/screenshot.js';
import type { Job } from '../flow/jobs.js';
import { tryDownload } from '../flow/media.js';
import {
  EXTEND_HOP_SECONDS,
  EXTEND_MODEL_LABEL,
  type Timeline,
  awaitExtension,
  cancelExtend,
  clipMediaUrl,
  openScene,
  readTimeline,
  sendExtend,
  startExtend,
} from '../flow/scene.js';
import { FlowError } from '../lib/errors.js';
import { defineTool } from '../server/tool.js';
import { sceneClip } from './scene-add.js';

export const sceneExtend = defineTool({
  name: 'flow_scene_extend',
  title: 'Extend the last clip of a scene',
  description:
    `Scene Builder "Extend": generates a ${EXTEND_HOP_SECONDS}-second continuation of the clip at after_clip_index (must be the last clip) ` +
    `with ${EXTEND_MODEL_LABEL} and downloads it as a separate media file. Spends credits when auto_confirm=true; ` +
    'auto_confirm=false opens the extend prompt, fills it, takes a screenshot and cancels. Safe to retry: if the extension ' +
    'was already generated (clip present at after_clip_index+1, or resume=true after a crash) it is downloaded instead of generated again.',
  input: {
    scene_url: z.url(),
    prompt: z.string().min(1).describe('What happens next; Flow continues motion and audio from the last frames'),
    after_clip_index: z.number().int().min(0).describe('Index of the clip to extend (0-based); must be the last clip'),
    output_dir: z.string(),
    auto_confirm: z.boolean().default(false),
    resume: z.boolean().default(false),
    job_id: z.string().optional(),
  },
  output: {
    status: z.enum(['ready_for_confirmation', 'completed', 'already_exists']),
    job_id: z.string(),
    scene_url: z.string(),
    clip_index: z.number().describe('Index of the extension clip in the timeline'),
    media_id: z.string().optional(),
    file: z.string().optional(),
    clips: z.array(sceneClip),
    total_duration_s: z.number(),
    model: z.string(),
    hop_seconds: z.number(),
    elapsed_ms: z.number(),
    screenshot: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async run(ctx, args) {
    const started = Date.now();
    const shots = path.join(ctx.config.stateDir, 'screenshots');
    const page = await openScene(ctx, args.scene_url);
    const before = await readTimeline(page);
    const expected = args.after_clip_index + 1;
    const base = { scene_url: page.url(), model: EXTEND_MODEL_LABEL, hop_seconds: EXTEND_HOP_SECONDS };
    const finish = (
      status: 'completed' | 'already_exists',
      jobId: string,
      timeline: Timeline,
      mediaId: string | undefined,
      file: string | undefined,
    ) => ({
      status,
      job_id: jobId,
      clip_index: expected,
      ...(mediaId ? { media_id: mediaId } : {}),
      ...(file ? { file } : {}),
      clips: timeline.clips,
      total_duration_s: timeline.total_duration_s,
      elapsed_ms: Date.now() - started,
      ...base,
    });

    if (args.after_clip_index >= before.clips.length) {
      throw new FlowError(
        'CLIP_NOT_FOUND',
        `scene has ${before.clips.length} clip(s); no clip at index ${args.after_clip_index}`,
        { clips: before.clips },
      );
    }

    const job: Job | undefined = args.job_id
      ? ctx.jobs.get(args.job_id)
      : ctx.jobs.findLatest(
          (j) => j.kind === 'scene_extend' && j.scene_url === args.scene_url && j.expected_clip_index === expected,
        );

    // Resume, or a timeline that already holds the expected clip: the job's media baseline identifies the extension
    if (args.resume || before.clips.length > expected) {
      if (job && job.phase !== 'failed') {
        const out = await awaitExtension(ctx, page, expected, args.output_dir, job.job_id);
        const result = finish(
          args.resume ? 'completed' : 'already_exists',
          job.job_id,
          out.timeline,
          out.media_id,
          out.file?.path,
        );
        ctx.jobs.update(job.job_id, { phase: 'done', result });
        return result;
      }
      if (before.clips.length > expected) {
        // Extended outside this tool: the clip's own address (a scene-side copy) downloads the same content
        const url = await clipMediaUrl(page, expected);
        let mediaId: string | undefined;
        let file: string | undefined;
        if (url) {
          const attempt = await tryDownload(
            ctx.session.getContext(),
            `${url}=mm,22,15`,
            'video',
            args.output_dir,
            'scene',
          );
          if (attempt.outcome === 'ok') {
            mediaId = attempt.file.media_id;
            file = attempt.file.path;
          }
        }
        return finish('already_exists', '', before, mediaId, file);
      }
      throw new FlowError('GENERATION_TIMEOUT', 'no extension job to resume for this scene/clip', {
        reason: 'no_job',
        expected_clip_index: expected,
      });
    }

    if (args.after_clip_index !== before.clips.length - 1) {
      throw new FlowError('CLIP_NOT_FOUND', 'only the last clip can be extended', { clips: before.clips });
    }
    if (before.generating) {
      throw new FlowError('BUSY', 'the extend prompt is already open in this scene; finish or cancel it first', {});
    }

    await startExtend(ctx, page, args.prompt);
    if (!args.auto_confirm) {
      const screenshot = await takeScreenshot(page, shots, 'scene-extend-ready');
      await cancelExtend(page);
      return {
        status: 'ready_for_confirmation' as const,
        job_id: '',
        clip_index: expected,
        clips: before.clips,
        total_duration_s: before.total_duration_s,
        elapsed_ms: Date.now() - started,
        ...(screenshot ? { screenshot } : {}),
        ...base,
      };
    }

    const created = ctx.jobs.create({
      kind: 'scene_extend',
      phase: 'sending',
      project_url: args.scene_url.replace(/\/scenes?\/.*$/, ''),
      scene_url: args.scene_url,
      output_dir: args.output_dir,
      prompt: args.prompt,
      model: EXTEND_MODEL_LABEL,
      baseline_tiles: before.clips.length,
      expected_clip_index: expected,
    });
    await sendExtend(ctx, page);
    ctx.jobs.update(created.job_id, { phase: 'sent' });
    const out = await awaitExtension(ctx, page, expected, args.output_dir, created.job_id);
    const result = finish('completed', created.job_id, out.timeline, out.media_id, out.file?.path);
    ctx.jobs.update(created.job_id, { phase: 'done', result });
    return result;
  },
});
