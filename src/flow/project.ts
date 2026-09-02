import type { Page } from 'playwright-core';
import { FlowError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { sleep } from './ui.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const FLOW_URL_RE = new RegExp(
  `^https://labs\\.google/fx/(?:([a-z]{2}(?:-[A-Za-z]{2})?)/)?tools/flow(?:/project/(${UUID})(?:/scenes/(${UUID}))?)?`,
);

export interface FlowLocation {
  locale: string | undefined;
  projectId: string | undefined;
  sceneId: string | undefined;
}

export function parseFlowUrl(url: string): FlowLocation | null {
  const m = FLOW_URL_RE.exec(url);
  if (!m) return null;
  return { locale: m[1], projectId: m[2], sceneId: m[3] };
}

export function requireProjectUrl(url: string): { projectId: string; location: FlowLocation } {
  const location = parseFlowUrl(url);
  if (!location?.projectId) {
    throw new FlowError('PROJECT_NOT_FOUND', `not a Flow project URL: ${url}`, { project_url: url });
  }
  return { projectId: location.projectId, location };
}

export function sceneUrl(projectUrl: string, sceneId: string): string {
  const { location } = requireProjectUrl(projectUrl);
  const locale = location.locale ? `${location.locale}/` : '';
  return `https://labs.google/fx/${locale}tools/flow/project/${location.projectId ?? ''}/scenes/${sceneId}`;
}

// Navigates only when the tab is not already on that project (scene view counts as a different place)
export async function ensureOnProject(page: Page, projectUrl: string, log: Logger, settleMs = 5000): Promise<string> {
  const { projectId } = requireProjectUrl(projectUrl);
  const here = parseFlowUrl(page.url());
  if (here?.projectId === projectId && !here.sceneId) return projectId;
  log.info('navigating to project', { projectUrl });
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded' });
  await sleep(settleMs);
  assertLoggedIn(page);
  return projectId;
}

export async function ensureOnScene(page: Page, url: string, log: Logger, settleMs = 4000): Promise<string> {
  const loc = parseFlowUrl(url);
  if (!loc?.sceneId) throw new FlowError('SCENE_NOT_FOUND', `not a Flow scene URL: ${url}`, { scene_url: url });
  const here = parseFlowUrl(page.url());
  if (here?.sceneId === loc.sceneId) return loc.sceneId;
  log.info('navigating to scene', { url });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(settleMs);
  assertLoggedIn(page);
  return loc.sceneId;
}

export function isLoggedIn(page: Page): boolean {
  return !page.url().includes('accounts.google.com');
}

export function assertLoggedIn(page: Page): void {
  if (!isLoggedIn(page)) {
    throw new FlowError(
      'NOT_LOGGED_IN',
      'Chrome is on the Google sign-in page; sign in once in the Flow browser window',
      {
        url: page.url(),
      },
    );
  }
}

export async function openFlowHome(page: Page, flowUrl: string, settleMs = 4000): Promise<void> {
  await page.goto(flowUrl, { waitUntil: 'domcontentloaded' });
  await sleep(settleMs);
}
