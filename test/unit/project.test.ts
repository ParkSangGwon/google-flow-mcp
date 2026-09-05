import { describe, expect, it } from 'vitest';
import { parseFlowUrl, sceneUrl } from '../../src/flow/project.js';

const P = 'b5d86d0f-1234-4abc-9def-0123456789ab';
const S = '33016bbc-53d5-4967-87d2-d41fab042c1c';

describe('flow urls', () => {
  it('parses home, project and scene URLs on flow.google.com', () => {
    expect(parseFlowUrl('https://flow.google.com')).toEqual({ projectId: undefined, sceneId: undefined });
    expect(parseFlowUrl(`https://flow.google.com/project/${P}`)).toEqual({ projectId: P, sceneId: undefined });
    expect(parseFlowUrl(`https://flow.google.com/project/${P}/scene/${S}`)).toEqual({ projectId: P, sceneId: S });
    expect(parseFlowUrl(`https://flow.google.com/project/${P}/scenes/${S}`)?.sceneId).toBe(S);
  });

  it('still parses the labs.google links Flow redirects from', () => {
    expect(parseFlowUrl(`https://labs.google/fx/ko/tools/flow/project/${P}`)?.projectId).toBe(P);
    expect(parseFlowUrl(`https://labs.google/fx/en/tools/flow/project/${P}/scene/${S}`)?.sceneId).toBe(S);
  });

  it('rejects sign-in and other views under a project, so navigation is not skipped', () => {
    expect(parseFlowUrl('https://accounts.google.com/signin')).toBeNull();
    expect(parseFlowUrl(`https://flow.google.com/project/${P}/edit/${S}`)).toBeNull();
  });

  it('builds a scene URL on the current domain', () => {
    expect(sceneUrl(`https://labs.google/fx/ko/tools/flow/project/${P}`, S)).toBe(
      `https://flow.google.com/project/${P}/scene/${S}`,
    );
    expect(() => sceneUrl('https://flow.google.com', S)).toThrow(/project URL/);
  });
});
