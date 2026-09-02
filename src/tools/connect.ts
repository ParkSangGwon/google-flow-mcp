import { z } from 'zod';
import { isLoggedIn, openFlowHome } from '../flow/project.js';
import { defineTool } from '../server/tool.js';

export const connect = defineTool({
  name: 'flow_connect',
  title: 'Connect to Google Flow',
  description:
    'Attach to the dedicated Chrome (launching it if needed), open a tab owned by this server and load Google Flow. ' +
    'Other tools connect on demand, so this is mainly a warm-up and login check. If logged_in is false, sign in once in the Chrome window.',
  input: {
    open_url: z.url().optional().describe('URL to open instead of the Flow home page (e.g. a project URL)'),
  },
  output: {
    attached_existing: z.boolean().describe('true when a Chrome was already listening on the CDP port'),
    cdp_port: z.number(),
    tab_url: z.string(),
    logged_in: z.boolean(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(ctx, args) {
    const page = await ctx.session.ensureConnected();
    await openFlowHome(page, args.open_url ?? ctx.config.flowUrl);
    return {
      attached_existing: ctx.session.status().attached_existing,
      cdp_port: ctx.config.cdpPort,
      tab_url: page.url(),
      logged_in: isLoggedIn(page),
    };
  },
});
