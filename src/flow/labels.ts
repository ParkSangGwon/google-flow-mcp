// The only module that knows Flow's on-screen strings. Flow renders the UI in the Google account's language
// (Korean, English or Brazilian Portuguese so far), so every label carries all three; matchers are built from
// this table, never inlined elsewhere. pt-BR strings marked (seen) were read live on 2026-11-07; the rest are
// Flow's expected wording and still need a live sighting.

export const LABELS = {
  agentSettings: ['에이전트 설정', 'Agent settings', 'Configurações do agente'], // pt-BR seen
  approve: ['승인', 'Approve', 'Accept', 'Aprovar'], // pt-BR seen
  never: ['안 함', 'Never', 'Nunca'], // pt-BR seen
  save: ['저장', 'Save', 'Salvar'], // pt-BR seen
  clearPrompt: ['프롬프트 지우기', 'Clear prompt', 'Apagar comando'], // pt-BR seen
  newSession: ['새로운 세션', 'New session', 'Iniciar nova sessão'], // pt-BR seen
  uploadMedia: ['미디어 업로드', 'Upload media', 'Enviar mídia'], // pt-BR seen
  // Composer attach button. Identified by accessible name, not by icon ligature: Flow renamed the
  // ligature add_2 → add (2026-09-05), and the top bar has its own 'add' button that .first() would win.
  attachToPrompt: ['프롬프트 상자에 소재 추가', 'prompt box', 'caixa de comando'], // pt-BR seen
  // Asset picker confirm button — Flow added this step, selecting the item alone no longer attaches it (2026-09-05)
  addToPrompt: ['프롬프트에 추가', 'Add to prompt', 'Incluir no comando'], // pt-BR seen
  // Picker row of a file still being uploaded (pt-BR seen by our gflow driver, 2026-10-22)
  uploading: ['업로드 중', 'Uploading', 'Enviando', '\\d+%'],
  generating: ['생성 중', '만드는 중', 'Generating', 'generating', 'scheduled', 'queue', 'Gerando', 'gerando', 'Criando', 'na fila'],
  policyBlocked: ['정책을 위반', '유해 콘텐츠', "violates? (?:Google'?s )?polic", 'harmful content', 'viola(?:m)? (?:as )?(?:nossas )?pol[íi]tica', 'conte[úu]do (?:nocivo|prejudicial)'],
  // Scene Builder (Korean strings observed live 2026-09-02, see docs/scene-builder.md)
  sceneAdd: ['장면에 추가', 'Add to [Ss]cene', 'Adicionar à cena'],
  // Flow renamed 장면 만들기 → 새로운 장면 in the tile menu (2026-09-05)
  sceneNew: ['새로운 장면', '장면 만들기', '새 장면', 'Create scene', 'New scene', 'Nova cena', 'Criar cena'],
  sceneAddClip: ['클립 추가', 'Add clip', 'Adicionar clipe'],
  sceneExtend: ['확장', 'Extend', 'Estender'],
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
