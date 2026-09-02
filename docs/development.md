# Development

```bash
npm install
npm run check      # prettier --check, eslint, tsc --noEmit, unit tests, stdio contract tests, docs freshness
npm run build      # tsc → dist/
npm run docs:tools # regenerate docs/tools.md from the tool definitions (CI fails if it is stale)
```

## Running a tool against the real thing

`scripts/call.ts` starts `dist/cli.js` over real stdio (exactly what an MCP client does) and prints the JSON body:

```bash
npx tsx scripts/call.ts flow_connect
npx tsx scripts/call.ts flow_generate_video '{"prompt":"...","project_url":"...","output_dir":"/tmp/out","auto_confirm":false}'

# several steps in one server process (the tab is kept between steps)
npx tsx scripts/call.ts '[
  {"tool":"flow_project_open","args":{"project_url":"https://labs.google/fx/ko/tools/flow/project/<id>"}},
  {"tool":"flow_inspect","args":{"action":"hover","target":"media:87e6a012","region":"left"}},
  {"tool":"flow_inspect","args":{"action":"click","at":[1193,104],"find":"장면|Scene","screenshot":true}}
]'
```

`scripts/show.py` condenses that output for reading (`... | python3 scripts/show.py`).

## Discovering UI (when Flow changes something)

`flow_inspect` is the reverse-engineering loop; it never generates anything:

1. `action: "none"` with `region` to see what is on screen (`rows` are `TAG|role|text|aria=|state|@x,y wxh`).
2. `action: "hover"` / `"click"` with a `target` regex (button text, menu item, aria-label) or `"media:<id8>"` for a
   grid tile, or `at: [x, y]` from a previous row. `added` / `removed` show what the action changed.
3. `find` returns text nodes matching a regex with positions (labels that are not buttons);
   `media: true` lists every element carrying a media id; `watch_network: true` records responses.
4. `action: "type"` types into the focused element (or clicks `target` first); `action: "press"` sends a key.

Put the strings you find into `src/flow/labels.ts` (Korean and English), never into tool code. Button
`textContent` has no space between the icon ligature and the label (`download다운로드`), so match the label alone or
use `\s*`.

## Adding a tool

1. Copy a file in `src/tools/`, keep the zod `input`/`output` shapes honest (they are the contract the LLM sees and
   the docs are generated from them), put UI logic in `src/flow/`.
2. Add it to `src/tools/index.ts`, run `npm run docs:tools`, update the tool list in `test/contract/server.test.ts`.
3. Throw `FlowError` with the closest `FlowErrorCode`; include the rows or menu texts you saw in `details` and a
   screenshot path when a selector fails.

## Live tests

`test/e2e/*.live.test.ts` run only with `FLOW_E2E=1` and need `FLOW_E2E_PROJECT_URL`; `FLOW_E2E_CREDITS` caps how
many credits they may spend (0 = dry runs only). They are not part of CI.

## Where things are on disk

- `~/.google-flow-mcp/logs/server-YYYY-MM-DD.log` — every tool call, with elapsed time and error details
- `~/.google-flow-mcp/screenshots/` — one PNG per phase/failure (`video-ready`, `approval-card`, `scene-extend-ready`, …)
- `~/.google-flow-mcp/jobs/` — job records used by `resume`
- `~/.google-flow-chrome/` — the dedicated Chrome profile (holds the Google login; keep it private)
