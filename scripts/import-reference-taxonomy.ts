import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildLegacyContext,
  classifyLegacyVideo,
  parseIsoDuration,
  type LegacyLedgerRow,
  type LegacyTagVideo,
  type LegacyTimestampVideo,
} from './legacy-content.ts';
import { readSourceShards } from './source-shards.ts';

interface SourceSubcategory {
  id: string;
  name: string;
  cardinality: string;
  valueKind: 'classification' | 'entity-reference';
  entityType?: 'person' | 'group' | 'channel' | 'game' | 'event' | 'series' | 'song' | 'work' | 'artist';
  videoRelation?: 'publishedBy' | 'features' | 'mentions' | 'plays' | 'watches' | 'performs' | 'featuresMusic' | 'participatesIn' | 'partOfSeries';
  values?: string[];
  valuesFrom?: string;
  requiredWhen?: string;
  appliesWhen?: string;
  source?: string;
  valueRule?: string;
  requiredValues?: Record<string, string>;
  extensible?: boolean;
}

interface SourceCategory {
  id: string;
  name: string;
  subcategories: SourceSubcategory[];
}

interface SourceTaxonomy {
  schemaVersion: string;
  categories: SourceCategory[];
}

interface SourceAliases {
  schemaVersion: string;
  exactAliases: Array<{ field: string; canonical: string; aliases: string[] }>;
  decompositions: Array<{
    legacy: string;
    targets: Array<{ field: string; value: string }>;
    discardedFragments?: string[];
    autoApply?: boolean;
    note?: string;
  }>;
  reviewRequired: Array<{ legacy: string; reason: string }>;
}

interface VideoSample {
  videos: Array<{
    videoId: string;
    tags: Array<{ categoryId: string; subcategoryId: string; canonicalName: string }>;
  }>;
}

const root = path.resolve(import.meta.dirname, '..');
const source = JSON.parse(readFileSync(path.join(root, 'spec/sources/tag-taxonomy-v2.json'), 'utf8')) as SourceTaxonomy;
const sourceAliases = JSON.parse(readFileSync(path.join(root, 'spec/sources/tag-aliases-v2.json'), 'utf8')) as SourceAliases;
const videoSample = JSON.parse(readFileSync(path.join(root, 'spec/sources/video-tags-available-30.json'), 'utf8')) as VideoSample;
const outDir = path.join(root, 'content/taxonomy');
const legacyTags = readSourceShards<LegacyTagVideo>(root, 'spec/sources/legacy-video-tags-v1/manifest.json', 'videos').items;
const legacyTimestamps = readSourceShards<LegacyTimestampVideo>(root, 'spec/sources/legacy-timestamps-v1/manifest.json', 'videos').items;
const ledgerRows = readSourceShards<LegacyLedgerRow>(root, 'spec/sources/v7-timestamp-ledger-v1/manifest.json', 'rows').items;

const dynamicValues = new Map<string, Set<string>>();
for (const video of videoSample.videos) {
  for (const tag of video.tags) {
    const field = `${tag.categoryId}.${tag.subcategoryId}`;
    const values = dynamicValues.get(field) ?? new Set<string>();
    values.add(tag.canonicalName);
    dynamicValues.set(field, values);
  }
}
const legacyContext = buildLegacyContext(legacyTags);
const tagsById = new Map(legacyTags.map((video) => [video.videoId, video]));
const timestampsById = new Map(legacyTimestamps.map((video) => [video.videoId, video]));
const ledgerById = new Map(ledgerRows.map((row) => [row.videoId, row]));
const legacyVideoIds = [...new Set([...tagsById.keys(), ...timestampsById.keys()])].sort();
for (const videoId of legacyVideoIds) {
  const tagVideo = tagsById.get(videoId);
  const timestampVideo = timestampsById.get(videoId);
  const ledger = ledgerById.get(videoId);
  if (ledger?.excluded) continue;
  if (!tagVideo && !timestampVideo) continue;
  const logicalTags = classifyLegacyVideo({
    videoId,
    title: timestampVideo?.title ?? tagVideo!.title,
    durationSeconds: timestampVideo?.durationSeconds ?? parseIsoDuration(tagVideo!.durationIso),
    channelName: ledger?.channelName || '白雪 巴/Shirayuki Tomoe',
    legacyTags: tagVideo?.legacyTags ?? [],
    hasApprovedTimestamps: Boolean(timestampVideo),
  }, legacyContext);
  for (const tag of logicalTags) {
    const field = `${tag.categoryId}.${tag.subcategoryId}`;
    const values = dynamicValues.get(field) ?? new Set<string>();
    values.add(tag.canonicalName);
    dynamicValues.set(field, values);
  }
}

