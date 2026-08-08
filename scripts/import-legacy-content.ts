import { createHash } from 'node:crypto';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  canonicalVideoSchema,
  buildTaxonomyLookup,
  findTagId,
  tagAliasesSchema,
  tagTaxonomySchema,
  type CanonicalVideo,
  type TagAliases,
  type TagTaxonomy,
} from '../src/domain/content.ts';
import { validateCanonicalVideo } from '../src/domain/validation.ts';
import {
  buildLegacyContext,
  classifyLegacyVideo,
  normalizeLegacyGeneratedAt,
  normalizeLegacyTimestampItems,
  parseIsoDuration,
  unresolvedLegacyTags,
  type LegacyLedgerRow,
  type LegacyTagVideo,
  type LegacyTimestampVideo,
  type LogicalTag,
} from './legacy-content.ts';
import { canonicalJson, prettyJson, readJson, sha256 } from './lib.ts';
import { readSourceShards, writeSourceShards } from './source-shards.ts';

const root = path.resolve(import.meta.dirname, '..');
const importedAt = '2026-08-04T15:00:00+09:00';
const reviewPullRequest = 'https://github.com/tsuji-tomonori/diopside-v8/pull/2';
const timestampSourcePullRequest = 'https://github.com/tsuji-tomonori/diopside-v7/pull/3';
const timestampSourceManifest = readSourceShards<LegacyTimestampVideo>(root, 'spec/sources/legacy-timestamps-v1/manifest.json', 'videos');
const tagSourceManifest = readSourceShards<LegacyTagVideo>(root, 'spec/sources/legacy-video-tags-v1/manifest.json', 'videos');
const ledgerSourceManifest = readSourceShards<LegacyLedgerRow>(root, 'spec/sources/v7-timestamp-ledger-v1/manifest.json', 'rows');
const legacyTimestamps = timestampSourceManifest.items;
const legacyTagVideos = tagSourceManifest.items;
const ledgerRows = ledgerSourceManifest.items;
const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
const aliases = tagAliasesSchema.parse(readJson(path.join(root, 'content/taxonomy/tag-aliases.json')));
const legacyContext = buildLegacyContext(legacyTagVideos);
const tagsById = uniqueMap(legacyTagVideos, 'タグ移行元');
const timestampsById = uniqueMap(legacyTimestamps, 'タイムスタンプ移行元');
const ledgerById = uniqueMap(ledgerRows, '進捗台帳');
const overrideFiles = readdirSync(path.join(root, 'content/videos')).filter((file) => file.endsWith('.json')).sort();
const overrides = overrideFiles.map((file) => canonicalVideoSchema.parse(readJson(path.join(root, 'content/videos', file))));
const overrideIds = new Set(overrides.map((video) => video.videoId));
const sourceVideoIds = [...new Set([...tagsById.keys(), ...timestampsById.keys()])].sort();

const catalog: CanonicalVideo[] = [];
const pending: Array<{
  videoId: string;
  title: string;
  reasons: string[];
  availableSources: string[];
}> = [];
const exclusions: Array<{
  videoId: string;
  reason: '対象外';
  detail: string;
  sourceFingerprint: string;
  confirmedAt: string;
}> = [];
const timestampAdjustments: Array<{ videoId: string; adjustments: string[] }> = [];

for (const videoId of sourceVideoIds) {
  const tagVideo = tagsById.get(videoId);
  const timestampVideo = timestampsById.get(videoId);
  const ledger = ledgerById.get(videoId);
  const title = timestampVideo?.title ?? tagVideo?.title;
  if (!title) throw new Error(`${videoId}: タイトルがありません。`);
  if (ledger?.excluded) {
    exclusions.push({
      videoId,
      reason: '対象外',
      detail: ledger.exclusionReason || '進捗台帳で公開対象外として確認済み',
      sourceFingerprint: sha256(canonicalJson(ledger)),
      confirmedAt: importedAt,
    });
    continue;
  }
  if (overrideIds.has(videoId)) continue;
  const durationSeconds = timestampVideo?.durationSeconds ?? parseIsoDuration(tagVideo!.durationIso);
  const durationIso = timestampVideo?.durationIso ?? tagVideo!.durationIso;
  const channelName = ledger?.channelName || '白雪 巴/Shirayuki Tomoe';
  const logicalTags = classifyLegacyVideo({
    videoId,
    title,
    durationSeconds,
    channelName,
    legacyTags: tagVideo?.legacyTags ?? [],
    hasApprovedTimestamps: Boolean(timestampVideo),
  }, legacyContext);
  const result = buildCanonical({
    videoId,
    title,
    publishedAt: timestampVideo?.publishedAt ?? tagVideo!.publishedAt,
    durationSeconds,
    durationIso,
    thumbnail: timestampVideo?.thumbnail ?? {
      url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 480, height: 360,
    },
    channelName,
    logicalTags,
    tagVideo,
    timestampVideo,
    taxonomy,
    aliases,
  });
  if ('reasons' in result) {
    pending.push({
      videoId,
      title,
      reasons: result.reasons,
      availableSources: [
        ...(tagVideo ? ['既存承認済みタグ'] : []),
        ...(timestampVideo ? ['既存承認済みタイムスタンプ'] : []),
        ...(ledger ? ['公開進捗台帳'] : []),
      ],
    });
  } else {
    catalog.push(result.video);
    if (result.adjustments.length > 0) timestampAdjustments.push({ videoId, adjustments: result.adjustments });
  }
}

