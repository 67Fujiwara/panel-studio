import { describe, expect, it } from 'vitest';
import { ellipsis } from '../../src/components/FacePicker';

describe('吹き出しの文字の切り詰め', () => {
  it('上限ちょうどは切らず、超えたら途中で … にする', () => {
    expect(ellipsis('ABCDEFGHIJKLMNOPQRSTUVWX', 24)).toBe('ABCDEFGHIJKLMNOPQRSTUVWX');
    expect(ellipsis('ABCDEFGHIJKLMNOPQRSTUVWXY', 24)).toBe('ABCDEFGHIJKLMNOPQRSTUVW…');
    expect(ellipsis('マルチコンパクト形ノーヒューズ遮断器（経済品）', 16)).toHaveLength(16);
    expect(ellipsis('', 16)).toBe('');
  });
});
