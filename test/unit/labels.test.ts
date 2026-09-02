import { describe, expect, it } from 'vitest';
import { IMAGE_MODELS, LABELS, VIDEO_MODELS, VIDEO_MODEL_IDS, label, modelLabel } from '../../src/flow/labels.js';

describe('labels', () => {
  it('every label has at least a Korean and an English form', () => {
    for (const [key, forms] of Object.entries(LABELS)) {
      expect(forms.length, key).toBeGreaterThanOrEqual(2);
    }
  });

  it('exact mode anchors the whole text; suffix mode tolerates an icon prefix', () => {
    expect(label('approve', 'exact').test('  승인 ')).toBe(true);
    expect(label('approve', 'exact').test('승인, 다시 묻지 않음')).toBe(false);
    expect(label('save', 'suffix').test('check저장')).toBe(true);
    expect(label('save', 'suffix').test('저장 안 함')).toBe(false);
    expect(label('sceneAdd').test('add_2장면에 추가')).toBe(true);
    expect(label('sceneAdd').test('Add to Scene')).toBe(true);
  });

  it('policy regex matches Korean and English refusals', () => {
    const re = label('policyBlocked');
    expect(re.test('요청이 Google 정책을 위반할 수 있어 생성하지 못했습니다')).toBe(true);
    expect(re.test("This request violates Google's policies")).toBe(true);
    expect(re.test('Generating your video')).toBe(false);
  });

  it('model ids map to the on-screen names', () => {
    expect(modelLabel('veo-3.1-fast')).toBe('Veo 3.1 - Fast');
    expect(modelLabel('nano-banana-pro')).toBe('Nano Banana Pro');
    expect(VIDEO_MODEL_IDS).toEqual(Object.keys(VIDEO_MODELS));
    expect(new Set(Object.keys(IMAGE_MODELS)).size).toBe(Object.keys(IMAGE_MODELS).length);
  });
});
