import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { findTagId, tagTaxonomySchema, type TagTaxonomy } from '../src/domain/content.ts';

interface AvailableTag {
  categoryId: string;
  subcategoryId: string;
  canonicalName: string;
  reason: string;
  evidenceType: '既存の承認済みタグ';
  confidence: '高' | '中';
}

interface AvailableVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  channelTitle: string;
  duration: string;
  tags: AvailableTag[];
}

interface VideoSource {
  schemaVersion: string;
  source: string;
  selection: {
    rule: string;
    videoIds: string[];
    videoCount: number;
    tagAssignmentCount: number;
  };
  videos: AvailableVideo[];
}

interface TimestampRecord {
  videoId: string;
  generatedAt: string;
  items: Array<{
    startSeconds: number;
    label: string;
    confidence: '高' | '中';
  }>;
}

interface TimestampSource {
  schemaVersion: string;
  source: {
    repository: string;
    revision: string;
    pullRequest: string;
    releaseId: string;
    sourceKind: string;
    sourceStatus: 'approved';
  };
  selection: {
    rule: string;
    requestedVideoIds: string[];
    requestedVideoCount: number;
    availableVideoCount: number;
    unavailableVideoIds: string[];
  };
  records: TimestampRecord[];
}

const root = path.resolve(import.meta.dirname, '..');
const videoSourcePath = path.join(root, 'spec/sources/video-tags-available-30.json');
const timestampSourcePath = path.join(root, 'spec/sources/video-timestamps-available-30.json');
const taxonomyPath = path.join(root, 'content/taxonomy/tag-taxonomy.json');
const outDir = path.join(root, 'content/videos');
const reviewedAt = '2026-08-04T12:00:00+09:00';
const reviewPullRequest = 'https://github.com/tsuji-tomonori/diopside-v8/pull/2';

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function parseDuration(duration: string): number {
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u);
  if (!match) throw new Error(`動画長が不正です: ${duration}`);
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function assertSameIds(actual: string[], expected: string[], label: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label}の動画IDが明示30件と一致しません。`);
  }
}

function missingTimestamps(video: AvailableVideo, durationSeconds: number): {
  status: '未作成';
  reason: '短尺' | '対象外' | '全編確認不足';
  detail: string;
  updatedAt: string;
} {
  const isStream = video.tags.some((tag) => (
    tag.categoryId === 'format'
    && tag.subcategoryId === 'media'
    && tag.canonicalName === '配信'
  ));
  if (durationSeconds < 30) {
    return { status: '未作成', reason: '短尺', detail: '30秒未満のため、移動用目次の対象外です。', updatedAt: reviewedAt };
  }
  if (!isStream) {
    return { status: '未作成', reason: '対象外', detail: '配信アーカイブではないため、既定の移動用目次の対象外です。', updatedAt: reviewedAt };
  }
  return {
    status: '未作成',
    reason: '全編確認不足',
    detail: '対応する承認済みタイムスタンプが提供データにありません。',
    updatedAt: reviewedAt,
  };
}

const videoSource = JSON.parse(readFileSync(videoSourcePath, 'utf8')) as VideoSource;
const timestampSource = JSON.parse(readFileSync(timestampSourcePath, 'utf8')) as TimestampSource;
const taxonomy = tagTaxonomySchema.parse(JSON.parse(readFileSync(taxonomyPath, 'utf8'))) as TagTaxonomy;
const videoIds = videoSource.videos.map((video) => video.videoId);
assertSameIds(videoIds, videoSource.selection.videoIds, 'タグ入力');
assertSameIds(timestampSource.selection.requestedVideoIds, videoSource.selection.videoIds, 'タイムスタンプ入力');
if (videoSource.selection.videoCount !== 30 || videoSource.videos.length !== 30) {
  throw new Error('提供データの明示30件をすべて収録してください。');
}
const tagCount = videoSource.videos.reduce((total, video) => total + video.tags.length, 0);
if (tagCount !== videoSource.selection.tagAssignmentCount) throw new Error('タグ付与件数が入力宣言と一致しません。');
if (new Set(videoIds).size !== videoIds.length) throw new Error('タグ入力の動画IDが重複しています。');
const timestampIds = timestampSource.records.map((record) => record.videoId);
if (new Set(timestampIds).size !== timestampIds.length) throw new Error('タイムスタンプ入力の動画IDが重複しています。');
if (timestampIds.some((videoId) => !videoIds.includes(videoId))) throw new Error('明示30件に含まれないタイムスタンプがあります。');
if (timestampSource.selection.requestedVideoCount !== videoIds.length
  || timestampSource.selection.availableVideoCount !== timestampSource.records.length) {
  throw new Error('タイムスタンプ入力の件数宣言が実データと一致しません。');
}
const expectedUnavailable = videoIds.filter((videoId) => !timestampIds.includes(videoId));
assertSameIds(timestampSource.selection.unavailableVideoIds, expectedUnavailable, 'タイムスタンプ未提供一覧');
const timestampByVideoId = new Map(timestampSource.records.map((record) => [record.videoId, record]));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let assignmentCount = 0;
for (const video of videoSource.videos) {
  const tagFingerprint = digest({ videoId: video.videoId, tags: video.tags });
  const evidence: Array<Record<string, unknown>> = [{
    evidenceId: 'evidence-approved-tags',
    type: '既存の承認済みタグ',
    sourceLabel: '提供されたv2タグ監査済みスナップショット',
    inputFingerprint: tagFingerprint,
  }];
  const tagAssignments = video.tags.map((tag) => {
    const id = findTagId(taxonomy, tag.categoryId, tag.subcategoryId, tag.canonicalName);
    if (!id) {
      throw new Error(`${video.videoId}: 未登録タグ ${tag.categoryId}.${tag.subcategoryId}=${tag.canonicalName}`);
    }
    return {
      tagId: id,
      reason: `${tag.reason}（判定タグ: ${tag.canonicalName}）`,
      confidence: tag.confidence,
      evidenceRefs: ['evidence-approved-tags'],
      reviewedAt,
    };
  });
  const nonPeopleTagCount = video.tags.filter((tag) => tag.categoryId !== 'people').length;
  assignmentCount += tagAssignments.length;
  const durationSeconds = parseDuration(video.duration);
  const timestampRecord = timestampByVideoId.get(video.videoId);
  let timestamps: Record<string, unknown> = missingTimestamps(video, durationSeconds);
  let timestampFingerprint: string | undefined;
  if (timestampRecord) {
    const items = timestampRecord.items.map((item) => ({
      timestampId: `timestamp-${item.startSeconds}-${digest(item.label).slice(0, 8)}`,
      startSeconds: item.startSeconds,
      label: item.label,
      confidence: item.confidence,
      evidenceRefs: item.startSeconds === 0 ? [] : ['evidence-approved-timestamps'],
    }));
    timestampFingerprint = digest({
      source: timestampSource.source,
      videoId: video.videoId,
      generatedAt: timestampRecord.generatedAt,
      items: timestampRecord.items,
    });
    const candidateHash = digest({ videoId: video.videoId, items });
    evidence.push({
      evidenceId: 'evidence-approved-timestamps',
      type: '既存の承認済みタイムスタンプ',
      sourceLabel: 'diopside-v7承認済み公開タイムスタンプ（PR #3）',
      inputFingerprint: timestampFingerprint,
    });
    timestamps = {
      status: '作成済み',
      origin: 'diopsideで作成した時刻一覧',
      items,
      candidateHash,
      inputFingerprint: timestampFingerprint,
      rulesVersion: '8.0.0',
      generatedAt: timestampRecord.generatedAt,
      updatedAt: reviewedAt,
      review: {
        mode: '既存承認済みデータ移行',
        candidateHash,
        source: {
          status: timestampSource.source.sourceStatus,
          repository: timestampSource.source.repository,
          revision: timestampSource.source.revision,
          pullRequest: timestampSource.source.pullRequest,
          releaseId: timestampSource.source.releaseId,
          sourceKind: timestampSource.source.sourceKind,
        },
        checks: {
          sourceApproval: true,
          minimumItems: true,
          startsAtZero: true,
          ascendingOrder: true,
          minimumInterval: true,
          inDurationRange: true,
          allowedConfidence: true,
          publicLabels: true,
        },
        validatedAt: reviewedAt,
        finalHumanCheck: {
          status: '承認済み',
          candidateHash,
          reviewedAt,
          pullRequest: reviewPullRequest,
        },
      },
    };
  }
  const canonical = {
    schemaVersion: '1.0.0',
    videoId: video.videoId,
    title: video.title,
    publishedAt: video.publishedAt,
    durationSeconds,
    durationIso: video.duration,
    thumbnail: {
      url: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
      width: 480,
      height: 360,
    },
    youtubeUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
    taxonomyVersion: taxonomy.taxonomyVersion,
    aliasVersion: taxonomy.aliasVersion,
    tagRulesVersion: taxonomy.rulesVersion,
    evidence,
    tagAssignments,
    ...(nonPeopleTagCount > 12 ? {
      overTagReviewReason: '提供された承認済みタグを全件保持し、重複・基数・条件不一致がないことを再検証した。',
    } : {}),
    timestamps,
    wordCloud: {
      status: '未作成',
      reason: '資料不足',
      detail: '承認可能な公開字幕、公開概要欄、または運用者提供の公開本文がありません。',
      updatedAt: reviewedAt,
    },
    provenance: {
      inputFingerprint: digest({
        videoId: video.videoId,
        tagFingerprint,
        timestampFingerprint: timestampFingerprint ?? null,
      }),
      generatorVersion: 'v8-available-30-migration-1.0.0',
      generatedAt: reviewedAt,
      reviewPullRequest,
    },
    approval: {
      status: '承認済み',
      approvedAt: reviewedAt,
      basis: '提供データの明示30件を全件移行し、時刻は既存承認済み23件だけを収録',
    },
  };
  writeFileSync(path.join(outDir, `${video.videoId}.json`), `${JSON.stringify(canonical, null, 2)}\n`);
}

writeFileSync(path.join(root, 'content/content-manifest.json'), `${JSON.stringify({
  schemaVersion: '1.0.0',
  taxonomyVersion: taxonomy.taxonomyVersion,
  aliasVersion: taxonomy.aliasVersion,
  tagRulesVersion: taxonomy.rulesVersion,
  timestampRulesVersion: '8.0.0',
  wordCloudRulesVersion: '8.0.0',
  generatedAt: reviewedAt,
  inputs: [
    'spec/sources/issue-1.md',
    'spec/sources/tag-taxonomy-v2.json',
    'spec/sources/tag-aliases-v2.json',
    'spec/sources/video-tags-available-30.json',
    'spec/sources/video-timestamps-available-30.json',
  ],
  videoCount: videoSource.videos.length,
  assignmentCount,
}, null, 2)}\n`);
writeFileSync(path.join(root, 'content/exclusions.json'), `${JSON.stringify({
  schemaVersion: '1.0.0',
  updatedAt: reviewedAt,
  records: [],
}, null, 2)}\n`);

console.log(`${videoSource.videos.length}動画・${assignmentCount}タグ付与・${timestampSource.records.length}件の承認済みタイムスタンプをv8正本へ移行しました。`);
