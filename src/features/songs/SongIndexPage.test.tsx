import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { BundleContext } from '../../contexts.ts';
import type { PublicBundle } from '../../data/loadPublicData.ts';
import { SongIndexPage } from './SongIndexPage.tsx';

const root = process.cwd();

describe('歌唱楽曲一覧', () => {
  it('歌ってみたと配信内歌唱を、原曲と正確な開始秒へのリンク付きで表示する', () => {
    renderPage('/songs');

    expect(screen.getByRole('heading', { level: 1, name: '歌った曲' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '吉原ラメント' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: '原曲を聴く ↗' })[0]).toHaveAttribute('href', expect.stringMatching(/^https:\/\/www\.youtube\.com\/watch/u));
    expect(screen.getByRole('link', { name: '10:33 から見る ↗' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=ARViApkvV-E&t=633s',
    );
    expect(screen.getAllByText('歌ってみた').length).toBeGreaterThan(0);
    expect(screen.getAllByText('歌枠')).toHaveLength(4);
  });

  it('白雪巴の歌唱を原曲より先に表示し、動画を主操作にする', () => {
    renderPage('/songs/tag-works-songTitle-f7c683c127e9');

    const card = screen.getByRole('heading', { level: 2, name: '可愛くてごめん' }).closest('article');
    if (!card) {
      throw new Error('楽曲カードが見つかりません');
    }

    const performanceHeading = within(card).getByRole('heading', { level: 3, name: '白雪巴の歌唱' });
    const originalHeading = within(card).getByRole('heading', { level: 3, name: '原曲情報' });
    expect(performanceHeading.compareDocumentPosition(originalHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(card).getByRole('link', { name: '10:33 から見る ↗' })).toHaveClass('primary');
    expect(within(card).getByRole('link', { name: '原曲を聴く ↗' })).toHaveClass('secondary');
  });

  it('楽曲タグのURLで対象曲だけを表示する', () => {
    renderPage('/songs/tag-works-songTitle-f7c683c127e9');

    expect(screen.getByRole('heading', { level: 1, name: '可愛くてごめん' })).toBeVisible();
    expect(screen.getAllByText(/HoneyWorks/u).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: '吉原ラメント' })).not.toBeInTheDocument();
  });
});

function renderPage(initialEntry: string): void {
  const bundle = publicBundle();
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BundleContext.Provider value={bundle}>
        <Routes><Route path="/songs/:tagId?" element={<SongIndexPage />} /></Routes>
      </BundleContext.Provider>
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
  };
}

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}
