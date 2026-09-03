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

export interface SuggestionVideo {
  videoId: string;
  title: string;
  normalizedTitle: string;
  normalizedReading: string;
  publishedAt: string;
}

export interface SuggestionTag {
  tagId: string;
  canonicalName: string;
  normalizedReading: string;
  count: number;
  aliases: string[];
  entityId?: string;
}

export interface SearchSuggestions {
  videos: SuggestionVideo[];
  tags: SuggestionTag[];
}

export interface ConditionError {
  field: '公開日' | '動画長';
  message: string;
}

interface PreparedTerm {
  value: string;
  fuzzy: (text: Uint32Array) => number | null;
}

interface PreparedQuery {
  normalized: string;
  terms: PreparedTerm[];
}

interface PreparedCatalog {
  maximumTextLength: number;
  publishedNewest: SearchVideo[];
  publishedOldest: SearchVideo[];
  durationShortest: SearchVideo[];
  durationLongest: SearchVideo[];
}

const catalogCache = new WeakMap<SearchVideo[], PreparedCatalog>();
const searchResultCache = new WeakMap<SearchVideo[], Map<string, SearchResult[]>>();
const titleCharactersCache = new WeakMap<SearchVideo, Uint32Array>();
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
  const text = codePoints(normalizedTitle);
  return createFuzzyMatcher(term, text.length)(text);
}

function createFuzzyMatcher(term: string, maximumTextLength: number): (text: Uint32Array) => number | null {
  const pattern = codePoints(term);
  if (pattern.length < 3) return () => null;
  const allowed = pattern.length <= 5 ? 1 : 2;
  const buffers = [
    new Uint16Array(maximumTextLength + 1),
    new Uint16Array(maximumTextLength + 1),
    new Uint16Array(maximumTextLength + 1),
  ];

  // 先頭行を0にすると、文字列の任意位置から照合を開始できる。最終行の
  // 最小値は長さ n-d..n+d の全連続部分文字列との最小距離と等価になる。
  const usedPatternCharacters = pattern.length >= 8 ? new Uint8Array(pattern.length) : null;
  return (text: Uint32Array): number | null => {
    if (text.length === 0 || text.length < pattern.length - allowed) return null;
    if (usedPatternCharacters) {
      usedPatternCharacters.fill(0);
      let shared = 0;
      const requiredShared = pattern.length - allowed;
      for (let column = 0; column < text.length && shared < requiredShared; column += 1) {
        for (let row = 0; row < pattern.length; row += 1) {
          if (usedPatternCharacters[row] === 0 && pattern[row] === text[column]) {
            usedPatternCharacters[row] = 1;
            shared += 1;
            break;
          }
        }
      }
      if (shared < requiredShared) return null;
    }
    let previousPrevious = buffers[0]!;
    let previous = buffers[1]!;
    let current = buffers[2]!;
    previousPrevious.fill(0, 0, text.length + 1);
    previous.fill(0, 0, text.length + 1);
    for (let row = 1; row <= pattern.length; row += 1) {
      current[0] = row;
      for (let column = 1; column <= text.length; column += 1) {
        const substitutionCost = pattern[row - 1] === text[column - 1] ? 0 : 1;
        const deletion = previous[column]! + 1;
        const insertion = current[column - 1]! + 1;
        const substitution = previous[column - 1]! + substitutionCost;
        let distance = deletion < insertion ? deletion : insertion;
        if (substitution < distance) distance = substitution;
        if (
          row > 1
          && column > 1
          && pattern[row - 1] === text[column - 2]
          && pattern[row - 2] === text[column - 1]
        ) {
          const transposition = previousPrevious[column - 2]! + 1;
          if (transposition < distance) distance = transposition;
        }
        current[column] = distance;
      }
      const next = previousPrevious;
      previousPrevious = previous;
      previous = current;
      current = next;
    }
    let minimum = Number.POSITIVE_INFINITY;
    for (let column = 1; column <= text.length; column += 1) {
      if (previous[column]! < minimum) minimum = previous[column]!;
    }
    return minimum <= allowed ? minimum : null;
  };
}

function relevance(query: PreparedQuery, video: SearchVideo): { rank: number; distance: number } | null {
  const searchableTexts = [video.normalizedTitle, video.normalizedReading];
  if (!query.normalized) return { rank: 5, distance: 0 };
  if (searchableTexts.some((text) => text === query.normalized)) return { rank: 0, distance: 0 };
  if (searchableTexts.some((text) => text.startsWith(query.normalized))) return { rank: 1, distance: 0 };
  if (searchableTexts.some((text) => text.includes(query.normalized))) return { rank: 2, distance: 0 };
  if (query.terms.every((term) => searchableTexts.some((text) => text.includes(term.value)))) {
    return { rank: 3, distance: 0 };
  }

  let totalDistance = 0;
  const text = titleCharacters(video);
  for (const term of query.terms) {
    if (searchableTexts.some((text) => text.includes(term.value))) continue;
    const distance = term.fuzzy(text);
    if (distance === null) return null;
    totalDistance += distance;
  }
  return { rank: 4, distance: totalDistance };
}

