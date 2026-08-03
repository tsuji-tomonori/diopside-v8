import type { SearchIndex } from './content.ts';

export type DurationBucket = '30分未満' | '30分以上1時間未満' | '1時間以上2時間未満' | '2時間以上';
export type SortOrder = '関連度順' | '公開日の新しい順' | '公開日の古い順' | '動画長の短い順' | '動画長の長い順';

export interface SearchCondition {
  query: string;
  tagIds: string[];
  publishedFrom?: string;
  publishedTo?: string;
  durationBucket?: DurationBucket;
  durationMinMinutes?: number;
  durationMaxMinutes?: number;
  sort?: SortOrder;
}

export type SearchVideo = SearchIndex['videos'][number];

export interface SearchResult extends SearchVideo {
  relevanceRank: number;
  totalDistance: number;
}

export interface ConditionError {
  field: '公開日' | '動画長';
  message: string;
}

interface PreparedTerm {
  value: string;
  fuzzy: (text: readonly string[]) => number | null;
}

interface PreparedQuery {
  normalized: string;
  terms: PreparedTerm[];
}

const titleCharactersCache = new WeakMap<SearchVideo, readonly string[]>();
const publishedTimeCache = new WeakMap<SearchVideo, number>();
const japanDateFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const durationBuckets: ReadonlyArray<{
  label: DurationBucket;
  minSeconds?: number;
  maxSeconds?: number;
}> = [
  { label: '30分未満', maxSeconds: 1799 },
  { label: '30分以上1時間未満', minSeconds: 1800, maxSeconds: 3599 },
  { label: '1時間以上2時間未満', minSeconds: 3600, maxSeconds: 7199 },
  { label: '2時間以上', minSeconds: 7200 },
];

