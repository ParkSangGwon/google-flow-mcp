import { z } from 'zod';
import { downloadMedia, fileNameFor } from '../flow/media.js';
import { defineTool } from '../server/tool.js';

export const mediaDownload = defineTool({
  name: 'flow_media_download',
  title: 'Download a media item',
  description:
    'Download one Flow media item (video or image) by its media id using the logged-in browser session. Ids come from the generation and scene tools or from flow_project_open.',
  input: {
    media_id: z.string().min(20).describe('Media uuid from media.getMediaUrlRedirect?name=<id>'),
    output_dir: z.string(),
    filename: z.string().optional().describe('File name without extension; default flow_<id8>_manual'),
  },
  output: { path: z.string(), content_type: z.string(), bytes: z.number() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(ctx, args) {
    await ctx.session.ensureConnected();
    const file = await downloadMedia(
      ctx.session.getContext(),
      args.media_id,
      args.output_dir,
      args.filename ?? fileNameFor(args.media_id, 'manual'),
    );
    return { path: file.path, content_type: file.content_type, bytes: file.bytes };
  },
});
