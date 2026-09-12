import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';

import { tagAliasesSchema, tagTaxonomySchema } from '../src/domain/content.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { canonicalJson, readJson } from './lib.ts';

const recordSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  changeType: z.enum(['初期導入', '保守変更']),
  previousTaxonomyVersion: z.string().nullable(),
  previousAliasVersion: z.string().nullable(),
  taxonomyVersion: z.string().min(1),
  aliasVersion: z.string().min(1),
  rulesVersion: z.string().min(1),
  affectedTagIds: z.array(z.string()),
  affectedVideoCount: z.number().int().nonnegative(),
  migration: z.string().min(10),
  reviewedAt: z.iso.datetime({ offset: true }),
}).strict();

// 比較元は現行schemaより前の版であるため、版間比較に必要な項目だけを読む。
// 現行schemaでparseすると、今回のような意図したschema変更そのものを比較できない。
const comparableTaxonomySchema = z.object({
  taxonomyVersion: z.string(),
  categories: z.array(z.object({
    subcategories: z.array(z.object({
      tags: z.array(z.object({ tagId: z.string() }).passthrough()),
    }).passthrough()),
  }).passthrough()),
}).passthrough();

const root = path.resolve(import.meta.dirname, '..');
const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
const aliases = tagAliasesSchema.parse(readJson(path.join(root, 'content/taxonomy/tag-aliases.json')));
const record = recordSchema.parse(readJson(path.join(root, 'content/taxonomy/change-record.json')));
const errors: string[] = [];

if (record.taxonomyVersion !== taxonomy.taxonomyVersion) errors.push('変更記録のタグ体系版が現行正本と一致しません。');
if (record.aliasVersion !== aliases.aliasVersion || record.aliasVersion !== taxonomy.aliasVersion) errors.push('変更記録の別名版が現行正本と一致しません。');
if (record.rulesVersion !== taxonomy.rulesVersion) errors.push('変更記録の生成規則版が現行正本と一致しません。');
for (const category of taxonomy.categories) {
  for (const subcategory of category.subcategories) {
    for (const tag of subcategory.tags) {
      if (!tag.inclusionCriteria.trim() || !tag.exclusionCriteria.trim()) errors.push(`${tag.tagId}: 包含基準と除外基準が必要です。`);
    }
  }
}

const base = argument('--base');
if (base) compareWithBase(base);

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`タグ体系変更管理合格: ${taxonomy.taxonomyVersion} / 別名 ${aliases.aliasVersion} / 影響${record.affectedVideoCount}動画`);
}

function compareWithBase(baseRef: string): void {
  const priorTaxonomyText = gitShow(baseRef, 'content/taxonomy/tag-taxonomy.json');
  const priorAliasesText = gitShow(baseRef, 'content/taxonomy/tag-aliases.json');
  if (!priorTaxonomyText || !priorAliasesText) {
    if (record.changeType !== '初期導入') errors.push('比較元にタグ体系がない変更は初期導入として記録してください。');
    return;
  }
  const priorTaxonomy = comparableTaxonomySchema.parse(JSON.parse(priorTaxonomyText));
  const priorAliases = tagAliasesSchema.parse(JSON.parse(priorAliasesText));
  const taxonomyChanged = canonicalJson(priorTaxonomy) !== canonicalJson(taxonomy);
  const aliasesChanged = canonicalJson(priorAliases) !== canonicalJson(aliases);
  if (!taxonomyChanged && !aliasesChanged) return;
  if (record.changeType !== '保守変更') errors.push('既存タグ体系の変更は保守変更として記録してください。');
  if (taxonomyChanged && priorTaxonomy.taxonomyVersion === taxonomy.taxonomyVersion) errors.push('タグ体系変更時はタグ体系版を更新してください。');
  if (aliasesChanged && priorAliases.aliasVersion === aliases.aliasVersion) errors.push('別名変更時は別名版を更新してください。');
  if (record.previousTaxonomyVersion !== priorTaxonomy.taxonomyVersion) errors.push('比較元のタグ体系版を変更記録へ残してください。');
  if (record.previousAliasVersion !== priorAliases.aliasVersion) errors.push('比較元の別名版を変更記録へ残してください。');

  const priorTags = new Map(priorTaxonomy.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags.map((tag) => [tag.tagId, tag] as const))));
  const nextTags = new Map(taxonomy.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags.map((tag) => [tag.tagId, tag] as const))));
  const changedIds = new Set([...priorTags.keys(), ...nextTags.keys()].filter((tagId) => canonicalJson(priorTags.get(tagId)) !== canonicalJson(nextTags.get(tagId))));
  const recordedIds = new Set(record.affectedTagIds);
  for (const tagId of changedIds) if (!recordedIds.has(tagId)) errors.push(`${tagId}: 影響タグ一覧にありません。`);
  const affectedVideos = readCanonicalVideos(root).filter((video) => (
    video.tagAssignments.some((assignment) => changedIds.has(assignment.tagId))
  )).length;
  if (record.affectedVideoCount !== affectedVideos) errors.push(`影響動画件数が一致しません（記録${record.affectedVideoCount}件、実際${affectedVideos}件）。`);
}

function gitShow(baseRef: string, file: string): string | null {
  try {
    return execFileSync('git', ['show', `${baseRef}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