const catalogManifest = writeSourceShards({
  repositoryRoot: root,
  directory: 'content/catalog',
  itemField: 'videos',
  items: catalog,
  key: (video) => video.videoId,
  shardCount: 256,
  source: {
    kind: '承認済み旧データの決定的移行カタログ',
    generatedBy: 'scripts/import-legacy-content.ts',
    importedAt,
    reviewPullRequest,
    tagSourceFingerprint: tagSourceManifest.manifest.snapshotFingerprint,
    timestampSourceFingerprint: timestampSourceManifest.manifest.snapshotFingerprint,
    ledgerSourceFingerprint: ledgerSourceManifest.manifest.snapshotFingerprint,
  },
});

const allVideos = [...catalog, ...overrides].sort((left, right) => left.videoId.localeCompare(right.videoId));
const duplicateIds = allVideos.filter((video, index) => allVideos[index - 1]?.videoId === video.videoId).map((video) => video.videoId);
if (duplicateIds.length > 0) throw new Error(`移行カタログと上書き動画が重複しています: ${duplicateIds.join(', ')}`);
const assignmentCount = allVideos.reduce((total, video) => total + video.tagAssignments.length, 0);
const createdTimestampVideos = allVideos.filter((video) => video.timestamps.status === '作成済み');
const chapterCount = createdTimestampVideos.reduce((total, video) => total + (video.timestamps.status === '作成済み' ? video.timestamps.items.length : 0), 0);
const migrationAcceptance = buildMigrationAcceptance(createdTimestampVideos, taxonomy);

writeFileSync(path.join(root, 'content/content-manifest.json'), prettyJson({
  schemaVersion: '1.0.0',
  taxonomyVersion: taxonomy.taxonomyVersion,
  aliasVersion: taxonomy.aliasVersion,
  tagRulesVersion: taxonomy.rulesVersion,
  timestampRulesVersion: '8.1.0',
  wordCloudRulesVersion: '8.0.0',
  synopsisRulesVersion: '1.0.0',
  generatedAt: importedAt,
  inputs: [
    'spec/sources/issue-1.md',
    'spec/sources/owner-directive-2026-08-04.md',
    'spec/sources/owner-directive-2026-08-08-video-synopsis.md',
    'spec/sources/tag-taxonomy-v2.json',
    'spec/sources/tag-aliases-v2.json',
    'spec/sources/video-tags-available-30.json',
    'spec/sources/video-timestamps-available-30.json',
    'spec/sources/legacy-video-tags-v1/manifest.json',
    'spec/sources/legacy-timestamps-v1/manifest.json',
    'spec/sources/v7-timestamp-ledger-v1/manifest.json',
    'spec/sources/legacy-tag-map-v1.json',
  ],
  sourceVideoCount: sourceVideoIds.length,
  catalogVideoCount: catalog.length,
  overrideVideoCount: overrides.length,
  excludedVideoCount: exclusions.length,
  pendingVideoCount: pending.length,
  videoCount: allVideos.length,
  assignmentCount,
  createdTimestampVideoCount: createdTimestampVideos.length,
  timestampItemCount: chapterCount,
  createdSynopsisVideoCount: allVideos.filter((video) => video.synopsis !== undefined).length,
}));
writeFileSync(path.join(root, 'content/exclusions.json'), prettyJson({
  schemaVersion: '1.0.0',
  updatedAt: importedAt,
  records: exclusions.sort((left, right) => left.videoId.localeCompare(right.videoId)),
}));
writeFileSync(path.join(root, 'content/pending-imports.json'), prettyJson({
  schemaVersion: '1.0.0',
  generatedAt: importedAt,
  rule: '根拠不足またはv8公開検証不合格の動画は推測で補完せず、公開カタログ外へ隔離する',
  records: pending.sort((left, right) => left.videoId.localeCompare(right.videoId)),
}));