function tagId(field: string, value: string): string {
  const digest = createHash('sha256').update(`${field}\0${value}`, 'utf8').digest('hex').slice(0, 12);
  return `tag-${field.replace('.', '-')}-${digest}`;
}

function normalized(value: string): string {
  return value.normalize('NFKC').trim().replace(/^#/u, '').replace(/\s+/gu, ' ').toLocaleLowerCase('ja-JP');
}

function sourceValues(categoryId: string, subcategory: SourceSubcategory): string[] {
  if (subcategory.values) return subcategory.values;
  if (subcategory.valuesFrom === 'content.primary') {
    const primary = source.categories
      .find((category) => category.id === 'content')
      ?.subcategories.find((item) => item.id === 'primary');
    return primary?.values ?? [];
  }
  return [];
}

const categories = source.categories.map((category, categoryOrder) => ({
  categoryId: category.id,
  name: category.name,
  order: categoryOrder + 1,
  subcategories: category.subcategories.map((subcategory, subcategoryOrder) => {
    const field = `${category.id}.${subcategory.id}`;
    const values = new Set([...sourceValues(category.id, subcategory), ...(dynamicValues.get(field) ?? [])]);
    return {
      subcategoryId: subcategory.id,
      name: subcategory.name,
      order: subcategoryOrder + 1,
      valueKind: subcategory.valueKind,
      ...(subcategory.entityType ? { entityType: subcategory.entityType } : {}),
      ...(subcategory.videoRelation ? { videoRelation: subcategory.videoRelation } : {}),
      cardinality: subcategory.cardinality,
      ...(subcategory.requiredWhen ? { requiredWhen: subcategory.requiredWhen } : {}),
      ...(subcategory.appliesWhen ? { appliesWhen: subcategory.appliesWhen } : {}),
      ...(subcategory.requiredValues ? { requiredValues: subcategory.requiredValues } : {}),
      ...(subcategory.source ? { source: subcategory.source } : {}),
      ...(subcategory.valueRule ? { valueRule: subcategory.valueRule } : {}),
      extensible: Boolean(subcategory.extensible || !subcategory.values),
      tags: [...values].sort((a, b) => a.localeCompare(b, 'ja')).map((canonicalName) => ({
        tagId: tagId(field, canonicalName),
        canonicalName,
        active: true,
        inclusionCriteria: `${subcategory.name}として公開情報から直接確認できること`,
        exclusionCriteria: '推測、低確度、確認待ち、分類不能な情報は含めない',
      })),
    };
  }),
}));

const subcategoryCount = categories.reduce((total, category) => total + category.subcategories.length, 0);
if (categories.length !== 7 || subcategoryCount !== 28) {
  throw new Error(`分類体系は7大分類・28小分類である必要があります（${categories.length}・${subcategoryCount}）`);
}

const tagLookup = new Map<string, string>();
for (const category of categories) {
  for (const subcategory of category.subcategories) {
    for (const tag of subcategory.tags) {
      tagLookup.set(`${category.categoryId}.${subcategory.subcategoryId}\0${tag.canonicalName}`, tag.tagId);
    }
  }
}

const aliasesByNormalized = new Map<string, { alias: string; normalizedAlias: string; tagId: string }>();
for (const entry of sourceAliases.exactAliases) {
  const id = tagLookup.get(`${entry.field}\0${entry.canonical}`);
  if (!id) continue;
  for (const alias of entry.aliases) {
    const normalizedAlias = normalized(alias);
    const prior = aliasesByNormalized.get(normalizedAlias);
    if (prior && prior.tagId !== id) throw new Error(`別名「${alias}」が複数タグへ解決されます。`);
    aliasesByNormalized.set(normalizedAlias, { alias, normalizedAlias, tagId: id });
  }
}
const aliases = [...aliasesByNormalized.values()].sort((left, right) => left.normalizedAlias.localeCompare(right.normalizedAlias, 'ja'));

const decompositions = sourceAliases.decompositions.map((entry) => {
  const unresolvedTargets = entry.targets.filter((target) => !tagLookup.has(`${target.field}\0${target.value}`));
  return {
    legacy: entry.legacy,
    normalizedLegacy: normalized(entry.legacy),
    targetTagIds: entry.targets.flatMap((target) => {
      const id = tagLookup.get(`${target.field}\0${target.value}`);
      return id ? [id] : [];
    }),
    unresolvedTargets,
    discardedFragments: entry.discardedFragments ?? [],
    autoApply: Boolean(entry.autoApply && unresolvedTargets.length === 0),
    note: entry.note ?? '複合した旧値を原子的なタグへ分解する',
  };
});
const unresolvedDecompositions = decompositions
  .filter((entry) => entry.unresolvedTargets.length > 0)
  .map((entry) => ({ legacy: entry.legacy, reason: '移行対象の公開資料に分解先がないため自動適用せず、人手確認する' }));
const reviewRequired = [...sourceAliases.reviewRequired, ...unresolvedDecompositions]
  .filter((entry, index, values) => values.findIndex((candidate) => candidate.legacy === entry.legacy) === index);

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'tag-taxonomy.json'), `${JSON.stringify({
  schemaVersion: '1.0.0',
  taxonomyVersion: '8.1.0',
  sourceVersion: source.schemaVersion,
  aliasVersion: '8.1.0',
  rulesVersion: '8.1.0',
  effectiveDate: '2026-08-04',
  categoryCount: categories.length,
  subcategoryCount,
  prohibitedCanonicalNames: ['', 'その他', '不明', '要確認', '未分類'],
  categories,
}, null, 2)}\n`);
writeFileSync(path.join(outDir, 'tag-aliases.json'), `${JSON.stringify({
  schemaVersion: '1.0.0',
  aliasVersion: '8.1.0',
  normalizationOrder: ['Unicode NFKC', '前後空白除去', '連続空白統合', '英字小文字化', '先頭の#除去'],
  aliases,
  decompositions,
  reviewRequired,
}, null, 2)}\n`);
const affectedVideoCount = new Set([...legacyVideoIds, ...videoSample.videos.map((video) => video.videoId)]).size;
writeFileSync(path.join(outDir, 'change-record.json'), `${JSON.stringify({
  schemaVersion: '1.0.0',
  changeType: '保守変更',
  previousTaxonomyVersion: '8.0.0',
  previousAliasVersion: '8.0.0',
  taxonomyVersion: '8.1.0',
  aliasVersion: '8.1.0',
  rulesVersion: '8.1.0',
  affectedTagIds: [...tagLookup.values()].sort(),
  affectedVideoCount,
  migration: '旧diopside、diopside-v7、公開進捗台帳から確認できた既存承認済みタグと時刻を、所有者指示に基づきv8正本へ決定的に移行する。',
  reviewedAt: '2026-08-04T15:00:00+09:00',
}, null, 2)}\n`);

console.log(`7大分類・28小分類・${tagLookup.size}タグを取り込みました。`);
