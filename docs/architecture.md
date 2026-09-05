# Architecture

```
src/
  cli.ts                 serve | init | doctor [--close-hung]
  config.ts              zod config: defaults < config.json < FLOW_MCP_* env
  context.ts             AppContext {config, log, session, jobs, lock} built once per process
  server/create-server   McpServer + StdioServerTransport, registers tools[]
  server/tool.ts         defineTool() + the ok/code result envelope + per-process lock
  browser/chrome.ts      spawn Chrome outside Playwright, poll /json/version
  browser/session.ts     connectOverCDP, one owned tab per process, closes only that tab
  browser/cdp.ts         raw browser-level CDP: list/probe/close targets (hung tab handling)
  flow/labels.ts         the only place with Korean/English UI strings and icon ligatures
  flow/ui.ts             locator helpers, geometry filters, waits
  flow/project.ts        Flow URL parsing, navigation, login check
  flow/composer.ts       the agent chat composer: settings, attach, send, approval, poll, download
  flow/media.ts          media ids, tile geometry, authenticated download
  flow/scene.ts          Scene Builder: create scene, read timeline, extend, wait
  flow/inspect.ts        snapshot/diff/find for flow_inspect
  flow/jobs.ts           on-disk job records for resume
  tools/*.ts             one file per tool: zod input/output + run()
```

Dependency direction: `tools → flow → browser → lib`. `flow/*` never imports the MCP SDK; `browser/*` never imports
`flow/*`.

## Why a real Chrome, launched outside Playwright

Google sign-in rejects browsers that expose `navigator.webdriver`. Chrome is spawned with
`--remote-debugging-port` and a dedicated `--user-data-dir`, then Playwright attaches over CDP. The profile keeps the
Google login; the server never touches credentials.

## One tab per process

`BrowserSession.ensureConnected()` always creates a new page and remembers its CDP target id. On SIGTERM / SIGINT /
stdin end the server closes that page (politely, then via `Target.closeTarget` if the renderer does not answer within
5 s) and detaches. Several server processes (several agent sessions) can share one Chrome this way without ever
touching each other's tabs.

Trade-off: Playwright's `connectOverCDP` attaches to _every_ tab in the browser, so a tab with a hung renderer —
anyone's — blocks all new connections. `doctor` probes each tab with `Runtime.evaluate` and `--close-hung` closes the
unresponsive ones.

## Matching the UI

Flow ships no test ids. Buttons carry a Material icon ligature plus a label in `innerText` (`add_2새 프로젝트`,
`download다운로드` — no space between icon and label in `textContent`). Matchers are regexes built from
`flow/labels.ts` with Korean|English alternation, scoped by role (`button`, `[role=menuitem]`, `[role=textbox]`) and,
where the same text occurs several times, by viewport geometry (right-hand chat panel, bottom-right composer, the
timeline band). Media tiles are `<flow-video-tile>` / `<flow-image-tile>` elements holding one
`flow.google.com/asb/<token>` URL; the tile element is the only thing that says whether it is a video or an
image, and a video tile shows a poster `<img>` until it is hovered. That token is an **address, not an id**:
Flow re-signs it over time and only image tiles still carry a media uuid (`data-media-id`). So media are
identified by a digest of the downloaded file, and a generation's outputs are recognised by position — the
grid is newest-first, and whatever grew the count of tiles of that kind is what the job produced.

`flow_inspect` is the discovery tool: it snapshots interactive elements, performs one action and returns the diff,
optional text matches, media element positions and network responses. Every "not found" error carries the rows it
saw so a label change is a one-line fix in `labels.ts`.

## Generation flow (`flow/composer.ts`)

1. Navigate to the project, make sure the agent composer (`arrow_forward` send button) is visible, clear it, start a
   new chat session (so the agent does not reuse an earlier attachment as first frame).
2. Settings popover (`tune`): "Confirm before generating" = 안 함/Never, then ratio, count and model in the image
   section (first) or video section (last) — the popover lists image controls above video controls.
3. Attach each reference: 프롬프트 상자에 소재 추가 → 미디어 업로드 → file chooser → click the uploaded item in the picker → verify a new
   thumbnail in the bottom-right composer box. Missing attachment = `REFERENCE_NOT_ATTACHED`, nothing sent.
4. Fill the instruction. Dry run returns here.
5. Write a job record (baseline of media ids), send (Enter, fallback click, retried while an upload is still
   processing), watch for an approval card or "generating" text, re-baseline once the grid is stable, then poll for
   the tiles of the requested kind that the count grew by, and save them as `flow_<id>_<job>.<ext>` where the
   id is an 8-char digest of the file. Re-downloading a clip yields the same name, so a resumed job neither
   duplicates nor loses it.

`resume: true` skips 1–4, loads the job (by id, or the latest for the same project and output dir) and only
polls/downloads — the path taken after a crash, a timeout, or when a client asks twice.

## Result envelope

Success: `{ content: [text JSON], structuredContent: {ok: true, ...} }`. Failure: `{ content: [text JSON], isError:
true }` with `{ok: false, code, message, recoverable, details, screenshot?}` — no `structuredContent`, because MCP
clients validate it against the success output schema even when `isError` is set. Tool code never throws out of the
adapter; unknown exceptions become `INTERNAL`.

## Logs and state

`stateDir` (default `~/.google-flow-mcp`): `logs/server-YYYY-MM-DD.log` (also stderr), `screenshots/` (one per
phase and per failure), `jobs/<id>.json`. Nothing is ever written to stdout except JSON-RPC frames.
