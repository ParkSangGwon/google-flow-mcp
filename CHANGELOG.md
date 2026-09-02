# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-02

### Added

- MCP server over stdio with a structured `ok` / `code` result envelope and on-disk job records for `resume`
- Session tools: `flow_connect`, `flow_status`, `flow_screenshot`, `flow_project_open`
- `flow_inspect`: snapshot/diff UI discovery with text search, media-element listing, coordinate actions, typing
  and network watching
- `flow_generate_video` (Veo 3.1 Lite/Fast/Quality, Omni Flash) and `flow_generate_image` (Nano Banana) through the
  Flow agent composer, with dry run (`auto_confirm: false`), reference images and crash-safe resume
- `flow_media_download`
- Scene Builder: `flow_scene_add`, `flow_scene_status`, `flow_scene_extend` (7 s Veo 3.1 - Lite hops, idempotent
  retries)
- `google-flow-mcp doctor` (Chrome, port, login, hung-tab probe with `--close-hung`) and `init`
- Korean and English UI labels

### Known limitations

- Scene "Download" cannot be captured from an automated tab in the current Flow build; download the clips instead
- No "Jump to" in the current Scene Builder menu; adding a clip to an existing scene is not exposed yet
