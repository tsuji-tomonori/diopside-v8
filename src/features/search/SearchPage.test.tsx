import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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

    const categorySummary = screen.getByText('人物・グループ');
    fireEvent.click(categorySummary);
    expect(categorySummary.closest('details')).toHaveAttribute('open');
    expect(document.querySelectorAll('.tag-subcategory[open]')).toHaveLength(0);

    const subcategorySummary = screen.getByText('ユニット・チーム');
    fireEvent.click(subcategorySummary);
    expect(subcategorySummary.closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: /女王と会長/u })).toBeVisible();
  });
});

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <DeviceStoreContext.Provider value={new DeviceStore()}>
        <BundleContext.Provider value={publicBundle()}>
          <Routes><Route path="/" element={<SearchPage />} /></Routes>
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
  };
}

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}
