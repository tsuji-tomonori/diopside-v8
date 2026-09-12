import path from 'node:path';
import { z } from 'zod';

import {
  channelPersonMappingsSchema,
  collaborationProfilesSchema,
  gameCatalogSchema,
  songPerformanceCatalogSchema,
  tagAliasesSchema,
  tagTaxonomySchema,
  videoExclusionsSchema,
  workIntroductionsSchema,
} from '../src/domain/content.ts';
import { findParallelGamePerspectives } from '../src/domain/parallel-game-perspectives.ts';
import {
  validateCanonicalVideo,
  validateChannelPersonMappings,
  validateGameCatalog,
  validateSongPerformanceCatalog,
  validateTaxonomy,
} from '../src/domain/validation.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { canonicalJson, readJson, sha256 } from './lib.ts';

const manifestSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  taxonomyVersion: z.string(),
  aliasVersion: z.string(),
  tagRulesVersion: z.string(),
  timestampRulesVersion: z.string(),
  wordCloudRulesVersion: z.string(),
  synopsisRulesVersion: z.string(),
  generatedAt: z.iso.datetime({ offset: true }),
  inputs: z.array(z.string()).min(1),
  sourceVideoCount: z.number().int().nonnegative(),
  catalogVideoCount: z.number().int().nonnegative(),
  overrideVideoCount: z.number().int().nonnegative(),
  excludedVideoCount: z.number().int().nonnegative(),
  pendingVideoCount: z.number().int().nonnegative(),
  videoCount: z.number().int().nonnegative(),
  assignmentCount: z.number().int().nonnegative(),
  createdTimestampVideoCount: z.number().int().nonnegative(),
  timestampItemCount: z.number().int().nonnegative(),
  createdSynopsisVideoCount: z.number().int().nonnegative(),
  customEmojiUsageVideoCount: z.number().int().nonnegative(),
}).strict();

const root = path.resolve(import.meta.dirname, '..');
const taxonomyInput = readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json'));
const aliasesInput = readJson(path.join(root, 'content/taxonomy/tag-aliases.json'));
const collaborationProfilesInput = readJson(path.join(root, 'content/people/collaboration-profiles.json'));
const channelPersonMappingsInput = readJson(path.join(root, 'content/people/channel-person-mappings.json'));
const songPerformancesInput = readJson(path.join(root, 'content/songs/song-performances.json'));
const gameCatalogInput = readJson(path.join(root, 'content/works/game-catalog.json'));
const workIntroductionsInput = readJson(path.join(root, 'content/works/work-introductions.json'));
const taxonomy = tagTaxonomySchema.parse(taxonomyInput);
const aliases = tagAliasesSchema.parse(aliasesInput);
const collaborationProfiles = collaborationProfilesSchema.parse(collaborationProfilesInput);
const channelPersonMappings = channelPersonMappingsSchema.parse(channelPersonMappingsInput);
const songPerformances = songPerformanceCatalogSchema.parse(songPerformancesInput);
const gameCatalog = gameCatalogSchema.parse(gameCatalogInput);
const workIntroductions = workIntroductionsSchema.parse(workIntroductionsInput);
const manifest = manifestSchema.parse(readJson(path.join(root, 'content/content-manifest.json')));
const exclusions = videoExclusionsSchema.parse(readJson(path.join(root, 'content/exclusions.json')));

const errors: string[] = validateTaxonomy(taxonomyInput, aliasesInput).map(formatIssue);
const videos = readCanonicalVideos(root);
const videosIncludingExcluded = readCanonicalVideos(root, { includeExcluded: true });
for (const video of videos) errors.push(...validateCanonicalVideo(video, taxonomy, aliases).map((item) => `${video.videoId}.json:${formatIssue(item)}`));
errors.push(...validateChannelPersonMappings(videos, taxonomy, channelPersonMappings, collaborationProfiles.subjectPersonTagId).map(formatIssue));
errors.push(...validateSongPerformanceCatalog(songPerformancesInput, videos, taxonomy).map(formatIssue));
errors.push(...validateGameCatalog(gameCatalogInput, taxonomy, workIntroductions, videos).map(formatIssue));
for (const finding of findParallelGamePerspectives(
  videos,
  taxonomy,
  channelPersonMappings,
  collaborationProfiles.subjectPersonTagId,
  gameCatalog,
)) {
  errors.push(`content/videos:PARALLEL_GAME_PERSPECTIVE:${finding.videoId} は ${finding.preferredVideoId} と同一ゲームを同時配信しています。`);
}

