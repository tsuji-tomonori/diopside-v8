import evaluation from '../../tests/fixtures/search-evaluation-v1.json';

import type { SearchIndex } from './content.ts';
import {
  additionalTagCounts,
  applySearch,
  buildSearchSuggestions,
  bucketRange,
  countWithAdditionalTag,
  damerauLevenshtein,
  dateInJapan,
  normalizeTitleForSearch,
  parseCondition,
  searchTagSuggestions,
  serializeCondition,
  withTagSelection,
  validateCondition,
} from './search.ts';

type SearchVideo = SearchIndex['videos'][number];

function video(
  videoId: string,
  title: string,
  publishedAt = '2026-01-01T00:00:00Z',
  durationSeconds: number | null = 1800,
  tagIds: string[] = [],
  reading = title,
): SearchVideo {
  return {
    videoId,
    normalizedTitle: normalizeTitleForSearch(title),
    normalizedReading: normalizeTitleForSearch(reading),
    publishedAt,
    durationSeconds,
    tagIds,
    entityIds: [],
  };
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

  it('タイトルから生成した読みを自由文字検索へ使う', () => {
    const target = video('video000001', '白雪巴の新衣装', undefined, undefined, [], 'しらゆきともえのしんいしょう');
    expect(applySearch([target], { query: 'しらゆき', tagIds: [] }).map((item) => item.videoId)).toEqual(['video000001']);
  });
});

