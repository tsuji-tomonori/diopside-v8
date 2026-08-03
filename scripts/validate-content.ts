import { readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import {
  canonicalVideoSchema,
  tagAliasesSchema,
  tagTaxonomySchema,
  type CanonicalVideo,
} from '../src/domain/content.ts';
import { validateCanonicalVideo, validateTaxonomy } from '../src/domain/validation.ts';
import { readJson } from './lib.ts';

const manifestSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  taxonomyVersion: z.string(),
  aliasVersion: z.string(),
  tagRulesVersion: z.string(),
  timestampRulesVersion: z.string(),
  wordCloudRulesVersion: z.string(),
  generatedAt: z.iso.datetime({ offset: true }),
  inputs: z.array(z.string()).min(1),
  videoCount: z.number().int().nonnegative(),
  assignmentCount: z.number().int().nonnegative(),
}).strict();

const root = path.resolve(import.meta.dirname, '..');
const taxonomyInput = readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json'));
const aliasesInput = readJson(path.join(root, 'content/taxonomy/tag-aliases.json'));
const taxonomy = tagTaxonomySchema.parse(taxonomyInput);
const aliases = tagAliasesSchema.parse(aliasesInput);
const manifest = manifestSchema.parse(readJson(path.join(root, 'content/content-manifest.json')));
const exclusions = readJson(path.join(root, 'content/exclusions.json')) as { records?: Array<{ videoId?: string }> };

const errors: string[] = validateTaxonomy(taxonomyInput, aliasesInput).map(formatIssue);
const videoFiles = readdirSync(path.join(root, 'content/videos'))
  .filter((file) => file.endsWith('.json'))
  .sort();
const videos: CanonicalVideo[] = [];
for (const file of videoFiles) {
  const input = readJson(path.join(root, 'content/videos', file));
  const parsed = canonicalVideoSchema.safeParse(input);
  if (!parsed.success) {
    errors.push(...parsed.error.issues.map((item) => `${file}:STRUCTURE:${item.path.join('.')}:${item.message}`));
    continue;
  }
  videos.push(parsed.data);
  errors.push(...validateCanonicalVideo(input, taxonomy, aliases).map((item) => `${file}:${formatIssue(item)}`));
}

const uniqueVideoIds = new Set(videos.map((video) => video.videoId));
if (uniqueVideoIds.size !== videos.length) errors.push('content/videos:VIDEO_ID_DUPLICATED:動画識別子が重複しています。');
if (manifest.videoCount !== videos.length) errors.push(`content-manifest:VIDEO_COUNT:${manifest.videoCount} != ${videos.length}`);
const assignmentCount = videos.reduce((total, video) => total + video.tagAssignments.length, 0);
if (manifest.assignmentCount !== assignmentCount) errors.push(`content-manifest:ASSIGNMENT_COUNT:${manifest.assignmentCount} != ${assignmentCount}`);
if (manifest.taxonomyVersion !== taxonomy.taxonomyVersion) errors.push('content-manifest:TAXONOMY_VERSION:タグ体系版が一致しません。');
if (manifest.aliasVersion !== aliases.aliasVersion) errors.push('content-manifest:ALIAS_VERSION:別名版が一致しません。');
if (manifest.tagRulesVersion !== taxonomy.rulesVersion) errors.push('content-manifest:RULES_VERSION:規則版が一致しません。');
for (const record of exclusions.records ?? []) {
  if (record.videoId && uniqueVideoIds.has(record.videoId)) errors.push(`content/exclusions.json:EXCLUDED_VIDEO_PUBLISHED:${record.videoId}`);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`正本検証合格: ${videos.length}動画・${assignmentCount}タグ付与・7大分類・30小分類`);
}

function formatIssue(item: { code: string; path: string; message: string }): string {
  return `${item.code}:${item.path}:${item.message}`;
}
