import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { VideoCard } from '../../components/VideoCard.tsx';
import { useBundle, useDeviceStore } from '../../contexts.ts';
import {
  applySearch,
  additionalTagCounts,
  durationBuckets,
  normalizeTagAlias,
  parseCondition,
  serializeCondition,
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
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<SearchCondition>(() => parseCondition(params));
  const [tagInput, setTagInput] = useState('');
  const [tagError, setTagError] = useState('');
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [resultAnnouncement, setResultAnnouncement] = useState('');
  const searchStartedAt = useRef<number | null>(null);
  const parsedCondition = useMemo(() => parseCondition(params), [params]);
  const summaries = useMemo(() => new Map(bundle.index.videos.map((video) => [video.videoId, video])), [bundle.index.videos]);
  const tags = useMemo(() => bundle.tagIndex.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags)), [bundle.tagIndex.categories]);
  const knownTagIds = useMemo(() => new Set(tags.map((tag) => tag.tagId)), [tags]);
  const tagInputIndex = useMemo(() => {
    const index = new Map(Object.entries(bundle.aliasIndex.aliases));
    for (const tag of tags) index.set(normalizeTagAlias(tag.canonicalName), tag.tagId);
    return index;
  }, [bundle.aliasIndex.aliases, tags]);
  const condition = useMemo(() => ({
    ...parsedCondition,
    tagIds: [...new Set(parsedCondition.tagIds.flatMap((value) => {
      const resolved = knownTagIds.has(value) ? value : tagInputIndex.get(normalizeTagAlias(value));
      return resolved ? [resolved] : [];
    }))],
  }), [knownTagIds, parsedCondition, tagInputIndex]);
  const errors = validateCondition(condition);
  const results = useMemo(() => applySearch(bundle.searchIndex.videos, condition), [bundle.searchIndex.videos, condition]);
  const selected = new Set(draft.tagIds);
  const draftResultCount = useMemo(() => applySearch(bundle.searchIndex.videos, draft).length, [bundle.searchIndex.videos, draft]);
  const tagCounts = useMemo(() => additionalTagCounts(bundle.searchIndex.videos, draft), [bundle.searchIndex.videos, draft]);

  useEffect(() => {
    setDraft(condition);
    setVisibleCount(pageSize);
  }, [condition]);

  useLayoutEffect(() => {
    if (searchStartedAt.current === null) return;
    const elapsed = performance.now() - searchStartedAt.current;
    searchStartedAt.current = null;
    setResultAnnouncement(`${results.length}件の検索結果へ更新しました。処理時間は${elapsed.toFixed(1)}ミリ秒です。`);
  }, [results.length, condition]);

  const submit = (): void => {
    const nextErrors = validateCondition(draft);
    if (nextErrors.length > 0) return;
    searchStartedAt.current = performance.now();
    setParams(serializeCondition(draft));
    void store.saveRecentSearch(draft);
  };

  const clear = (): void => {
    const empty = { query: '', tagIds: [] };
    setDraft(empty);
    setTagInput('');
    setTagError('');
    searchStartedAt.current = performance.now();
    setParams(new URLSearchParams());
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
        <h1>記憶のかけらから<br />動画へたどり着く。</h1>
        <p>タイトルの断片と、diopsideが整理・確認したタグから探せます。</p>
        <p className="updated">公開データ最終更新: {formatDate(bundle.latest.updatedAt)}</p>
      </section>

      <section className="search-panel" aria-labelledby="search-heading">
        <h2 id="search-heading">動画を検索</h2>
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label className="search-label" htmlFor="query">動画タイトル</label>
          <div className="search-row">
            <input
              id="query"
              type="search"
              value={draft.query}
              onChange={(event) => setDraft((current) => ({ ...current, query: event.target.value }))}
              placeholder="覚えている言葉を入力"
              autoComplete="off"
            />
            <button className="button primary" type="submit">この条件で探す</button>
          </div>

          <details className="filter-drawer" open={draft.tagIds.length > 0}>
            <summary>タグ・公開日・動画長で絞り込む</summary>
            <fieldset className="tag-filter">
              <legend>タグ</legend>
              <p className="hint">タグ名はタイトル検索へ自動では追加されません。複数選択は「すべて含む」です。</p>
              <label className="tag-input-label" htmlFor="tag-name">タグ名または別名から追加</label>
              <div className="tag-input-row">
                <input id="tag-name" list="tag-name-options" value={tagInput} onChange={(event) => setTagInput(event.target.value)} />
                <datalist id="tag-name-options">
                  {tags.map((tag) => <option key={tag.tagId} value={tag.canonicalName} />)}
                  {Object.keys(bundle.aliasIndex.aliases).map((alias) => <option key={`alias-${alias}`} value={alias} />)}
                </datalist>
                <button className="button secondary" type="button" onClick={addTagByName}>タグを追加</button>
              </div>
              {tagError && <p className="form-error" role="alert">{tagError}</p>}
              {bundle.tagIndex.categories.map((category) => {
                const visible = category.subcategories.flatMap((subcategory) => subcategory.tags).filter((tag) => tag.count > 0 || selected.has(tag.tagId));
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
            <h2 id="results-heading" aria-live="polite">{errors.length > 0 ? '条件を確認してください' : `${results.length}件の動画`}</h2>
          </div>
          <label>並び順
            <select value={condition.sort ?? (condition.query ? '関連度順' : '公開日の新しい順')} onChange={(event) => {
              const next = { ...condition, sort: event.target.value as SortOrder };
              searchStartedAt.current = performance.now();
              setParams(serializeCondition(next));
            }}>
              {sortOrders.map((sort) => <option key={sort}>{sort}</option>)}
            </select>
          </label>
        </div>
        <p className="screen-reader-only" role="status" data-testid="result-update-status">{resultAnnouncement}</p>
        {results.length === 0 && errors.length === 0 ? (
          <div className="empty-state">
            <h3>一致する動画がありません</h3>
            <p>言葉を短くするか、タグや期間を減らしてみてください。</p>
            <button className="button secondary" type="button" onClick={clear}>条件をすべて解除</button>
          </div>
        ) : (
          <div className="video-grid">
            {results.slice(0, visibleCount).flatMap((result) => {
              const video = summaries.get(result.videoId);
              return video ? [<VideoCard key={video.videoId} video={video} />] : [];
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
