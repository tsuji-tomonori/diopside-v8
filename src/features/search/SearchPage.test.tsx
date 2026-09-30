import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { BundleContext, DeviceStoreContext } from '../../contexts.ts';
import { DeviceStore } from '../../data/deviceStore.ts';
import type { PublicBundle } from '../../data/loadPublicData.ts';
import { SearchPage } from './SearchPage.tsx';

const root = process.cwd();

describe('検索画面の詳細絞り込み', () => {
  it('公開日と動画長を先に置き、タグは短い導線と閉じた二段階分類で表示する', () => {
    renderPage();

    const filterSummary = screen.getByText('タグ・公開日・動画長で絞り込む');
    const filterDrawer = filterSummary.closest('details');
    const dateRangeTrigger = screen.getByRole('button', { name: /公開日の範囲/u });
    const tagFilter = document.querySelector('.tag-filter');
    if (!filterDrawer || !tagFilter) throw new Error('詳細絞り込みの構造を取得できません。');

    expect(Boolean(dateRangeTrigger.compareDocumentPosition(tagFilter) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(document.querySelectorAll('.tag-category[open]')).toHaveLength(0);
    expect(document.querySelectorAll('.tag-subcategory[open]')).toHaveLength(0);

    fireEvent.click(filterSummary);
    expect(filterDrawer).toHaveAttribute('open');
    expect(screen.getByLabelText('タグ名または別名から追加')).toBeVisible();
    expect(document.querySelector('.quick-tags .tag-choice')).toBeVisible();

    expect(screen.queryByText('人物・グループ')).not.toBeInTheDocument();
    expect(screen.getByText('分類から絞り込む')).toBeVisible();
    const categorySummary = screen.getByText('内容');
    fireEvent.click(categorySummary);
    expect(categorySummary.closest('details')).toHaveAttribute('open');
    expect(document.querySelectorAll('.tag-subcategory[open]')).toHaveLength(0);

    const subcategorySummary = screen.getByText('主ジャンル');
    fireEvent.click(subcategorySummary);
    expect(subcategorySummary.closest('details')).toHaveAttribute('open');
    const subcategoryDetails = subcategorySummary.closest('details');
    if (!subcategoryDetails) throw new Error('主ジャンルの分類を取得できません。');
    expect(within(subcategoryDetails).getByRole('button', { name: /^ゲーム/u })).toBeVisible();
  }, 20_000);
});

function renderPage(initialEntry = '/'): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <DeviceStoreContext.Provider value={new DeviceStore()}>
        <BundleContext.Provider value={publicBundle()}>
          <NavigationProbe /><Routes><Route path="/" element={<SearchPage />} /></Routes>
        </BundleContext.Provider>
      </DeviceStoreContext.Provider>
    </MemoryRouter>,
  );
}

function publicBundle(): PublicBundle {
  const latest = json('public/data/latest.json') as PublicBundle['latest'];
  return {
    latest,
    index: json(`public/${latest.indexPath}`) as PublicBundle['index'],
    searchIndex: json(`public/${latest.searchIndexPath}`) as PublicBundle['searchIndex'],
    tagIndex: json(`public/${latest.tagIndexPath}`) as PublicBundle['tagIndex'],
    aliasIndex: json(`public/${latest.aliasIndexPath}`) as PublicBundle['aliasIndex'],
    songIndex: json(`public/data/releases/${latest.releaseId}/song-index.json`) as PublicBundle['songIndex'],
    gameIndex: json(`public/${latest.gameIndexPath}`) as PublicBundle['gameIndex'],
    entityIndex: json(`public/${latest.entityIndexPath}`) as PublicBundle['entityIndex'],
  };
}

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}


function NavigationProbe(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.search}</output><button type="button" onClick={() => navigate(-1)}>前の検索へ戻る</button><button type="button" onClick={() => navigate(1)}>次の検索へ進む</button></>;
}

function locationParams(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('location').textContent ?? '');
}

