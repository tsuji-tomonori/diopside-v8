import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { VideoCard } from '../../components/VideoCard.tsx';
import { useBundle, useDeviceStore } from '../../contexts.ts';
import {
  applySearch,
  buildSearchSuggestions,
  dateInJapan,
  durationBuckets,
  normalizeTagAlias,
  parseCondition,
  serializeCondition,
  tagCountsForResults,
  validateCondition,
  type DurationBucket,
  type SearchCondition,
  type SortOrder,
} from '../../domain/search.ts';
import { formatDate } from '../../format.ts';
import { DateRangePicker } from './DateRangePicker.tsx';
import { DurationRangeSlider } from './DurationRangeSlider.tsx';

const sortOrders: SortOrder[] = ['関連度順', '公開日の新しい順', '公開日の古い順', '動画長の短い順', '動画長の長い順'];
const pageSize = 24;
const durationTagFilterSettleDelayMilliseconds = 100;
const songGenreTagIds = new Set([
  'tag-content-primary-90289feaebbf',
  'tag-content-secondary-f86130d9b03d',
]);

type DurationFilter = Pick<SearchCondition, 'durationBucket' | 'durationMinMinutes' | 'durationMaxMinutes'>;

export function SearchPage(): React.JSX.Element {
  const bundle = useBundle();
  const store = useDeviceStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<SearchCondition>(() => parseCondition(params));
  const [tagInput, setTagInput] = useState('');
  const [tagError, setTagError] = useState('');
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [resultAnnouncement, setResultAnnouncement] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [appliedCondition, setAppliedCondition] = useState<SearchCondition | null>(null);
  const [settledDurationFilter, setSettledDurationFilter] = useState<DurationFilter>(() => durationFilterOf(
    draft.durationBucket,
    draft.durationMinMinutes,
    draft.durationMaxMinutes,
  ));
  const searchStartedAt = useRef<number | null>(null);
  const searchComputationMs = useRef(0);
  const pendingParams = useRef<URLSearchParams | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const parsedCondition = useMemo(() => parseCondition(params), [params]);
  const summaries = useMemo(() => new Map(bundle.index.videos.map((video) => [video.videoId, video])), [bundle.index.videos]);
  const filterBounds = useMemo(() => searchFilterBounds(bundle.searchIndex.videos), [bundle.searchIndex.videos]);
  const tags = useMemo(() => bundle.tagIndex.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags)), [bundle.tagIndex.categories]);
  const aliasesByTagId = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const [alias, tagId] of Object.entries(bundle.aliasIndex.aliases)) {
      const values = result.get(tagId) ?? [];
      values.push(alias);
      result.set(tagId, values);
    }
    return result;
  }, [bundle.aliasIndex.aliases]);
  const suggestionVideos = useMemo(() => bundle.searchIndex.videos.flatMap((video) => {
    const summary = summaries.get(video.videoId);
    return summary ? [{
      videoId: video.videoId,
      title: summary.title,
      normalizedTitle: video.normalizedTitle,
      normalizedReading: video.normalizedReading,
      publishedAt: video.publishedAt,
    }] : [];
  }), [bundle.searchIndex.videos, summaries]);
  const suggestionTags = useMemo(() => tags
    .filter((tag) => tag.count > 0)
    .map((tag) => ({
      tagId: tag.tagId,
      canonicalName: tag.canonicalName,
      normalizedReading: tag.normalizedReading,
      count: tag.count,
      aliases: aliasesByTagId.get(tag.tagId) ?? [],
    })), [aliasesByTagId, tags]);
  const suggestions = useMemo(
    () => buildSearchSuggestions(draft.query, suggestionVideos, suggestionTags),
    [draft.query, suggestionTags, suggestionVideos],
  );
  const suggestionOptions = useMemo(() => [
    ...suggestions.videos.map((video) => ({ kind: 'video' as const, id: video.videoId, value: video })),
    ...suggestions.tags.map((tag) => ({ kind: 'tag' as const, id: tag.tagId, value: tag })),
  ], [suggestions]);
  const showSuggestions = suggestionsOpen && draft.query.trim().length > 0 && suggestionOptions.length > 0;
  const knownTagIds = useMemo(() => new Set(tags.map((tag) => tag.tagId)), [tags]);
  const songTagIds = useMemo(() => new Set(bundle.songIndex.songs.map((song) => song.tagId)), [bundle.songIndex.songs]);
  const gameTitleTagIds = useMemo(() => new Set(bundle.gameIndex.games.map((game) => game.gameTitleTagId)), [bundle.gameIndex.games]);
  const gameGenreTagIds = useMemo(() => new Set(
    bundle.tagIndex.categories
      .find((category) => category.categoryId === 'content')
      ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'gameGenre')
      ?.tags.map((tag) => tag.tagId) ?? [],
  ), [bundle.tagIndex.categories]);
  const gameRootTagIds = useMemo(() => new Set(
    bundle.tagIndex.categories
      .find((category) => category.categoryId === 'content')
      ?.subcategories.filter((subcategory) => ['primary', 'secondary'].includes(subcategory.subcategoryId))
      .flatMap((subcategory) => subcategory.tags.filter((tag) => tag.canonicalName === 'ゲーム').map((tag) => tag.tagId)) ?? [],
  ), [bundle.tagIndex.categories]);
  const tagInputIndex = useMemo(() => {
    const index = new Map(Object.entries(bundle.aliasIndex.aliases));
    for (const tag of tags) index.set(normalizeTagAlias(tag.canonicalName), tag.tagId);
    return index;
  }, [bundle.aliasIndex.aliases, tags]);
  const urlCondition = useMemo(() => ({
    ...parsedCondition,
    tagIds: [...new Set(parsedCondition.tagIds.flatMap((value) => {
      const resolved = knownTagIds.has(value) ? value : tagInputIndex.get(normalizeTagAlias(value));
      return resolved ? [resolved] : [];
    }))],
  }), [knownTagIds, parsedCondition, tagInputIndex]);
  const condition = appliedCondition ?? urlCondition;
  const errors = validateCondition(condition);
  const results = useMemo(() => {
    const startedAt = performance.now();
    const nextResults = applySearch(bundle.searchIndex.videos, condition);
    searchComputationMs.current = performance.now() - startedAt;
    return nextResults;
  }, [bundle.searchIndex.videos, condition]);
  const selected = new Set(draft.tagIds);
  const tagFilterCondition = useMemo<SearchCondition>(() => ({
    query: draft.query,
    tagIds: draft.tagIds,
    ...(draft.publishedFrom ? { publishedFrom: draft.publishedFrom } : {}),
    ...(draft.publishedTo ? { publishedTo: draft.publishedTo } : {}),
    ...(draft.sort ? { sort: draft.sort } : {}),
    ...settledDurationFilter,
  }), [draft.publishedFrom, draft.publishedTo, draft.query, draft.sort, draft.tagIds, settledDurationFilter]);
  const draftResults = useMemo(
    () => applySearch(bundle.searchIndex.videos, tagFilterCondition),
    [bundle.searchIndex.videos, tagFilterCondition],
  );
  const draftResultCount = draftResults.length;
  const tagCounts = useMemo(() => tagCountsForResults(draftResults), [draftResults]);
  const availableTagIds = new Set(tags.flatMap((tag) => (
    selected.has(tag.tagId) || (tagCounts.get(tag.tagId) ?? 0) > 0 ? [tag.tagId] : []
  )));
  const selectedTags = tags.filter((tag) => selected.has(tag.tagId));
  const quickTags = (bundle.tagIndex.categories
    .find((category) => category.categoryId === 'content')
    ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'primary')
    ?.tags ?? [])
    .filter((tag) => availableTagIds.has(tag.tagId) && !selected.has(tag.tagId));

  useEffect(() => {
    setDraft(condition);
    setVisibleCount(pageSize);
  }, [condition]);

  useEffect(() => {
    if (appliedCondition && serializeCondition(appliedCondition).toString() === serializeCondition(urlCondition).toString()) {
      setAppliedCondition(null);
    }
  }, [appliedCondition, urlCondition]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSettledDurationFilter(durationFilterOf(
        draft.durationBucket,
        draft.durationMinMinutes,
        draft.durationMaxMinutes,
      ));
    }, durationTagFilterSettleDelayMilliseconds);
    return () => window.clearTimeout(timeoutId);
  }, [draft.durationBucket, draft.durationMaxMinutes, draft.durationMinMinutes]);

  useLayoutEffect(() => {
    if (searchStartedAt.current === null) return;
    const elapsed = performance.now() - searchStartedAt.current;
    searchStartedAt.current = null;
    setResultAnnouncement(`${results.length}件の検索結果へ更新しました。処理時間は${elapsed.toFixed(1)}ミリ秒です。`);
    const nextParams = pendingParams.current;
    if (nextParams) {
      pendingParams.current = null;
      requestAnimationFrame(() => setParams(nextParams));
    }
  }, [results.length, condition, setParams]);

  const submit = (nextCondition: SearchCondition = draft): boolean => {
    const nextErrors = validateCondition(nextCondition);
    if (nextErrors.length > 0) return false;
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    searchStartedAt.current = performance.now();
    pendingParams.current = serializeCondition(nextCondition);
    setDraft(nextCondition);
    setAppliedCondition(nextCondition);
    void store.saveRecentSearch(nextCondition);
    return true;
  };

  const closeTagsAndShowResults = (nextCondition: SearchCondition = draft): void => {
    if (!submit(nextCondition)) return;

    setTagsExpanded(false);
    requestAnimationFrame(() => {
      resultsHeadingRef.current?.focus({ preventScroll: true });
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      resultsHeadingRef.current?.scrollIntoView({ behavior, block: 'start' });
    });
  };

  const applyTagSuggestion = (tagId: string): void => {
    if (gameRootTagIds.has(tagId)) {
      navigate('/games');
      return;
    }
    if (gameGenreTagIds.has(tagId)) {
      navigate(`/games/genres/${tagId}`);
      return;
    }
    if (gameTitleTagIds.has(tagId)) {
      navigate(`/works/${tagId}`);
      return;
    }
    if (songGenreTagIds.has(tagId)) {
      navigate('/songs');
      return;
    }
    if (songTagIds.has(tagId)) {
      navigate(`/songs/${tagId}`);
      return;
    }
    const next = { ...draft, query: '', tagIds: [...new Set([...draft.tagIds, tagId])] };
    closeTagsAndShowResults(next);
  };

  const selectActiveSuggestion = (): boolean => {
    const option = suggestionOptions[activeSuggestionIndex];
    if (!option) return false;
    if (option.kind === 'video') navigate(`/video/${option.value.videoId}`);
    else applyTagSuggestion(option.value.tagId);
    return true;
  };

  const resolveTagId = (value: string): string | undefined => {
    const normalizedValue = value.trim();
    if (!normalizedValue) return undefined;
    return knownTagIds.has(normalizedValue)
      ? normalizedValue
      : tagInputIndex.get(normalizeTagAlias(normalizedValue));
  };

  const selectTagAndShowResults = (tagId: string, mode: 'add' | 'toggle'): void => {
    if (gameRootTagIds.has(tagId)) {
      navigate('/games');
      return;
    }
    if (gameGenreTagIds.has(tagId)) {
      navigate(`/games/genres/${tagId}`);
      return;
    }
    if (gameTitleTagIds.has(tagId)) {
      navigate(`/works/${tagId}`);
      return;
    }
    if (songGenreTagIds.has(tagId)) {
      navigate('/songs');
      return;
    }
    if (songTagIds.has(tagId)) {
      navigate(`/songs/${tagId}`);
      return;
    }
    const alreadySelected = selected.has(tagId);
    const nextTagIds = mode === 'toggle' && alreadySelected
      ? draft.tagIds.filter((id) => id !== tagId)
      : [...new Set([...draft.tagIds, tagId])];
    setTagInput('');
    setTagError('');
    closeTagsAndShowResults({ ...draft, tagIds: nextTagIds });
  };

  const clear = (): void => {
    const empty = { query: '', tagIds: [] };
    setDraft(empty);
    setTagInput('');
    setTagError('');
    searchStartedAt.current = performance.now();
    pendingParams.current = new URLSearchParams();
    setAppliedCondition(empty);
  };

  const addTagByName = (): void => {
    const tagId = resolveTagId(tagInput);
    if (!tagId) {
      setTagError('一致する登録済みタグがありません。候補から選んでください。');
      return;
    }
    selectTagAndShowResults(tagId, 'add');
  };

  const updateTagInput = (value: string): void => {
    setTagInput(value);
    setTagError('');
    const tagId = resolveTagId(value);
    if (tagId) selectTagAndShowResults(tagId, 'add');
  };

  const updateBucket = (value?: DurationBucket): void => {
    const bucket = durationBuckets.find((item) => item.label === value);
    if (!bucket) {
      setDraft(({ durationBucket: _bucket, durationMinMinutes: _minimum, durationMaxMinutes: _maximum, ...current }) => current);
      return;
    }
    setDraft((current) => {
      const { durationBucket: _bucket, durationMinMinutes: _minimum, durationMaxMinutes: _maximum, ...rest } = current;
      return {
        ...rest,
        durationBucket: bucket.label,
        ...(bucket.minSeconds !== undefined ? { durationMinMinutes: bucket.minSeconds / 60 } : { durationMinMinutes: 0 }),
        ...(bucket.maxSeconds !== undefined ? { durationMaxMinutes: bucket.maxSeconds / 60 } : {}),
      };
    });
  };

  const updateDurationRange = (minimumMinutes?: number, maximumMinutes?: number): void => {
    setDraft(({ durationBucket: _bucket, durationMinMinutes: _minimum, durationMaxMinutes: _maximum, ...current }) => ({
      ...current,
      ...(minimumMinutes !== undefined ? { durationMinMinutes: minimumMinutes } : {}),
      ...(maximumMinutes !== undefined ? { durationMaxMinutes: maximumMinutes } : {}),
    }));
  };

  const updatePublishedRange = (range: { from?: string; to?: string }): void => {
    setDraft(({ publishedFrom: _from, publishedTo: _to, ...current }) => ({
      ...current,
      ...(range.from ? { publishedFrom: range.from } : {}),
      ...(range.to ? { publishedTo: range.to } : {}),
    }));
  };

  const renderTagChoice = (tag: (typeof tags)[number]): React.JSX.Element => {
    const count = selected.has(tag.tagId) ? draftResultCount : (tagCounts.get(tag.tagId) ?? 0);
    return (
      <button
        type="button"
        key={tag.tagId}
        className="tag-choice"
        aria-pressed={selected.has(tag.tagId)}
        onClick={() => selectTagAndShowResults(tag.tagId, 'toggle')}
      >
        {tag.canonicalName}<span>{count}件</span>
      </button>
    );
  };

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">にじさんじアーカイブを、もう一度見つける</p>
        <p>タイトルの断片と、diopsideが整理・確認したタグから探せます。</p>
        <p className="updated">公開データ最終更新: {formatDate(bundle.latest.updatedAt)}</p>
      </section>

      <section className="search-panel" aria-labelledby="search-heading">
        <h1 id="search-heading">動画を検索</h1>
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label className="search-label" htmlFor="query">検索</label>
          <div className="search-row">
            <div
              className="search-combobox"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSuggestionsOpen(false);
              }}
            >
              <input
                id="query"
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="search-suggestions"
                aria-expanded={showSuggestions}
                aria-activedescendant={showSuggestions && activeSuggestionIndex >= 0 ? `search-suggestion-${activeSuggestionIndex}` : undefined}
                value={draft.query}
                onFocus={() => setSuggestionsOpen(true)}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, query: event.target.value }));
                  setSuggestionsOpen(true);
                  setActiveSuggestionIndex(-1);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === 'Escape') {
                    setSuggestionsOpen(false);
                    setActiveSuggestionIndex(-1);
                    return;
                  }
                  if (event.key === 'ArrowDown' && suggestionOptions.length > 0) {
                    event.preventDefault();
                    setSuggestionsOpen(true);
                    setActiveSuggestionIndex((current) => (current + 1) % suggestionOptions.length);
                    return;
                  }
                  if (event.key === 'ArrowUp' && suggestionOptions.length > 0) {
                    event.preventDefault();
                    setSuggestionsOpen(true);
                    setActiveSuggestionIndex((current) => current <= 0 ? suggestionOptions.length - 1 : current - 1);
                    return;
                  }
                  if (event.key === 'Enter' && activeSuggestionIndex >= 0 && selectActiveSuggestion()) event.preventDefault();
                }}
                placeholder="動画タイトルやタグ名を入力"
                autoComplete="off"
              />
              {showSuggestions && (
                <div id="search-suggestions" className="search-suggestions" role="listbox" aria-label="検索候補">
                  {suggestions.videos.length > 0 && (
                    <section role="group" aria-label="動画候補">
                      <h2>動画</h2>
                      {suggestions.videos.map((video) => {
                        const optionIndex = suggestionOptions.findIndex((option) => option.kind === 'video' && option.id === video.videoId);
                        return (
                          <Link
                            id={`search-suggestion-${optionIndex}`}
                            key={video.videoId}
                            className="search-suggestion"
                            role="option"
                            aria-selected={activeSuggestionIndex === optionIndex}
                            to={`/video/${video.videoId}`}
                            onMouseEnter={() => setActiveSuggestionIndex(optionIndex)}
                          >
                            <span className="suggestion-kind">動画</span>
                            <span>{video.title}</span>
                          </Link>
                        );
                      })}
                    </section>
                  )}
                  {suggestions.tags.length > 0 && (
                    <section role="group" aria-label="タグ候補">
                      <h2>タグ</h2>
                      {suggestions.tags.map((tag) => {
                        const optionIndex = suggestionOptions.findIndex((option) => option.kind === 'tag' && option.id === tag.tagId);
                        return (
                          <button
                            id={`search-suggestion-${optionIndex}`}
                            key={tag.tagId}
                            className="search-suggestion"
                            type="button"
                            role="option"
                            aria-selected={activeSuggestionIndex === optionIndex}
                            onMouseEnter={() => setActiveSuggestionIndex(optionIndex)}
                            onClick={() => applyTagSuggestion(tag.tagId)}
                          >
                            <span className="suggestion-kind">タグ</span>
                            <span>{tag.canonicalName}</span>
                            <small>{tag.count}件</small>
                          </button>
                        );
                      })}
                    </section>
                  )}
                </div>
              )}
              <p className="screen-reader-only" role="status">
                {draft.query.trim() ? `動画${suggestions.videos.length}件、タグ${suggestions.tags.length}件の候補` : ''}
              </p>
            </div>
            <button
              className="button primary"
              type="submit"
              onMouseDown={(event) => event.preventDefault()}
            >
              この条件で探す
            </button>
          </div>

          <details className="filter-drawer" open={draft.tagIds.length > 0}>
            <summary>タグ・公開日・動画長で絞り込む</summary>

            <div className="filter-grid">
              <fieldset className="filter-card">
                <legend>公開日</legend>
                <DateRangePicker
                  from={draft.publishedFrom}
                  to={draft.publishedTo}
                  minimumAvailableDate={filterBounds.minimumDate}
                  maximumAvailableDate={filterBounds.maximumDate}
                  onChange={updatePublishedRange}
                />
              </fieldset>
              <fieldset className="filter-card">
                <legend>動画長</legend>
                <DurationRangeSlider
                  bucket={draft.durationBucket}
                  minimumMinutes={draft.durationMinMinutes}
                  maximumMinutes={draft.durationMaxMinutes}
                  limitMinutes={filterBounds.maximumDurationMinutes}
                  onBucketChange={updateBucket}
                  onRangeChange={updateDurationRange}
                />
              </fieldset>
            </div>
            {validateCondition(draft).map((error) => <p className="form-error" role="alert" key={error.field}>{error.message}</p>)}
            <div className="filter-actions">
              <button className="button primary" type="submit">絞り込みを反映</button>
              <button className="button ghost" type="button" onClick={clear}>条件をすべて解除</button>
            </div>

            <fieldset className="tag-filter">
              <legend>タグ</legend>
              <div className="tag-filter-toolbar">
                <p className="hint">よく使う主ジャンル、タグ名入力、分類一覧から選べます。複数選択は「すべて含む」です。</p>
                <button
                  className="button secondary"
                  type="button"
                  aria-controls="tag-filter-content"
                  aria-expanded={tagsExpanded}
                  onClick={() => tagsExpanded ? closeTagsAndShowResults() : setTagsExpanded(true)}
                >
                  {tagsExpanded ? 'タグを閉じて動画を見る' : `タグを開く（選択${selected.size}件）`}
                </button>
              </div>
              <div
                id="tag-filter-content"
                className={`tag-filter-content${tagsExpanded ? ' is-expanded' : ''}`}
                aria-hidden={!tagsExpanded}
                inert={!tagsExpanded}
              >
                <div className="tag-filter-content-inner">
                  <label className="tag-input-label" htmlFor="tag-name">タグ名または別名から追加</label>
                  <div className="tag-input-row">
                    <input id="tag-name" list="tag-name-options" value={tagInput} onChange={(event) => updateTagInput(event.target.value)} />
                    <datalist id="tag-name-options">
                      {tags.filter((tag) => availableTagIds.has(tag.tagId)).map((tag) => <option key={tag.tagId} value={tag.canonicalName} />)}
                      {Object.entries(bundle.aliasIndex.aliases)
                        .filter(([, tagId]) => availableTagIds.has(tagId))
                        .map(([alias]) => <option key={`alias-${alias}`} value={alias} />)}
                    </datalist>
                    <button className="button secondary" type="button" onClick={addTagByName}>タグを追加</button>
                  </div>
                  {tagError && <p className="form-error" role="alert">{tagError}</p>}
                  {selectedTags.length > 0 && (
                    <section className="tag-shortcut-group selected-tags" aria-labelledby="selected-tags-heading">
                      <div className="tag-shortcut-heading">
                        <h3 id="selected-tags-heading">選択中</h3>
                        <span>{selectedTags.length}件</span>
                      </div>
                      <div className="tag-choices">{selectedTags.map(renderTagChoice)}</div>
                    </section>
                  )}
                  {quickTags.length > 0 && (
                    <section className="tag-shortcut-group quick-tags" aria-labelledby="quick-tags-heading">
                      <div className="tag-shortcut-heading">
                        <h3 id="quick-tags-heading">よく使う主ジャンル</h3>
                        <span>1回で選択</span>
                      </div>
                      <div className="tag-choices">{quickTags.map(renderTagChoice)}</div>
                    </section>
                  )}
                  <div className="tag-browser-heading">
                    <h3>すべてのタグ</h3>
                    <p className="hint">大分類と小分類を順に開くと、必要なタグだけを表示できます。</p>
                  </div>
                  <div className="tag-accordion">
                    {bundle.tagIndex.categories.map((category) => {
                      const visibleSubcategories = category.subcategories
                        .map((subcategory) => ({
                          subcategory,
                          visibleTags: subcategory.tags.filter((tag) => availableTagIds.has(tag.tagId)),
                        }))
                        .filter(({ visibleTags }) => visibleTags.length > 0);
                      const visibleTagCount = visibleSubcategories
                        .reduce((total, { visibleTags }) => total + visibleTags.length, 0);
                      const selectedTagCount = visibleSubcategories
                        .reduce((total, { visibleTags }) => total + visibleTags.filter((tag) => selected.has(tag.tagId)).length, 0);
                      if (visibleTagCount === 0) return null;
                      return (
                        <details className="tag-category" key={category.categoryId}>
                          <summary>
                            <span>{category.name}</span>
                            <span className="tag-accordion-count">
                              {selectedTagCount > 0 ? `${selectedTagCount}件選択中・` : ''}{visibleTagCount}件
                            </span>
                          </summary>
                          <div className="tag-category-content">
                            {visibleSubcategories.map(({ subcategory, visibleTags }) => {
                              const subcategorySelectedCount = visibleTags.filter((tag) => selected.has(tag.tagId)).length;
                              return (
                                <details className="tag-subcategory" key={subcategory.subcategoryId}>
                                  <summary>
                                    <span>{subcategory.name}</span>
                                    <span className="tag-accordion-count">
                                      {subcategorySelectedCount > 0 ? `${subcategorySelectedCount}件選択中・` : ''}{visibleTags.length}件
                                    </span>
                                  </summary>
                                  <div className="tag-choices">{visibleTags.map(renderTagChoice)}</div>
                                </details>
                              );
                            })}
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </div>
              </div>
            </fieldset>
          </details>
        </form>
      </section>

      <section className="results" aria-labelledby="results-heading">
        <div className="results-heading">
          <div>
            <p className="eyebrow">検索結果</p>
            <h2 ref={resultsHeadingRef} id="results-heading" tabIndex={-1} aria-live="polite">{errors.length > 0 ? '条件を確認してください' : `${results.length}件の動画`}</h2>
          </div>
          <label>並び順
            <select value={condition.sort ?? (condition.query ? '関連度順' : '公開日の新しい順')} onChange={(event) => {
              const next = { ...condition, sort: event.target.value as SortOrder };
              searchStartedAt.current = performance.now();
              pendingParams.current = serializeCondition(next);
              setAppliedCondition(next);
            }}>
              {sortOrders.map((sort) => <option key={sort}>{sort}</option>)}
            </select>
          </label>
        </div>
        <p className="screen-reader-only" role="status" data-testid="result-update-status" data-search-computation-ms={searchComputationMs.current.toFixed(1)}>{resultAnnouncement}</p>
        {results.length === 0 && errors.length === 0 ? (
          <div className="empty-state">
            <h3>一致する動画がありません</h3>
            <p>言葉を短くするか、タグや期間を減らしてみてください。</p>
            <button className="button secondary" type="button" onClick={clear}>条件をすべて解除</button>
          </div>
        ) : (
          <div className="video-grid">
            {results.slice(0, visibleCount).flatMap((result, index) => {
              const video = summaries.get(result.videoId);
              return video ? [<VideoCard key={`result-slot-${index}`} video={video} />] : [];
            })}
          </div>
        )}
        {visibleCount < results.length && (
          <button className="button secondary load-more" type="button" onClick={() => setVisibleCount((current) => current + pageSize)}>
            さらに表示（残り{results.length - visibleCount}件）
          </button>
        )}
      </section>
    </main>
  );
}

function searchFilterBounds(videos: Array<{ publishedAt: string; durationSeconds: number | null }>): {
  minimumDate: string;
  maximumDate: string;
  maximumDurationMinutes: number;
} {
  const today = dateInJapan(new Date().toISOString());
  let minimumDate = '';
  let maximumDate = '';
  let maximumDurationSeconds = 0;
  for (const video of videos) {
    const publishedDate = dateInJapan(video.publishedAt);
    if (!minimumDate || publishedDate < minimumDate) minimumDate = publishedDate;
    if (!maximumDate || publishedDate > maximumDate) maximumDate = publishedDate;
    maximumDurationSeconds = Math.max(maximumDurationSeconds, video.durationSeconds ?? 0);
  }
  return {
    minimumDate: minimumDate || today,
    maximumDate: maximumDate || today,
    maximumDurationMinutes: Math.max(240, Math.ceil(maximumDurationSeconds / 1800) * 30),
  };
}

function durationFilterOf(
  durationBucket: DurationBucket | undefined,
  durationMinMinutes: number | undefined,
  durationMaxMinutes: number | undefined,
): DurationFilter {
  return {
    ...(durationBucket ? { durationBucket } : {}),
    ...(durationMinMinutes !== undefined ? { durationMinMinutes } : {}),
    ...(durationMaxMinutes !== undefined ? { durationMaxMinutes } : {}),
  };
}