describe('検索サジェスト', () => {
  const videos = [{
    videoId: 'video000001',
    title: '白雪巴の新衣装',
    normalizedTitle: normalizeTitleForSearch('白雪巴の新衣装'),
    normalizedReading: 'しらゆきともえのしんいしょう',
    publishedAt: '2026-01-01T00:00:00Z',
  }];
  const tags = [{
    tagId: 'tag-person',
    canonicalName: '白雪巴',
    normalizedReading: 'しらゆきともえ',
    count: 10,
    aliases: [],
  }, {
    tagId: 'tag-game',
    canonicalName: 'マインクラフト',
    normalizedReading: 'まいんくらふと',
    count: 5,
    aliases: ['マイクラ'],
  }];

  it.each(['し', 'しら', 'しらゆき', 'しらゆきともえ'] as const)('ひらがなの入力 %s ごとに漢字の動画とタグを候補にする', (query) => {
    const suggestions = buildSearchSuggestions(query, videos, tags);
    expect(suggestions.videos.map((item) => item.videoId)).toEqual(['video000001']);
    expect(suggestions.tags.map((item) => item.tagId)).toContain('tag-person');
  });

  it('ひらがなでカタカナ名と別名を候補にする', () => {
    expect(buildSearchSuggestions('まい', videos, tags).tags.map((item) => item.tagId)).toContain('tag-game');
    expect(buildSearchSuggestions('まいくら', videos, tags).tags.map((item) => item.tagId)).toContain('tag-game');
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

  it('明示したANYは和集合、除外は選択モードに関係なく適用する', () => {
    expect(applySearch(videos, { query: '', tagIds: ['tag-a', 'tag-b'], tagMatch: 'any' }).map((item) => item.videoId)).toEqual(['video000003', 'video000002', 'video000001']);
    expect(applySearch(videos, { query: '', tagIds: ['tag-a', 'tag-b'], tagMatch: 'any', excludedTagIds: ['tag-b'] }).map((item) => item.videoId)).toEqual(['video000002']);
    expect(applySearch(videos, { query: '', tagIds: ['tag-a'], excludedTagIds: ['tag-a'] })).toEqual([]);
    expect(applySearch(videos, { query: '', tagIds: [], tagMatch: 'any', excludedTagIds: ['tag-b'] }).map((item) => item.videoId)).toEqual(['video000002']);
    expect(applySearch(videos, { query: '', tagIds: ['tag-unknown'], tagMatch: 'any' })).toEqual([]);
    expect(applySearch(videos, { query: '', tagIds: [], excludedTagIds: ['tag-unknown'] })).toHaveLength(3);
  });

  it('ALL・ANY・除外をタイトル・期間・長さと同時適用し、異なる条件をキャッシュで混同しない', () => {
    const base = { query: '雑談', tagIds: ['tag-a', 'tag-b'], publishedFrom: '2025-01-02', durationMinMinutes: 30 };
    expect(applySearch(videos, base)).toEqual([]);
    expect(applySearch(videos, { ...base, tagMatch: 'any' }).map((item) => item.videoId)).toEqual(['video000002']);
    expect(applySearch(videos, { ...base, tagMatch: 'any', excludedTagIds: ['tag-a'] })).toEqual([]);
    expect(applySearch(videos, { ...base, tagMatch: 'any' })).toHaveLength(1);
    expect(applySearch(videos, base)).toEqual([]);
  });

  it('追加後件数はANYで既存結果と候補の重複を二重計上せず、期間と除外を維持する', () => {
    for (const tagMatch of ['all', 'any'] as const) {
      for (const tagIds of [[], ['tag-a'], ['tag-a', 'tag-b']]) {
        for (const excludedTagIds of [[], ['tag-b']]) {
          for (const query of ['', '雑談']) {
            const condition = { query, tagIds, tagMatch, excludedTagIds };
            const counts = additionalTagCounts(videos, condition);
            for (const tagId of ['tag-a', 'tag-b']) {
              expect(counts.get(tagId) ?? 0).toBe(countWithAdditionalTag(videos, condition, tagId));
            }
          }
        }
      }
    }
    expect(additionalTagCounts(videos, { query: '', tagIds: ['tag-a'], tagMatch: 'any', durationMinMinutes: 30 }).get('tag-b')).toBe(1);
  });

  it('タグ条件の編集は含める・除外を相互に移し、他の条件を保持する', () => {
    const original = { query: '雑談', tagIds: ['tag-a', 'tag-b'], tagMatch: 'any' as const, durationMinMinutes: 30 };
    const excluded = withTagSelection(original, 'tag-a', 'exclude');
    expect(excluded).toEqual({ ...original, tagIds: ['tag-b'], excludedTagIds: ['tag-a'] });
    expect(withTagSelection(excluded, 'tag-a', 'include')).toEqual({ ...original, tagIds: ['tag-b', 'tag-a'] });
    expect(withTagSelection(excluded, 'tag-a', 'remove')).toEqual({ ...original, tagIds: ['tag-b'] });
    expect(original.tagIds).toEqual(['tag-a', 'tag-b']);
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

describe('タグ検索条件のURL互換性', () => {
  it('ANYと除外を重複なく安定したURLで往復する', () => {
    const condition = { query: ' 雑談 ', tagIds: ['tag-b', 'tag-a', 'tag-a'], tagMatch: 'any' as const, excludedTagIds: ['tag-d', 'tag-c', 'tag-d'] };
    const params = serializeCondition(condition);
    expect(params.toString()).toBe('q=%E9%9B%91%E8%AB%87&tag=tag-a&tag=tag-b&tagMatch=any&exclude=tag-c&exclude=tag-d');
    expect(parseCondition(params)).toEqual({ query: '雑談', tagIds: ['tag-a', 'tag-b'], tagMatch: 'any', excludedTagIds: ['tag-c', 'tag-d'] });
  });

  it('31件のタグ条件は保存・URL更新の前に共通検証で拒否する', () => {
    const tagIds = Array.from({ length: 31 }, (_, index) => `tag-${index}`);
    expect(validateCondition({ query: '', tagIds })[0]?.field).toBe('タグ');
    expect(validateCondition({ query: '', tagIds: [], excludedTagIds: tagIds })[0]?.field).toBe('タグ');
    expect(validateCondition({ query: '', tagIds: tagIds.slice(0, 30), excludedTagIds: tagIds.slice(0, 30) })).toEqual([]);
  });

  it('既存URLと未知のモードはALLを維持し、タグ配列の上限を守る', () => {
    expect(parseCondition(new URLSearchParams('tag=tag-a&tag=tag-b&tagMatch=unknown&exclude='))).toEqual({ query: '', tagIds: ['tag-a', 'tag-b'] });
    expect(serializeCondition({ query: '', tagIds: [], tagMatch: 'all', excludedTagIds: [] }).toString()).toBe('');
    const params = new URLSearchParams();
    for (let index = 0; index < 40; index += 1) { params.append('tag', `tag-${index}`); params.append('exclude', `other-${index}`); }
    expect(parseCondition(params).tagIds).toHaveLength(30);
    expect(parseCondition(params).excludedTagIds).toHaveLength(30);
  });
});

describe('タグの独立した探索', () => {
  it('正規名・読み・別名・複数語から登録済みタグを検索し、動画文字検索へ混入しない', () => {
    const tags = [{ tagId: 'tag-a', canonicalName: 'マインクラフト', normalizedReading: 'まいんくらふと', aliases: ['マイクラ 建築'], count: 5 }, { tagId: 'tag-b', canonicalName: '朝の雑談', normalizedReading: 'あさのざつだん', aliases: [], count: 10 }];
    expect(searchTagSuggestions('まいくら', tags).map((tag) => tag.tagId)).toEqual(['tag-a']);
    expect(searchTagSuggestions('建築 マイクラ', tags).map((tag) => tag.tagId)).toEqual(['tag-a']);
    expect(searchTagSuggestions('あさ', tags).map((tag) => tag.tagId)).toEqual(['tag-b']);
    expect(searchTagSuggestions('', tags)).toEqual([]);
    expect(applySearch([video('video000001', '配信', undefined, undefined, ['tag-a'])], { query: 'マイクラ', tagIds: [] })).toEqual([]);
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
