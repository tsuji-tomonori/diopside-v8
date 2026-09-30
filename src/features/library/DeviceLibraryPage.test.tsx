import { IDBFactory } from 'fake-indexeddb';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { DeviceStoreContext } from '../../contexts.ts';
import { DeviceStore } from '../../data/deviceStore.ts';
import { parseCondition } from '../../domain/search.ts';
import { DeviceLibraryPage } from './DeviceLibraryPage.tsx';

function SearchDestination(): React.JSX.Element {
  return <output data-testid="destination">{JSON.stringify(parseCondition(new URLSearchParams(useLocation().search)))}</output>;
}

it('最近の検索はALL・ANY・除外を見分け、選択した条件を復元する', async () => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: new IDBFactory() });
  const store = new DeviceStore();
  const condition = { query: '雑談', tagIds: ['tag-a', 'tag-b'], tagMatch: 'any' as const, excludedTagIds: ['tag-c'] };
  await store.saveRecentSearch(condition);
  render(<MemoryRouter initialEntries={['/library']}><DeviceStoreContext.Provider value={store}><Routes><Route path="/library" element={<DeviceLibraryPage />} /><Route path="/" element={<SearchDestination />} /></Routes></DeviceStoreContext.Provider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '雑談・タグ2件（いずれかを含む）・除外タグ1件' }));
  expect(JSON.parse(screen.getByTestId('destination').textContent ?? '{}')).toEqual(condition);
});
