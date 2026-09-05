// The only module that knows Flow's on-screen strings. Flow renders Korean or English depending on the
// account, so every label carries both; matchers are built from this table, never inlined elsewhere.

export const LABELS = {
  agentSettings: ['에이전트 설정', 'Agent settings'],
  approve: ['승인', 'Approve', 'Accept'],
  never: ['안 함', 'Never'],
  save: ['저장', 'Save'],
  clearPrompt: ['프롬프트 지우기', 'Clear prompt'],
  newSession: ['새로운 세션', 'New session'],
  uploadMedia: ['미디어 업로드', 'Upload media'],
  // Composer attach button. Identified by accessible name, not by icon ligature: Flow renamed the
  // ligature add_2 → add (2026-09-05), and the top bar has its own 'add' button that .first() would win.
  attachToPrompt: ['프롬프트 상자에 소재 추가', 'prompt box'],
  // Asset picker confirm button — Flow added this step, selecting the item alone no longer attaches it (2026-09-05)
  addToPrompt: ['프롬프트에 추가', 'Add to prompt'],
  generating: ['생성 중', '만드는 중', 'Generating', 'generating', 'scheduled', 'queue'],
  policyBlocked: ['정책을 위반', '유해 콘텐츠', "violates? (?:Google'?s )?polic", 'harmful content'],
  // Scene Builder (Korean strings observed live 2026-09-02, see docs/scene-builder.md)
  sceneAdd: ['장면에 추가', 'Add to [Ss]cene'],
  // Flow renamed 장면 만들기 → 새로운 장면 in the tile menu (2026-09-05)
  sceneNew: ['새로운 장면', '장면 만들기', '새 장면', 'Create scene', 'New scene'],
  sceneAddClip: ['클립 추가', 'Add clip'],
  sceneExtend: ['확장', 'Extend'],
} as const;

export type LabelKey = keyof typeof LABELS;

// Material icon ligatures that appear in button innerText (language independent)
export const ICON = {
  send: 'arrow_forward',
  add: 'add', // renamed from add_2 by Flow, 2026-09-05
  settings: 'tune',
  newSession: 'edit_square',
  more: 'more_vert',
  cancel: 'cancel',
} as const;

export type IconName = keyof typeof ICON;

export const VIDEO_MODELS = {
  'veo-3.1-lite': 'Veo 3.1 - Lite',
  'veo-3.1-fast': 'Veo 3.1 - Fast',
  'veo-3.1-quality': 'Veo 3.1 - Quality',
  'omni-flash': 'Omni Flash',
} as const;

export const IMAGE_MODELS = {
  'nano-banana-pro': 'Nano Banana Pro',
  'nano-banana-2': 'Nano Banana 2',
  'nano-banana-2-lite': 'Nano Banana 2 Lite',
} as const;

export type VideoModelId = keyof typeof VIDEO_MODELS;
export type ImageModelId = keyof typeof IMAGE_MODELS;
export type ModelId = VideoModelId | ImageModelId;

export const VIDEO_MODEL_IDS = Object.keys(VIDEO_MODELS) as [VideoModelId, ...VideoModelId[]];
export const IMAGE_MODEL_IDS = Object.keys(IMAGE_MODELS) as [ImageModelId, ...ImageModelId[]];

export function modelLabel(id: ModelId): string {
  return id in VIDEO_MODELS ? VIDEO_MODELS[id as VideoModelId] : IMAGE_MODELS[id as ImageModelId];
}

export type LabelMode = 'exact' | 'contains' | 'suffix';

// exact: the whole text is the label; suffix: text ends with it (button innerText is prefixed by an icon ligature)
export function label(key: LabelKey, mode: LabelMode = 'contains'): RegExp {
  const alts = LABELS[key].join('|');
  if (mode === 'exact') return new RegExp(`^\\s*(?:${alts})\\s*$`);
  if (mode === 'suffix') return new RegExp(`(?:${alts})\\s*$`);
  return new RegExp(alts);
}
