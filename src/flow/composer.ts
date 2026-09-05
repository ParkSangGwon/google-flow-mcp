import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { takeScreenshot } from '../browser/screenshot.js';
import type { AppContext } from '../context.js';
import { FlowError } from '../lib/errors.js';
import type { Job } from './jobs.js';
import { IMAGE_MODELS, type ModelId, label, modelLabel } from './labels.js';
import { type MediaKind, downloadedPrefixes, fileNameFor, mediaIds, tryDownload } from './media.js';
import { ensureOnProject } from './project.js';
import { bodyText, firstInRegion, iconButton, isVisible, labelButton, namedButton, pressEscape, sleep, waitStable } from './ui.js';

// Flow's agent chat composer (right-hand panel): settings popover (tune), attach menu (add_2), send (arrow_forward),
// an optional approval card, and the media grid where outputs appear. This module owns that whole flow.

export interface GenerateArgs {
  kind: MediaKind;
  prompt: string;
  model: ModelId;
  ratio: string;
  duration: number | undefined;
  count: number;
  referenceImages: string[];
  projectUrl: string;
  outputDir: string;
  autoConfirm: boolean;
  resume: boolean;
  jobId: string | undefined;
  editMode: boolean;
}

// Type alias so the result can be stored as a job record (Record<string, unknown>)
export type GenerateResult = {
  status: 'ready_for_confirmation' | 'completed';
  job_id: string;
  files: string[];
  media_ids: string[];
  references_attached: number;
  approval_text: string;
  model: string;
  ratio: string;
  duration?: number;
  elapsed_ms: number;
  prompt: string;
  screenshot?: string;
};

const APPROVAL_TIMEOUT_MS = 120_000;
const RESUME_APPROVAL_TIMEOUT_MS = 30_000;
const SEND_ATTEMPTS = 30;

export async function generateMedia(ctx: AppContext, args: GenerateArgs): Promise<GenerateResult> {
  const started = Date.now();
  const page = await ctx.session.ensureConnected();
  const shots = path.join(ctx.config.stateDir, 'screenshots');
  const modelName = modelLabel(args.model);
  await ensureOnProject(page, args.projectUrl, ctx.log);

  if (args.resume) return resumeGeneration(ctx, page, args, started);

  await ensureComposer(ctx, page, args.editMode);
  await applyDefaults(ctx, page, args.kind, args.ratio, modelName, args.count);
  await ensureComposer(ctx, page, args.editMode);

  let attached = 0;
  for (const ref of args.referenceImages) {
    if ((await attachReference(ctx, page, ref)) || (await attachReference(ctx, page, ref))) attached++;
  }
  // Sending without the reference makes the agent pick an arbitrary project image as the first frame: stop before credits
  if (args.referenceImages.length > 0 && attached < args.referenceImages.length) {
    await clearComposer(ctx, page);
    throw new FlowError(
      'REFERENCE_NOT_ATTACHED',
      `${attached}/${args.referenceImages.length} reference images attached; nothing was sent`,
      { attached, requested: args.referenceImages.length },
      await takeScreenshot(page, shots, 'reference-not-attached'),
    );
  }

  const instruction = buildInstruction(args, modelName, attached);
  const input = composerInput(page);
  await input.click();
  await input.fill('');
  await input.fill(instruction);
  await sleep(400);

  const base = {
    references_attached: attached,
    model: modelName,
    ratio: args.ratio,
    prompt: instruction,
    ...(args.duration !== undefined ? { duration: args.duration } : {}),
  };

  if (!args.autoConfirm) {
    const screenshot = await takeScreenshot(page, shots, `${args.kind}-ready`);
    return {
      status: 'ready_for_confirmation',
      job_id: '',
      files: [],
      media_ids: [],
      approval_text: '',
      elapsed_ms: Date.now() - started,
      ...base,
      ...(screenshot ? { screenshot } : {}),
    };
  }

  const job = ctx.jobs.create({
    kind: args.kind,
    phase: 'sending',
    project_url: args.projectUrl,
    output_dir: args.outputDir,
    prompt: instruction,
    model: modelName,
    baseline_media_ids: await mediaIds(page),
  });
  const bodyBefore = await bodyText(page);
  await send(ctx, page, input, shots);
  ctx.jobs.update(job.job_id, { phase: 'sent' });

  const approvalText = await awaitApproval(ctx, page, bodyBefore, job.baseline_media_ids, APPROVAL_TIMEOUT_MS, true);
  // The grid is still loading right after navigation; only a stable count is a trustworthy baseline
  await waitStable(async () => (await mediaIds(page)).length);
  const baseline = await mediaIds(page);
  ctx.jobs.update(job.job_id, { baseline_media_ids: baseline });

  const files = await awaitOutputs(ctx, page, args, job.job_id, new Set(baseline), bodyBefore, shots);
  const result: GenerateResult = {
    status: 'completed',
    job_id: job.job_id,
    files: files.map((f) => f.path),
    media_ids: files.map((f) => f.media_id),
    approval_text: approvalText,
    elapsed_ms: Date.now() - started,
    ...base,
  };
  ctx.jobs.update(job.job_id, { phase: 'done', result });
  return result;
}

