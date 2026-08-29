import { readFileSync } from 'node:fs';
import path from 'node:path';

import { IDBFactory } from 'fake-indexeddb';

import { embeddedReleaseId } from '../generated/release.ts';
import { DeviceStore } from './deviceStore.ts';
import { loadPublicBundle, loadVideoDetail } from './loadPublicData.ts';

const root = process.cwd();
const latest = json('public/data/latest.json') as {
  releaseId: string;
  indexPath: string;
  searchIndexPath: string;
  tagIndexPath: string;
  aliasIndexPath: string;
  gameIndexPath: string;
};
const contentManifest = json('content/content-manifest.json') as { videoCount: number };

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: new IDBFactory() });
});

describe('公開データ読込', () => {
  it('最新、索引、タグ、別名を同じ公開版として読みキャッシュする', async () => {
    const store = new DeviceStore();
    const bundle = await loadPublicBundle(store, repositoryFetcher());
    expect(bundle.latest.releaseId).toBe(embeddedReleaseId);
    expect(bundle.index.videos).toHaveLength(contentManifest.videoCount);
    expect(bundle.songIndex.songs.length).toBeGreaterThan(0);
    expect(bundle.gameIndex.games.length).toBeGreaterThan(0);
    expect((await store.readPublicCache())?.releaseId).toBe(embeddedReleaseId);
  });

  it('通信失敗時だけ同じ公開版の検証済みキャッシュへ縮退する', async () => {
    const store = new DeviceStore();
    const expected = await loadPublicBundle(store, repositoryFetcher());
    const cached = await loadPublicBundle(store, failingFetcher());
    expect(cached).toEqual(expected);
  });

  it('画面埋込版とlatestが異なる場合はキャッシュで隠さず公開版不一致を示す', async () => {
    const store = new DeviceStore();
    await loadPublicBundle(store, repositoryFetcher());
    const mismatchFetcher = repositoryFetcher({
      'data/latest.json': { ...json('public/data/latest.json') as object, releaseId: 'release-0000000000000000' },
    });
    await expect(loadPublicBundle(store, mismatchFetcher)).rejects.toMatchObject({ kind: '公開版不一致' });
  });

  it('取得失敗と構造不適合を別の日本語状態にする', async () => {
    await expect(loadPublicBundle(new DeviceStore(), failingFetcher())).rejects.toMatchObject({ kind: '取得失敗' });
    const invalidFetcher = repositoryFetcher({ 'data/latest.json': { schemaVersion: '壊れた版' } });
    await expect(loadPublicBundle(new DeviceStore(), invalidFetcher)).rejects.toMatchObject({ kind: '構造不適合' });
  });

  it('動画詳細の動画IDと公開版を検証する', async () => {
    const videoId = 'c9TnpjK3ZZE';
    const detail = await loadVideoDetail(videoId, latest.releaseId, repositoryFetcher());
    expect(detail.videoId).toBe(videoId);
    expect(detail.releaseId).toBe(embeddedReleaseId);
    await expect(loadVideoDetail(videoId, 'release-0000000000000000', repositoryFetcher())).rejects.toMatchObject({ kind: '取得失敗' });
  });
});

function repositoryFetcher(overrides: Record<string, unknown> = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const pathname = typeof input === 'string' ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    const relativePath = pathname.replace(/^\/(?:diopside-v8\/)?/u, '');
    if (Object.hasOwn(overrides, relativePath)) return Response.json(overrides[relativePath]);
    try {
      return Response.json(json(`public/${relativePath}`));
    } catch {
      return new Response('not found', { status: 404 });
    }
  }) as typeof fetch;
}

function failingFetcher(): typeof fetch {
  return (async () => { throw new TypeError('offline'); }) as typeof fetch;
}

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as unknown;
}