export function normalizeTitleForSearch(value: string): string {
  return katakanaToHiragana(value.normalize('NFKC').toLocaleLowerCase('ja-JP'))
    .replace(/[^\p{L}\p{N}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function katakanaToHiragana(value: string): string {
  return [...value].map((character) => {
    const code = character.codePointAt(0);
    if (code !== undefined && code >= 0x30a1 && code <= 0x30f6) {
      return String.fromCodePoint(code - 0x60);
    }
    return character;
  }).join('');
}

export function tokenizeQuery(value: string): string[] {
  const normalized = normalizeTitleForSearch(value);
  return normalized ? normalized.split(' ') : [];
}

export function damerauLevenshtein(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const rows = a.length + 1;
  const columns = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) matrix[row]![0] = row;
  for (let column = 0; column < columns; column += 1) matrix[0]![column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      const deletion = matrix[row - 1]![column]! + 1;
      const insertion = matrix[row]![column - 1]! + 1;
      const substitution = matrix[row - 1]![column - 1]! + substitutionCost;
      let distance = Math.min(deletion, insertion, substitution);
      if (
        row > 1
        && column > 1
        && a[row - 1] === b[column - 2]
        && a[row - 2] === b[column - 1]
      ) {
        distance = Math.min(distance, matrix[row - 2]![column - 2]! + 1);
      }
      matrix[row]![column] = distance;
    }
  }
  return matrix[a.length]![b.length]!;
}

export function fuzzyDistance(term: string, normalizedTitle: string): number | null {
  const text = [...normalizedTitle];
  return createFuzzyMatcher(term, text.length)(text);
}

function createFuzzyMatcher(term: string, maximumTextLength: number): (text: readonly string[]) => number | null {
  const pattern = [...term];
  if (pattern.length < 3) return () => null;
  const allowed = pattern.length <= 5 ? 1 : 2;
  const buffers = [
    new Uint16Array(maximumTextLength + 1),
    new Uint16Array(maximumTextLength + 1),
    new Uint16Array(maximumTextLength + 1),
  ];

  // 先頭行を0にすると、文字列の任意位置から照合を開始できる。最終行の
  // 最小値は長さ n-d..n+d の全連続部分文字列との最小距離と等価になる。
  return (text: readonly string[]): number | null => {
    if (text.length === 0) return null;
    let previousPrevious = buffers[0]!;
    let previous = buffers[1]!;
    let current = buffers[2]!;
    previousPrevious.fill(0, 0, text.length + 1);
    previous.fill(0, 0, text.length + 1);
    for (let row = 1; row <= pattern.length; row += 1) {
      current[0] = row;
      for (let column = 1; column <= text.length; column += 1) {
        const substitutionCost = pattern[row - 1] === text[column - 1] ? 0 : 1;
        let distance = Math.min(
          previous[column]! + 1,
          current[column - 1]! + 1,
          previous[column - 1]! + substitutionCost,
        );
        if (
          row > 1
          && column > 1
          && pattern[row - 1] === text[column - 2]
          && pattern[row - 2] === text[column - 1]
        ) {
          distance = Math.min(distance, previousPrevious[column - 2]! + 1);
        }
        current[column] = distance;
      }
      [previousPrevious, previous, current] = [previous, current, previousPrevious];
    }
    let minimum = Number.POSITIVE_INFINITY;
    for (let column = 1; column <= text.length; column += 1) minimum = Math.min(minimum, previous[column]!);
    return minimum <= allowed ? minimum : null;
  };
}

function relevance(query: PreparedQuery, video: SearchVideo): { rank: number; distance: number } | null {
  const normalizedTitle = video.normalizedTitle;
  if (!query.normalized) return { rank: 5, distance: 0 };
  if (normalizedTitle === query.normalized) return { rank: 0, distance: 0 };
  if (normalizedTitle.startsWith(query.normalized)) return { rank: 1, distance: 0 };
  if (normalizedTitle.includes(query.normalized)) return { rank: 2, distance: 0 };
  if (query.terms.every((term) => normalizedTitle.includes(term.value))) return { rank: 3, distance: 0 };

  let totalDistance = 0;
  const text = titleCharacters(video);
  for (const term of query.terms) {
    if (normalizedTitle.includes(term.value)) continue;
    const distance = term.fuzzy(text);
    if (distance === null) return null;
    totalDistance += distance;
  }
  return { rank: 4, distance: totalDistance };
}

export function validateCondition(condition: SearchCondition): ConditionError[] {
  const errors: ConditionError[] = [];
  if (condition.publishedFrom && condition.publishedTo && condition.publishedFrom > condition.publishedTo) {
    errors.push({ field: '公開日', message: '公開日の開始日は終了日以前にしてください。' });
  }
  if (
    condition.durationMinMinutes !== undefined
    && condition.durationMaxMinutes !== undefined
    && condition.durationMinMinutes > condition.durationMaxMinutes
  ) {
    errors.push({ field: '動画長', message: '動画長の最小値は最大値以下にしてください。' });
  }
  return errors;
}

export function bucketRange(bucket: DurationBucket): { min?: number; max?: number } {
  const match = durationBuckets.find((item) => item.label === bucket);
  if (!match) return {};
  return {
    ...(match.minSeconds !== undefined ? { min: match.minSeconds } : {}),
    ...(match.maxSeconds !== undefined ? { max: match.maxSeconds } : {}),
  };
}

export function applySearch(videos: SearchVideo[], condition: SearchCondition): SearchResult[] {
  if (validateCondition(condition).length > 0) return [];
  const normalizedQuery = normalizeTitleForSearch(condition.query);
  const maximumTextLength = videos.reduce((maximum, video) => Math.max(maximum, titleCharacters(video).length), 0);
  const query: PreparedQuery = {
    normalized: normalizedQuery,
    terms: (normalizedQuery ? normalizedQuery.split(' ') : []).map((value) => ({
      value,
      fuzzy: createFuzzyMatcher(value, maximumTextLength),
    })),
  };
  const selectedTags = [...new Set(condition.tagIds)];
  const bucket = condition.durationBucket ? bucketRange(condition.durationBucket) : {};
  const minimumSeconds = condition.durationBucket
    ? bucket.min
    : condition.durationMinMinutes !== undefined ? condition.durationMinMinutes * 60 : undefined;
  const maximumSeconds = condition.durationBucket
    ? bucket.max
    : condition.durationMaxMinutes !== undefined ? condition.durationMaxMinutes * 60 : undefined;

  const results: ScoredSearchResult[] = [];
  for (const video of videos) {
    const score = relevance(query, video);
    if (!score) continue;
    if (!selectedTags.every((tagId) => video.tagIds.includes(tagId))) continue;
    if (condition.publishedFrom || condition.publishedTo) {
      const publishedDate = dateInJapan(video.publishedAt);
      if (condition.publishedFrom && publishedDate < condition.publishedFrom) continue;
      if (condition.publishedTo && publishedDate > condition.publishedTo) continue;
    }
    if ((minimumSeconds !== undefined || maximumSeconds !== undefined) && video.durationSeconds === null) continue;
    if (minimumSeconds !== undefined && (video.durationSeconds ?? -1) < minimumSeconds) continue;
    if (maximumSeconds !== undefined && (video.durationSeconds ?? Number.POSITIVE_INFINITY) > maximumSeconds) continue;
    results.push({ ...video, relevanceRank: score.rank, totalDistance: score.distance, publishedTime: publishedTime(video) });
  }

  const requestedSort = condition.sort ?? (normalizedQuery ? '関連度順' : '公開日の新しい順');
  return results
    .sort((left, right) => compareResults(left, right, requestedSort))
    .map(({ publishedTime: _publishedTime, ...result }) => result);
}

type ScoredSearchResult = SearchResult & { publishedTime: number };

function compareResults(left: ScoredSearchResult, right: ScoredSearchResult, sort: SortOrder): number {
  const idOrder = left.videoId.localeCompare(right.videoId);
  if (sort === '関連度順') {
    return left.relevanceRank - right.relevanceRank
      || left.totalDistance - right.totalDistance
      || right.publishedTime - left.publishedTime
      || idOrder;
  }
  if (sort === '公開日の古い順') {
    return left.publishedTime - right.publishedTime || idOrder;
  }
  if (sort === '動画長の短い順') {
    return compareNullableDuration(left.durationSeconds, right.durationSeconds, 1) || idOrder;
  }
  if (sort === '動画長の長い順') {
    return compareNullableDuration(left.durationSeconds, right.durationSeconds, -1) || idOrder;
  }
  return right.publishedTime - left.publishedTime || idOrder;
}

function compareNullableDuration(left: number | null, right: number | null, direction: 1 | -1): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return (left - right) * direction;
}

