import { z } from 'zod';
import { parseFlowUrl } from '../flow/project.js';
import { clipMediaId, openScene, readTimeline } from '../flow/scene.js';
import { defineTool } from '../server/tool.js';
import { sceneClip } from './scene-add.js';

export const sceneStatus = defineTool({
  name: 'flow_scene_status',
  title: 'Read a scene timeline',
  description:
    'Open a Scene Builder view and report its clips (index, duration) and total length, plus whether an extension is still rendering. ' +
    'with_media_ids selects each clip to read its media id (slower). Costs no credits.',
  input: {
    scene_url: z.url(),
    with_media_ids: z.boolean().default(false),
  },
  output: {
    scene_id: z.string(),
    clips: z.array(sceneClip),
    total_duration_s: z.number(),
    generating: z.boolean(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(ctx, args) {
    const page = await openScene(ctx, args.scene_url);
    const timeline = await readTimeline(page);
    if (args.with_media_ids) {
      for (const clip of timeline.clips) {
        const id = await clipMediaId(page, clip.index);
        if (id) clip.media_id = id;
      }
    }
    return { scene_id: parseFlowUrl(page.url())?.sceneId ?? '', ...timeline };
  },
});
