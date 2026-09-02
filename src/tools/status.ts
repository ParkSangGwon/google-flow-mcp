import { z } from 'zod';
import { describeJob } from '../flow/composer.js';
import { isLoggedIn, parseFlowUrl } from '../flow/project.js';
import { defineTool } from '../server/tool.js';

export const status = defineTool({
  name: 'flow_status',
  title: 'Connection status',
  description:
    'Report browser connection, login state, the current Flow project/scene, the running tool and in-flight jobs. Never touches the page.',
  input: {},
  output: {
    connected: z.boolean(),
    logged_in: z.boolean(),
    url: z.string().optional(),
    project_id: z.string().optional(),
    scene_id: z.string().optional(),
    running_tool: z.string().optional(),
    jobs_in_flight: z.array(z.record(z.string(), z.unknown())),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  run(ctx) {
    const s = ctx.session.status();
    const loc = s.url ? parseFlowUrl(s.url) : null;
    return Promise.resolve({
      connected: s.connected,
      logged_in: s.connected ? isLoggedIn(ctx.session.getPage()) : false,
      ...(s.url !== undefined ? { url: s.url } : {}),
      ...(loc?.projectId ? { project_id: loc.projectId } : {}),
      ...(loc?.sceneId ? { scene_id: loc.sceneId } : {}),
      ...(ctx.lock.runningTool !== undefined ? { running_tool: ctx.lock.runningTool } : {}),
      jobs_in_flight: ctx.jobs.inFlight().map(describeJob),
    });
  },
});
