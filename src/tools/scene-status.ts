import { z } from 'zod';
import { parseFlowUrl } from '../flow/project.js';
import { openScene, readTimeline } from '../flow/scene.js';
import { defineTool } from '../server/tool.js';
import { sceneClip } from './scene-add.js';

export const sceneStatus = defineTool({
  name: 'flow_scene_status',
  title: 'Read a scene timeline',
  description:
    'Open a Scene Builder view and report its clips (index, duration) and total length, plus whether an extension is still rendering. Costs no credits.',
  input: {
    scene_url: z.url(),
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
    return { scene_id: parseFlowUrl(page.url())?.sceneId ?? '', ...timeline };
  },
});
