import type { Page } from 'playwright-core';
import { FlowError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { sleep } from './ui.js';

// Flow mints scene ids in upper case and project ids in lower case, so both are accepted
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// Flow moved to flow.google.com/project/<id> (2026-09-05); the labs.google form still redirects there and stays
// accepted as input. Scene Builder lives under /scene/<id>; /scenes/ is accepted for older links. Anything else
// below a project (a media detail view, say) must not parse as "on the project", or navigation would be skipped.
export const FLOW_ROOT = 'https://flow.google.com';
export const FLOW_URL_RE = new RegExp(
  `^https://(?:flow\\.google\\.com|labs\\.google/fx/(?:[a-z]{2}(?:-[A-Za-z]{2})?/)?tools/flow)` +
    `(?:/project/(${UUID})(?:/scenes?/(${UUID}))?)?/?(?:[?#].*)?$`,
);

export interface FlowLocation {
  projectId: string | undefined;
  sceneId: string | undefined;
}

export function parseFlowUrl(url: string): FlowLocation | null {
  const m = FLOW_URL_RE.exec(url);
  if (!m) return null;
  return { projectId: m[1], sceneId: m[2] };
}

export function requireProjectUrl(url: string): string {
  const location = parseFlowUrl(url);
  if (!location?.projectId) {
    throw new FlowError('PROJECT_NOT_FOUND', `not a Flow project URL: ${url}`, { project_url: url });
  }
  return location.projectId;
}

export function sceneUrl(projectUrl: string, sceneId: string): string {
  return `${FLOW_ROOT}/project/${requireProjectUrl(projectUrl)}/scene/${sceneId}`;
}

// Navigates only when the tab is not already on that project (scene view counts as a different place)
export async function ensureOnProject(page: Page, projectUrl: string, log: Logger, settleMs = 5000): Promise<string> {
  const projectId = requireProjectUrl(projectUrl);
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
