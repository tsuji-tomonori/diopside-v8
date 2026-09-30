import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';

import { normalizeTitleForSearch, type SearchCondition, type SearchVideo, type SuggestionTag } from '../../domain/search.ts';
import { TagSearchControls } from './TagSearchControls.tsx';

const tags: SuggestionTag[] = [
  { tagId: 'tag-chat', canonicalName: '雑談', normalizedReading: 'ざつだん', aliases: ['おしゃべり', '共通候補'], count: 2 },
  { tagId: 'tag-game', canonicalName: 'ゲーム', normalizedReading: 'げーむ', aliases: ['共通候補'], count: 2 },
  { tagId: 'tag-person', canonicalName: '白雪巴', normalizedReading: 'しらゆきともえ', aliases: ['巴さん'], count: 1, entityId: 'entity-person' },
];
const videos: SearchVideo[] = [
  { videoId: 'video000001', normalizedTitle: normalizeTitleForSearch('朝の配信'), normalizedReading: 'あさのはいしん', publishedAt: '2026-01-01T00:00:00Z', durationSeconds: 600, tagIds: ['tag-chat', 'tag-person'], entityIds: [] },
  { videoId: 'video000002', normalizedTitle: normalizeTitleForSearch('夜の配信'), normalizedReading: 'よるのはいしん', publishedAt: '2026-01-02T00:00:00Z', durationSeconds: 600, tagIds: ['tag-game'], entityIds: [] },
  { videoId: 'video000003', normalizedTitle: normalizeTitleForSearch('昼の配信'), normalizedReading: 'ひるのはいしん', publishedAt: '2026-01-03T00:00:00Z', durationSeconds: 600, tagIds: ['tag-chat', 'tag-game'], entityIds: [] },
];

function renderControls(initial: SearchCondition = { query: '', tagIds: [] }): void {
  function Harness(): React.JSX.Element {
    const [condition, setCondition] = useState(initial);
    return <><TagSearchControls condition={condition} countCondition={condition} videos={videos} tags={tags} onChange={(next) => { setCondition(next); return true; }} /><output data-testid="condition">{JSON.stringify(condition)}</output></>;
  }
  render(<Harness />);
}

function condition(): SearchCondition {
  return JSON.parse(screen.getByTestId('condition').textContent ?? '{}') as SearchCondition;
}

function findTag(query: string): void {
  fireEvent.change(screen.getByRole('combobox', { name: 'タグ名・別名・読みで探す' }), { target: { value: query } });
}

describe('タグ組み合わせ検索', () => {
  it('別名の部分入力から即時に追加し、入力欄を維持して複数タグを組み合わせる', () => {
    renderControls();
    findTag('おしゃ');
    fireEvent.click(screen.getByRole('option', { name: '雑談 分類 2件' }));
    expect(condition()).toEqual({ query: '', tagIds: ['tag-chat'] });
    expect(screen.getByRole('combobox', { name: 'タグ名・別名・読みで探す' })).toHaveFocus();
    findTag('ゲーム');
    fireEvent.click(screen.getByRole('option', { name: 'ゲーム 分類 1件' }));
    expect(condition().tagIds).toEqual(['tag-chat', 'tag-game']);
    expect(screen.getByRole('button', { name: 'すべて含む: 雑談を解除' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('含めるタグの条件'), { target: { value: 'any' } });
    expect(condition().tagMatch).toBe('any');
    expect(screen.getByRole('button', { name: 'いずれかを含む: ゲームを解除' })).toBeVisible();
  });

  it('人物タグも詳細ページへ移動せず組み合わせ、除外へ移した場合は含める側から取り除く', () => {
    renderControls({ query: '', tagIds: ['tag-chat', 'tag-person'], tagMatch: 'any' });
    fireEvent.change(screen.getByLabelText('追加する条件'), { target: { value: 'exclude' } });
    findTag('しら');
    fireEvent.click(screen.getByRole('option', { name: '白雪巴 関連項目 1件' }));
    expect(condition()).toEqual({ query: '', tagIds: ['tag-chat'], tagMatch: 'any', excludedTagIds: ['tag-person'] });
    expect(screen.getByRole('button', { name: '除外する: 白雪巴を解除' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '除外する: 白雪巴を解除' }));
    expect(condition().excludedTagIds).toBeUndefined();
  });

  it('0件の候補を明示し、ANYへ緩めれば追加できる', () => {
    renderControls({ query: '', tagIds: ['tag-person'] });
    findTag('ゲーム');
    expect(screen.getByRole('option', { name: 'ゲーム 分類 0件' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('含めるタグの条件'), { target: { value: 'any' } });
    expect(screen.getByRole('option', { name: 'ゲーム 分類 3件' })).toBeEnabled();
  });

  it('タグだけ解除してタイトル・期間・長さを保持する', () => {
    renderControls({ query: '朝', tagIds: ['tag-chat'], tagMatch: 'any', excludedTagIds: ['tag-game'], publishedFrom: '2026-01-01', durationMaxMinutes: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'タグ条件だけ解除' }));
    expect(condition()).toEqual({ query: '朝', tagIds: [], publishedFrom: '2026-01-01', durationMaxMinutes: 10 });
  });

  it('矢印キーとEnterで選択し、IME確定EnterとEscapeでは選択しない', () => {
    renderControls();
    findTag('ざつ');
    const input = screen.getByRole('combobox', { name: 'タグ名・別名・読みで探す' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'tag-composer-option-0');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(condition().tagIds).toEqual([]);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(condition().tagIds).toEqual([]);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(condition().tagIds).toEqual(['tag-chat']);
  });

  it('未選択からArrowUpで最後の選択可能候補へ移る', () => {
    renderControls();
    findTag('共通候補');
    const input = screen.getByRole('combobox', { name: 'タグ名・別名・読みで探す' });
    expect(within(screen.getByRole('listbox', { name: '組み合わせるタグ候補' })).getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', 'tag-composer-option-1');
  });

  it('候補なしと選択済みを明示し、繰り返し選択で重複しない', () => {
    renderControls({ query: '', tagIds: ['tag-chat'] });
    findTag('ざつ');
    const option = screen.getByRole('option', { name: '雑談 分類 選択済み' });
    expect(option).toBeDisabled();
    fireEvent.click(option);
    expect(condition().tagIds).toEqual(['tag-chat']);
    findTag('存在しないタグ');
    expect(within(document.querySelector('.tag-composer-popover') as HTMLElement).getByRole('status')).toHaveTextContent('一致する登録済みタグがありません');
  });

  it('30件の上限で追加を止めても既存タグの解除はできる', () => {
    renderControls({ query: '', tagIds: Array.from({ length: 30 }, (_, index) => `other-${index}`), tagMatch: 'any' });
    findTag('ざつ');
    expect(screen.getByRole('option', { name: '雑談 分類 上限30件' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'いずれかを含む: other-0を解除' }));
    expect(screen.getByRole('option', { name: '雑談 分類 2件' })).toBeEnabled();
  });
});