async function resumeGeneration(
  ctx: AppContext,
  page: Page,
  args: GenerateArgs,
  started: number,
): Promise<GenerateResult> {
  const shots = path.join(ctx.config.stateDir, 'screenshots');
  const job = args.jobId
    ? ctx.jobs.get(args.jobId)
    : ctx.jobs.findLatest(
        (j) =>
          j.kind === args.kind &&
          j.project_url === args.projectUrl &&
          j.output_dir === args.outputDir &&
          j.phase !== 'failed',
      );
  if (!job) {
    throw new FlowError('GENERATION_TIMEOUT', 'no in-flight generation to resume for this project/output_dir', {
      reason: 'no_job',
      project_url: args.projectUrl,
      output_dir: args.outputDir,
    });
  }
  if (job.phase === 'done' && job.result) {
    ctx.log.info('resume: job already completed', { job_id: job.job_id });
    return { ...(job.result as unknown as GenerateResult), elapsed_ms: Date.now() - started };
  }
  await pressEscape(page);
  const bodyBefore = await bodyText(page);
  const approvalText = await awaitApproval(
    ctx,
    page,
    bodyBefore,
    job.baseline_media_ids,
    RESUME_APPROVAL_TIMEOUT_MS,
    false,
  );
  const files = await awaitOutputs(ctx, page, args, job.job_id, new Set(job.baseline_media_ids), bodyBefore, shots);
  const result: GenerateResult = {
    status: 'completed',
    job_id: job.job_id,
    files: files.map((f) => f.path),
    media_ids: files.map((f) => f.media_id),
    references_attached: 0,
    approval_text: approvalText,
    model: job.model,
    ratio: args.ratio,
    ...(args.duration !== undefined ? { duration: args.duration } : {}),
    elapsed_ms: Date.now() - started,
    prompt: job.prompt,
  };
  ctx.jobs.update(job.job_id, { phase: 'done', result });
  return result;
}

function composerInput(page: Page): Locator {
  return page.locator('[contenteditable="true"]:visible, textarea:visible').first();
}

function buildInstruction(args: GenerateArgs, modelName: string, attached: number): string {
  if (args.editMode) {
    return `Edit the last generated video (keep the same ${args.duration ?? 8}-second length and ${args.ratio} ratio): ${args.prompt}`;
  }
  if (args.kind === 'image') {
    const n = args.count === 1 ? 'one image' : `${args.count} images`;
    return (
      `Generate ${n} in ${args.ratio} aspect ratio with ${modelName}` +
      (attached ? ', using the attached image as the visual reference' : '') +
      `. Do not add text or captions unless the description asks for it. Image: ${args.prompt}`
    );
  }
  return (
    `Generate one ${args.duration ?? 8}-second ${args.ratio} video with ${modelName}` +
    (attached ? ', using the attached image as the first frame and keeping its composition, palette and subject' : '') +
    `. Do not add text, captions, music or narration. Scene: ${args.prompt}`
  );
}

async function closeSidePanels(page: Page): Promise<void> {
  // The settings popover closes via Save; the X next to it would close the whole chat panel
  if (await isVisible(page.getByText(label('agentSettings')).first())) {
    await labelButton(page, 'save', 'exact')
      .first()
      .click()
      .catch(() => undefined);
    await sleep(800);
  }
  await pressEscape(page);
}

