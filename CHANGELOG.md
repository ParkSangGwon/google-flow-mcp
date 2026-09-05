# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] - 2026-09-05

### Fixed

- A second reference image is verified again. 0.3.0 judged an attachment by "does the composer hold a
  reference", which the first reference already satisfies, so the second one passed before its upload had
  landed — or when the confirm click had not taken at all. Sending without the reference makes the agent pick
  an arbitrary project image as the first frame, which is what `REFERENCE_NOT_ATTACHED` exists to prevent.
  Attachments are now counted: whatever the composer held before is the origin, and the i-th reference has to
  push the count past it
- The output baseline is taken once, before sending. It used to be re-read after the approval wait, which is
  harmless only because Flow's grid does not refresh itself — the moment it does, a fast generation would be
  absorbed into the baseline and the job would wait out its timeout for an output it already had
- Agent settings are applied per project. The cache key was the media kind alone, so generating in a second
  project with the same ratio, model and count skipped the settings and produced at Flow's defaults

## [0.3.0] - 2026-09-05

0.2.0 shipped with a generation loop that could never see its own output. This release makes the round trip
work end to end.

### Fixed

- Generations no longer time out while the clips are ready. Flow's SPA does not push finished media into the
  project grid, so polling the DOM alone reported the baseline tile count for the full 30 minutes — one project
  logged 6 tiles for half an hour while it actually grew from 5 videos to 8. The poll loop now reloads the page
  every 60 s; the same shot went from a 30-minute timeout to a 4-minute download
- Reference images are no longer discarded as `REFERENCE_NOT_ATTACHED` when they did attach. Re-uploading the
  same file on a retry makes Flow hand back the same URL, and the previous attempt's thumbnail is still in the
  composer, so the "any new URL?" test came up empty and threw away a good generation. Attachment is now judged
  by whether the composer holds a reference at all

## [0.2.0] - 2026-09-05

Flow's 2026-09-05 rebuild moved media to a new address scheme and renamed part of the UI, which broke every
path that finds or downloads media. This release follows that build.

### Fixed

- Generation outputs are found again. Flow serves media from `flow.google.com/asb/<token>` instead of
  `media.getMediaUrlRedirect?name=<uuid>`, so the old matcher saw nothing and `flow_generate_video` /
  `flow_generate_image` timed out after 30 minutes even though the clip had been generated
- Project URLs on `flow.google.com/project/<uuid>` are recognised (the `labs.google` links Flow redirects from
  are still accepted as input), so the server no longer re-navigates on every call
- Reference images attach again: the composer's attach button is matched by its accessible name, and the asset
  picker's new "add to prompt" confirm step is clicked
- `flow_scene_add` follows the renamed "New scene" submenu item, the scene card that is no longer a
  `role=button`, and scene ids that Flow mints in upper case

### Changed

- Media ids are an 8-character digest of the downloaded file. Flow re-signs a tile's address over time and no
  longer exposes a uuid for video tiles, so the bytes are the only identity that survives a reload or a restart.
  File names keep the `flow_<id>_<job>.<ext>` shape, and re-downloading a clip neither duplicates nor loses it
- A generation's outputs are recognised by position: the grid is newest-first, and whatever grew the count of
  tiles of that kind since the baseline is what the job produced
- `flow_project_open` returns `media` (index, kind, title, address, and the uuid when Flow still exposes one)
  and `videos` instead of `media_ids`
- `flow_media_download` takes a Flow media uuid; it downloads video and image alike
- `flow_inspect`'s `media` option lists grid tiles (`index|kind|title`) rather than media elements
- Videos download at their original size (720x1280 h264), the same file Flow's own "original size" menu offers

### Removed

- `flow_scene_status`'s `with_media_ids` and `SceneClip.media_id`: the rebuilt scene view exposes no stable
  per-clip id

### Known limitations

- The rebuilt scene view's timeline is a `<flow-scene-timeline>` whose clip blocks are no longer `role=button`,
  so `flow_scene_status` reports no clips and `flow_scene_extend` cannot find one to extend; see
  `docs/scene-builder.md`
- Scene "Download" still cannot be captured from an automated tab; download the clips instead

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
