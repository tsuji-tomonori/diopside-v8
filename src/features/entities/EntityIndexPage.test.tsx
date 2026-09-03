import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { BundleContext, DeviceStoreContext } from '../../contexts.ts';
import { DeviceStore } from '../../data/deviceStore.ts';
import type { PublicBundle } from '../../data/loadPublicData.ts';
import { EntityIndexPage } from './EntityIndexPage.tsx';

const root = process.cwd();

describe('人物・作品・企画の探索', () => {
  it('名前と種類で絞り込み、イベントから対象ゲームへ移動できる', () => {
    const bundle = publicBundle();
    const event = bundle.entityIndex.entities.find((entity) => entity.canonicalName === 'Niji_AmongUs');
    if (!event) throw new Error('Niji_AmongUsエンティティがありません。');
    const gameRelation = event.relations.find((relation) => relation.relationType === 'usesGame');
    const game = bundle.entityIndex.entities.find((entity) => entity.entityId === gameRelation?.entityId);
    expect(game?.canonicalName).toBe('Among Us');

    render(
      <MemoryRouter initialEntries={['/entities']}>
        <DeviceStoreContext.Provider value={new DeviceStore()}>
          <BundleContext.Provider value={bundle}>
            <Routes>
              <Route path="/entities" element={<EntityIndexPage />} />
              <Route path="/entities/:entityId" element={<EntityIndexPage />} />
            </Routes>
          </BundleContext.Provider>
        </DeviceStoreContext.Provider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('名前で検索'), { target: { value: 'Niji_AmongUs' } });
    fireEvent.click(screen.getByRole('link', { name: /Niji_AmongUs/u }));
    expect(screen.getByRole('heading', { name: 'Niji_AmongUs', level: 1 })).toBeVisible();
    expect(screen.getByRole('link', { name: /対象ゲームAmong Usゲーム作品/u })).toHaveAttribute('href', `/entities/${game?.entityId}`);
    expect(screen.getByText(/イベント参加/u)).toBeVisible();
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
    entityIndex: json(`public/${latest.entityIndexPath}`) as PublicBundle['entityIndex'],
  };
}

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}
