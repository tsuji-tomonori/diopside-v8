import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readCanonicalVideos } from '../scripts/canonical-store.ts';
import { buildContentCoverage, enrichmentFeatures, planEnrichment, type EnrichmentClaims } from '../scripts/content-coverage.ts';
import { buildEnrichmentReadiness, sourceInventorySchema } from '../scripts/enrichment-readiness.ts';
import { sha256 } from '../scripts/lib.ts';

const now = '2026-09-30T14:00:00Z';
const source = readCanonicalVideos(process.cwd())[0]!;
const video = structuredClone(source);
video.videoId = 'AbCdEfGhI12';
delete video.synopsis;
delete video.customEmojiUsage;
video.timestamps = { status: '未作成', reason: '全編確認不足', detail: '全編確認不足', updatedAt: now };
video.wordCloud = { status: '未作成', reason: '資料不足', detail: '資料不足', updatedAt: now };
const coverage = buildContentCoverage([video]);
const claims: EnrichmentClaims = { schemaVersion: '1.0.0', checkedAt: now, complete: true, corpusFingerprint: coverage.corpusFingerprint, claims: [] };
const directory = mkdtempSync(path.join(os.tmpdir(), 'enrichment-readiness-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const inventory = () => {
  writeFileSync(path.join(directory, 'private.txt'), 'synthetic source fixture');
  return sourceInventorySchema.parse({ schemaVersion: '1.0.0', records: [{ videoId: video.videoId, feature: 'synopsis', canonicalFingerprint: coverage.records[0]!.canonicalFingerprint, sourceFingerprint: sha256('synthetic source fixture'), localPath: 'private.txt' }] });
};

describe('補完readinessの保守的な判定', () => {
  it('claim snapshotなし・旧形式・不完全・古い正本・期限切れ・未来時刻を実行候補にしない', () => {
    const cases: Array<[EnrichmentClaims | undefined, string]> = [
      [undefined, 'missing'],
      [{ schemaVersion: '1.0.0', checkedAt: now, claims: [] }, 'incomplete'],
      [{ ...claims, complete: false }, 'incomplete'],
      [{ ...claims, unresolvedPullRequests: ['https://github.com/owner/repo/pull/2'] }, 'incomplete'],
      [{ ...claims, corpusFingerprint: '0'.repeat(64) }, 'stale-corpus'],
      [{ ...claims, checkedAt: '2026-09-30T12:59:59Z' }, 'expired'],
      [{ ...claims, checkedAt: '2026-09-30T14:00:01Z' }, 'future-dated'],
    ];
    for (const [snapshot, expected] of cases) {
      const result = buildEnrichmentReadiness(coverage, { now, ...(snapshot ? { claims: snapshot } : {}) });
      expect(result.claimsSnapshotStatus).toBe(expected);
      expect(result.records[0]!.features.synopsis.status).toBe('blocked-claims-snapshot');
      expect(result.executionReady).toBe(false);
    }
  });

  it('既存の有限計画と旧snapshotの保留動作は変更しない', () => {
    const old: EnrichmentClaims = { schemaVersion: '1.0.0', checkedAt: now, claims: [{ videoId: video.videoId, features: ['timestamps'], pullRequest: 'https://github.com/owner/repo/pull/1' }] };
    expect(planEnrichment(coverage, { features: ['synopsis'], limit: 10, claims: old }).targets).toEqual([]);
    expect(buildEnrichmentReadiness(coverage, { now, claims: old }).records[0]!.features.synopsis.status).toBe('held-existing-pr');
  });

  it('大文字小文字を保持し、別機能PRも動画全体を保留する。古いclaimを奪わない', () => {
    const lower = structuredClone(video); lower.videoId = 'abCdEfGhI12';
    const both = buildContentCoverage([video, lower]);
    const snapshot = { ...claims, corpusFingerprint: both.corpusFingerprint, claims: [{ videoId: video.videoId, features: ['timestamps' as const], pullRequest: 'https://github.com/owner/repo/pull/1' }] };
    const result = buildEnrichmentReadiness(both, { now, claims: snapshot });
    expect(result.records.find((r) => r.videoId === video.videoId)!.features.synopsis.status).toBe('held-existing-pr');
    expect(result.records.find((r) => r.videoId === lower.videoId)!.features.synopsis.status).toBe('source-required');
  });

  it('素材不足と確認待ちを区別し、未計測・対象外を実行対象にしない', () => {
    const excluded = structuredClone(video); excluded.timestamps = { status: '未作成', reason: '短尺', detail: '短尺', updatedAt: now };
    excluded.wordCloud = { status: '未作成', reason: '確認待ち', detail: '確認待ち', updatedAt: now };
    const c = buildContentCoverage([excluded]);
    const result = buildEnrichmentReadiness(c, { now, claims: { ...claims, corpusFingerprint: c.corpusFingerprint } });
    expect(result.records[0]!.features.timestamps.status).toBe('not-applicable');
    expect(result.records[0]!.features.wordCloud.status).toBe('review-required');
    expect(result.records[0]!.features.wordCloud.sourceStatus).toBe('unverified');
    expect(result.records[0]!.features.transcript.status).toBe('unmeasured');
    expect(buildEnrichmentReadiness(coverage, { now, claims }).records[0]!.features.wordCloud.sourceStatus).toBe('missing');
  });

  it('source実体hashを照合し、一致してもレビュー完了・実行可能としない', () => {
    const result = buildEnrichmentReadiness(coverage, { now, claims, sources: inventory(), sourceRoot: directory });
    expect(result.records[0]!.features.synopsis.sourceStatus).toBe('verified-bytes');
    expect(result.records[0]!.features.synopsis.status).toBe('review-required');
    expect(result.executionReady).toBe(false);
    expect(result.executableVideoCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain('private.txt');
    expect(JSON.stringify(result)).not.toContain('synthetic source fixture');
  });

  it('sourceと正本の古い結び付け、hash不一致、欠損を閉じた状態にする', () => {
    const sources = inventory();
    sources.records[0]!.canonicalFingerprint = '0'.repeat(64);
    expect(buildEnrichmentReadiness(coverage, { now, claims, sources, sourceRoot: directory }).records[0]!.features.synopsis.sourceStatus).toBe('stale-canonical');
    sources.records[0]!.canonicalFingerprint = coverage.records[0]!.canonicalFingerprint;
    writeFileSync(path.join(directory, 'private.txt'), 'changed');
    expect(buildEnrichmentReadiness(coverage, { now, claims, sources, sourceRoot: directory }).records[0]!.features.synopsis.sourceStatus).toBe('digest-mismatch');
    sources.records[0]!.localPath = 'absent.txt';
    expect(buildEnrichmentReadiness(coverage, { now, claims, sources, sourceRoot: directory }).records[0]!.features.synopsis.sourceStatus).toBe('unreadable');
  });

  it('ゼロ件の集計済みとチャット未取得、timeline不足を区別する', () => {
    const zero = structuredClone(video);
    zero.customEmojiUsage = { status: '集計済み', totalCount: 0, items: [], inputFingerprint: 'a'.repeat(64), rulesVersion: '2.0.0', updatedAt: now };
    const c = buildContentCoverage([zero]);
    const features = buildEnrichmentReadiness(c, { now, claims: { ...claims, corpusFingerprint: c.corpusFingerprint } }).records[0]!.features;
    expect(features.customEmojiUsage.status).toBe('present');
    expect(features.customEmojiTimeline.status).toBe('source-required');
    expect(buildEnrichmentReadiness(coverage, { now, claims }).records[0]!.features.customEmojiUsage.status).toBe('source-required');
  });

  it('全機能で状態合計が動画数と一致し、境界時刻を決定的に扱う', () => {
    const result = buildEnrichmentReadiness(coverage, { now: '2026-09-30T15:00:00Z', claims });
    expect(result.claimsSnapshotStatus).toBe('current');
    for (const feature of enrichmentFeatures) expect(Object.values(result.totals[feature]!).reduce((a, b) => a + b, 0)).toBe(coverage.videoCount);
    expect(() => buildEnrichmentReadiness(coverage, { now: 'invalid', claims })).toThrow();
    expect(() => buildEnrichmentReadiness(coverage, { now, claims, maxClaimsAgeSeconds: 0 })).toThrow();
    const sources = inventory(); sources.records.push(sources.records[0]!);
    expect(() => buildEnrichmentReadiness(coverage, { now, claims, sources })).toThrow('重複');
    expect(() => sourceInventorySchema.parse({ ...inventory(), approved: true })).toThrow();
  });
});
