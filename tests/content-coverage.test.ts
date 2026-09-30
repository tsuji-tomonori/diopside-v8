import { readCanonicalVideos } from '../scripts/canonical-store.ts';
import { buildContentCoverage, enrichmentClaimsSchema, enrichmentFeatures, planEnrichment, videoFeatureCoverage } from '../scripts/content-coverage.ts';
import type { CanonicalVideo } from '../src/domain/content.ts';

const source = readCanonicalVideos(process.cwd());
const base = source[0]!;
const incomplete = (id = 'AbCdEfGhI12'): CanonicalVideo => {
  const copy = structuredClone(base);
  copy.videoId = id;
  delete copy.synopsis;
  delete copy.customEmojiUsage;
  copy.timestamps = { status: '未作成', reason: '確認待ち', detail: '確認待ち', updatedAt: '2026-09-30T00:00:00Z' };
  return copy;
};

describe('動画別コンテンツ整備の不足と有限計画', () => {
  it('全件を各状態へ分解し、登録数と全編品質を混同しない', () => {
    const report = buildContentCoverage(source);
    expect(report.videoCount).toBe(source.length);
    for (const feature of enrichmentFeatures) expect(Object.values(report.totals[feature]!).reduce((a, b) => a + b, 0)).toBe(source.length);
    expect(report.totals.transcript?.unmeasured).toBe(source.length);
    expect(report.totals.hybridSearch?.unmeasured).toBe(source.length);
    expect(report.totals.customEmojiTimeline?.present).toBeLessThanOrEqual(report.totals.customEmojiUsage?.present ?? 0);
  });

  it('入力順序に依存せず、同じ正本から同じ計画を作る', () => {
    const a = incomplete(); const b = incomplete('ZbCdEfGhI12');
    const first = buildContentCoverage([a, b]); const second = buildContentCoverage([b, a]);
    expect(first).toEqual(second);
    expect(planEnrichment(first, { features: ['synopsis', 'timestamps'], limit: 1 })).toEqual(planEnrichment(second, { features: ['timestamps', 'synopsis', 'synopsis'], limit: 1 }));
    expect(planEnrichment(first, { features: ['synopsis'], limit: 1 }).remainingVideoCount).toBe(1);
    expect(() => buildContentCoverage([a, a])).toThrow('重複');
  });

  it('同じ元入力でも正本が変わればworkKeyが変わり、完成済みを再計画しない', () => {
    const a = incomplete(); const b = structuredClone(a); b.title += '更新';
    const plan = (video: CanonicalVideo) => planEnrichment(buildContentCoverage([video]), { features: ['synopsis', 'tags'], limit: 10 });
    expect(plan(a).targets[0]?.workKey).not.toBe(plan(b).targets[0]?.workKey);
    expect(plan(a).targets[0]?.features).toEqual(['synopsis']);
    expect(planEnrichment(buildContentCoverage([a]), { features: ['transcript', 'hybridSearch'], limit: 10 }).targets).toEqual([]);
  });

  it('同じ動画の別機能も既存PRへ保留し、動画IDの大文字小文字を保持する', () => {
    const a = incomplete(); const b = incomplete('abCdEfGhI12');
    const claims = { schemaVersion: '1.0.0' as const, checkedAt: '2026-09-30T00:00:00Z', claims: [{ videoId: a.videoId, features: ['synopsis' as const], pullRequest: 'https://github.com/tsuji-tomonori/diopside-v8/pull/1' }] };
    const plan = planEnrichment(buildContentCoverage([a, b]), { features: ['timestamps', 'synopsis'], limit: 10, claims });
    expect(plan.targets.find((target) => target.videoId === a.videoId)).toBeUndefined();
    expect(plan.targets.find((target) => target.videoId === b.videoId)?.features).toEqual(['timestamps', 'synopsis']);
    expect(plan.heldWork).toEqual([{ videoId: a.videoId, features: ['timestamps', 'synopsis'], claimFeatures: ['synopsis'], pullRequest: claims.claims[0]!.pullRequest, state: 'in-progress', updatedAt: null }]);
    expect(plan.executionReady).toBe(false);
    expect(plan.claimsCheckedAt).toBe(claims.checkedAt);
    expect(() => enrichmentClaimsSchema.parse({ ...claims, rawChat: 'private' })).toThrow();
  });

  it('ゼロ件の取得済み絵文字と未取得、総数と推移、対象外を区別する', () => {
    const a = incomplete();
    a.customEmojiUsage = { status: '集計済み', totalCount: 0, items: [], inputFingerprint: 'a'.repeat(64), rulesVersion: '2.0.0', updatedAt: '2026-09-30T00:00:00Z' };
    a.timestamps = { status: '未作成', reason: '短尺', detail: '短尺', updatedAt: '2026-09-30T00:00:00Z' };
    expect(videoFeatureCoverage(a).customEmojiUsage.status).toBe('present');
    expect(videoFeatureCoverage(a).customEmojiTimeline.status).toBe('missing');
    expect(videoFeatureCoverage(a).timestamps.status).toBe('not-applicable');
    expect(planEnrichment(buildContentCoverage([a]), { features: ['timestamps'], limit: 10 }).targets).toEqual([]);
  });

  it('境界値を検証し、新着と過去の両方向で有限集合を固定する', () => {
    const a = incomplete(); const b = incomplete('ZbCdEfGhI12');
    a.publishedAt = '2020-01-01T00:00:00Z'; b.publishedAt = '2026-01-01T00:00:00Z';
    const coverage = buildContentCoverage([a, b]);
    expect(planEnrichment(coverage, { features: ['synopsis'], limit: 1 }).targets[0]?.videoId).toBe(b.videoId);
    expect(planEnrichment(coverage, { features: ['synopsis'], limit: 1, order: 'oldest' }).targets[0]?.videoId).toBe(a.videoId);
    for (const limit of [0, -1, 1.1, NaN, 1001]) expect(() => planEnrichment(coverage, { features: ['synopsis'], limit })).toThrow();
    expect(() => planEnrichment(coverage, { features: [], limit: 1 })).toThrow();
  });
});
