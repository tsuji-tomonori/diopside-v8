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

  it('未登録の作品は説明を捏造せず、動画一覧を表示する', () => {
    const bundle = publicBundle();
    render(
      <MemoryRouter initialEntries={['/works/tag-works-gameTitle-c45f1a817134']}>
        <DeviceStoreContext.Provider value={new DeviceStore()}>
          <BundleContext.Provider value={bundle}>
            <Routes><Route path="/works/:tagId" element={<WorkDetailPage />} /></Routes>
          </BundleContext.Provider>
        </DeviceStoreContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: '番外編' })).toBeVisible();
    expect(screen.getByText('この作品の公式紹介文は確認中です。動画一覧は引き続き利用できます。')).toBeVisible();
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
