import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import aliasesInput from '../content/taxonomy/tag-aliases.json';
import taxonomyInput from '../content/taxonomy/tag-taxonomy.json';
import canonicalInput from '../content/videos/7keH8yrqabc.json';
import { readCanonicalVideos } from '../scripts/canonical-store.ts';
import { tagAliasesSchema, tagTaxonomySchema } from '../src/domain/content.ts';
import { aliasCompatibilityErrors, aliasHistorySnapshot } from '../src/domain/tag-alias-compatibility.ts';
import { detectExplicitGameTitleTagIds } from '../src/domain/game-title-detection.ts';
import { normalizeTagAlias, searchTagSuggestions } from '../src/domain/search.ts';
import { validateCanonicalVideo, validateTaxonomy } from '../src/domain/validation.ts';

const root = path.resolve(import.meta.dirname, '..');
const taxonomy = tagTaxonomySchema.parse(taxonomyInput);
const aliases = tagAliasesSchema.parse(aliasesInput);
const videos = readCanonicalVideos(root);
const evidence = [
  {
    "alias": "バイオRE:4",
    "tagId": "tag-works-gameTitle-6d46f8a766df",
    "videoIds": [
      "4br9lIV6tzQ",
      "FcSdtmAZ2VU",
      "HaLBVS1KZ7M",
      "kv0cvd2QdF8",
      "QvwqVkSzUAc",
      "YD4IU8Wf3vQ"
    ]
  },
  {
    "alias": "ポケモンレジェンズアルセウス",
    "tagId": "tag-works-gameTitle-0a2921b44ca8",
    "videoIds": [
      "_ohvI7337io",
      "bXzh2xxW4zg",
      "Gln_7DqFMU4",
      "HakQfgDFBBw",
      "htjV5H9KWEs",
      "RhBkmcG-GRo",
      "V3G_P0kchT8",
      "vRl-g0toE1g"
    ]
  },
  {
    "alias": "リングフィットアドベンチャー",
    "tagId": "tag-works-gameTitle-01da1a2e8541",
    "videoIds": [
      "23pz176eOAM",
      "ONPGU04nLbc",
      "RaDdNIncl38",
      "T7hnGVszU1w",
      "UkHFOhmrn-w",
      "v8e03tGRFW4"
    ]
  }
];

