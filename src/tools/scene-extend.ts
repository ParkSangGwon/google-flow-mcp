import path from 'node:path';
import { z } from 'zod';
import { takeScreenshot } from '../browser/screenshot.js';
import { FlowError } from '../lib/errors.js';
import { fileNameFor, mediaIds, tryDownload } from '../flow/media.js';
import {
  EXTEND_HOP_SECONDS,
  EXTEND_MODEL_LABEL,
  awaitExtension,
  cancelExtend,
  clipMediaId,
  openScene,
  readTimeline,
  sendExtend,
  startExtend,
} from '../flow/scene.js';
import { defineTool } from '../server/tool.js';
import { sceneClip } from './scene-add.js';

export const sceneExtend = defineTool({
  name: 'flow_scene_extend',
  title: 'Extend the last clip of a scene',
  description:
    `Scene Builder "Extend": generates a ${EXTEND_HOP_SECONDS}-second continuation of the clip at after_clip_index (must be the last clip) ` +
    `with ${EXTEND_MODEL_LABEL} and downloads it as a separate media file. Spends credits when auto_confirm=true; ` +
    'auto_confirm=false opens the extend prompt, fills it, takes a screenshot and cancels. Idempotent: if a clip already exists ' +
    'at after_clip_index+1 it is downloaded instead of generating again. resume=true only waits for / downloads a running extension.',
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

    if (args.after_clip_index >= before.clips.length) {
      throw new FlowError(
        'CLIP_NOT_FOUND',
        `scene has ${before.clips.length} clip(s); no clip at index ${args.after_clip_index}`,
        {
          clips: before.clips,
        },
      );
    }

    // A clip already sitting at the expected index means an earlier call (or a crashed one) succeeded: reuse it
    if (before.clips.length > expected || (before.clips.length === expected && !before.generating && args.resume)) {
      const mediaId = await clipMediaId(page, expected);
      let file: string | undefined;
      if (mediaId) {
        const attempt = await tryDownload(
          ctx.session.getContext(),
          mediaId,
          args.output_dir,
          fileNameFor(mediaId, args.job_id ?? 'scene'),
          'video',
        );
        if (attempt.outcome === 'ok') file = attempt.file.path;
      }
      return {
        status: 'already_exists' as const,
        job_id: args.job_id ?? '',
        clip_index: expected,
        ...(mediaId ? { media_id: mediaId } : {}),
        ...(file ? { file } : {}),
        clips: before.clips,
        total_duration_s: before.total_duration_s,
        elapsed_ms: Date.now() - started,
        ...base,
      };
    }

    if (args.resume) {
      const job = args.job_id
        ? ctx.jobs.get(args.job_id)
        : ctx.jobs.findLatest((j) => j.kind === 'scene_extend' && j.scene_url === args.scene_url);
      if (!job || !before.generating) {
        throw new FlowError('GENERATION_TIMEOUT', 'no running extension to resume in this scene', {
          reason: 'no_job',
          generating: before.generating,
        });
      }
      const seed = { ...before, clips: before.clips.slice(0, expected) };
      const out = await awaitExtension(ctx, page, seed, new Set(job.baseline_media_ids), args.output_dir, job.job_id);
      const result = {
        status: 'completed' as const,
        job_id: job.job_id,
        clip_index: expected,
        ...(out.media_id ? { media_id: out.media_id } : {}),
        ...(out.file ? { file: out.file.path } : {}),
        clips: out.timeline.clips,
        total_duration_s: out.timeline.total_duration_s,
        elapsed_ms: Date.now() - started,
        ...base,
      };
      ctx.jobs.update(job.job_id, { phase: 'done', result });
      return result;
    }

    if (args.after_clip_index !== before.clips.length - 1) {
      throw new FlowError('CLIP_NOT_FOUND', 'only the last clip can be extended', { clips: before.clips });
    }
    if (before.generating) {
      throw new FlowError('BUSY', 'an extension is still rendering in this scene; call again with resume=true', {});
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

    const baseline = await mediaIds(page);
    const job = ctx.jobs.create({
      kind: 'scene_extend',
      phase: 'sending',
      project_url: args.scene_url.replace(/\/scenes?\/.*$/, ''),
      scene_url: args.scene_url,
      output_dir: args.output_dir,
      prompt: args.prompt,
      model: EXTEND_MODEL_LABEL,
      baseline_media_ids: baseline,
      expected_clip_index: expected,
    });
    await sendExtend(ctx, page);
    ctx.jobs.update(job.job_id, { phase: 'sent' });
    const out = await awaitExtension(ctx, page, before, new Set(baseline), args.output_dir, job.job_id);
    const result = {
      status: 'completed' as const,
      job_id: job.job_id,
      clip_index: expected,
      ...(out.media_id ? { media_id: out.media_id } : {}),
      ...(out.file ? { file: out.file.path } : {}),
      clips: out.timeline.clips,
      total_duration_s: out.timeline.total_duration_s,
      elapsed_ms: Date.now() - started,
      ...base,
    };
    ctx.jobs.update(job.job_id, { phase: 'done', result });
    return result;
  },
});
