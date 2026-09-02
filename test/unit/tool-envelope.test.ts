import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/context.js';
import { FlowError } from '../../src/lib/errors.js';
import { silentLogger } from '../../src/lib/logger.js';
import { Mutex } from '../../src/lib/mutex.js';
import { defineTool, runTool } from '../../src/server/tool.js';

function ctx(): AppContext {
  return {
    config: { lockWaitMs: 50 } as AppContext['config'],
    log: silentLogger,
    session: {} as AppContext['session'],
    jobs: {} as AppContext['jobs'],
    lock: new Mutex(),
  };
}

const echo = defineTool({
  name: 'echo',
  title: 'Echo',
  description: 'test',
  input: { text: z.string() },
  output: { text: z.string() },
  annotations: { readOnlyHint: false },
  run: (_c, args) => Promise.resolve({ text: args.text }),
});

const failing = defineTool({
  name: 'failing',
  title: 'Failing',
  description: 'test',
  input: {},
  output: {},
  annotations: { readOnlyHint: true },
  run: () => Promise.reject(new FlowError('UI_NOT_FOUND', 'missing button', { rows: [] })),
});

describe('tool envelope', () => {
  const body = (res: { content: unknown[] }): unknown => JSON.parse((res.content[0] as { text: string }).text);

  it('wraps success as ok:true with structuredContent', async () => {
    const res = await runTool(ctx(), echo, { text: 'hi' });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toEqual({ ok: true, text: 'hi' });
    expect(JSON.parse((res.content[0] as { text: string }).text)).toEqual({ ok: true, text: 'hi' });
  });

  it('never throws: errors become ok:false text bodies with isError and no structuredContent', async () => {
    const res = await runTool(ctx(), failing, {});
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
    expect(body(res)).toMatchObject({ ok: false, code: 'UI_NOT_FOUND', recoverable: true });
  });

  it('serializes page-touching tools and reports BUSY when the lock is held', async () => {
    const c = ctx();
    let release: () => void = () => undefined;
    const slow = defineTool({
      ...echo,
      name: 'slow',
      run: () => new Promise<{ text: string }>((resolve) => (release = () => resolve({ text: 'done' }))),
    });
    const first = runTool(c, slow, { text: 'a' });
    const second = await runTool(c, echo, { text: 'b' });
    expect(body(second)).toMatchObject({ ok: false, code: 'BUSY', details: { running_tool: 'slow' } });
    release();
    expect((await first).structuredContent).toEqual({ ok: true, text: 'done' });
  });
});