describe('組み合わせタグとURLの連携', () => {
  const gameTag = 'tag-content-primary-0dbfa3115896';
  const collaborationTag = 'tag-context-participation-a4911ea059bb';

  it('AND・OR・除外を即時反映し、戻る・進むで条件と結果を復元する', async () => {
    const videos = publicBundle().searchIndex.videos;
    const expected = (mode: 'all' | 'any' | 'exclude'): number => videos.filter((video) => mode === 'all'
      ? video.tagIds.includes(gameTag) && video.tagIds.includes(collaborationTag)
      : mode === 'any' ? video.tagIds.includes(gameTag) || video.tagIds.includes(collaborationTag)
        : !video.tagIds.includes(gameTag) && video.tagIds.includes(collaborationTag)).length;
    renderPage(`/?tag=${gameTag}&tag=${collaborationTag}`);
    expect(screen.getByRole('heading', { name: `${expected('all')}件の動画` })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('含めるタグの条件'), { target: { value: 'any' } });
    await waitFor(() => expect(locationParams().get('tagMatch')).toBe('any'));
    expect(screen.getByRole('heading', { name: `${expected('any')}件の動画` })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('追加する条件'), { target: { value: 'exclude' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'タグ名・別名・読みで探す' }), { target: { value: 'げーむ' } });
    const candidate = document.querySelector(`.tag-composer-option[data-tag-id="${gameTag}"]`);
    if (!candidate) throw new Error('ゲームのタグ候補がありません。');
    fireEvent.click(candidate);
    await waitFor(() => expect(locationParams().getAll('exclude')).toEqual([gameTag]));
    expect(locationParams().getAll('tag')).toEqual([collaborationTag]);
    expect(screen.getByRole('heading', { name: `${expected('exclude')}件の動画` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '前の検索へ戻る' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: `${expected('any')}件の動画` })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'いずれかを含む: ゲームを解除' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次の検索へ進む' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: `${expected('exclude')}件の動画` })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '除外する: ゲームを解除' })).toBeInTheDocument();
  });

  it('新しいタグ入力では詳細絞り込みを勝手に開かずに動画を絞り込む', async () => {
    renderPage();
    const drawer = document.querySelector('.filter-drawer');
    expect(drawer).not.toHaveAttribute('open');
    fireEvent.change(screen.getByRole('combobox', { name: 'タグ名・別名・読みで探す' }), { target: { value: 'こらぼ' } });
    const candidate = document.querySelector(`.tag-composer-option[data-tag-id="${collaborationTag}"]`);
    if (!candidate) throw new Error('コラボのタグ候補がありません。');
    fireEvent.click(candidate);
    await waitFor(() => expect(locationParams().getAll('tag')).toEqual([collaborationTag]));
    expect(drawer).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'すべて含む: コラボを解除' })).toBeVisible();
  });

  it('初期URLの除外別名を不変IDに解決して復元する', () => {
    renderPage('/?tagMatch=any&tag=ゲーム&exclude=コラボ');
    expect(screen.getByLabelText('含めるタグの条件')).toHaveValue('any');
    expect(screen.getByRole('button', { name: '除外する: コラボを解除' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'いずれかを含む: ゲームを解除' })).toBeInTheDocument();
  });

  it('主検索から31個目のタグを追加しても見える警告で止め、URLを書き換えない', () => {
    const selected = publicBundle().tagIndex.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags))
      .filter((tag) => tag.count > 0 && tag.tagId !== collaborationTag).slice(0, 30).map((tag) => tag.tagId);
    const params = new URLSearchParams({ tagMatch: 'any' });
    for (const tagId of selected) params.append('tag', tagId);
    renderPage(`/?${params.toString()}`);
    fireEvent.change(screen.getByRole('combobox', { name: '検索' }), { target: { value: 'コラボ' } });
    fireEvent.click(within(screen.getByRole('listbox', { name: '検索候補' })).getByRole('option', { name: /^分類\s*コラボ\s*\d+件$/u }));
    expect(screen.getByRole('alert')).toHaveTextContent('それぞれ30件まで');
    expect(locationParams().getAll('tag')).toEqual(selected);
    expect(screen.queryByRole('button', { name: 'いずれかを含む: コラボを解除' })).not.toBeInTheDocument();
  });
});
