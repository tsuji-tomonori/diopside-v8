import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildTaxonomyLookup,
  latestReleaseSchema,
  publicAliasIndexSchema,
  publicIndexSchema,
  publicTagIndexSchema,
  publicVideoDetailSchema,
  publicVideoShardSchema,
  searchIndexSchema,
  tagAliasesSchema,
  tagTaxonomySchema,
  type CanonicalVideo,
  type PublicVideoDetail,
  type PublicVideoSummary,
  videoShardId,
} from '../src/domain/content.ts';
import { normalizeTitleForSearch } from '../src/domain/search.ts';
import { scanPublicBoundary, validateCanonicalVideo, validateTaxonomy } from '../src/domain/validation.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { canonicalJson, prettyJson, readJson, sha256 } from './lib.ts';

interface ContentManifest {
  generatedAt: string;
}

const root = path.resolve(import.meta.dirname, '..');
const publicDataDir = path.join(root, 'public/data');
const generatedSourceDir = path.join(root, 'src/generated');
const taxonomyInput = readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json'));
const aliasesInput = readJson(path.join(root, 'content/taxonomy/tag-aliases.json'));
const taxonomy = tagTaxonomySchema.parse(taxonomyInput);
const aliases = tagAliasesSchema.parse(aliasesInput);
const contentManifest = readJson(path.join(root, 'content/content-manifest.json')) as ContentManifest;

const taxonomyIssues = validateTaxonomy(taxonomyInput, aliasesInput);
if (taxonomyIssues.length > 0) throw new Error(taxonomyIssues.map((item) => `${item.code}:${item.path}:${item.message}`).join('\n'));

const videos = readCanonicalVideos(root);
for (const video of videos) {
  const issues = validateCanonicalVideo(video, taxonomy, aliases);
  if (issues.length > 0) throw new Error(`${video.videoId}\n${issues.map((item) => `${item.code}:${item.path}:${item.message}`).join('\n')}`);
}

const releaseSeed = {
  taxonomy,
  aliases,
  videos: videos.map(normalizeCanonicalVideo),
};
const releaseId = `release-${sha256(canonicalJson(releaseSeed)).slice(0, 16)}`;
const releaseDir = path.join(publicDataDir, 'releases', releaseId);
rmSync(publicDataDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
mkdirSync(generatedSourceDir, { recursive: true });

const summaries = videos
  .map(toSummary)
  .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime() || left.videoId.localeCompare(right.videoId));
const index = publicIndexSchema.parse({
  schemaVersion: '1.0.0',
  releaseId,
  updatedAt: contentManifest.generatedAt,
  videos: summaries,
});
const searchIndex = searchIndexSchema.parse({
  schemaVersion: '1.0.0',
  releaseId,
  normalizationVersion: '1.0.0',
  videos: summaries.map(({ videoId, normalizedTitle, publishedAt, durationSeconds, tagIds }) => ({
    videoId,
    normalizedTitle,
    publishedAt,
    durationSeconds,
    tagIds,
  })),
});

const tagToVideoIds = new Map<string, string[]>();
for (const video of videos) {
  for (const tagId of new Set(video.tagAssignments.map((assignment) => assignment.tagId))) {
    const values = tagToVideoIds.get(tagId) ?? [];
    values.push(video.videoId);
    tagToVideoIds.set(tagId, values);
  }
}
const tagIndex = publicTagIndexSchema.parse({
  schemaVersion: '1.0.0',
  releaseId,
  taxonomyVersion: taxonomy.taxonomyVersion,
  aliasVersion: taxonomy.aliasVersion,
  categories: taxonomy.categories.map((category) => ({
    categoryId: category.categoryId,
    name: category.name,
    order: category.order,
    subcategories: category.subcategories.map((subcategory) => ({
      subcategoryId: subcategory.subcategoryId,
      name: subcategory.name,
      order: subcategory.order,
      tags: subcategory.tags.filter((tag) => tag.active).map((tag) => {
        const videoIds = [...(tagToVideoIds.get(tag.tagId) ?? [])].sort();
        return { tagId: tag.tagId, canonicalName: tag.canonicalName, count: videoIds.length, videoIds };
      }),
    })),
  })),
});
const aliasIndex = publicAliasIndexSchema.parse({
  schemaVersion: '1.0.0',
  releaseId,
  aliasVersion: aliases.aliasVersion,
  aliases: Object.fromEntries(
    aliases.aliases
      .map((entry): [string, string] => [entry.normalizedAlias, entry.tagId])
      .sort(([left], [right]) => left.localeCompare(right)),
  ),
});

const outputFiles = new Map<string, unknown>([
  ['index.json', index],
  ['search-index.json', searchIndex],
  ['tag-index.json', tagIndex],
  ['alias-index.json', aliasIndex],
]);
const detailShards = new Map<string, Record<string, PublicVideoDetail>>();
for (const video of videos) {
  const detail = publicVideoDetailSchema.parse(toDetail(video, releaseId));
  const shardId = videoShardId(video.videoId);
  const shard = detailShards.get(shardId) ?? {};
  shard[video.videoId] = detail;
  detailShards.set(shardId, shard);
}
for (let index = 0; index < 256; index += 1) {
  const shardId = index.toString(16).padStart(2, '0');
  outputFiles.set(`video-shards/${shardId}.json`, publicVideoShardSchema.parse({
    schemaVersion: '1.0.0',
    releaseId,
    shardId,
    videos: Object.fromEntries(Object.entries(detailShards.get(shardId) ?? {}).sort(([left], [right]) => left.localeCompare(right))),
  }));
}

