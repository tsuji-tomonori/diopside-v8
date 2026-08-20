import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { VideoCard } from '../../components/VideoCard.tsx';
import { useBundle, useDeviceStore } from '../../contexts.ts';
import {
  applySearch,
  buildSearchSuggestions,
  durationBuckets,
  normalizeTagAlias,
  parseCondition,
  serializeCondition,
  tagCountsForResults,
  validateCondition,
  type SearchCondition,
  type SortOrder,
} from '../../domain/search.ts';
import { formatDate } from '../../format.ts';

const sortOrders: SortOrder[] = ['関連度順', '公開日の新しい順', '公開日の古い順', '動画長の短い順', '動画長の長い順'];
const pageSize = 24;

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
  const searchStartedAt = useRef<number | null>(null);
  const searchComputationMs = useRef(0);
  const pendingParams = useRef<URLSearchParams | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const parsedCondition = useMemo(() => parseCondition(params), [params]);
  const summaries = useMemo(() => new Map(bundle.index.videos.map((video) => [video.videoId, video])), [bundle.index.videos]);
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
  const draftResults = useMemo(() => applySearch(bundle.searchIndex.videos, draft), [bundle.searchIndex.videos, draft]);
  const draftResultCount = draftResults.length;
  const tagCounts = useMemo(() => tagCountsForResults(draftResults), [draftResults]);
  const availableTagIds = new Set(tags.flatMap((tag) => (
    selected.has(tag.tagId) || (tagCounts.get(tag.tagId) ?? 0) > 0 ? [tag.tagId] : []
  )));

  useEffect(() => {
    setDraft(condition);
    setVisibleCount(pageSize);
  }, [condition]);

  useEffect(() => {
    if (appliedCondition && serializeCondition(appliedCondition).toString() === serializeCondition(urlCondition).toString()) {
      setAppliedCondition(null);
    }
  }, [appliedCondition, urlCondition]);

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

  const submit = (): boolean => {
    const nextErrors = validateCondition(draft);
    if (nextErrors.length > 0) return false;
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    searchStartedAt.current = performance.now();
    pendingParams.current = serializeCondition(draft);
    setAppliedCondition(draft);
    void store.saveRecentSearch(draft);
    return true;
  };

  const applyTagSuggestion = (tagId: string): void => {
    const next = { ...draft, query: '', tagIds: [...new Set([...draft.tagIds, tagId])] };
    setDraft(next);
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    searchStartedAt.current = performance.now();
    pendingParams.current = serializeCondition(next);
    setAppliedCondition(next);
    void store.saveRecentSearch(next);
  };

  const selectActiveSuggestion = (): boolean => {
    const option = suggestionOptions[activeSuggestionIndex];
    if (!option) return false;
    if (option.kind === 'video') navigate(`/video/${option.value.videoId}`);
    else applyTagSuggestion(option.value.tagId);
    return true;
  };

  const closeTagsAndShowResults = (): void => {
    if (!submit()) return;
    setTagsExpanded(false);
    requestAnimationFrame(() => {
      resultsHeadingRef.current?.focus({ preventScroll: true });
      resultsHeadingRef.current?.scrollIntoView({ block: 'start' });
    });
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
    const value = tagInput.trim();
    if (!value) return;
    const direct = knownTagIds.has(value) ? value : undefined;
    const tagId = direct ?? tagInputIndex.get(normalizeTagAlias(value));
    if (!tagId) {
      setTagError('一致する登録済みタグがありません。候補から選んでください。');
      return;
    }
    setDraft((current) => ({ ...current, tagIds: [...new Set([...current.tagIds, tagId])] }));
    setTagInput('');
    setTagError('');
  };

  const updateBucket = (value: string): void => {
    if (!value) {
      setDraft(({ durationBucket: _removed, ...current }) => current);
      return;
    }
    const bucket = durationBuckets.find((item) => item.label === value);
    if (!bucket) return;
    setDraft((current) => {
      const { durationMinMinutes: _minimum, durationMaxMinutes: _maximum, ...rest } = current;
      return {
      ...rest,
      durationBucket: bucket.label,
      ...(bucket.minSeconds !== undefined ? { durationMinMinutes: bucket.minSeconds / 60 } : { durationMinMinutes: 0 }),
      ...(bucket.maxSeconds !== undefined ? { durationMaxMinutes: bucket.maxSeconds / 60 } : {}),
    }; });
  };

  const updateManualDuration = (field: 'durationMinMinutes' | 'durationMaxMinutes', value: string): void => {
    setDraft(({ durationBucket: _removed, ...current }) => ({
      ...current,
      ...(value === '' ? { [field]: undefined } : { [field]: Number(value) }),
    }));
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
            <fieldset className="tag-filter">
              <legend>タグ</legend>
              <div className="tag-filter-toolbar">
                <p className="hint">タグ名はタイトル検索へ自動では追加されません。複数選択は「すべて含む」です。</p>
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
              <div id="tag-filter-content" hidden={!tagsExpanded}>
                <label className="tag-input-label" htmlFor="tag-name">タグ名または別名から追加</label>
                <div className="tag-input-row">
                  <input id="tag-name" list="tag-name-options" value={tagInput} onChange={(event) => setTagInput(event.target.value)} />
                  <datalist id="tag-name-options">
                    {tags.filter((tag) => availableTagIds.has(tag.tagId)).map((tag) => <option key={tag.tagId} value={tag.canonicalName} />)}
                    {Object.entries(bundle.aliasIndex.aliases)
                      .filter(([, tagId]) => availableTagIds.has(tagId))
                      .map(([alias]) => <option key={`alias-${alias}`} value={alias} />)}
                  </datalist>
                  <button className="button secondary" type="button" onClick={addTagByName}>タグを追加</button>
                </div>
                {tagError && <p className="form-error" role="alert">{tagError}</p>}
                {bundle.tagIndex.categories.map((category) => {
                  const visible = category.subcategories
                    .flatMap((subcategory) => subcategory.tags)
                    .filter((tag) => availableTagIds.has(tag.tagId));
                  if (visible.length === 0) return null;
                  return (
                    <div className="tag-group" key={category.categoryId}>
                      <h3>{category.name}</h3>
                      <div className="tag-choices">
                        {visible.map((tag) => {
                          const count = selected.has(tag.tagId) ? draftResultCount : (tagCounts.get(tag.tagId) ?? 0);
                          return (
                            <button
                              type="button"
                              key={tag.tagId}
                              className="tag-choice"
                              aria-pressed={selected.has(tag.tagId)}
                              onClick={() => setDraft((current) => ({
                                ...current,
                                tagIds: selected.has(tag.tagId)
                                  ? current.tagIds.filter((id) => id !== tag.tagId)
                                  : [...current.tagIds, tag.tagId],
                              }))}
                            >
                              {tag.canonicalName}<span>{count}件</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <div className="filter-grid">
              <fieldset>
                <legend>公開日</legend>
                <label>開始日<input type="date" value={draft.publishedFrom ?? ''} onChange={(event) => setDraft((current) => setOptionalDate(current, 'publishedFrom', event.target.value))} /></label>
                <label>終了日<input type="date" value={draft.publishedTo ?? ''} onChange={(event) => setDraft((current) => setOptionalDate(current, 'publishedTo', event.target.value))} /></label>
              </fieldset>
              <fieldset>
                <legend>動画長</legend>
                <label>区分
                  <select value={draft.durationBucket ?? ''} onChange={(event) => updateBucket(event.target.value)}>
                    <option value="">指定しない</option>
                    {durationBuckets.map((bucket) => <option key={bucket.label}>{bucket.label}</option>)}
                  </select>
                </label>
                <div className="duration-inputs">
                  <label>最小（分）<input min="0" type="number" value={draft.durationMinMinutes ?? ''} onChange={(event) => updateManualDuration('durationMinMinutes', event.target.value)} /></label>
                  <label>最大（分）<input min="0" type="number" value={draft.durationMaxMinutes ?? ''} onChange={(event) => updateManualDuration('durationMaxMinutes', event.target.value)} /></label>
                </div>
              </fieldset>
            </div>
            {validateCondition(draft).map((error) => <p className="form-error" role="alert" key={error.field}>{error.message}</p>)}
            <div className="filter-actions">
              <button className="button primary" type="submit">絞り込みを反映</button>
              <button className="button ghost" type="button" onClick={clear}>条件をすべて解除</button>
            </div>
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

function setOptionalDate(
  condition: SearchCondition,
  key: 'publishedFrom' | 'publishedTo',
  value: string,
): SearchCondition {
  if (value) return { ...condition, [key]: value };
  if (key === 'publishedFrom') {
    const { publishedFrom: _removed, ...rest } = condition;
    return rest;
  }
  const { publishedTo: _removed, ...rest } = condition;
  return rest;
}
