import { describe, expect, it } from 'vitest';
import { parseFlowUrl, sceneUrl } from '../../src/flow/project.js';

const P = 'b5d86d0f-1234-4abc-9def-0123456789ab';
const S = '33016bbc-53d5-4967-87d2-d41fab042c1c';

describe('flow urls', () => {
  it('parses home, project and scene URLs with or without locale', () => {
    expect(parseFlowUrl('https://labs.google/fx/tools/flow')).toEqual({
      locale: undefined,
      projectId: undefined,
      sceneId: undefined,
    });
    expect(parseFlowUrl(`https://labs.google/fx/ko/tools/flow/project/${P}`)).toEqual({
      locale: 'ko',
      projectId: P,
      sceneId: undefined,
    });
    expect(parseFlowUrl(`https://labs.google/fx/en/tools/flow/project/${P}/scene/${S}`)).toEqual({
      locale: 'en',
      projectId: P,
      sceneId: S,
    });
    expect(parseFlowUrl(`https://labs.google/fx/tools/flow/project/${P}/scenes/${S}`)?.sceneId).toBe(S);
    expect(parseFlowUrl('https://accounts.google.com/signin')).toBeNull();
  });

  it('builds a scene URL that keeps the project locale', () => {
    expect(sceneUrl(`https://labs.google/fx/ko/tools/flow/project/${P}`, S)).toBe(
      `https://labs.google/fx/ko/tools/flow/project/${P}/scene/${S}`,
    );
    expect(() => sceneUrl('https://labs.google/fx/tools/flow', S)).toThrow(/project URL/);
  });
});