// Thumbnails attached to the composer sit in the bottom-right box; grid tiles and suggestion cards do not
async function composerMedia(page: Page): Promise<string[]> {
  return page
    .evaluate(() =>
      // Attached thumbnails sit at the bottom-right of the composer. Match them by position and exclude
      // Flow's own chrome, rather than whitelisting host names — the CDN for uploads changes (2026-09-05).
      Array.from(document.querySelectorAll('img'))
        .filter((i) => {
          const r = i.getBoundingClientRect();
          const src = i.currentSrc || i.src;
          return (
            r.width > 24 &&
            r.y > window.innerHeight * 0.7 &&
            r.x > window.innerWidth * 0.75 &&
            !/zero_states|\/website\/flow\/|\.svg(\?|$)/.test(src)
          );
        })
        .map((i) => i.currentSrc || i.src),
    )
    .catch(() => []);
}

async function clearComposer(ctx: AppContext, page: Page): Promise<void> {
  const clear = labelButton(page, 'clearPrompt').first();
  if (await isVisible(clear)) {
    await clear.click().catch(() => undefined);
    await sleep(500);
  }
  for (let i = 0; i < 4 && (await composerMedia(page)).length > 0; i++) {
    const cancel = page
      .locator('button')
      .filter({ hasText: /^\s*cancel\s*$/ })
      .last();
    if (!(await isVisible(cancel))) break;
    await cancel.click().catch(() => undefined);
    await sleep(400);
  }
  if ((await composerMedia(page)).length > 0) ctx.log.warn('composer still has attachments after clear');
}

// A fresh chat session per request stops the agent from reusing the previous request's attachment as first frame
async function newSession(ctx: AppContext, page: Page): Promise<void> {
  const b = page
    .locator('button')
    .filter({ hasText: /edit_square|새로운 세션|New session/ })
    .first();
  if (await isVisible(b)) {
    await b.click().catch(() => undefined);
    await sleep(1500);
    ctx.log.info('started a new agent session');
  }
}

async function ensureComposer(ctx: AppContext, page: Page, keepSession: boolean): Promise<void> {
  await closeSidePanels(page);
  if (!(await isVisible(iconButton(page, 'send').first()))) {
    ctx.log.info('composer not visible, reloading project page');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(5000);
    await closeSidePanels(page);
    if (!(await isVisible(iconButton(page, 'send').first()))) {
      throw new FlowError(
        'UI_NOT_FOUND',
        'agent composer (arrow_forward button) not found on the project page',
        {},
        await takeScreenshot(page, path.join(ctx.config.stateDir, 'screenshots'), 'no-composer'),
      );
    }
  }
  await clearComposer(ctx, page);
  if (!keepSession) await newSession(ctx, page);
}

// Agent settings popover: "confirm before generating" = Never, then the ratio / count / model for the media kind.
// The popover lists the image section first and the video section last, so same-label buttons are picked by position.
const appliedDefaults = new Map<string, string>();
async function applyDefaults(
  ctx: AppContext,
  page: Page,
  kind: MediaKind,
  ratio: string,
  modelName: string,
  count: number,
): Promise<void> {
  const key = `${kind}|${ratio}|${modelName}|${count}`;
  if (appliedDefaults.get(kind) === key) return;
  const pick = (loc: Locator): Locator => (kind === 'video' ? loc.last() : loc.first());
  await iconButton(page, 'settings').first().click({ timeout: 10_000 });
  await page.getByText(label('agentSettings')).first().waitFor({ timeout: 10_000 });
  await sleep(500);
  const never = page.getByText(label('never', 'exact')).first();
  if (await isVisible(never)) {
    await never.click().catch(() => undefined);
    await sleep(300);
  }
  const ratioBtn = pick(page.locator('button').filter({ hasText: new RegExp(`${ratio.replace(':', '\\:')}\\s*$`) }));
  await ratioBtn.click().catch(() => ctx.log.warn('ratio button not found', { ratio }));
  const countBtn = pick(page.locator('button').filter({ hasText: new RegExp(`x${count}\\s*$`) }));
  await countBtn.click().catch(() => ctx.log.warn('count button not found', { count }));
  const modelRe =
    kind === 'video' ? /Omni|Veo/ : new RegExp(Object.values(IMAGE_MODELS).join('|').replace(/ /g, '\\s'));
  const modelBtn = pick(page.locator('button').filter({ hasText: modelRe }));
  const current = await modelBtn.innerText().catch(() => '');
  if (!current.includes(modelName)) {
    await modelBtn.click();
    await sleep(700);
    const opt = page.getByText(modelName, { exact: false }).last();
    if (await isVisible(opt)) await opt.click();
    else {
      ctx.log.warn('model option not visible', { model: modelName });
      await pressEscape(page);
    }
    await sleep(400);
  }
  await takeScreenshot(page, path.join(ctx.config.stateDir, 'screenshots'), `${kind}-defaults`);
  await labelButton(page, 'save', 'exact').first().click();
  await sleep(800);
  appliedDefaults.set(kind, key);
  ctx.log.info('agent defaults applied', { kind, ratio, model: modelName, count });
}