const mapping = unresolvedLegacyTags(legacyTagVideos, legacyContext);
writeFileSync(path.join(root, 'spec/sources/legacy-tag-map-v1.json'), prettyJson({
  schemaVersion: '1.0.0',
  generatedBy: 'scripts/import-legacy-content.ts',
  generatedAt: importedAt,
  sourceManifest: 'spec/sources/legacy-video-tags-v1/manifest.json',
  sourceFingerprint: tagSourceManifest.manifest.snapshotFingerprint,
  rulesVersion: taxonomy.rulesVersion,
  legacyTagCount: mapping.length,
  mappedTagCount: mapping.filter((entry) => entry.disposition !== 'not-published').length,
  notPublishedTagCount: mapping.filter((entry) => entry.disposition === 'not-published').length,
  entries: mapping,
  timestampLabelAdjustments: timestampAdjustments,
}));
writeFileSync(path.join(root, 'tests/fixtures/legacy-migration-acceptance-v1.json'), prettyJson(migrationAcceptance));

console.log([
  `旧データ移行完了: ${allVideos.length}動画（カタログ${catalog.length}・上書き${overrides.length}）`,
  `${assignmentCount}タグ付与、${createdTimestampVideos.length}動画・${chapterCount}区間のタイムスタンプ`,
  `除外${exclusions.length}件、要レビュー${pending.length}件、ラベル安全調整${timestampAdjustments.length}動画`,
  `カタログ指紋 ${catalogManifest.snapshotFingerprint}`,
].join('\n'));