const uniqueVideoIds = new Set(videos.map((video) => video.videoId));
if (uniqueVideoIds.size !== videos.length) errors.push('content/videos:VIDEO_ID_DUPLICATED:動画識別子が重複しています。');
if (manifest.videoCount !== videos.length) errors.push(`content-manifest:VIDEO_COUNT:${manifest.videoCount} != ${videos.length}`);
if (manifest.excludedVideoCount !== exclusions.records.length) errors.push(`content-manifest:EXCLUDED_VIDEO_COUNT:${manifest.excludedVideoCount} != ${exclusions.records.length}`);
const assignmentCount = videos.reduce((total, video) => total + video.tagAssignments.length, 0);
if (manifest.assignmentCount !== assignmentCount) errors.push(`content-manifest:ASSIGNMENT_COUNT:${manifest.assignmentCount} != ${assignmentCount}`);
if (manifest.catalogVideoCount + manifest.overrideVideoCount !== manifest.videoCount) errors.push('content-manifest:CATALOG_COUNT:カタログと上書きの件数が総動画数と一致しません。');
const createdTimestampVideos = videos.filter((video) => video.timestamps.status === '作成済み');
if (manifest.createdTimestampVideoCount !== createdTimestampVideos.length) errors.push('content-manifest:TIMESTAMP_VIDEO_COUNT:作成済みタイムスタンプ動画数が一致しません。');
const timestampItemCount = createdTimestampVideos.reduce((total, video) => total + (video.timestamps.status === '作成済み' ? video.timestamps.items.length : 0), 0);
if (manifest.timestampItemCount !== timestampItemCount) errors.push('content-manifest:TIMESTAMP_ITEM_COUNT:タイムスタンプ区間数が一致しません。');
const createdSynopsisVideoCount = videos.filter((video) => video.synopsis !== undefined).length;
if (manifest.createdSynopsisVideoCount !== createdSynopsisVideoCount) errors.push('content-manifest:SYNOPSIS_VIDEO_COUNT:作成済みあらすじ動画数が一致しません。');
const customEmojiUsageVideoCount = videos.filter((video) => video.customEmojiUsage !== undefined).length;
if (manifest.customEmojiUsageVideoCount !== customEmojiUsageVideoCount) errors.push('content-manifest:CUSTOM_EMOJI_USAGE_VIDEO_COUNT:カスタム絵文字集計済み動画数が一致しません。');
if (manifest.taxonomyVersion !== taxonomy.taxonomyVersion) errors.push('content-manifest:TAXONOMY_VERSION:タグ体系版が一致しません。');
if (manifest.aliasVersion !== aliases.aliasVersion) errors.push('content-manifest:ALIAS_VERSION:別名版が一致しません。');
if (manifest.tagRulesVersion !== taxonomy.rulesVersion) errors.push('content-manifest:RULES_VERSION:規則版が一致しません。');
const exclusionIds = new Set<string>();
const rawVideoIds = new Set(videosIncludingExcluded.map((video) => video.videoId));
const parallelFindings = findParallelGamePerspectives(
  videosIncludingExcluded,
  taxonomy,
  channelPersonMappings,
  collaborationProfiles.subjectPersonTagId,
  gameCatalog,
);
const parallelFindingByVideoId = new Map(parallelFindings.map((finding) => [finding.videoId, finding]));
const exclusionByVideoId = new Map(exclusions.records.map((record) => [record.videoId, record]));
for (const record of exclusions.records) {
  if (exclusionIds.has(record.videoId)) errors.push(`content/exclusions.json:EXCLUDED_VIDEO_DUPLICATED:${record.videoId}`);
  exclusionIds.add(record.videoId);
  if (uniqueVideoIds.has(record.videoId)) errors.push(`content/exclusions.json:EXCLUDED_VIDEO_PUBLISHED:${record.videoId}`);
  if (record.ruleId === 'V8-SAFETY-005') {
    if (record.reason !== '対象外' || !record.preferredVideoId) {
      errors.push(`content/exclusions.json:PARALLEL_GAME_PERSPECTIVE_TRACE:${record.videoId}`);
    } else if (!uniqueVideoIds.has(record.preferredVideoId)) {
      errors.push(`content/exclusions.json:PREFERRED_VIDEO_UNKNOWN:${record.videoId}:${record.preferredVideoId}`);
    }
    const finding = parallelFindingByVideoId.get(record.videoId);
    if (!rawVideoIds.has(record.videoId) || !finding) {
      errors.push(`content/exclusions.json:PARALLEL_GAME_PERSPECTIVE_SOURCE_UNKNOWN:${record.videoId}`);
    } else {
      if (record.preferredVideoId !== finding.preferredVideoId) {
        errors.push(`content/exclusions.json:PREFERRED_VIDEO_MISMATCH:${record.videoId}:${record.preferredVideoId}:${finding.preferredVideoId}`);
      }
      if (record.sourceFingerprint !== sha256(canonicalJson(finding))) {
        errors.push(`content/exclusions.json:PARALLEL_GAME_PERSPECTIVE_FINGERPRINT:${record.videoId}`);
      }
    }
  } else if (record.preferredVideoId) {
    errors.push(`content/exclusions.json:PREFERRED_VIDEO_WITHOUT_RULE:${record.videoId}`);
  }
}
for (const finding of parallelFindings) {
  if (exclusionByVideoId.get(finding.videoId)?.ruleId !== 'V8-SAFETY-005') {
    errors.push(`content/exclusions.json:PARALLEL_GAME_PERSPECTIVE_EXCLUSION_MISSING:${finding.videoId}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  const appearanceCount = songPerformances.songs.reduce((total, song) => total + song.appearances.length, 0);
  console.log(`正本検証合格: ${videos.length}動画・${assignmentCount}タグ付与・${gameCatalog.games.length}ゲーム・${songPerformances.songs.length}楽曲・${appearanceCount}歌唱実績・7大分類・28小分類`);
}

function formatIssue(item: { code: string; path: string; message: string }): string {
  return `${item.code}:${item.path}:${item.message}`;
}
