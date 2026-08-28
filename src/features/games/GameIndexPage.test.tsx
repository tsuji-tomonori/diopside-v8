import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { BundleContext } from '../../contexts.ts';
import type { PublicBundle } from '../../data/loadPublicData.ts';
import { GameIndexPage } from './GameIndexPage.tsx';

const root = process.cwd();

describe('ゲームを探す', () => {
  it('ジャンルごとにプレイしたゲームの件数を表示する', () => {
    renderPage('/games');

    expect(screen.getByRole('heading', { level: 1, name: 'ゲームを探す' })).toBeVisible();
    expect(screen.getByRole('link', { name: /アドベンチャー/u })).toHaveAttribute(
      'href',
      '/games/genres/tag-content-gameGenre-2ec4e38c680d',
    );
    expect(screen.queryByText('恋愛ゲーム')).not.toBeInTheDocument();
  });

  it('ジャンルから作品を選び、そのゲームの配信一覧へ進める', () => {
    renderPage('/games/genres/tag-content-gameGenre-2ec4e38c680d');

    expect(screen.getByRole('heading', { level: 1, name: 'アドベンチャー' })).toBeVisible();
    const gameLink = screen.getByRole('link', { name: 'ワガママハイスペック' });
    expect(gameLink).toHaveAttribute(
      'href',
      '/works/tag-works-gameTitle-ea18b3c09633',
    );
    const gameCard = gameLink.closest('article');
    expect(gameCard).not.toBeNull();
    expect(within(gameCard as HTMLElement).getByRole('link', { name: '6件の配信を見る →' })).toHaveAttribute(
      'href',
      '/works/tag-works-gameTitle-ea18b3c09633',
    );
  });
});

function renderPage(initialEntry: string): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BundleContext.Provider value={publicBundle()}>
        <Routes>
          <Route path="/games" element={<GameIndexPage />} />
          <Route path="/games/genres/:tagId" element={<GameIndexPage />} />
        </Routes>
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