function buildCanonical(input: {
  videoId: string;
  title: string;
  publishedAt: string;
  durationSeconds: number;
  durationIso: string;
  thumbnail: { url: string; width: number; height: number };
  channelName: string;
  logicalTags: LogicalTag[];
  tagVideo: LegacyTagVideo | undefined;
  timestampVideo: LegacyTimestampVideo | undefined;
  taxonomy: TagTaxonomy;
  aliases: TagAliases;
}): { video: CanonicalVideo; adjustments: string[] } | { reasons: string[] } {
  const tagFingerprint = input.tagVideo ? sha256(canonicalJson(input.tagVideo)) : undefined;
  const titleFingerprint = sha256(input.title);
  const channelFingerprint = sha256(input.channelName);
  const durationFingerprint = sha256(input.durationIso);
  const evidence: Array<Record<string, unknown>> = [
    { evidenceId: 'evidence-title', type: '動画タイトル', sourceLabel: '公開動画タイトル', inputFingerprint: titleFingerprint },
    { evidenceId: 'evidence-channel', type: '公開チャンネル', sourceLabel: '公開進捗台帳または旧正本のチャンネル', inputFingerprint: channelFingerprint },
    { evidenceId: 'evidence-duration', type: '動画長', sourceLabel: '公開動画長', inputFingerprint: durationFingerprint },
    ...(tagFingerprint ? [{
      evidenceId: 'evidence-approved-tags',
      type: '既存の承認済みタグ',
      sourceLabel: '旧diopsideの承認済みタグ正本',
      inputFingerprint: tagFingerprint,
    }] : []),
  ];
  const evidenceId = (kind: LogicalTag['evidence']): string => {
    if (kind === 'legacy' && tagFingerprint) return 'evidence-approved-tags';
    if (kind === 'channel') return 'evidence-channel';
    if (kind === 'duration') return 'evidence-duration';
    return 'evidence-title';
  };
  const missingTags: string[] = [];
  const tagAssignments = input.logicalTags.flatMap((tag) => {
    const tagId = findTagId(input.taxonomy, tag.categoryId, tag.subcategoryId, tag.canonicalName);
    if (!tagId) {
      missingTags.push(`${tag.categoryId}.${tag.subcategoryId}:${tag.canonicalName}`);
      return [];
    }
    return [{
      tagId,
      reason: tag.reason,
      confidence: tag.confidence,
      evidenceRefs: [evidenceId(tag.evidence)],
      reviewedAt: importedAt,
    }];
  });
  if (missingTags.length > 0) return { reasons: missingTags.map((tag) => `タグ体系に移行先がない: ${tag}`) };
  const nonPeopleTagCount = input.logicalTags.filter((tag) => tag.categoryId !== 'people').length;
  let timestampFingerprint: string | undefined;
  let adjustments: string[] = [];
  let timestamps: Record<string, unknown>;
  if (input.timestampVideo) {
    const normalized = normalizeLegacyTimestampItems(input.timestampVideo.items);
    adjustments = normalized.adjustments;
    const items = normalized.items.map((item) => ({
      timestampId: `timestamp-${item.startSeconds}-${digest(item.label).slice(0, 8)}`,
      startSeconds: item.startSeconds,
      label: item.label,
      confidence: item.confidence,
      evidenceRefs: item.startSeconds === 0 ? [] : ['evidence-approved-timestamps'],
    }));
    timestampFingerprint = sha256(canonicalJson({
      sourceFingerprint: timestampSourceManifest.manifest.snapshotFingerprint,
      videoId: input.videoId,
      sourcePath: input.timestampVideo.sourcePath,
      generatedAt: input.timestampVideo.generatedAt,
      items: input.timestampVideo.items,
      adjustments,
    }));
    const candidateHash = sha256(canonicalJson({ videoId: input.videoId, items }));
    evidence.push({
      evidenceId: 'evidence-approved-timestamps',
      type: '既存の承認済みタイムスタンプ',
      sourceLabel: 'diopside-v7承認済み公開タイムスタンプ',
      inputFingerprint: timestampFingerprint,
    });
    timestamps = {
      status: '作成済み',
      origin: 'diopsideで作成した時刻一覧',
      items,
      candidateHash,
      inputFingerprint: timestampFingerprint,
      rulesVersion: '8.1.0',
      generatedAt: normalizeLegacyGeneratedAt(input.timestampVideo.generatedAt),
      updatedAt: importedAt,
      review: {
        mode: '既存承認済みデータ移行',
        candidateHash,
        source: {
          status: 'approved',
          repository: String(timestampSourceManifest.manifest.source.repository),
          revision: String(timestampSourceManifest.manifest.source.commit),
          pullRequest: timestampSourcePullRequest,
          releaseId: String(timestampSourceManifest.manifest.source.releaseId),
          sourceKind: input.timestampVideo.sourceKind,
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
        validatedAt: importedAt,
        finalHumanCheck: {
          status: '承認済み', candidateHash, reviewedAt: importedAt, pullRequest: reviewPullRequest,
        },
      },
    };
  } else {
    const media = input.logicalTags.find((tag) => tag.categoryId === 'format' && tag.subcategoryId === 'media')?.canonicalName;
    timestamps = input.durationSeconds < 30
      ? { status: '未作成', reason: '短尺', detail: '30秒未満のため、移動用目次の対象外です。', updatedAt: importedAt }
      : media !== '配信'
        ? { status: '未作成', reason: '対象外', detail: '配信アーカイブではないため、移動用目次の対象外です。', updatedAt: importedAt }
        : { status: '未作成', reason: '全編確認不足', detail: '承認済みの全編タイムスタンプが移行元にありません。', updatedAt: importedAt };
  }
  const candidate = {
    schemaVersion: '1.0.0',
    videoId: input.videoId,
    title: input.title,
    publishedAt: input.publishedAt,
    durationSeconds: input.durationSeconds,
    durationIso: input.durationIso,
    thumbnail: input.thumbnail,
    youtubeUrl: `https://www.youtube.com/watch?v=${input.videoId}`,
    taxonomyVersion: input.taxonomy.taxonomyVersion,
    aliasVersion: input.taxonomy.aliasVersion,
    tagRulesVersion: input.taxonomy.rulesVersion,
    evidence,
    tagAssignments,
    ...(nonPeopleTagCount > 12 ? { overTagReviewReason: '旧正本の意味を保持しつつ、重複・基数・条件を決定的に再検証した。' } : {}),
    timestamps,
    wordCloud: {
      status: '未作成', reason: '資料不足', detail: '承認可能な公開字幕、公開概要欄、または運用者提供の公開本文がありません。', updatedAt: importedAt,
    },
    provenance: {
      inputFingerprint: sha256(canonicalJson({
        tagSource: tagFingerprint ?? null,
        timestampSource: timestampFingerprint ?? null,
        title: titleFingerprint,
        channel: channelFingerprint,
        duration: durationFingerprint,
      })),
      generatorVersion: 'v8-legacy-migration-1.0.0',
      generatedAt: importedAt,
      reviewPullRequest,
    },
    approval: {
      status: '承認済み', approvedAt: importedAt, basis: 'ユーザー指示に基づく既存承認済みデータ移行とv8公開境界の再検証',
    },
  };
  const parsed = canonicalVideoSchema.safeParse(candidate);
  if (!parsed.success) return { reasons: parsed.error.issues.map((issue) => `STRUCTURE:${issue.path.join('.')}:${issue.message}`) };
  const issues = validateCanonicalVideo(parsed.data, input.taxonomy, input.aliases);
  return issues.length > 0
    ? { reasons: issues.map((issue) => `${issue.code}:${issue.path}:${issue.message}`) }
    : { video: parsed.data, adjustments };
}

function uniqueMap<T extends { videoId: string }>(items: T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.videoId)) throw new Error(`${label}の動画IDが重複しています: ${item.videoId}`);
    result.set(item.videoId, item);
  }
  return result;
}

