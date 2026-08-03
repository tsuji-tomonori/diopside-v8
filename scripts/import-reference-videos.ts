import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { findTagId, tagTaxonomySchema, type TagTaxonomy } from '../src/domain/content.ts';

interface SampleTag {
  categoryId: string;
  subcategoryId: string;
  canonicalName: string;
  reason: string;
  evidenceType: '公開チャンネル' | '動画長' | '動画タイトル';
  confidence: '高' | '中';
}

interface SampleVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  channelTitle: string;
  duration: string;
  tags: SampleTag[];
}

interface VideoSample {
  schemaVersion: string;
  source: string;
  videos: SampleVideo[];
}

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'spec/sources/video-tags-sample.json');
const taxonomyPath = path.join(root, 'content/taxonomy/tag-taxonomy.json');
const outDir = path.join(root, 'content/videos');
const reviewedAt = '2026-08-03T00:00:00+09:00';

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

function evidenceId(type: SampleTag['evidenceType']): string {
  if (type === '動画タイトル') return 'evidence-video-title';
  if (type === '動画長') return 'evidence-duration';
  return 'evidence-channel';
}

function evidenceSource(video: SampleVideo, type: SampleTag['evidenceType']): string {
  if (type === '動画タイトル') return video.title;
  if (type === '動画長') return video.duration;
  return video.channelTitle;
}

const sample = JSON.parse(readFileSync(sourcePath, 'utf8')) as VideoSample;
const taxonomy = tagTaxonomySchema.parse(JSON.parse(readFileSync(taxonomyPath, 'utf8'))) as TagTaxonomy;
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let assignmentCount = 0;
for (const video of sample.videos) {
  const types = [...new Set(video.tags.map((tag) => tag.evidenceType))];
  const evidence = types.map((type) => {
    const source = evidenceSource(video, type);
    return {
      evidenceId: evidenceId(type),
      type,
      sourceLabel: type === '動画タイトル' ? '公開動画タイトル' : type === '動画長' ? '公開動画長' : '公開チャンネル名',
      inputFingerprint: digest(source),
    };
  });
  const tagAssignments = video.tags.map((tag) => {
    const id = findTagId(taxonomy, tag.categoryId, tag.subcategoryId, tag.canonicalName);
    if (!id) {
      throw new Error(`${video.videoId}: 未登録タグ ${tag.categoryId}.${tag.subcategoryId}=${tag.canonicalName}`);
    }
    return {
      tagId: id,
      reason: `${tag.reason}（判定タグ: ${tag.canonicalName}）`,
      confidence: tag.confidence,
      evidenceRefs: [evidenceId(tag.evidenceType)],
      reviewedAt,
    };
  });
  assignmentCount += tagAssignments.length;
  const durationSeconds = parseDuration(video.duration);
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
    timestamps: {
      status: '未作成',
      reason: durationSeconds < 30 ? '短尺' : '全編確認不足',
      detail: durationSeconds < 30
        ? '30秒未満のため、移動用目次の対象外です。'
        : '作成者の時刻一覧または動画全編を覆う根拠を確認できていません。',
      updatedAt: reviewedAt,
    },
    wordCloud: {
      status: '未作成',
      reason: '資料不足',
      detail: '承認可能な公開字幕、公開概要欄、または運用者提供の公開本文がありません。',
      updatedAt: reviewedAt,
    },
    provenance: {
      inputFingerprint: digest({
        videoId: video.videoId,
        title: video.title,
        publishedAt: video.publishedAt,
        duration: video.duration,
        tagIds: tagAssignments.map((tag) => tag.tagId).sort(),
      }),
      generatorVersion: 'v8-initial-migration-1.0.0',
      generatedAt: reviewedAt,
      reviewPullRequest: 'Issue #1を参照する初期実装プルリクエスト',
    },
    approval: {
      status: '承認済み',
      approvedAt: reviewedAt,
      basis: '受領したv7タグ監査スナップショットから公開禁止情報を除外して移行',
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
    'spec/sources/video-tags-sample.json',
  ],
  videoCount: sample.videos.length,
  assignmentCount,
}, null, 2)}\n`);
writeFileSync(path.join(root, 'content/exclusions.json'), `${JSON.stringify({
  schemaVersion: '1.0.0',
  updatedAt: reviewedAt,
  records: [],
}, null, 2)}\n`);

console.log(`${sample.videos.length}動画・${assignmentCount}タグ付与をv8正本へ移行しました。`);
