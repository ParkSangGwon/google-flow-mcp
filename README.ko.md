# google-flow-mcp

[![npm](https://img.shields.io/npm/v/google-flow-mcp)](https://www.npmjs.com/package/google-flow-mcp)
[![CI](https://github.com/ParkSangGwon/google-flow-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ParkSangGwon/google-flow-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

**Google Flow**(labs.google — Veo 영상, Nano Banana 이미지)를 내 Chrome 세션으로 구동하는 비공식
[MCP](https://modelcontextprotocol.io) 서버입니다. AI 에이전트(Claude Code, 임의의 MCP 클라이언트, 혹은 순수 JSON-RPC
스크립트)가 영상·이미지를 생성하고, **Scene Builder(장면 빌더)** 로 클립을 7초씩 이어 붙여(모션·오디오 연속) 긴 장면을
만들 수 있습니다.

English: [README.md](README.md)

## 무엇을 하나

| 영역                       | 도구                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| 세션                       | `flow_connect`, `flow_status`, `flow_screenshot`, `flow_inspect`, `flow_project_open`            |
| 생성(Flow 에이전트 컴포저) | `flow_generate_video`(Veo 3.1 Lite/Fast/Quality, Omni Flash), `flow_generate_image`(Nano Banana) |
| 미디어                     | `flow_media_download`                                                                            |
| Scene Builder              | `flow_scene_add`, `flow_scene_status`, `flow_scene_extend`                                       |

스키마가 포함된 전체 레퍼런스: [docs/tools.md](docs/tools.md). Scene Builder 동작 원리와 실측값:
[docs/scene-builder.md](docs/scene-builder.md).

이것은 API 클라이언트가 **아닙니다**. Flow에는 공개 API가 없고, 이 서버는 실제 Chrome에서 실제 UI를 클릭합니다. Google과
무관한 프로젝트이며, 서버가 하는 모든 일은 같은 브라우저 창에서 손으로도 할 수 있는 일입니다.

## 요구사항

- Node.js 20+
- Google Chrome(macOS 경로가 기본값, Linux/Windows는 설정으로)
- Google Flow에 접근 가능한 Google 계정과 Flow 크레딧(AI Plus / Pro / Ultra)
- 생성은 직접 Generate를 누르는 것과 똑같이 크레딧을 씁니다. 생성 도구는 모두 드라이런(`auto_confirm: false`)이 있어
  클릭 직전까지만 준비하고 멈춥니다.

## 빠른 시작

```bash
# 1. 서버 등록 (Claude Code)
claude mcp add google-flow -- npx -y google-flow-mcp

# 2. 선택: 설정 파일 생성과 환경 점검
npx google-flow-mcp init
npx google-flow-mcp doctor
```

첫 `flow_connect`가 전용 Chrome(`~/.google-flow-chrome`)을 자체 프로필로 띄웁니다. 거기서 한 번만 Google에 로그인하면
그 프로필에 로그인이 유지됩니다. 서버는 자격증명을 보지도, 저장하지도 않습니다.

`.mcp.json`으로 등록하려면:

```json
{ "mcpServers": { "google-flow": { "command": "npx", "args": ["-y", "google-flow-mcp"] } } }
```

클론해서 쓰려면 `npm install && npm run build` 후 `node /path/to/google-flow-mcp/dist/cli.js`를 등록합니다.

## 전형적인 흐름

```text
flow_connect                       → { logged_in: true }
flow_project_open  { project_url } → { media_ids: [...] }
flow_generate_video { prompt, model: "veo-3.1-fast", ratio: "9:16", duration: 8,
                      reference_images: ["/abs/keyframe.jpg"], project_url, output_dir,
                      auto_confirm: false }                      → status: ready_for_confirmation (0크레딧)
flow_generate_video { ...같은 인자, auto_confirm: true }          → files: ["/abs/out/flow_ab12cd34_<job>.mp4"], media_ids
flow_scene_add     { project_url, media_id }                     → scene_url
flow_scene_extend  { scene_url, prompt, after_clip_index: 0, output_dir, auto_confirm: true }
                                                                 → file: 7초 연속 클립, clip_index: 1
flow_scene_extend  { ..., after_clip_index: 1, ... }             → clip_index: 2
```

시드와 확장 파일을 로컬에서 concat(ffmpeg)하면 이음새 없는 롱테이크가 됩니다. 확장 클립의 첫 프레임은 직전 클립의 마지막
프레임과 같습니다.

## 결과와 오류

모든 도구는 JSON 텍스트 블록 하나를 돌려줍니다.

```json
{ "ok": true, "files": ["..."], "media_ids": ["..."], "job_id": "..." }
{ "ok": false, "code": "POLICY_BLOCKED", "message": "...", "recoverable": false, "details": {}, "screenshot": "/path.png" }
```

실패는 `isError: true`로 표시되며 예외를 던지지 않으므로 클라이언트는 `code`로 분기하면 됩니다
(`REFERENCE_NOT_ATTACHED`, `POLICY_BLOCKED`, `GENERATION_TIMEOUT`, `BUSY`, `NOT_LOGGED_IN`, … — docs/tools.md 참고).
긴 생성은 `~/.google-flow-mcp/jobs`에 기록되어, 크래시나 타임아웃 뒤 같은 도구를 `resume: true`로 부르면 다시 생성하지
않고 그 잡을 이어받습니다.

## 크레딧 (Google AI Ultra, 2026년 9월 — 본인 요금제에서 확인)

| 모델                     | 크레딧            | 비고                                     |
| ------------------------ | ----------------- | ---------------------------------------- |
| Veo 3.1 - Lite           | 5 (4/6/8초)       | Scene Builder Extend가 쓰는 유일한 모델  |
| Veo 3.1 - Fast           | 10                |                                          |
| Veo 3.1 - Quality        | 100               |                                          |
| Omni Flash               | 15 / 20 / 25 / 30 | 4 / 6 / 8 / 10초; video-to-video 편집 40 |
| Scene Builder Extend 1회 | 5                 | 7초, Veo 3.1 - Lite                      |

## 설정

macOS에서는 기본값으로 동작합니다. `~/.config/google-flow-mcp/config.json`(`npx google-flow-mcp init`)이나
`FLOW_MCP_*` 환경변수로 바꿉니다.

| 키                    | 환경변수                         | 기본값                                                         |
| --------------------- | -------------------------------- | -------------------------------------------------------------- |
| `chromePath`          | `FLOW_MCP_CHROME_PATH`           | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| `userDataDir`         | `FLOW_MCP_USER_DATA_DIR`         | `~/.google-flow-chrome`                                        |
| `cdpPort`             | `FLOW_MCP_CDP_PORT`              | `9333`                                                         |
| `stateDir`            | `FLOW_MCP_STATE_DIR`             | `~/.google-flow-mcp` (로그·스크린샷·잡)                        |
| `generationTimeoutMs` | `FLOW_MCP_GENERATION_TIMEOUT_MS` | `1800000`                                                      |
| `logLevel`            | `FLOW_MCP_LOG_LEVEL`             | `info`                                                         |

## MCP 라이브러리 없이 Python(또는 아무 프로세스)에서 쓰기

서버는 stdio 위의 MCP를 말하므로, 순수 JSON-RPC 클라이언트는 40줄이면 됩니다.

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

stdout에는 JSON-RPC 프레임만 쓰이고, 로그는 stderr와 `~/.google-flow-mcp/logs`로 갑니다.

## Chrome 하나를 여러 에이전트가 공유하기

서버 프로세스마다 탭을 정확히 하나만 소유하고 종료 시 그 탭만 닫습니다. 여러 프로세스가 9333 포트의 Chrome을 함께 쓸 수
있습니다. 공유 모델의 주의점 하나: Playwright는 연결 시 모든 탭에 붙기 때문에 렌더러가 멈춘 탭 하나가 모두의 새 연결을
막습니다. `npx google-flow-mcp doctor`가 그런 탭을 찾아주고 `doctor --close-hung`이 닫아 줍니다.

## 로드맵 / 알려진 한계

- **장면 다운로드**: Flow의 "다운로드"는 장면을 렌더하지만 현재 Flow 빌드에서는 자동화된 탭으로 파일이 오지 않아 도구로
  내놓지 않았습니다. 대신 클립(`media_id`)을 받아 로컬에서 concat하세요.
- **Jump to**: 현재 Scene Builder 메뉴에 없습니다(Extend만 있음).
- 기존 장면에 클립 추가(애셋 선택기), 캐릭터, Tools 갤러리, 이미지 편집: 아직 없습니다.
- 라벨은 한국어·영어를 매칭합니다. 다른 UI 언어는 `src/flow/labels.ts`에 항목이 필요합니다(PR 환영 — `flow_inspect`가
  문자열을 보여줍니다).

## 개발

```bash
npm install
npm run check          # 포맷·린트·타입체크·단위+stdio 계약 테스트·문서 신선도
npm run build
npx tsx scripts/call.ts flow_status                   # dist/를 실제 stdio로 띄워 도구 하나 실행
npx tsx scripts/call.ts '[{"tool":"flow_project_open","args":{...}},{"tool":"flow_inspect","args":{...}}]'
```

UI 탐색 루프는 [docs/development.md](docs/development.md), 구조는 [docs/architecture.md](docs/architecture.md)를
보세요. Flow를 실제로 건드리는 라이브 테스트는 `FLOW_E2E=1` 뒤에 있습니다.

## 라이선스

MIT. Google Flow, Veo, Nano Banana는 Google LLC의 상표이며 이 프로젝트는 Google의 보증이나 제휴와 무관합니다.
