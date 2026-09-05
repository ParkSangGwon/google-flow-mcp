import { z } from 'zod';
import { mediaTiles } from '../flow/media.js';
import { ensureOnProject } from '../flow/project.js';
import { waitStable } from '../flow/ui.js';
import { defineTool } from '../server/tool.js';

export const projectOpen = defineTool({
  name: 'flow_project_open',
  title: 'Open a Flow project',
  description:
    'Navigate the owned tab to a Flow project URL and report how many media items the grid shows. Generation tools call this implicitly.',
  input: {
    project_url: z.url().describe('https://flow.google.com/project/<uuid> (the old labs.google link also works)'),
  },
  output: {
    project_id: z.string(),
    url: z.string(),
    media_count: z.number(),
    videos: z.number().describe('How many of those tiles are videos'),
    media: z
      .array(
        z.object({
          index: z.number(),
          kind: z.string(),
          title: z.string(),
          url: z.string(),
          uuid: z.string().optional(),
        }),
      )
      .describe('Grid tiles, newest first. url is a short-lived address Flow re-signs; uuid feeds flow_media_download'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(ctx, args) {
    const page = await ctx.session.ensureConnected();
    const projectId = await ensureOnProject(page, args.project_url, ctx.log);
    await waitStable(async () => (await mediaTiles(page)).length);
    const tiles = await mediaTiles(page);
    return {
      project_id: projectId,
      url: page.url(),
      media_count: tiles.length,
      videos: tiles.filter((t) => t.kind === 'video').length,
      media: tiles,
    };
  },
});