export function buildSearchSuggestions(
  query: string,
  videos: SuggestionVideo[],
  tags: SuggestionTag[],
  limitPerKind = 6,
): SearchSuggestions {
  const normalizedQuery = normalizeTitleForSearch(query);
  if (!normalizedQuery) return { videos: [], tags: [] };
  const videosRanked = videos
    .flatMap((video) => {
      const rank = suggestionRank(normalizedQuery, [video.normalizedTitle, video.normalizedReading]);
      return rank === null ? [] : [{ value: video, rank }];
    })
    .sort((left, right) => left.rank - right.rank
      || Date.parse(right.value.publishedAt) - Date.parse(left.value.publishedAt)
      || left.value.videoId.localeCompare(right.value.videoId))
    .slice(0, limitPerKind)
    .map(({ value }) => value);
  const tagsRanked = tags
    .flatMap((tag) => {
      const rank = suggestionRank(normalizedQuery, [
        normalizeTitleForSearch(tag.canonicalName),
        tag.normalizedReading,
        ...tag.aliases.map(normalizeTitleForSearch),
      ]);
      return rank === null ? [] : [{ value: tag, rank }];
    })
    .sort((left, right) => left.rank - right.rank
      || right.value.count - left.value.count
      || left.value.canonicalName.localeCompare(right.value.canonicalName, 'ja'))
    .slice(0, limitPerKind)
    .map(({ value }) => value);
  return { videos: videosRanked, tags: tagsRanked };
}

function suggestionRank(query: string, texts: string[]): number | null {
  let best = Number.POSITIVE_INFINITY;
  for (const text of texts) {
    if (text === query) best = Math.min(best, 0);
    else if (text.startsWith(query)) best = Math.min(best, 1);
    else if (text.split(' ').some((term) => term.startsWith(query))) best = Math.min(best, 2);
    else if (text.includes(query)) best = Math.min(best, 3);
  }
  return Number.isFinite(best) ? best : null;
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
  const catalog = preparedCatalog(videos);
  const normalizedQuery = normalizeTitleForSearch(condition.query);
  const requestedSort = condition.sort ?? (normalizedQuery ? '関連度順' : '公開日の新しい順');
  const selectedTags = [...new Set(condition.tagIds)].sort();
  const cache = searchResultCache.get(videos) ?? new Map<string, SearchResult[]>();
  if (!searchResultCache.has(videos)) searchResultCache.set(videos, cache);
  const cacheKey = JSON.stringify({
    query: normalizedQuery,
    tagIds: selectedTags,
    publishedFrom: condition.publishedFrom ?? null,
    publishedTo: condition.publishedTo ?? null,
    durationBucket: condition.durationBucket ?? null,
    durationMinMinutes: condition.durationMinMinutes ?? null,
    durationMaxMinutes: condition.durationMaxMinutes ?? null,
    sort: requestedSort,
  });
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const query: PreparedQuery = {
    normalized: normalizedQuery,
    terms: (normalizedQuery ? normalizedQuery.split(' ') : []).map((value) => ({
      value,
      fuzzy: createFuzzyMatcher(value, catalog.maximumTextLength),
    })),
  };
  const bucket = condition.durationBucket ? bucketRange(condition.durationBucket) : {};
  const minimumSeconds = condition.durationBucket
    ? bucket.min
    : condition.durationMinMinutes !== undefined ? condition.durationMinMinutes * 60 : undefined;
  const maximumSeconds = condition.durationBucket
    ? bucket.max
    : condition.durationMaxMinutes !== undefined ? condition.durationMaxMinutes * 60 : undefined;

  const source = requestedSort === '公開日の古い順'
    ? catalog.publishedOldest
    : requestedSort === '動画長の短い順'
      ? catalog.durationShortest
      : requestedSort === '動画長の長い順'
        ? catalog.durationLongest
        : catalog.publishedNewest;
  const results: SearchResult[] = [];
  const relevanceBuckets = requestedSort === '関連度順'
    ? Array.from({ length: 6 }, () => new Map<number, SearchResult[]>())
    : null;
  for (const video of source) {
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
    const result = { ...video, relevanceRank: score.rank, totalDistance: score.distance };
    if (relevanceBuckets) {
      const bucket = relevanceBuckets[score.rank]!;
      const values = bucket.get(score.distance) ?? [];
      values.push(result);
      bucket.set(score.distance, values);
    } else {
      results.push(result);
    }
  }

  if (relevanceBuckets) {
    for (const relevanceBucket of relevanceBuckets) {
      for (const distance of [...relevanceBucket.keys()].sort((left, right) => left - right)) {
        results.push(...relevanceBucket.get(distance)!);
      }
    }
  }
  if (cache.size >= 64) cache.delete(cache.keys().next().value as string);
  cache.set(cacheKey, results);
  return results;
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
  return tagCountsForResults(applySearch(videos, condition));
}

export function tagCountsForResults(matching: SearchResult[]): Map<string, number> {
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

function preparedCatalog(videos: SearchVideo[]): PreparedCatalog {
  const cached = catalogCache.get(videos);
  if (cached) return cached;
  const publishedNewest = [...videos].sort((left, right) => publishedTime(right) - publishedTime(left) || left.videoId.localeCompare(right.videoId));
  const catalog: PreparedCatalog = {
    maximumTextLength: videos.reduce((maximum, video) => Math.max(maximum, titleCharacters(video).length), 0),
    publishedNewest,
    publishedOldest: [...videos].sort((left, right) => publishedTime(left) - publishedTime(right) || left.videoId.localeCompare(right.videoId)),
    durationShortest: [...videos].sort((left, right) => compareNullableDuration(left.durationSeconds, right.durationSeconds, 1) || left.videoId.localeCompare(right.videoId)),
    durationLongest: [...videos].sort((left, right) => compareNullableDuration(left.durationSeconds, right.durationSeconds, -1) || left.videoId.localeCompare(right.videoId)),
  };
  catalogCache.set(videos, catalog);
  return catalog;
}

function titleCharacters(video: SearchVideo): Uint32Array {
  const cached = titleCharactersCache.get(video);
  if (cached) return cached;
  const characters = codePoints(video.normalizedTitle);
  titleCharactersCache.set(video, characters);
  return characters;
}

function codePoints(value: string): Uint32Array {
  return Uint32Array.from(value, (character) => character.codePointAt(0) ?? 0);
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
