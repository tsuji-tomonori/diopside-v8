import evaluation from '../../tests/fixtures/search-evaluation-v1.json';

import type { SearchIndex } from './content.ts';
import {
  applySearch,
  bucketRange,
  countWithAdditionalTag,
  damerauLevenshtein,
  dateInJapan,
  normalizeTitleForSearch,
  parseCondition,
  serializeCondition,
  validateCondition,
} from './search.ts';

type SearchVideo = SearchIndex['videos'][number];

function video(
  videoId: string,
  title: string,
  publishedAt = '2026-01-01T00:00:00Z',
  durationSeconds: number | null = 1800,
  tagIds: string[] = [],
): SearchVideo {
  return { videoId, normalizedTitle: normalizeTitleForSearch(title), publishedAt, durationSeconds, tagIds };
}

describe('タイトル検索', () => {
  it('正規化は表示文字列から独立し、定義された順序で照合文字列を作る', () => {
    expect(normalizeTitleForSearch('  ＡＢＣ・カラオケ!!  ')).toBe('abc からおけ');
  });

  it('固定評価データ22件をすべて満たす', () => {
    for (const [index, item] of evaluation.cases.entries()) {
      const result = applySearch([video(`fixture${String(index).padStart(4, '0')}`, item.title)], { query: item.query, tagIds: [] });
      expect(result.length, item.id).toBe(item.match ? 1 : 0);
      if ('rank' in item && result[0]) expect(result[0].relevanceRank, item.id).toBe(item.rank);
    }
  });

  it('Damerau–Levenshtein距離は隣接入替を1と数える', () => {
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
  });

  it('関連度、距離、公開日、識別子の順で決定的に並べる', () => {
    const videos = [
      video('video000003', '今夜の雑談', '2025-01-01T00:00:00Z'),
      video('video000002', '雑談', '2024-01-01T00:00:00Z'),
      video('video000001', '雑談のお知らせ', '2026-01-01T00:00:00Z'),
    ];
    expect(applySearch(videos, { query: '雑談', tagIds: [] }).map((item) => item.videoId)).toEqual([
      'video000002', 'video000001', 'video000003',
    ]);
  });
});

describe('複合絞り込み', () => {
  const videos = [
    video('video000001', '朝の雑談', '2025-01-01T14:59:59Z', 1799, ['tag-a', 'tag-b']),
    video('video000002', '夜の雑談', '2025-01-01T15:00:00Z', 1800, ['tag-a']),
    video('video000003', '歌枠', '2025-02-01T00:00:00Z', null, ['tag-b']),
  ];

  it('タグは不変識別子の完全一致かつ複数選択ANDで判定する', () => {
    expect(applySearch(videos, { query: '', tagIds: ['tag-a', 'tag-b'] }).map((item) => item.videoId)).toEqual(['video000001']);
    expect(countWithAdditionalTag(videos, { query: '', tagIds: ['tag-a'] }, 'tag-b')).toBe(1);
  });

  it('日本標準時の日付として両端を含める', () => {
    expect(dateInJapan('2025-01-01T15:00:00Z')).toBe('2025-01-02');
    expect(applySearch(videos, { query: '', tagIds: [], publishedFrom: '2025-01-02', publishedTo: '2025-01-02' }).map((item) => item.videoId)).toEqual(['video000002']);
  });

  it('動画長区分は境界値が重複せず、指定時は不明値を除外する', () => {
    expect(bucketRange('30分未満')).toEqual({ max: 1799 });
    expect(bucketRange('30分以上1時間未満')).toEqual({ min: 1800, max: 3599 });
    expect(applySearch(videos, { query: '', tagIds: [], durationBucket: '30分未満' }).map((item) => item.videoId)).toEqual(['video000001']);
    expect(applySearch(videos, { query: '', tagIds: [], durationMinMinutes: 30 }).map((item) => item.videoId)).toEqual(['video000002']);
  });

  it('逆転した期間と動画長を日本語の入力誤りにする', () => {
    expect(validateCondition({ query: '', tagIds: [], publishedFrom: '2025-02-01', publishedTo: '2025-01-01', durationMinMinutes: 10, durationMaxMinutes: 5 })).toEqual([
      { field: '公開日', message: '公開日の開始日は終了日以前にしてください。' },
      { field: '動画長', message: '動画長の最小値は最大値以下にしてください。' },
    ]);
  });

  it('条件をURLへ安定して保存し復元する', () => {
    const condition = { query: ' 雑談 ', tagIds: ['tag-b', 'tag-a', 'tag-a'], publishedFrom: '2025-01-01', sort: '公開日の古い順' as const };
    expect(parseCondition(serializeCondition(condition))).toEqual({
      query: '雑談', tagIds: ['tag-a', 'tag-b'], publishedFrom: '2025-01-01', sort: '公開日の古い順',
    });
  });
});

describe('検索性能', () => {
  it('2,500動画・代表20検索の95パーセンタイルを100ミリ秒以内にする', () => {
    const videos = Array.from({ length: 2500 }, (_, index) => video(
      `perf${String(index).padStart(7, '0')}`,
      `第${index}回 マインクラフト 雑談 配信`,
      new Date(Date.UTC(2020 + (index % 6), index % 12, 1)).toISOString(),
      600 + index,
      [`tag-${index % 20}`],
    ));
    const elapsed = Array.from({ length: 20 }, (_, index) => {
      const start = performance.now();
      applySearch(videos, { query: index % 2 ? 'マイクラフト' : `第${index}回`, tagIds: [] });
      return performance.now() - start;
    }).sort((left, right) => left - right);
    expect(elapsed[Math.ceil(elapsed.length * 0.95) - 1]).toBeLessThan(100);
  });
});
