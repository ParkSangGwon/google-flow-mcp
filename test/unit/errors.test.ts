import { describe, expect, it } from 'vitest';
import { FlowError, isFlowError, toErrorBody } from '../../src/lib/errors.js';

describe('FlowError', () => {
  it('serializes code, details and recoverability', () => {
    const err = new FlowError('POLICY_BLOCKED', 'refused', { prompt: 'x' }, '/tmp/shot.png');
    expect(isFlowError(err)).toBe(true);
    expect(toErrorBody(err)).toEqual({
      ok: false,
      code: 'POLICY_BLOCKED',
      message: 'refused',
      recoverable: false,
      details: { prompt: 'x' },
      screenshot: '/tmp/shot.png',
    });
    expect(new FlowError('GENERATION_TIMEOUT', 'slow').recoverable).toBe(true);
  });

  it('maps unknown errors to INTERNAL without leaking a stack', () => {
    const body = toErrorBody(new TypeError('boom'));
    expect(body).toEqual({ ok: false, code: 'INTERNAL', message: 'boom', recoverable: false, details: {} });
    expect(toErrorBody('plain').message).toBe('plain');
  });
});
