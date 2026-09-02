export const FLOW_ERROR_CODES = [
  'BROWSER_NOT_CONNECTED',
  'CHROME_LAUNCH_FAILED',
  'NOT_LOGGED_IN',
  'PROJECT_NOT_FOUND',
  'UI_NOT_FOUND',
  'REFERENCE_NOT_ATTACHED',
  'SEND_FAILED',
  'POLICY_BLOCKED',
  'APPROVAL_TIMEOUT',
  'GENERATION_TIMEOUT',
  'DOWNLOAD_FAILED',
  'SCENE_NOT_FOUND',
  'CLIP_NOT_FOUND',
  'MODEL_NOT_AVAILABLE',
  'BUSY',
  'INTERNAL',
] as const;

export type FlowErrorCode = (typeof FLOW_ERROR_CODES)[number];

// "recoverable" = retrying the same call can succeed (transient UI/timing), as opposed to input or account problems
const RECOVERABLE = new Set<FlowErrorCode>([
  'BROWSER_NOT_CONNECTED',
  'CHROME_LAUNCH_FAILED',
  'UI_NOT_FOUND',
  'SEND_FAILED',
  'APPROVAL_TIMEOUT',
  'GENERATION_TIMEOUT',
  'DOWNLOAD_FAILED',
  'BUSY',
]);

export type ErrorDetails = Record<string, unknown>;

export class FlowError extends Error {
  readonly code: FlowErrorCode;
  readonly details: ErrorDetails;
  readonly recoverable: boolean;
  screenshot: string | undefined;

  constructor(code: FlowErrorCode, message: string, details: ErrorDetails = {}, screenshot?: string) {
    super(message);
    this.name = 'FlowError';
    this.code = code;
    this.details = details;
    this.recoverable = RECOVERABLE.has(code);
    this.screenshot = screenshot;
  }
}

// A type alias (not an interface) so it is assignable to the SDK's indexed structuredContent
export type ErrorBody = {
  ok: false;
  code: FlowErrorCode;
  message: string;
  recoverable: boolean;
  details: ErrorDetails;
  screenshot?: string;
};

export function isFlowError(err: unknown): err is FlowError {
  return err instanceof FlowError;
}

export function toErrorBody(err: unknown): ErrorBody {
  if (isFlowError(err)) {
    const body: ErrorBody = {
      ok: false,
      code: err.code,
      message: err.message,
      recoverable: err.recoverable,
      details: err.details,
    };
    if (err.screenshot !== undefined) body.screenshot = err.screenshot;
    return body;
  }
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, code: 'INTERNAL', message, recoverable: false, details: {} };
}
