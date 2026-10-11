import { z } from 'zod';

import type { CanonicalVideo } from '../src/domain/content.ts';
import { canonicalJson, sha256 } from './lib.ts';

export const enrichmentFeatures = ['timestamps', 'synopsis', 'tags', 'wordCloud', 'customEmojiUsage', 'customEmojiTimeline', 'transcript', 'hybridSearch'] as const;
export type EnrichmentFeature = typeof enrichmentFeatures[number];
export type CoverageStatus = 'present' | 'missing' | 'not-applicable' | 'unmeasured';
export interface FeatureCoverage {
  status: CoverageStatus;
  reason: string;
  evidenceRefs: string[];
}

// Safe, operator-provided snapshot of active work; this is not a claim or a lock.
export const enrichmentClaimsSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  checkedAt: z.iso.datetime({ offset: true }),
  // Optional for legacy snapshots; readiness fails closed unless both are present.
  corpusFingerprint: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  complete: z.boolean().optional(),
  unresolvedPullRequests: z.array(z.string().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9]\d*$/u)).optional(),
  claims: z.array(z.object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
    features: z.array(z.enum(enrichmentFeatures)).min(1),
    state: z.enum(['in-progress', 'blocked', 'awaiting-review']).optional(),
    updatedAt: z.iso.datetime({ offset: true }).optional(),
    pullRequest: z.string().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9]\d*$/u),
  }).strict()),
}).strict();
export type EnrichmentClaims = z.infer<typeof enrichmentClaimsSchema>;

export function videoFeatureCoverage(video: CanonicalVideo): Record<EnrichmentFeature, FeatureCoverage> {
  const present = (reason: string, evidenceRefs: string[] = []): FeatureCoverage => ({ status: 'present', reason, evidenceRefs: [...new Set(evidenceRefs)].sort() });
  const missing = (reason: string, notApplicable = false): FeatureCoverage => ({ status: notApplicable ? 'not-applicable' : 'missing', reason, evidenceRefs: [] });
  const emoji = video.customEmojiUsage;
  return {
    timestamps: video.timestamps.status === '作成済み'
      ? present('正本に時刻一覧と確認記録あり', video.timestamps.items.flatMap((item) => item.evidenceRefs))
      : missing(video.timestamps.reason, ['対象外', '短尺'].includes(video.timestamps.reason)),
    synopsis: video.synopsis ? present('正本にあらすじと根拠参照あり', video.synopsis.bodyEvidenceRefs) : missing('正本にあらすじなし'),
    tags: video.tagAssignments.length > 0 ? present('正本に根拠付きタグあり。網羅性は別途確認が必要', video.tagAssignments.flatMap((tag) => tag.evidenceRefs)) : missing('正本にタグなし'),
    wordCloud: video.wordCloud.status === '作成済み' ? present(`正本に集計あり: ${video.wordCloud.inputType}`) : missing(video.wordCloud.reason, video.wordCloud.reason === '対象外'),
    customEmojiUsage: emoji ? present('正本に集計あり。ゼロ件も集計済みとして扱う') : missing('正本に集計なし。チャット未取得と絵文字ゼロ件は区別する'),
    customEmojiTimeline: emoji?.timeline ? present('正本に時刻付き集計あり') : missing(emoji ? '総数のみ。時刻付き元チャットの再集計が必要' : '正本に時刻付き集計なし'),
    transcript: { status: 'unmeasured', reason: '正本だけではprivate文字起こしの有無・全編確認・品質を判定できない', evidenceRefs: [] },
    hybridSearch: { status: 'unmeasured', reason: '文字起こし・チャットを基にした語彙検索と意味検索の索引・評価は正本に記録されていない', evidenceRefs: [] },
  };
}

export function buildContentCoverage(videos: CanonicalVideo[]) {
  if (new Set(videos.map((video) => video.videoId)).size !== videos.length) throw new Error('動画IDが重複しています。');
  const records = [...videos].sort((a, b) => a.videoId.localeCompare(b.videoId)).map((video) => ({
    videoId: video.videoId,
    publishedAt: video.publishedAt,
    // Digest the actual canonical record, not only an upstream input fingerprint.
    canonicalFingerprint: sha256(canonicalJson(video)),
    features: videoFeatureCoverage(video),
  }));
  const totals = Object.fromEntries(enrichmentFeatures.map((feature) => [feature, {
    present: records.filter((record) => record.features[feature].status === 'present').length,
    missing: records.filter((record) => record.features[feature].status === 'missing').length,
    notApplicable: records.filter((record) => record.features[feature].status === 'not-applicable').length,
    unmeasured: records.filter((record) => record.features[feature].status === 'unmeasured').length,
  }]));
  return { schemaVersion: '1.0.0' as const, corpusFingerprint: sha256(canonicalJson(records)), videoCount: records.length, totals, records };
}

export function planEnrichment(
  coverage: ReturnType<typeof buildContentCoverage>,
  options: { features: EnrichmentFeature[]; limit: number; claims?: EnrichmentClaims; order?: 'newest' | 'oldest' },
) {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000) throw new Error('limitは1〜1000の整数にしてください。');
  const selectedFeatures = enrichmentFeatures.filter((feature) => options.features.includes(feature));
  if (selectedFeatures.length === 0) throw new Error('対象機能を1つ以上指定してください。');
  const claims = options.claims ? enrichmentClaimsSchema.parse(options.claims) : undefined;
  const active = new Map<string, Set<EnrichmentFeature>>();
  for (const claim of claims?.claims ?? []) {
    const features = active.get(claim.videoId) ?? new Set<EnrichmentFeature>();
    for (const feature of claim.features) features.add(feature);
    active.set(claim.videoId, features);
  }
  const records = [...coverage.records].sort((a, b) => (options.order === 'oldest' ? 1 : -1) * (Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) || a.videoId.localeCompare(b.videoId));
  const candidates = records.flatMap((record) => {
    const features = selectedFeatures.filter((feature) => record.features[feature].status === 'missing' && !active.has(record.videoId));
    return features.length === 0 ? [] : [{
      videoId: record.videoId,
      canonicalFingerprint: record.canonicalFingerprint,
      features,
      workKey: sha256(canonicalJson({ videoId: record.videoId, canonicalFingerprint: record.canonicalFingerprint, features })),
    }];
  });
  const targets = candidates.slice(0, options.limit);
  return {
    schemaVersion: '1.0.0' as const,
    corpusFingerprint: coverage.corpusFingerprint,
    claimsCheckedAt: claims?.checkedAt ?? null,
    executionReady: false as const,
    guard: '計画のみ。実行前に最新mainの指紋、除外、開いているPRを再確認し、既存ハーネスで原子的claimを行う。未計測を未作成とみなさない。',
    heldWork: (claims?.claims ?? []).flatMap((claim) => {
      const record = coverage.records.find((item) => item.videoId === claim.videoId);
      const features = selectedFeatures.filter((feature) => record?.features[feature].status === 'missing');
      return features.length === 0 ? [] : [{ videoId: claim.videoId, features, claimFeatures: enrichmentFeatures.filter((feature) => claim.features.includes(feature)), pullRequest: claim.pullRequest, state: claim.state ?? 'in-progress', updatedAt: claim.updatedAt ?? null }];
    }).sort((a, b) => a.videoId.localeCompare(b.videoId) || a.pullRequest.localeCompare(b.pullRequest)),
    eligibleVideoCount: candidates.length,
    remainingVideoCount: candidates.length - targets.length,
    targets,
    planFingerprint: sha256(canonicalJson(targets)),
  };
}
