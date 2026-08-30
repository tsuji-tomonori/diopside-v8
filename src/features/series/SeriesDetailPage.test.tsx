import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { BundleContext, DeviceStoreContext } from '../../contexts.ts';
import { DeviceStore } from '../../data/deviceStore.ts';
import type { PublicBundle } from '../../data/loadPublicData.ts';
import { SeriesDetailPage } from './SeriesDetailPage.tsx';

const root = process.cwd();

describe('定期・連続企画ページ', () => {
  it('企画名と、そのタグを持つ公開動画だけを表示する', () => {
    const bundle = publicBundle();
    const series = bundle.tagIndex.categories
      .find((category) => category.categoryId === 'program')
      ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'recurringSeries')
      ?.tags.find((tag) => tag.canonicalName === 'バーチャル3分劇場');
    if (!series) throw new Error('テスト用の定期・連続企画タグが見つかりません。');

    render(
      <MemoryRouter initialEntries={[`/series/${series.tagId}`]}>
        <DeviceStoreContext.Provider value={new DeviceStore()}>
          <BundleContext.Provider value={bundle}>
            <Routes><Route path="/series/:tagId" element={<SeriesDetailPage />} /></Routes>
          </BundleContext.Provider>
        </DeviceStoreContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'バーチャル3分劇場' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: `${series.videoIds.length}件の動画` })).toBeVisible();
    expect(document.querySelectorAll('.series-results .video-card')).toHaveLength(series.videoIds.length);
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
    songIndex: json(`public/data/releases/${latest.releaseId}/song-index.json`) as PublicBundle['songIndex'],
    gameIndex: json(`public/${latest.gameIndexPath}`) as PublicBundle['gameIndex'],
  };
}

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}
