import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { enrichmentClaimsSchema, enrichmentFeatures, type EnrichmentClaims, type EnrichmentFeature, type buildContentCoverage } from './content-coverage.ts';
import { sha256 } from './lib.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const sourceInventorySchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  records: z.array(z.object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
    feature: z.enum(enrichmentFeatures),
    canonicalFingerprint: digest,
    sourceFingerprint: digest,
    localPath: z.string().min(1),
  }).strict()),
}).strict();
export type SourceInventory = z.infer<typeof sourceInventorySchema>;

export const readinessStatuses = ['present', 'not-applicable', 'unmeasured', 'held-existing-pr', 'blocked-claims-snapshot', 'source-required', 'review-required'] as const;
type ReadinessStatus = typeof readinessStatuses[number];
type SourceStatus = 'unverified' | 'missing' | 'stale-canonical' | 'unreadable' | 'digest-mismatch' | 'verified-bytes';

// A matching digest proves byte availability, never full-track coverage, factual
// accuracy, privacy, candidate review, or permission to execute the harness.
export function buildEnrichmentReadiness(
  coverage: ReturnType<typeof buildContentCoverage>,
  options: { claims?: EnrichmentClaims; now: string; maxClaimsAgeSeconds?: number; sources?: SourceInventory; sourceRoot?: string },
) {
  const now = Date.parse(options.now);
  const maxAge = options.maxClaimsAgeSeconds ?? 3600;
  if (!Number.isFinite(now) || !Number.isSafeInteger(maxAge) || maxAge < 1) throw new Error('確認時刻とclaim有効期間が不正です。');
  const claims = options.claims ? enrichmentClaimsSchema.parse(options.claims) : undefined;
  const age = claims ? (now - Date.parse(claims.checkedAt)) / 1000 : null;
  const claimsSnapshotStatus = !claims ? 'missing' : claims.complete !== true || (claims.unresolvedPullRequests?.length ?? 0) > 0 ? 'incomplete'
    : claims.corpusFingerprint !== coverage.corpusFingerprint ? 'stale-corpus'
      : age! < 0 ? 'future-dated' : age! > maxAge ? 'expired' : 'current';
  const inventory = sourceInventorySchema.parse(options.sources ?? { schemaVersion: '1.0.0', records: [] });
  const sourceByKey = new Map<string, SourceInventory['records'][number]>();
  for (const source of inventory.records) {
    const key = `${source.videoId}:${source.feature}`;
    if (sourceByKey.has(key)) throw new Error('同じ動画と機能のsource指定が重複しています。');
    sourceByKey.set(key, source);
  }
  const records = coverage.records.map((record) => {
    const held = (claims?.claims ?? []).filter((claim) => claim.videoId === record.videoId);
    const features = Object.fromEntries(enrichmentFeatures.map((feature) => {
      const original = record.features[feature];
      const source = sourceByKey.get(`${record.videoId}:${feature}`);
      let sourceStatus: SourceStatus = original.reason === '資料不足' ? 'missing' : 'unverified';
      if (source) {
        if (source.canonicalFingerprint !== record.canonicalFingerprint) sourceStatus = 'stale-canonical';
        else {
          try {
            sourceStatus = sha256(readFileSync(path.resolve(options.sourceRoot ?? '.', source.localPath))) === source.sourceFingerprint ? 'verified-bytes' : 'digest-mismatch';
          } catch { sourceStatus = 'unreadable'; }
        }
      }
      const status: ReadinessStatus = original.status !== 'missing' ? original.status
        : held.length ? 'held-existing-pr'
          : claimsSnapshotStatus !== 'current' ? 'blocked-claims-snapshot'
            : sourceStatus === 'verified-bytes' || (!source && original.reason === '確認待ち') ? 'review-required' : 'source-required';
      return [feature, { status, sourceStatus, canonicalReason: original.reason,
        // Never include private source paths or bytes in a report.
        sourceFingerprint: source?.sourceFingerprint ?? null,
        pullRequests: [...new Set(held.map((claim) => claim.pullRequest))].sort(),
      }];
    })) as Record<EnrichmentFeature, { status: ReadinessStatus; sourceStatus: SourceStatus; canonicalReason: string; sourceFingerprint: string | null; pullRequests: string[] }>;
    return { videoId: record.videoId, canonicalFingerprint: record.canonicalFingerprint, features };
  });
  const totals = Object.fromEntries(enrichmentFeatures.map((feature) => [feature, Object.fromEntries(readinessStatuses.map((status) => [status, records.filter((record) => record.features[feature].status === status).length]))]));
  return { schemaVersion: '1.0.0' as const, corpusFingerprint: coverage.corpusFingerprint,
    checkedAt: options.now, claimsCheckedAt: claims?.checkedAt ?? null, claimsSnapshotStatus, maxClaimsAgeSeconds: maxAge,
    unresolvedPullRequests: [...new Set(claims?.unresolvedPullRequests ?? [])].sort(),
    executionReady: false as const, executableVideoCount: 0 as const,
    guard: 'readinessは計画用。sourceのhash一致は素材の存在のみを示す。全編・品質・同一candidate hashの独立レビューは既存ハーネスで検証し、最新main・除外・PR・原子的claimを実行直前に再確認する。',
    totals, records };
}
