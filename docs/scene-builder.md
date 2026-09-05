# Scene Builder

How Google Flow's Scene Builder behaves as observed live on 2026-09-02 (Korean UI, Google AI Ultra), and what this
server automates. Labels are Korean first, English second; both are matched.

## The UI

1. **Entering**: in a project, hover a video tile → `⋮` (`more_vert 옵션 더보기`) → `play_movies 장면에 추가` (Add to
   Scene) → submenu `add 새로운 장면` (New scene). Existing scenes would be listed in the same submenu.
2. A **scene card** (`movie` icon, title "Untitled Scene MM-DD HH:MM:SS") appears at the top of the project grid.
   Opening it navigates to `https://flow.google.com/project/<projectId>/scene/<sceneId>`
   (singular `scene`; the old `/scenes/` form is also accepted by this server).
3. **Scene view**: top bar (`arrow_back 프로젝트로 돌아가기`, editable title, `favorite`, `download 다운로드`, `delete`,
   `history 기록 숨기기`, `⋮`, `완료`), a media strip of the project's media (newest first), the preview player with
   `mm:ss:ff` current/total labels, a timeline at the bottom, and a bottom prompt box (`수정 사항 설명`, Omni 1.1
   Flash) that edits the selected clip.
4. **Timeline**: one `role=button` block per clip, width proportional to duration (100 px per second at default
   zoom, 62 px tall). Selecting a block shows that clip's poster in the right panel; the poster's `src` is the
   address this server downloads the clip from. A clip added to a scene is its own copy of the source tile with
   its own address, but the same content — and so the same media id, which is a digest of the file.

   > The 2026-09-05 rebuild replaced this timeline with `<flow-scene-timeline>`, whose clip blocks are no longer
   > `role=button` elements. Reading a scene's clips is therefore broken until those selectors are redone;
   > `flow_scene_add` (creating the scene) works.

5. **`+` after the last clip** (`add 클립 추가`, 28×28) opens a menu with `add 클립 추가` (asset picker: project
   dropdown, tabs 모두/동영상/업로드, search, `장면에 추가` confirm) and `keyboard_double_arrow_right 확장(Veo 3.1 - Lite)`.
   The model is fixed in the label; there is no picker and **no "Jump to"** entry in this build.
6. **Extend**: the timeline gains a placeholder block labelled `확장({{modelName}})` (sic) plus a hint block
   `프롬프트를 통해 연장하세요`; the bottom prompt box placeholder becomes `다음 단계는 무엇일까요?` with a chip
   `확장(Veo 3.1 - Lite) ×` and the send button `arrow_forward 만들기`. No approval card. After send the placeholder
   block has no text; when the render finishes (about 60–90 s) it becomes a real clip.

## Measured

| Fact                                  | Value                                                                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension length                      | 7.0 s file; the timeline draws it as 8 s (total 4 s seed → 12 s)                                                                                                                                         |
| Extension file                        | 720×1280 (9:16 seed), H.264 + audio, its own file and media id                                                                                                                                           |
| Seam                                  | NCC 0.995 between the seed's last frame and the extension's first frame; no overlap                                                                                                                      |
| Model / cost                          | Veo 3.1 - Lite, 5 credits per hop (Ultra)                                                                                                                                                                |
| Seed requirements                     | A 4 s Veo 3.1 Fast/Lite clip extended fine; official docs say Veo 3.1 8 s clips are extendable                                                                                                           |
| Approval card                         | None with "Confirm before generating: Never"                                                                                                                                                             |
| Extension registered as project media | Yes when the tab stays open until the render completes; **not** when the tab closes early. The clip still exists in the scene and its id can be read by selecting it, which is how `resume` recovers it. |
| Scene "Download"                      | Shows "장면 내보내는 중…" for ~75 s, then nothing reaches the automated tab: no Chrome download, no `showSaveFilePicker`, no new tab or media. Not exposed as a tool.                                    |

## What the tools do

- `flow_scene_add {project_url, media_id}` → hover the tile, `⋮` → 장면에 추가 → 장면 만들기, open the first card,
  return `scene_url` and the timeline. 0 credits. The tile is located by its poster `<img>`; the lazy `<video>` in
  the grid is a detached preview and is ignored.
- `flow_scene_status {scene_url, with_media_ids?}` → clips with durations (from block widths and the total label);
  `with_media_ids` selects each block and reads the poster id.
- `flow_scene_extend {scene_url, prompt, after_clip_index, output_dir, auto_confirm, resume, job_id?}`:
  1. Refuses if `after_clip_index` is not the last clip (`CLIP_NOT_FOUND`).
  2. If the timeline already has a clip at `after_clip_index + 1` (or `resume: true`), it does not generate: it
     selects that clip, reads its media id, downloads it and returns `already_exists`/`completed`.
  3. Otherwise `+` → 확장 → type the prompt → (dry run stops here, screenshot, Escape) → send → poll: a new last
     block whose selected media id downloads as `video/*` means done; ids new to the media strip are tried too.
  4. Job records in `~/.google-flow-mcp/jobs` hold the media baseline, so a restarted server resumes correctly.

## Recipe: a seamless long take

```text
seed   = flow_generate_video { model: veo-3.1-fast, duration: 8, reference_images: [keyframe] }   # 10 credits
scene  = flow_scene_add { project_url, media_id: seed.media_ids[0] }
hop1   = flow_scene_extend { scene_url, prompt: "…continues…", after_clip_index: 0, auto_confirm: true }  # 5
hop2   = flow_scene_extend { scene_url, prompt: "…",           after_clip_index: 1, auto_confirm: true }  # 5
ffmpeg -i seed.mp4 -i hop1.mp4 -i hop2.mp4 -filter_complex "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1" out.mp4
```

Extensions continue motion and ambient audio from the last frames; restate the subject, wardrobe, light and camera
move in every hop prompt because Flow does not carry the previous prompt over.
