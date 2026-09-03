import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { tagAliasesSchema, tagTaxonomySchema } from './content.ts';
import { detectExplicitGameTitleTagIds } from './game-title-detection.ts';

const root = path.resolve(import.meta.dirname, '../..');
const taxonomy = tagTaxonomySchema.parse(JSON.parse(readFileSync(path.join(root, 'content/taxonomy/tag-taxonomy.json'), 'utf8')));
const aliases = tagAliasesSchema.parse(JSON.parse(readFileSync(path.join(root, 'content/taxonomy/tag-aliases.json'), 'utf8')));

describe('detectExplicitGameTitleTagIds', () => {
  it.each([
    ['【めっちゃカメレオン】視聴者参加型！めっちゃ初回カメレオン', 'めっちゃカメレオン'],
    ['【スゴイツヨイトウフ】お前はまだトウフを知らない', 'スゴイツヨイトウフ'],
    ['【APEX】自分オーダーｽｶ？？', 'Apex Legends'],
    ['【SILENT HILL f #1】完全初見！', 'SILENT HILL f'],
    ['【メイドインワリオ】初見でおすそわける。', 'おすそわけるメイドインワリオ'],
  ])('作品名の明示表記を検出する: %s', (title, expectedName) => {
    const detected = detectExplicitGameTitleTagIds(title, taxonomy, aliases);
    const expected = taxonomy.categories
      .flatMap((category) => category.subcategories)
      .flatMap((subcategory) => subcategory.tags)
      .find((tag) => tag.canonicalName === expectedName)?.tagId;
    expect(detected).toContain(expected);
  });

  it.each([
    '【3Dコラボ】敗者は罰ゲーム',
    '格闘ゲーム化！？星5キャラ白雪巴',
    '【#白雪巴3D 番外編】スパチャお礼',
  ])('ゲーム作品名ではない一般表現を検出しない: %s', (title) => {
    expect(detectExplicitGameTitleTagIds(title, taxonomy, aliases)).toEqual([]);
  });
});