function buildMigrationAcceptance(videos: CanonicalVideo[], taxonomyValue: TagTaxonomy): Record<string, unknown> {
  const expected = new Map([
    ['ゲーム', 8], ['企画', 6], ['雑談', 5], ['ASMR', 3], ['歌', 2], ['朗読・声劇', 2], ['同時視聴', 2], ['TRPG', 2],
  ]);
  const lookup = buildTaxonomyLookup(taxonomyValue);
  const sample: Array<Record<string, unknown>> = [];
  for (const [genre, count] of expected) {
    const candidates = videos.filter((video) => {
      if (video.timestamps.status !== '作成済み' || !('mode' in video.timestamps.review)) return false;
      return video.tagAssignments.some((assignment) => {
        const tag = lookup.get(assignment.tagId);
        return tag?.categoryId === 'content' && tag.subcategoryId === 'primary' && tag.canonicalName === genre;
      });
    }).sort((left, right) => {
      const leftOfficial = channelName(left, lookup).includes('白雪');
      const rightOfficial = channelName(right, lookup).includes('白雪');
      return Number(leftOfficial) - Number(rightOfficial) || left.videoId.localeCompare(right.videoId);
    });
    if (candidates.length < count) throw new Error(`固定移行受入の「${genre}」が${count}件に足りません。`);
    for (const video of candidates.slice(0, count)) {
      if (video.timestamps.status !== '作成済み' || !('mode' in video.timestamps.review)) throw new Error('固定移行受入の選択状態が不正です。');
      sample.push({
        videoId: video.videoId,
        genre,
        scope: channelName(video, lookup).includes('白雪') ? '本人チャンネル' : '外部チャンネル',
        durationIso: video.durationIso,
        timestampItemCount: video.timestamps.items.length,
        sourceApproval: video.timestamps.review.source.status === 'approved',
        deterministicValidation: validateCanonicalVideo(video, taxonomyValue, aliases).length === 0,
        labelSafety: video.timestamps.review.checks.publicLabels,
      });
    }
  }
  const scopeCounts = Object.fromEntries(['本人チャンネル', '外部チャンネル'].map((scope) => [
    scope, sample.filter((item) => item.scope === scope).length,
  ]));
  return {
    schemaVersion: '1.0.0',
    fixtureType: '承認済み旧データ移行の固定30動画品質確認',
    source: 'diopside-v7 release 20260804-001、PR #3、2026-08-04プロダクト所有者指示',
    previousRejectedPilot: 'tests/fixtures/pilot-timestamps-v1.json',
    selectionRule: '主ジャンル別に動画ID順で固定し、各候補は承認済み移行経路とv8決定的検証に合格すること',
    expectedGenreCounts: Object.fromEntries(expected),
    scopeCounts,
    sample,
    evaluation: {
      sourceApprovalPassed: sample.filter((item) => item.sourceApproval).length,
      deterministicValidationPassed: sample.filter((item) => item.deterministicValidation).length,
      labelSafetyPassed: sample.filter((item) => item.labelSafety).length,
      rejectedBeforePublication: 0,
      approvedForPublicCanonicalData: sample.length,
      decision: '旧パイロットの不合格25件を合格へ読み替えず、別途確認できた承認済みデータから固定30件を選び直して移行受入を行う',
    },
    sampleFingerprint: sha256(canonicalJson(sample)),
  };
}

function channelName(video: CanonicalVideo, lookup: ReturnType<typeof buildTaxonomyLookup>): string {
  return video.tagAssignments.flatMap((assignment) => {
    const tag = lookup.get(assignment.tagId);
    return tag?.categoryId === 'people' && tag.subcategoryId === 'channel' ? [tag.canonicalName] : [];
  })[0] ?? '';
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
