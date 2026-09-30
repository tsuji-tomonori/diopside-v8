import { useEffect, useMemo, useRef, useState } from 'react';

import {
  applySearch,
  searchTagSuggestions,
  withTagSelection,
  type SearchCondition,
  type SearchVideo,
  type SuggestionTag,
} from '../../domain/search.ts';

interface TagSearchControlsProps {
  condition: SearchCondition;
  countCondition: SearchCondition;
  videos: SearchVideo[];
  tags: SuggestionTag[];
  onChange: (condition: SearchCondition) => boolean;
}

export function TagSearchControls({ condition, countCondition, videos, tags, onChange }: TagSearchControlsProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<'include' | 'exclude'>('include');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.tagId, tag])), [tags]);
  const choices = useMemo(() => searchTagSuggestions(query, tags).map((tag) => ({
    ...tag,
    resultCount: applySearch(videos, withTagSelection(countCondition, tag.tagId, selection)).length,
  })), [countCondition, query, selection, tags, videos]);
  const included = condition.tagIds;
  const excluded = condition.excludedTagIds ?? [];
  const targetIds = selection === 'include' ? included : excluded;
  const atLimit = targetIds.length >= 30;
  const showChoices = open && query.trim().length > 0;
  const choiceStatus = (choice: (typeof choices)[number]): string => targetIds.includes(choice.tagId) ? '選択済み' : atLimit ? '上限30件' : `${choice.resultCount}件`;
  const isDisabled = (choice: (typeof choices)[number]): boolean => (
    targetIds.includes(choice.tagId) || atLimit || (selection === 'include' && choice.resultCount === 0)
  );

  const choose = (index: number): void => {
    const choice = choices[index];
    if (!choice || isDisabled(choice)) return;
    if (!onChange(withTagSelection(condition, choice.tagId, selection))) return;
    setQuery('');
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const move = (direction: 1 | -1): void => {
    if (choices.length === 0) return;
    let index = activeIndex >= 0 ? activeIndex : direction === 1 ? -1 : 0;
    for (let step = 0; step < choices.length; step += 1) {
      index = (index + direction + choices.length) % choices.length;
      const choice = choices[index];
      if (choice && !isDisabled(choice)) {
        setActiveIndex(index);
        break;
      }
    }
  };

  useEffect(() => {
    if (showChoices && activeIndex >= 0) listRef.current?.querySelector(`[id="tag-composer-option-${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, showChoices]);

  return (
    <section className="tag-composer" aria-labelledby="tag-composer-heading">
      <div className="tag-composer-heading">
        <h2 id="tag-composer-heading">タグを組み合わせて探す</h2>
        <p className="hint">分類・人物・作品・企画を、この画面で組み合わせられます。</p>
      </div>
      <div className="tag-composer-controls">
        <label className="tag-composer-match">含めるタグの条件
          <select value={condition.tagMatch ?? 'all'} onChange={(event) => {
            const { tagMatch: _match, ...rest } = condition;
            onChange(event.target.value === 'any' ? { ...rest, tagMatch: 'any' } : rest);
          }}>
            <option value="all">すべて含む（AND）</option>
            <option value="any">いずれかを含む（OR）</option>
          </select>
        </label>
        <label className="tag-composer-selection">追加する条件
          <select value={selection} onChange={(event) => {
            setSelection(event.target.value === 'exclude' ? 'exclude' : 'include');
            setActiveIndex(-1);
          }}>
            <option value="include">含める</option>
            <option value="exclude">除外する</option>
          </select>
        </label>
        <div className="tag-composer-search" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}>
          <label htmlFor="tag-composer-input">タグ名・別名・読みで探す</label>
          <input
            ref={inputRef}
            id="tag-composer-input"
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="tag-composer-options"
            aria-expanded={showChoices}
            aria-activedescendant={showChoices && activeIndex >= 0 ? `tag-composer-option-${activeIndex}` : undefined}
            aria-describedby="tag-composer-hint"
            autoComplete="off"
            placeholder="例: 雑談、ホラー、人物名"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Escape') { setOpen(false); setActiveIndex(-1); return; }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setOpen(true);
                move(event.key === 'ArrowDown' ? 1 : -1);
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                if (showChoices && activeIndex >= 0) choose(activeIndex);
                else { setOpen(true); move(1); }
              }
            }}
          />
          {showChoices && (
            <div className="tag-composer-popover">
              <p className="hint">{selection === 'include' ? '追加' : '除外'}した後の動画件数</p>
              <div ref={listRef} id="tag-composer-options" role="listbox" aria-label="組み合わせるタグ候補">
                {choices.map((choice, index) => (
                  <button
                    key={choice.tagId}
                    data-tag-id={choice.tagId}
                    id={`tag-composer-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    aria-label={`${choice.canonicalName} ${choice.categoryLabel ?? (choice.entityId ? '関連項目' : '分類')} ${choiceStatus(choice)}`}
                    disabled={isDisabled(choice)}
                    className="tag-composer-option"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(index)}
                  >
                    <span>{choice.canonicalName}<small>{choice.categoryLabel ?? (choice.entityId ? '関連項目' : '分類')}</small></span>
                    <span>{choiceStatus(choice)}</span>
                  </button>
                ))}
              </div>
              <p role="status" className="hint">
                {choices.length === 0 ? '一致する登録済みタグがありません。短い言葉や別名を試してください。'
                  : choices.length === 12 ? '上位12件を表示しています。文字を追加すると絞り込めます。'
                    : `${choices.length}件のタグ候補`}
              </p>
            </div>
          )}
        </div>
      </div>
      <p id="tag-composer-hint" className="hint">選ぶとすぐに結果へ反映します。除外タグは、どれか一つでも含む動画を除きます。0件の候補は他の条件を緩めると選べます。</p>
      {atLimit && <p role="status" className="hint">含めるタグ・除外するタグはそれぞれ30件までです。選択中のタグを外してから追加してください。</p>}
      {(included.length > 0 || excluded.length > 0) && (
        <div className="tag-composer-active" aria-label="適用中のタグ条件">
          {([{ ids: included, label: condition.tagMatch === 'any' ? 'いずれかを含む' : 'すべて含む', kind: 'include' }, { ids: excluded, label: '除外する', kind: 'exclude' }] as const)
            .filter((group) => group.ids.length > 0)
            .map((group) => (
              <div className={`tag-composer-group is-${group.kind}`} key={group.kind}>
                <strong>{group.label}</strong>
                <div className="tag-composer-chips">
                  {group.ids.map((tagId) => {
                    const name = tagById.get(tagId)?.canonicalName ?? tagId;
                    return <button type="button" key={tagId} aria-label={`${group.label}: ${name}を解除`} onClick={() => onChange(withTagSelection(condition, tagId, 'remove'))}>{name}<span aria-hidden="true">×</span></button>;
                  })}
                </div>
              </div>
            ))}
          <button className="button ghost" type="button" onClick={() => {
            const { excludedTagIds: _excluded, tagMatch: _match, ...rest } = condition;
            onChange({ ...rest, tagIds: [] });
          }}>タグ条件だけ解除</button>
        </div>
      )}
    </section>
  );
}