for (const [relativePath, value] of outputFiles) {
  const issues = scanPublicBoundary(value);
  if (issues.length > 0) throw new Error(`${relativePath}\n${issues.map((item) => `${item.code}:${item.path}`).join('\n')}`);
  const target = path.join(releaseDir, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, prettyJson(value));
}
const manifestFiles = [...outputFiles.keys()].sort().map((relativePath) => ({
  path: relativePath,
  sha256: sha256(prettyJson(outputFiles.get(relativePath))),
}));
const publicManifest = {
  schemaVersion: '1.0.0',
  releaseId,
  generatedAt: contentManifest.generatedAt,
  taxonomyVersion: taxonomy.taxonomyVersion,
  aliasVersion: aliases.aliasVersion,
  files: manifestFiles,
};
writeFileSync(path.join(releaseDir, 'manifest.json'), prettyJson(publicManifest));

const base = `data/releases/${releaseId}`;
const latest = latestReleaseSchema.parse({
  schemaVersion: '1.0.0',
  releaseId,
  updatedAt: contentManifest.generatedAt,
  indexPath: `${base}/index.json`,
  searchIndexPath: `${base}/search-index.json`,
  tagIndexPath: `${base}/tag-index.json`,
  aliasIndexPath: `${base}/alias-index.json`,
  manifestPath: `${base}/manifest.json`,
  videoShardCount: 256,
  videoShardPathTemplate: `${base}/video-shards/{shard}.json`,
});
writeFileSync(path.join(publicDataDir, 'latest.json'), prettyJson(latest));
writeFileSync(path.join(generatedSourceDir, 'release.ts'), `export const embeddedReleaseId = '${releaseId}' as const;\n`);
console.log(`公開版 ${releaseId} を生成しました（${videos.length}動画）。`);

function normalizeCanonicalVideo(video: CanonicalVideo): CanonicalVideo {
  return {
    ...video,
    evidence: [...video.evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    tagAssignments: [...video.tagAssignments].sort((left, right) => left.tagId.localeCompare(right.tagId)),
  };
}

function toSummary(video: CanonicalVideo): PublicVideoSummary {
  return {
    videoId: video.videoId,
    title: video.title,
    normalizedTitle: normalizeTitleForSearch(video.title),
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
    thumbnail: video.thumbnail,
    youtubeUrl: video.youtubeUrl,
    tagIds: [...new Set(video.tagAssignments.map((assignment) => assignment.tagId))].sort(),
  };
}

function toDetail(video: CanonicalVideo, currentReleaseId: string): PublicVideoDetail {
  const summary = toSummary(video);
  const timestamps = video.timestamps.status === '未作成'
    ? video.timestamps
    : {
        status: '作成済み' as const,
        origin: video.timestamps.origin,
        updatedAt: video.timestamps.updatedAt,
        items: video.timestamps.items.map((item, index) => ({
          timestampId: item.timestampId,
          startSeconds: item.startSeconds,
          endSeconds: video.timestamps.status === '作成済み'
            ? (video.timestamps.items[index + 1]?.startSeconds ?? video.durationSeconds ?? item.startSeconds + 1)
            : item.startSeconds + 1,
          label: item.label,
          confidence: item.confidence,
          youtubeUrl: `https://www.youtube.com/watch?v=${video.videoId}&t=${item.startSeconds}s`,
        })),
      };
  const wordCloud = video.wordCloud.status === '未作成'
    ? video.wordCloud
    : {
        status: '作成済み' as const,
        words: video.wordCloud.words,
        inputType: video.wordCloud.inputType,
        exclusionRulesVersion: video.wordCloud.exclusionRulesVersion,
        rulesVersion: video.wordCloud.rulesVersion,
        updatedAt: video.wordCloud.updatedAt,
      };
  const lookup = buildTaxonomyLookup(taxonomy);
  const tagDates = video.tagAssignments.map((assignment) => assignment.reviewedAt).sort();
  if (video.tagAssignments.some((assignment) => !lookup.has(assignment.tagId))) throw new Error(`${video.videoId}: 未知タグ`);
  return {
    ...summary,
    releaseId: currentReleaseId,
    taxonomyVersion: video.taxonomyVersion,
    tagsUpdatedAt: tagDates.at(-1) ?? contentManifest.generatedAt,
    synopsis: video.synopsis
      ? {
          body: video.synopsis.body,
          featuredQuote: {
            text: video.synopsis.featuredQuote.text,
            atSeconds: video.synopsis.featuredQuote.atSeconds,
            youtubeUrl: `https://www.youtube.com/watch?v=${video.videoId}&t=${video.synopsis.featuredQuote.atSeconds}s`,
          },
          updatedAt: video.synopsis.updatedAt,
        }
      : undefined,
    timestamps,
    wordCloud,
    provenance: {
      generatorVersion: video.provenance.generatorVersion,
      generatedAt: video.provenance.generatedAt,
      reviewPullRequest: video.provenance.reviewPullRequest,
    },
  };
}
