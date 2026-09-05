import { z } from 'zod';
import { createSceneFromMedia, readTimeline } from '../flow/scene.js';
import { defineTool } from '../server/tool.js';

export const sceneClip = z.object({
  index: z.number(),
  duration_s: z.number(),
});

export const sceneAdd = defineTool({
  name: 'flow_scene_add',
  title: 'Create a scene from a clip',
  description:
    'Open a project media item\'s menu and "Add to Scene → Create scene", then open the new Scene Builder view. ' +
    'Returns the scene URL to pass to flow_scene_extend / flow_scene_status / flow_scene_download. Costs no credits.',
  input: {
    project_url: z.url(),
    media_id: z
      .string()
      .min(8)
      .describe('The 8-char media id of a clip this server downloaded, or the tile title Flow shows for it'),
  },
  output: {
    scene_url: z.string(),
    scene_id: z.string(),
    clips: z.array(sceneClip),
    total_duration_s: z.number(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    const scene = await createSceneFromMedia(ctx, args.project_url, args.media_id);
    const timeline = await readTimeline(ctx.session.getPage());
    return { ...scene, clips: timeline.clips, total_duration_s: timeline.total_duration_s };
  },
});