// attach button → Upload media → file chooser → click the uploaded item in the picker → confirm a new composer thumbnail
async function attachReference(ctx: AppContext, page: Page, filePath: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    throw new FlowError('REFERENCE_NOT_ATTACHED', `reference image not found: ${filePath}`, { path: filePath });
  }
  const shots = path.join(ctx.config.stateDir, 'screenshots');
  const before = new Set(await composerMedia(page));
  // A previous failed attempt can leave the attach menu open; its overlay then swallows the click
  // and the button reports aria-expanded="true" forever (observed 2026-09-05).
  const attach = namedButton(page, 'attachToPrompt').first();
  if ((await attach.getAttribute('aria-expanded').catch(() => null)) === 'true') {
    await pressEscape(page, 500);
  }
  await attach.click();
  const upload = labelButton(page, 'uploadMedia').last();
  await upload.waitFor({ timeout: 10_000 });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15_000 }), upload.click()]);
  await chooser.setFiles(filePath);
  ctx.log.info('reference file chosen', { filePath });
  // Flow 2026-09-05: the upload opens the right-hand asset picker with the new file already selected,
  // so there is nothing to click in the list — only the '프롬프트에 추가' confirm attaches it to the composer.
  const confirm = labelButton(page, 'addToPrompt', 'exact').first();
  try {
    await confirm.waitFor({ timeout: 60_000 });
  } catch {
    await takeScreenshot(page, shots, 'ref-not-in-picker');
    await pressEscape(page);
    return false;
  }
  await confirm.click();
  await sleep(800);
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000) {
    await sleep(1000);
    const now = await composerMedia(page);
    if (now.some((src) => !before.has(src))) {
      if ((await page.locator('[role="dialog"]').count()) > 0) await pressEscape(page, 500);
      if ((await composerMedia(page)).some((src) => !before.has(src))) return true;
    }
  }
  await takeScreenshot(page, shots, 'ref-not-attached');
  await pressEscape(page);
  return false;
}

// While an upload is still processing the composer silently ignores send; retry until the input empties
async function send(ctx: AppContext, page: Page, input: Locator, shots: string): Promise<void> {
  for (let i = 0; i < SEND_ATTEMPTS; i++) {
    if (i % 2 === 0) {
      await input.click().catch(() => undefined);
      await page.keyboard.press('End').catch(() => undefined);
      await page.keyboard.press('Enter').catch(() => undefined);
    } else {
      const sendBtn = iconButton(page, 'send').last();
      if (await sendBtn.isEnabled().catch(() => false)) await sendBtn.click().catch(() => undefined);
    }
    await sleep(5000);
    const remaining = (await input.innerText().catch(() => '')).trim();
    if (remaining.length < 20) {
      ctx.log.info('generation request sent');
      return;
    }
    if (i % 6 === 5) ctx.log.info('send not accepted yet, retrying', { elapsed_s: (i + 1) * 5 });
  }
  throw new FlowError(
    'SEND_FAILED',
    `composer still holds the prompt after ${(SEND_ATTEMPTS * 5).toString()}s; send did not go through`,
    {},
    await takeScreenshot(page, shots, 'send-failed'),
  );
}

function freshText(now: string, before: string): string {
  return now.length > before.length ? now.slice(Math.max(0, before.length - 200)) : '';
}

async function failIfPolicyBlocked(ctx: AppContext, page: Page, bodyBefore: string): Promise<void> {
  const fresh = freshText(await bodyText(page), bodyBefore);
  if (label('policyBlocked').test(fresh)) {
    throw new FlowError(
      'POLICY_BLOCKED',
      'generator refused the prompt as a possible policy violation; nothing generated',
      {},
      await takeScreenshot(page, path.join(ctx.config.stateDir, 'screenshots'), 'policy-blocked'),
    );
  }
}

