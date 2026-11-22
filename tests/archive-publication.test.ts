import { describe, expect, it } from 'vitest';

import { archiveAuditInput, readPublishedArchives, reconcileArchives } from '../scripts/reconcile-archive-publication.ts';
import { videoShardId } from '../src/domain/content.ts';

const id = 'IH7YlUrpUIs';
const other = 'jmIjiSnfoMY';
const ready = { timestamps: true, synopsis: true };
const partial = { timestamps: true, synopsis: false };
const sha = 'a'.repeat(40);
const old = 'b'.repeat(40);
const input = (extra: Partial<Parameters<typeof reconcileArchives>[0]> = {}) => archiveAuditInput.parse({
  discovered: [id], timestampsLedger: [], synopsisLedger: [], pullRequests: [], ...extra,
});
const pr = { videoId: id, number: 2751, headSha: sha, mergeable: true, draft: true } as const;

describe('配信元と公開の照合', () => {
  it('登録漏れ、処理待ち、PR滞留、公開待ちを別々の状態にする', () => {
    const ledger = { timestampsLedger: [{ videoId: id, complete: false }], synopsisLedger: [{ videoId: id, complete: false }] };
    expect(reconcileArchives(input(), new Map(), new Map(), new Set())[0]?.stage).toBe('register');
    expect(reconcileArchives(input(ledger), new Map(), new Map(), new Set())[0]?.stage).toBe('prepare');
    expect(reconcileArchives(input({ ...ledger, pullRequests: [{ ...pr, check: null }] }), new Map(), new Map(), new Set())[0]?.stage).toBe('open-pull-request');
    expect(reconcileArchives(input(ledger), new Map([[id, ready]]), new Map([[id, partial]]), new Set())[0]?.stage).toBe('awaiting-publication');
  });

  it('前回合格を現在headの合格とせず、競合・CI失敗・Draftを区別する', () => {
    const prs = [
      { ...pr, number: 1, mergeable: false, check: null },
      { ...pr, number: 2, check: { headSha: old, conclusion: 'success' as const } },
      { ...pr, number: 3, check: { headSha: sha, conclusion: 'failure' as const } },
      { ...pr, number: 4, check: { headSha: sha, conclusion: 'success' as const } },
      { ...pr, number: 5, mergeable: null, draft: false, check: { headSha: sha, conclusion: 'success' as const } },
    ];
    const result = reconcileArchives(input({ pullRequests: prs }), new Map(), new Map(), new Set());
    expect(result[0]?.pullRequests.map(candidate => candidate.status)).toEqual([
      'conflict', 'latest-check-missing', 'check-failed', 'draft', 'mergeability-unknown',
    ]);
  });

  it('公開済みでも両方の台帳の漏れ・逆方向のずれを残し、除外は作業候補にしない', () => {
    const result = reconcileArchives(input({
      discovered: [id, other],
      timestampsLedger: [{ videoId: id, complete: false }, { videoId: other, complete: true }],
    }), new Map([[id, ready]]), new Map([[id, ready]]), new Set([other]));
    expect(result[0]).toMatchObject({ stage: 'published', ledgerIssues: ['missing-row', 'differs-from-public'] });
    expect(result[1]).toMatchObject({ stage: 'excluded', ledgerIssues: ['missing-row', 'differs-from-public'] });
  });

  it('重複IDで曖昧な台帳を合成しない', () => {
    expect(() => reconcileArchives(input({
      timestampsLedger: [{ videoId: id, complete: false }, { videoId: id, complete: true }],
    }), new Map(), new Map(), new Set())).toThrow(/重複/u);
  });
});

describe('公開版の実データ確認', () => {
  const releaseId = 'release-1234567890abcdef';
  const shardId = videoShardId(id);

  function reader(detail: unknown, switched = false) {
    let requests = 0;
    return (p: string) => {
      requests += 1;
      if (p === 'data/latest.json') return Promise.resolve({ releaseId: switched && requests > 1 ? 'release-2234567890abcdef' : releaseId });
      if (p === `data/releases/${releaseId}/index.json`) return Promise.resolve({ releaseId, videos: [{ videoId: id }] });
      if (p === `data/releases/${releaseId}/video-shards/${shardId}.json`) return Promise.resolve(detail);
      return Promise.reject(new Error(`Unexpected path: ${p}`));
    };
  }
  const detail = { releaseId, shardId, videos: {
    [id]: { videoId: id, releaseId, timestamps: { status: '作成済み', items: [{}] }, synopsis: { body: 'あらすじ' } },
  } };

  it('公開索引だけでなく、同一版の時刻とあらすじを読む', async () => {
    const result = await readPublishedArchives([id, other], reader(detail));
    expect(result.videos.get(id)).toEqual(ready);
    expect(result.videos.has(other)).toBe(false);
  });

  it('索引と詳細の不一致や、取得中の版の切り替えを未掲載と誤報しない', async () => {
    await expect(readPublishedArchives([id], reader({ ...detail, videos: {} }))).rejects.toThrow(/未確認/u);
    await expect(readPublishedArchives([id], reader(detail, true))).rejects.toThrow(/切り替わり/u);
  });
});
