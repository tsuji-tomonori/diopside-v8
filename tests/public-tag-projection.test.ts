import taxonomyInput from '../content/taxonomy/tag-taxonomy.json';

import { buildPublicTagIdMap } from '../scripts/public-tag-projection.ts';
import { tagTaxonomySchema } from '../src/domain/content.ts';

describe('公開人物タグ投影', () => {
  it('来栖夏芽の言及人物IDを出演者IDへ統合する', () => {
    const projection = buildPublicTagIdMap(tagTaxonomySchema.parse(taxonomyInput));

    expect(projection.get('tag-reference-mentionedPerson-cc812a0d12ea')).toBe('tag-people-performer-f1576533a080');
    expect(projection.get('tag-people-performer-f1576533a080')).toBe('tag-people-performer-f1576533a080');
  });

  it('チャンネルタグは従来どおり公開しない', () => {
    const projection = buildPublicTagIdMap(tagTaxonomySchema.parse(taxonomyInput));

    expect(projection.get('tag-people-channel-e0fc18a727d8')).toBeNull();
  });
});
