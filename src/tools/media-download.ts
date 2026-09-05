import { z } from 'zod';
import { downloadByUuid } from '../flow/media.js';
import { defineTool } from '../server/tool.js';

export const mediaDownload = defineTool({
  name: 'flow_media_download',
  title: 'Download a media item',
  description:
    'Download one Flow media item (video or image) by its Flow media uuid using the logged-in browser session. Uuids come from flow_project_open (image tiles expose one; video tiles do not).',
  input: {
    media_id: z.string().min(20).describe('Flow media uuid'),
    output_dir: z.string(),
    suffix: z.string().default('manual').describe('Trailing part of the file name: flow_<id>_<suffix>.<ext>'),
  },
  output: { path: z.string(), content_type: z.string(), bytes: z.number(), media_id: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(ctx, args) {
    await ctx.session.ensureConnected();
    const file = await downloadByUuid(ctx.session.getContext(), args.media_id, args.output_dir, args.suffix);
    return { path: file.path, content_type: file.content_type, bytes: file.bytes, media_id: file.media_id };
  },
});
