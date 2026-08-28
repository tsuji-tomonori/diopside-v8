import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { BundleContext, DeviceStoreContext } from '../../contexts.ts';
import { DeviceStore } from '../../data/deviceStore.ts';
import type { PublicBundle } from '../../data/loadPublicData.ts';
import { CollaboratorDetailPage } from './CollaboratorDetailPage.tsx';
import { GroupDetailPage } from './GroupDetailPage.tsx';

const root = process.cwd();

describe('コラボ相手・コンビページ', () => {
  it('人物名、ローカルアイコン、YouTubeチャンネル、共演動画を表示する', () => {
    const bundle = publicBundle();
    const fumi = findTag(bundle, 'performer', 'フミ');
    if (!fumi.personProfile) throw new Error('フミの人物プロフィールがありません。');
    render(
      <MemoryRouter initialEntries={[`/collaborators/${fumi.tagId}`]}>
        <DeviceStoreContext.Provider value={new DeviceStore()}>
          <BundleContext.Provider value={bundle}>
            <Routes><Route path="/collaborators/:tagId" element={<CollaboratorDetailPage />} /></Routes>
          </BundleContext.Provider>
        </DeviceStoreContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'フミ' })).toBeVisible();
    expect(document.querySelector('.person-avatar')).toHaveAttribute('src', expect.stringContaining('/people/icons/'));
    expect(screen.getByRole('link', { name: 'YouTubeチャンネルを見る' })).toHaveAttribute('href', fumi.personProfile.youtubeChannelUrl);
    expect(document.querySelectorAll('.collaboration-results .video-card').length).toBeGreaterThan(0);
  });

  it('フルトイの説明、出典、全メンバーのYouTubeリンク、動画一覧を表示する', () => {
    const bundle = publicBundle();
    const fultoi = findTag(bundle, 'unit', 'フルトイ');
    render(
      <MemoryRouter initialEntries={[`/groups/${fultoi.tagId}`]}>
        <DeviceStoreContext.Provider value={new DeviceStore()}>
          <BundleContext.Provider value={bundle}>
            <Routes><Route path="/groups/:tagId" element={<GroupDetailPage />} /></Routes>
          </BundleContext.Provider>
        </DeviceStoreContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'フルトイ' })).toBeVisible();
    expect(screen.getByText(/フミ、ルイス・キャミー、白雪巴/u)).toBeVisible();
    expect(screen.getByRole('link', { name: 'にじさんじ非公式Wiki「フルトイ」' })).toHaveAttribute('href', 'https://wikiwiki.jp/nijisanji/%E3%83%95%E3%83%AB%E3%83%88%E3%82%A4');
    expect(screen.getAllByText('YouTubeチャンネル →')).toHaveLength(3);
    expect(document.querySelectorAll('.collaboration-results .video-card').length).toBeGreaterThan(0);
  });
});

function findTag(bundle: PublicBundle, subcategoryId: 'performer' | 'unit', name: string) {
  const tag = bundle.tagIndex.categories
    .find((category) => category.categoryId === 'people')
    ?.subcategories.find((subcategory) => subcategory.subcategoryId === subcategoryId)
    ?.tags.find((item) => item.canonicalName === name);
  if (!tag) throw new Error(`テスト用タグが見つかりません: ${name}`);
  return tag;
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
  };
}

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}