export function countWithAdditionalTag(
  videos: SearchVideo[],
  condition: SearchCondition,
  candidateTagId: string,
): number {
  return applySearch(videos, {
    ...condition,
    tagIds: [...condition.tagIds, candidateTagId],
  }).length;
}

export function additionalTagCounts(
  videos: SearchVideo[],
  condition: SearchCondition,
): Map<string, number> {
  const matching = applySearch(videos, condition);
  const counts = new Map<string, number>();
  for (const video of matching) {
    for (const tagId of new Set(video.tagIds)) counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
  }
  return counts;
}

export function normalizeTagAlias(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/^#/u, '')
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('ja-JP');
}

export function resolveTagAlias(
  value: string,
  aliasIndex: Record<string, string>,
  knownTagIds: Set<string>,
): string | null {
  if (knownTagIds.has(value)) return value;
  return aliasIndex[normalizeTagAlias(value)] ?? null;
}

export function dateInJapan(value: string): string {
  return japanDateFormatter.format(new Date(value));
}

function titleCharacters(video: SearchVideo): readonly string[] {
  const cached = titleCharactersCache.get(video);
  if (cached) return cached;
  const characters = [...video.normalizedTitle];
  titleCharactersCache.set(video, characters);
  return characters;
}

function publishedTime(video: SearchVideo): number {
  const cached = publishedTimeCache.get(video);
  if (cached !== undefined) return cached;
  const value = Date.parse(video.publishedAt);
  publishedTimeCache.set(video, value);
  return value;
}

export function serializeCondition(condition: SearchCondition): URLSearchParams {
  const params = new URLSearchParams();
  if (condition.query.trim()) params.set('q', condition.query.trim());
  for (const tagId of [...new Set(condition.tagIds)].sort()) params.append('tag', tagId);
  if (condition.publishedFrom) params.set('from', condition.publishedFrom);
  if (condition.publishedTo) params.set('to', condition.publishedTo);
  if (condition.durationBucket) params.set('length', condition.durationBucket);
  if (condition.durationMinMinutes !== undefined) params.set('min', String(condition.durationMinMinutes));
  if (condition.durationMaxMinutes !== undefined) params.set('max', String(condition.durationMaxMinutes));
  if (condition.sort) params.set('sort', condition.sort);
  return params;
}

export function parseCondition(params: URLSearchParams): SearchCondition {
  const bucket = params.get('length');
  const sort = params.get('sort');
  return {
    query: params.get('q')?.slice(0, 200) ?? '',
    tagIds: [...new Set(params.getAll('tag').filter(Boolean))].slice(0, 30),
    ...(validDate(params.get('from')) ? { publishedFrom: params.get('from')! } : {}),
    ...(validDate(params.get('to')) ? { publishedTo: params.get('to')! } : {}),
    ...(durationBuckets.some((item) => item.label === bucket) ? { durationBucket: bucket as DurationBucket } : {}),
    ...(validNonnegativeNumber(params.get('min')) ? { durationMinMinutes: Number(params.get('min')) } : {}),
    ...(validNonnegativeNumber(params.get('max')) ? { durationMaxMinutes: Number(params.get('max')) } : {}),
    ...(isSortOrder(sort) ? { sort } : {}),
  };
}

function validDate(value: string | null): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(new Date(`${value}T00:00:00+09:00`).getTime()));
}

function validNonnegativeNumber(value: string | null): boolean {
  return Boolean(value !== null && Number.isFinite(Number(value)) && Number(value) >= 0);
}

function isSortOrder(value: string | null): value is SortOrder {
  return value === '関連度順'
    || value === '公開日の新しい順'
    || value === '公開日の古い順'
    || value === '動画長の短い順'
    || value === '動画長の長い順';
}
