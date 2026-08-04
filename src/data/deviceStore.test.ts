import { IDBFactory } from 'fake-indexeddb';

import type { PublicVideoSummary } from '../domain/content.ts';
import { DeviceStore } from './deviceStore.ts';

function summary(index: number): PublicVideoSummary {
  return {
    videoId: `video${String(index).padStart(6, '0')}`,
    title: `動画${index}`,
    normalizedTitle: `動画${index}`,
    publishedAt: '2026-01-01T00:00:00Z',
    durationSeconds: 600,
    thumbnail: { url: `https://i.ytimg.com/vi/video${String(index).padStart(6, '0')}/hqdefault.jpg`, width: 480, height: 360 },
    youtubeUrl: `https://www.youtube.com/watch?v=video${String(index).padStart(6, '0')}`,
    tagIds: [],
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: new IDBFactory() });
});

describe('端末内データ', () => {
  it('履歴を重複させず新しい順に最大200件保持する', async () => {
    const store = new DeviceStore();
    for (let index = 0; index < 205; index += 1) await store.recordHistory(summary(index));
    await store.recordHistory(summary(100));
    const history = await store.listHistory();
    expect(history).toHaveLength(200);
    expect(history[0]?.videoId).toBe(summary(100).videoId);
    expect(new Set(history.map((item) => item.videoId)).size).toBe(200);
  });

  it('お気に入りを重複保存せず、個別解除できる', async () => {
    const store = new DeviceStore();
    expect(await store.toggleFavorite(summary(1))).toBe(true);
    expect(await store.toggleFavorite(summary(1))).toBe(false);
    expect(await store.listFavorites()).toEqual([]);
  });

  it('最近の検索条件を同一条件1件かつ最大20件にする', async () => {
    const store = new DeviceStore();
    for (let index = 0; index < 25; index += 1) await store.saveRecentSearch({ query: `検索${index}`, tagIds: [] });
    await store.saveRecentSearch({ query: '検索10', tagIds: [] });
    const entries = await store.listRecentSearches();
    expect(entries).toHaveLength(20);
    expect(entries[0]?.condition.query).toBe('検索10');
    expect(new Set(entries.map((item) => item.key)).size).toBe(20);
  });

  it('一括削除は履歴、お気に入り、検索、公開キャッシュだけを消す', async () => {
    const store = new DeviceStore();
    await store.recordHistory(summary(1));
    await store.toggleFavorite(summary(2));
    await store.saveRecentSearch({ query: '雑談', tagIds: [] });
    await store.writePublicCache('release-0000000000000000', { ok: true });
    await store.clearAll();
    expect(await store.listHistory()).toEqual([]);
    expect(await store.listFavorites()).toEqual([]);
    expect(await store.listRecentSearches()).toEqual([]);
    expect(await store.readPublicCache()).toBeNull();
  });

  it('IndexedDBを利用できない場合もメモリで閲覧機能を継続し通知する', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
    const notices: string[] = [];
    const store = new DeviceStore((message) => notices.push(message));
    await store.recordHistory(summary(1));
    expect(await store.listHistory()).toHaveLength(1);
    expect(notices).toEqual(['端末内への保存を利用できません。検索と閲覧はこのまま続けられます。']);
  });

  it('破損した端末内データを読み込まずメモリへ縮退する', async () => {
    const notices: string[] = [];
    const store = new DeviceStore((message) => notices.push(message));
    await store.listHistory();
    const database = await openDatabase();
    await putRaw(database, 'history', { unexpected: true });
    expect(await store.listHistory()).toEqual([]);
    expect(notices).toEqual(['端末内データを読み取れないため、この画面では一時保存へ切り替えました。検索と閲覧は続けられます。']);
  });
});

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('diopside-v8', 1);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

function putRaw(database: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('端末内データ', 'readwrite');
    transaction.objectStore('端末内データ').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
