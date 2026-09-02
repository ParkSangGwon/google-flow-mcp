import { z } from 'zod';
import { mediaIds } from '../flow/media.js';
import { ensureOnProject } from '../flow/project.js';
import { waitStable } from '../flow/ui.js';
import { defineTool } from '../server/tool.js';

export const projectOpen = defineTool({
  name: 'flow_project_open',
  title: 'Open a Flow project',
  description:
    'Navigate the owned tab to a Flow project URL and report how many media items the grid shows. Generation tools call this implicitly.',
  input: {
    project_url: z.url().describe('https://labs.google/fx/<locale>/tools/flow/project/<uuid>'),
  },
  output: {
    project_id: z.string(),
    url: z.string(),
    media_count: z.number(),
    media_ids: z.array(z.string()).describe('Media ids currently visible in the grid, newest first as rendered'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(ctx, args) {
    const page = await ctx.session.ensureConnected();
    const projectId = await ensureOnProject(page, args.project_url, ctx.log);
    await waitStable(async () => (await mediaIds(page)).length);
    const ids = await mediaIds(page);
    return { project_id: projectId, url: page.url(), media_count: ids.length, media_ids: ids };
  },
});