// Card items are text nodes in the right-hand chat panel (below the top bar), not <button>s
async function findApproveButton(page: Page): Promise<Locator | null> {
  return firstInRegion(page, page.getByText(label('approve', 'exact')), 'right', 100);
}

async function awaitApproval(
  ctx: AppContext,
  page: Page,
  bodyBefore: string,
  baselineIds: readonly string[],
  timeoutMs: number,
  nudgeAllowed: boolean,
): Promise<string> {
  const baseline = new Set(baselineIds);
  const shots = path.join(ctx.config.stateDir, 'screenshots');
  const t0 = Date.now();
  let nudges = 0;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(1500);
    const approve = await findApproveButton(page);
    if (approve) {
      const approvalText = (await bodyText(page)).slice(-1200);
      await takeScreenshot(page, shots, 'approval-card');
      await approve.click();
      ctx.log.info('approval clicked', { card: /크레딧[^\n]*|credits?[^\n]*/i.exec(approvalText)?.[0] });
      return approvalText;
    }
    await failIfPolicyBlocked(ctx, page, bodyBefore);
    const fresh = freshText(await bodyText(page), bodyBefore);
    if (label('generating').test(fresh)) {
      ctx.log.info('generation already running (no approval card)');
      return '';
    }
    if ((await mediaIds(page)).some((id) => !baseline.has(id))) {
      ctx.log.info('new media tile appeared; generation started');
      return '';
    }
    // The agent often only announces what it will do and stops; a short follow-up gets it moving
    if (nudgeAllowed && nudges < 2 && Date.now() - t0 > 45_000 * (nudges + 1)) {
      const input = composerInput(page);
      await input.click().catch(() => undefined);
      await input
        .fill('Yes, proceed and generate it now, using the image I attached in my previous message as the reference.')
        .catch(() => undefined);
      await page.keyboard.press('Enter').catch(() => undefined);
      nudges++;
      ctx.log.info('nudged agent to proceed', { nudges });
    }
  }
  // With "confirm before generating: Never" there is usually no card at all; media polling decides
  return '';
}

async function awaitOutputs(
  ctx: AppContext,
  page: Page,
  args: GenerateArgs,
  jobId: string,
  baseline: Set<string>,
  bodyBefore: string,
  shots: string,
): Promise<{ path: string; media_id: string }[]> {
  fs.mkdirSync(args.outputDir, { recursive: true });
  const onDisk = downloadedPrefixes(args.outputDir);
  const wrongKind = new Set<string>();
  const files: { path: string; media_id: string }[] = [];
  const t0 = Date.now();
  let lastShot = 0;
  while (Date.now() - t0 < ctx.config.generationTimeoutMs && files.length < args.count) {
    await sleep(ctx.config.pollIntervalMs);
    await failIfPolicyBlocked(ctx, page, bodyBefore);
    const ids = (await mediaIds(page)).filter(
      (id) => !baseline.has(id) && !wrongKind.has(id) && !onDisk.has(id.slice(0, 8)),
    );
    if (ids.length > 0) {
      await sleep(3000); // the thumbnail appears before encoding finishes
      for (const id of ids) {
        const attempt = await tryDownload(
          ctx.session.getContext(),
          id,
          args.outputDir,
          fileNameFor(id, jobId),
          args.kind,
        );
        if (attempt.outcome === 'ok') {
          files.push({ path: attempt.file.path, media_id: id });
          onDisk.add(id.slice(0, 8));
          ctx.log.info('output downloaded', { id, path: attempt.file.path, bytes: attempt.file.bytes });
        } else if (attempt.outcome === 'wrong_kind') {
          wrongKind.add(id);
        } else {
          ctx.log.warn('download retry later', { id, reason: attempt.reason });
        }
      }
    }
    const minute = Math.floor((Date.now() - t0) / 60_000);
    if (minute > lastShot) {
      lastShot = minute;
      await takeScreenshot(page, shots, `wait-${minute}m`);
    }
  }
  if (files.length === 0) {
    throw new FlowError(
      'GENERATION_TIMEOUT',
      `no ${args.kind}/* media appeared within ${Math.round(ctx.config.generationTimeoutMs / 1000)}s`,
      { non_matching_ids: [...wrongKind] },
      await takeScreenshot(page, shots, 'generation-timeout'),
    );
  }
  return files;
}

export function describeJob(job: Job): Record<string, unknown> {
  return { job_id: job.job_id, kind: job.kind, phase: job.phase, created_at: job.created_at, model: job.model };
}
