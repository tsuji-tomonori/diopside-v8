import { preserveCanonicalRequirements } from '../scripts/requirement-preservation.ts';

describe('正本要件の再生成', () => {
  it('新しい所有者変更、新規要件、廃止要件を旧importで消さない', () => {
    const generated = [{ id: 'A', revision: 1, object: 'old' }];
    const existing = [{ id: 'A', revision: 2, object: 'new' }, { id: 'B', revision: 1, status: 'retired' }];
    const result = preserveCanonicalRequirements(generated, existing, new Set());
    expect(result).toEqual(existing);
    expect(preserveCanonicalRequirements(generated, result, new Set())).toEqual(result);
  });
  it('新しいimportと明示的な既存例外を保持し順序を固定する', () => {
    const generated = [{ id: 'B', revision: 2, object: 'new' }, { id: 'A', revision: 2, object: 'import' }];
    const existing = [{ id: 'A', revision: 1, object: 'override' }, { id: 'B', revision: 1, object: 'old' }];
    expect(preserveCanonicalRequirements(generated, existing, new Set(['A']))).toEqual([existing[0], generated[0]]);
  });
});