describe('根拠付き検索別名と追加だけの後方互換性', () => {
  it.each(evidence)('$alias は公開タイトルと既存の承認済みゲームタグで裏付けられる', ({ alias, tagId, videoIds }) => {
    const lookup = new Map(videos.map((video) => [video.videoId, video]));
    for (const videoId of videoIds) {
      const video = lookup.get(videoId);
      expect(video, videoId).toBeDefined();
      expect(video!.title).toContain(`【${alias}】`);
      expect(video!.tagAssignments.some((entry) => entry.tagId === tagId)).toBe(true);
    }
    expect(aliases.aliases.find((entry) => entry.normalizedAlias === normalizeTagAlias(alias))?.tagId).toBe(tagId);
    expect(detectExplicitGameTitleTagIds(`【${alias}】`, taxonomy, aliases)).toEqual([tagId]);
    const tags = taxonomy.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags.map((tag) => ({
      ...tag, normalizedReading: '', count: 0,
      aliases: aliases.aliases.filter((entry) => entry.tagId === tag.tagId).map((entry) => entry.alias),
    }))));
    expect(searchTagSuggestions(alias, tags)[0]?.tagId).toBe(tagId);
  });

  it('根拠20動画は確認用であり正本の書き換えを必要としない', () => {
    expect(new Set(evidence.flatMap((entry) => entry.videoIds)).size).toBe(20);
    expect(validateTaxonomy(taxonomy, aliases)).toEqual([]);
    for (const video of videos) expect(validateCanonicalVideo(video, taxonomy, aliases), video.videoId).toEqual([]);
  });

  it('8.3.0は明示宣言と完全な追加互換履歴が揃う場合だけ受け入れる', () => {
    expect(aliasCompatibilityErrors(aliases, '8.3.0')).toEqual([]);
    expect(validateCanonicalVideo(canonicalInput, taxonomy, aliases)).toEqual([]);
    const undeclared = structuredClone(taxonomy);
    undeclared.compatibleCanonicalVideoAliasVersions = [];
    expect(validateCanonicalVideo(canonicalInput, undeclared, aliases).map((item) => item.code)).toContain('ALIAS_VERSION_MISMATCH');
    const noHistory = structuredClone(taxonomy);
    noHistory.compatibleCanonicalVideoAliasVersions = ['fictitious'];
    const forgedVideo = { ...canonicalInput, aliasVersion: 'fictitious' };
    expect(validateCanonicalVideo(forgedVideo, noHistory, aliases).map((item) => item.code)).toContain('ALIAS_VERSION_MISMATCH');
    expect(validateTaxonomy(noHistory, aliases).map((item) => item.code)).toContain('ALIAS_COMPATIBILITY_INVALID');
    expect(validateCanonicalVideo({ ...canonicalInput, aliasVersion: '8.2.0' }, taxonomy, aliases).map((item) => item.code)).toContain('ALIAS_VERSION_MISMATCH');
  });

  it.each(['remove', 'remap', 'duplicate', 'normalization', 'decomposition', 'review'] as const)('既存の意味を変える変更を拒否する: %s', (change) => {
    const changed = structuredClone(aliases);
    if (change === 'remove') changed.aliases.shift();
    if (change === 'remap') changed.aliases[0]!.tagId = evidence[0]!.tagId;
    if (change === 'duplicate') changed.aliases.push({ ...changed.aliases[0]! });
    if (change === 'normalization') changed.normalizationOrder.reverse();
    if (change === 'decomposition') changed.decompositions[0]!.autoApply = false;
    if (change === 'review') changed.reviewRequired.pop();
    expect(aliasCompatibilityErrors(changed, '8.3.0').length).toBeGreaterThan(0);
    expect(validateCanonicalVideo(canonicalInput, taxonomy, changed).map((item) => item.code)).toContain('ALIAS_VERSION_MISMATCH');
  });

  it('別の正規タグと衝突する追加別名を拒否する', () => {
    const changed = structuredClone(aliases);
    changed.aliases.push({ alias: 'Minecraft', normalizedAlias: 'minecraft', tagId: evidence[0]!.tagId });
    expect(validateTaxonomy(taxonomy, changed).map((item) => item.code)).toContain('ALIAS_CANONICAL_COLLISION');
  });

  it('タイトルのゲーム別名から出演者タグを作らず、人物の役割を統合しない', () => {
    expect(detectExplicitGameTitleTagIds('【バイオRE:4】白雪巴/来栖夏芽', taxonomy, aliases)).toEqual([evidence[0]!.tagId]);
    const tags = taxonomy.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags));
    expect(tags.filter((tag) => tag.canonicalName === '来栖夏芽').length).toBeGreaterThan(1);
  });

  it('互換履歴は承認済み8.3.0の固定fingerprintに一致し、呼び出し元から改ざんできない', () => {
    // 6aa10f04 main's alias payload, identical to 63b7044d before CONTENT 03.
    const raw = readFileSync(path.join(root, 'content/taxonomy/alias-history/8.3.0.json'));
    expect(createHash('sha256').update(raw).digest('hex')).toBe('f6a2a6b360bf501a47251c295a1a51777c748029bb8ce2c3f376a7fd4ede20a1');
    const forged = aliasHistorySnapshot('8.3.0')!;
    forged.aliases.shift();
    const changed = structuredClone(aliases);
    changed.aliases.shift();
    expect(aliasCompatibilityErrors(changed, '8.3.0').length).toBeGreaterThan(0);
    expect(validateTaxonomy(taxonomy, { ...changed, compatibleVersions: [forged] }).length).toBeGreaterThan(0);
    expect(aliasHistorySnapshot('fictitious')).toBeUndefined();
    expect(aliasCompatibilityErrors(aliases, '8.3.0')).toEqual([]);
  });
});
