# google-flow-mcp

[![npm](https://img.shields.io/npm/v/google-flow-mcp)](https://www.npmjs.com/package/google-flow-mcp)
[![CI](https://github.com/ParkSangGwon/google-flow-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ParkSangGwon/google-flow-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

Unofficial [MCP](https://modelcontextprotocol.io) server that drives **Google Flow** (labs.google — Veo video,
Nano Banana images) through your own Chrome session, so an AI agent (Claude Code, any MCP client, or a plain
JSON-RPC script) can generate videos and images and build scenes with **Scene Builder** (extend a clip by 7-second
hops with continuous motion and audio).

Korean: [README.ko.md](README.ko.md)

## What it does

| Area                             | Tools                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| Session                          | `flow_connect`, `flow_status`, `flow_screenshot`, `flow_inspect`, `flow_project_open`              |
| Generation (Flow agent composer) | `flow_generate_video` (Veo 3.1 Lite/Fast/Quality, Omni Flash), `flow_generate_image` (Nano Banana) |
| Media                            | `flow_media_download`                                                                              |
| Scene Builder                    | `flow_scene_add`, `flow_scene_status`, `flow_scene_extend`                                         |

Full reference with schemas: [docs/tools.md](docs/tools.md). How Scene Builder works and what was measured:
[docs/scene-builder.md](docs/scene-builder.md).

What it is **not**: an API client. Flow has no public API; this server clicks the real UI in a real Chrome. It is not
affiliated with Google. Everything it does, you could do by hand in the same browser window.

## Requirements

- Node.js 20+
- Google Chrome (macOS path is the default; Linux/Windows via config)
- A Google account with access to Google Flow and Flow credits (AI Plus / Pro / Ultra)
- A generation spends credits exactly like clicking Generate yourself. Every generating tool has a dry run
  (`auto_confirm: false`) that prepares everything and stops before the click.

## Quick start

```bash
# 1. Register the server (Claude Code)
claude mcp add google-flow -- npx -y google-flow-mcp

# 2. Optional: write a config file and check the setup
npx google-flow-mcp init
npx google-flow-mcp doctor
```

The first `flow_connect` launches a dedicated Chrome (`~/.google-flow-chrome`) with its own profile. Sign in to
Google there once; the login stays in that profile. The server never sees or stores credentials.

`.mcp.json` equivalent:

```json
{ "mcpServers": { "google-flow": { "command": "npx", "args": ["-y", "google-flow-mcp"] } } }
```

From a clone: `npm install && npm run build`, then register `node /path/to/google-flow-mcp/dist/cli.js`.

## A typical session

```text
flow_connect                       → { logged_in: true }
flow_project_open  { project_url } → { media_ids: [...] }
flow_generate_video { prompt, model: "veo-3.1-fast", ratio: "9:16", duration: 8,
                      reference_images: ["/abs/keyframe.jpg"], project_url, output_dir,
                      auto_confirm: false }                      → status: ready_for_confirmation (0 credits)
flow_generate_video { ...same, auto_confirm: true }              → files: ["/abs/out/flow_ab12cd34_<job>.mp4"], media_ids
flow_scene_add     { project_url, media_id }                     → scene_url
flow_scene_extend  { scene_url, prompt, after_clip_index: 0, output_dir, auto_confirm: true }
                                                                 → file: 7 s continuation, clip_index: 1
flow_scene_extend  { ..., after_clip_index: 1, ... }             → clip_index: 2
```

Concatenate the seed and the extension files locally (ffmpeg concat) for a seamless long take: the extension's first
frame equals the previous clip's last frame.

## Results and errors

Every tool returns one JSON text block:

```json
{ "ok": true, "files": ["..."], "media_ids": ["..."], "job_id": "..." }
{ "ok": false, "code": "POLICY_BLOCKED", "message": "...", "recoverable": false, "details": {}, "screenshot": "/path.png" }
```

Failures set `isError: true` and never throw, so a client can branch on `code`
(`REFERENCE_NOT_ATTACHED`, `POLICY_BLOCKED`, `GENERATION_TIMEOUT`, `BUSY`, `NOT_LOGGED_IN`, ... — see docs/tools.md).
Long generations are recorded in `~/.google-flow-mcp/jobs`; after a crash or timeout call the same tool with
`resume: true` and it picks the job up instead of generating again.

## Credits (Google AI Ultra, September 2026 — verify on your plan)

| Model                    | Credits           | Notes                                     |
| ------------------------ | ----------------- | ----------------------------------------- |
| Veo 3.1 - Lite           | 5 (4/6/8 s)       | The only model Scene Builder Extend uses  |
| Veo 3.1 - Fast           | 10                |                                           |
| Veo 3.1 - Quality        | 100               |                                           |
| Omni Flash               | 15 / 20 / 25 / 30 | 4 / 6 / 8 / 10 s; video-to-video edits 40 |
| Scene Builder Extend hop | 5                 | 7 s, Veo 3.1 - Lite                       |

## Configuration

Defaults work on macOS. Override with `~/.config/google-flow-mcp/config.json` (`npx google-flow-mcp init`) or
`FLOW_MCP_*` environment variables:

| Key                   | Env                              | Default                                                        |
| --------------------- | -------------------------------- | -------------------------------------------------------------- |
| `chromePath`          | `FLOW_MCP_CHROME_PATH`           | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| `userDataDir`         | `FLOW_MCP_USER_DATA_DIR`         | `~/.google-flow-chrome`                                        |
| `cdpPort`             | `FLOW_MCP_CDP_PORT`              | `9333`                                                         |
| `stateDir`            | `FLOW_MCP_STATE_DIR`             | `~/.google-flow-mcp` (logs, screenshots, jobs)                 |
| `generationTimeoutMs` | `FLOW_MCP_GENERATION_TIMEOUT_MS` | `1800000`                                                      |
| `logLevel`            | `FLOW_MCP_LOG_LEVEL`             | `info`                                                         |

## Using it from Python (or any process) without an MCP library

The server speaks MCP over stdio; a raw JSON-RPC client is ~40 lines:

```python
import json, subprocess, itertools
proc = subprocess.Popen(["npx", "-y", "google-flow-mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
ids = itertools.count(1)
def rpc(method, params=None, notify=False):
    msg = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if not notify: msg["id"] = next(ids)
    proc.stdin.write(json.dumps(msg) + "\n"); proc.stdin.flush()
    if notify: return None
    for line in proc.stdout:
        if line.startswith("{") and json.loads(line).get("id") == msg["id"]:
            return json.loads(line)["result"]
rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "me", "version": "0"}})
rpc("notifications/initialized", notify=True)
res = rpc("tools/call", {"name": "flow_status", "arguments": {}})
print(json.loads(res["content"][0]["text"]))
```

Only JSON-RPC frames are written to stdout; logs go to stderr and `~/.google-flow-mcp/logs`.

## Sharing one Chrome between several agents

Each server process owns exactly one tab and closes it on exit. Several processes can share the Chrome on port 9333.
One caveat of the shared model: Playwright attaches to every tab when it connects, so a tab whose renderer is
frozen blocks new connections for everyone. `npx google-flow-mcp doctor` lists such tabs and
`doctor --close-hung` closes them.

## Roadmap / known limits

- **Scene download**: Flow's "Download" renders the scene but no file reaches an automated tab in the current
  Flow build, so it is not exposed. Download the clips (`media_id`s) and concatenate locally instead.
- **Jump to**: not present in the current Scene Builder menu; only Extend is.
- Adding a clip to an _existing_ scene (asset picker), characters, the Tools gallery, image editing: not yet.
- Labels are matched in Korean and English; other UI languages need entries in `src/flow/labels.ts` (PRs welcome —
  `flow_inspect` shows you the strings).

## Development

```bash
npm install
npm run check          # format, lint, typecheck, unit + stdio contract tests, docs freshness
npm run build
npx tsx scripts/call.ts flow_status                   # run one tool against dist/ over real stdio
npx tsx scripts/call.ts '[{"tool":"flow_project_open","args":{...}},{"tool":"flow_inspect","args":{...}}]'
```

See [docs/development.md](docs/development.md) for the UI-discovery loop and [docs/architecture.md](docs/architecture.md)
for how the pieces fit. Live tests that touch Flow are gated behind `FLOW_E2E=1`.

## License

MIT. Google Flow, Veo and Nano Banana are trademarks of Google LLC; this project is not endorsed by or affiliated with Google.
