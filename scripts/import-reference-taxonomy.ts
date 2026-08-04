import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface SourceSubcategory {
  id: string;
  name: string;
  cardinality: string;
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
    tags: Array<{ categoryId: string; subcategoryId: string; canonicalName: string }>;
  }>;
}

const root = path.resolve(import.meta.dirname, '..');
const source = JSON.parse(readFileSync(path.join(root, 'spec/sources/tag-taxonomy-v2.json'), 'utf8')) as SourceTaxonomy;
const sourceAliases = JSON.parse(readFileSync(path.join(root, 'spec/sources/tag-aliases-v2.json'), 'utf8')) as SourceAliases;
const videoSample = JSON.parse(readFileSync(path.join(root, 'spec/sources/video-tags-available-30.json'), 'utf8')) as VideoSample;
const outDir = path.join(root, 'content/taxonomy');

const dynamicValues = new Map<string, Set<string>>();
for (const video of videoSample.videos) {
  for (const tag of video.tags) {
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
if (categories.length !== 7 || subcategoryCount !== 30) {
  throw new Error(`分類体系は7大分類・30小分類である必要があります（${categories.length}・${subcategoryCount}）`);
}

const tagLookup = new Map<string, string>();
for (const category of categories) {
  for (const subcategory of category.subcategories) {
    for (const tag of subcategory.tags) {
      tagLookup.set(`${category.categoryId}.${subcategory.subcategoryId}\0${tag.canonicalName}`, tag.tagId);
    }
  }
}

const aliases = sourceAliases.exactAliases.flatMap((entry) => {
  const id = tagLookup.get(`${entry.field}\0${entry.canonical}`);
  if (!id) return [];
  return entry.aliases.map((alias) => ({ alias, normalizedAlias: normalized(alias), tagId: id }));
});

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
  .map((entry) => ({ legacy: entry.legacy, reason: '明示30件のタグ体系に分解先がないため自動適用せず、人手確認する' }));
const reviewRequired = [...sourceAliases.reviewRequired, ...unresolvedDecompositions]
  .filter((entry, index, values) => values.findIndex((candidate) => candidate.legacy === entry.legacy) === index);

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'tag-taxonomy.json'), `${JSON.stringify({
  schemaVersion: '1.0.0',
  taxonomyVersion: '8.0.0',
  sourceVersion: source.schemaVersion,
  aliasVersion: '8.0.0',
  rulesVersion: '8.0.0',
  effectiveDate: '2026-08-03',
  categoryCount: categories.length,
  subcategoryCount,
  prohibitedCanonicalNames: ['', 'その他', '不明', '要確認', '未分類'],
  categories,
}, null, 2)}\n`);
writeFileSync(path.join(outDir, 'tag-aliases.json'), `${JSON.stringify({
  schemaVersion: '1.0.0',
  aliasVersion: '8.0.0',
  normalizationOrder: ['Unicode NFKC', '前後空白除去', '連続空白統合', '英字小文字化', '先頭の#除去'],
  aliases,
  decompositions,
  reviewRequired,
}, null, 2)}\n`);

console.log(`7大分類・30小分類・${tagLookup.size}タグを取り込みました。`);
