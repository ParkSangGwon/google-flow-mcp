import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape } from 'zod';
import type { AppContext } from '../context.js';
import { toErrorBody } from '../lib/errors.js';

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDef<I extends ZodRawShape, O extends ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: I;
  output: O;
  annotations: ToolAnnotations;
  // Method shorthand on purpose: it is bivariant, so concrete tools are assignable to AnyTool
  run(ctx: AppContext, args: z.infer<z.ZodObject<I>>): Promise<z.infer<z.ZodObject<O>>>;
}

// Identity function that pins the generics so `run` args/results are typed from the zod shapes
export function defineTool<I extends ZodRawShape, O extends ZodRawShape>(def: ToolDef<I, O>): ToolDef<I, O> {
  return def;
}

export type AnyTool = ToolDef<ZodRawShape, ZodRawShape>;

export function registerTools(server: McpServer, ctx: AppContext, tools: readonly AnyTool[]): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        outputSchema: { ok: z.literal(true), ...tool.output },
        annotations: tool.annotations,
      },
      async (args) => runTool(ctx, tool, args),
    );
  }
}

// Every result is a JSON body with `ok`; errors never propagate as thrown exceptions (the SDK would
// flatten them to plain text and lose the machine-readable code). Error bodies go in `content` only:
// SDK clients validate `structuredContent` against the success outputSchema even when isError is set.
export async function runTool(ctx: AppContext, tool: AnyTool, args: Record<string, unknown>): Promise<CallToolResult> {
  const started = Date.now();
  ctx.log.info(`tool ${tool.name} start`, summarizeArgs(args));
  try {
    const exec = (): Promise<Record<string, unknown>> => tool.run(ctx, args);
    const data = tool.annotations.readOnlyHint
      ? await exec()
      : await ctx.lock.run(tool.name, ctx.config.lockWaitMs, exec);
    const body = { ok: true as const, ...data };
    ctx.log.info(`tool ${tool.name} ok`, { elapsed_ms: Date.now() - started });
    return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
  } catch (err) {
    const body = toErrorBody(err);
    ctx.log.error(`tool ${tool.name} failed: ${body.code} ${body.message}`, {
      elapsed_ms: Date.now() - started,
      details: body.details,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
  }
}

function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args))
    out[k] = typeof v === 'string' && v.length > 80 ? v.slice(0, 77) + '...' : v;
  return out;
}
