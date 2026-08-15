import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { BundleContext, DeviceStoreContext } from '../../contexts.ts';
import { DeviceStore } from '../../data/deviceStore.ts';
import type { PublicBundle } from '../../data/loadPublicData.ts';
import { WorkDetailPage } from './WorkDetailPage.tsx';

const root = process.cwd();

describe('作品ページ', () => {
  it('公式説明の引用・出典リンク・同じ作品の動画だけを表示する', () => {
    const bundle = publicBundle();
    render(
      <MemoryRouter initialEntries={['/works/tag-works-gameTitle-942446bc56ac']}>
        <DeviceStoreContext.Provider value={new DeviceStore()}>
          <BundleContext.Provider value={bundle}>
            <Routes><Route path="/works/:tagId" element={<WorkDetailPage />} /></Routes>
          </BundleContext.Provider>
        </DeviceStoreContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'SILENT HILL2' })).toBeVisible();
    expect(screen.getByText(/シリーズ最高傑作と名高いサイコロジカルホラー/u)).toBeVisible();
    expect(screen.getByRole('link', { name: 'SILENT HILL 2 公式サイト' })).toHaveAttribute(
      'href',
      'https://www.konami.com/games/silenthill/2r/jp/ja/',
    );
    expect(document.querySelectorAll('.work-results .video-card')).toHaveLength(4);
  });

  it('公式紹介文を掲載できない場合は調査結果を表示する', () => {
    const bundle = publicBundle();
    const work = bundle.tagIndex.categories
      .find((category) => category.categoryId === 'works')
      ?.subcategories.flatMap((subcategory) => subcategory.tags)
      .find((tag) => tag.tagId === 'tag-works-gameTitle-44ffcf49bd94');
    if (!work) throw new Error('テスト用の作品タグが見つかりません。');
    work.introductionUnavailable = {
      reasonCode: 'official-source-unavailable',
      reason: '原作はSteamから恒久的に削除され、原作アプリIDの公式コミュニティページにも紹介本文がありません。',
      checkedAt: '2026-08-15',
      reference: {
        url: 'https://steamcommunity.com/app/2381590',
        label: 'Steam公式コミュニティページ（販売終了）',
      },
    };
    render(
      <MemoryRouter initialEntries={['/works/tag-works-gameTitle-44ffcf49bd94']}>
        <DeviceStoreContext.Provider value={new DeviceStore()}>
          <BundleContext.Provider value={bundle}>
            <Routes><Route path="/works/:tagId" element={<WorkDetailPage />} /></Routes>
          </BundleContext.Provider>
        </DeviceStoreContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Only Up!' })).toBeVisible();
    expect(screen.getByText('公式紹介文を掲載できない理由')).toBeVisible();
    expect(screen.getByText(/公式コミュニティページにも紹介本文がありません/u)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Steam公式コミュニティページ（販売終了）' })).toHaveAttribute(
      'href',
      'https://steamcommunity.com/app/2381590',
    );
    expect(screen.getByText('調査日: 2026年8月15日')).toBeVisible();
    expect(screen.queryByText('作品紹介の調査結果がありません。')).not.toBeInTheDocument();
  });
});

function publicBundle(): PublicBundle {
  const latest = json('public/data/latest.json') as PublicBundle['latest'];
  return {
    latest,
    index: json(`public/${latest.indexPath}`) as PublicBundle['index'],
    searchIndex: json(`public/${latest.searchIndexPath}`) as PublicBundle['searchIndex'],
    tagIndex: json(`public/${latest.tagIndexPath}`) as PublicBundle['tagIndex'],
    aliasIndex: json(`public/${latest.aliasIndexPath}`) as PublicBundle['aliasIndex'],
  };
}

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}
