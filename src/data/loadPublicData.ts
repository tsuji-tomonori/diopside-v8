import {
  latestReleaseSchema,
  publicAliasIndexSchema,
  publicIndexSchema,
  publicTagIndexSchema,
  publicVideoDetailSchema,
  publicVideoShardSchema,
  searchIndexSchema,
  videoShardId,
  type LatestRelease,
  type PublicAliasIndex,
  type PublicIndex,
  type PublicTagIndex,
  type PublicVideoDetail,
  type SearchIndex,
} from '../domain/content.ts';
import { embeddedReleaseId } from '../generated/release.ts';
import type { DeviceStore } from './deviceStore.ts';

export type LoadFailureKind = '取得失敗' | '構造不適合' | '公開版不一致';

export class PublicDataError extends Error {
  public constructor(public readonly kind: LoadFailureKind, message: string) {
    super(message);
  }
}

export interface PublicBundle {
  latest: LatestRelease;
  index: PublicIndex;
  searchIndex: SearchIndex;
  tagIndex: PublicTagIndex;
  aliasIndex: PublicAliasIndex;
}

export async function loadPublicBundle(store: DeviceStore, fetcher: typeof fetch = fetch): Promise<PublicBundle> {
  try {
    const latest = latestReleaseSchema.parse(await fetchJson('data/latest.json', fetcher));
    if (latest.releaseId !== embeddedReleaseId) throw mismatch();
    const [indexInput, searchInput, tagInput, aliasInput] = await Promise.all([
      fetchJson(latest.indexPath, fetcher),
      fetchJson(latest.searchIndexPath, fetcher),
      fetchJson(latest.tagIndexPath, fetcher),
      fetchJson(latest.aliasIndexPath, fetcher),
    ]);
    const bundle = {
      latest,
      index: publicIndexSchema.parse(indexInput),
      searchIndex: searchIndexSchema.parse(searchInput),
      tagIndex: publicTagIndexSchema.parse(tagInput),
      aliasIndex: publicAliasIndexSchema.parse(aliasInput),
    };
    assertSameRelease(bundle);
    await store.writePublicCache(bundle.latest.releaseId, bundle);
    return bundle;
  } catch (error) {
    if (error instanceof PublicDataError && error.kind === '公開版不一致') throw error;
    const cache = await store.readPublicCache();
    if (cache?.releaseId === embeddedReleaseId) {
      try {
        const value = cache.value as PublicBundle;
        const bundle = {
          latest: latestReleaseSchema.parse(value.latest),
          index: publicIndexSchema.parse(value.index),
          searchIndex: searchIndexSchema.parse(value.searchIndex),
          tagIndex: publicTagIndexSchema.parse(value.tagIndex),
          aliasIndex: publicAliasIndexSchema.parse(value.aliasIndex),
        };
        assertSameRelease(bundle);
        return bundle;
      } catch {
        // 破損したキャッシュは無視し、元の取得エラーを利用者へ示す。
      }
    }
    if (isStructureError(error)) {
      throw new PublicDataError('構造不適合', '公開データの形式を確認できませんでした。再読み込みしても直らない場合は、公開版の修正をお待ちください。');
    }
    throw new PublicDataError('取得失敗', '公開データを取得できませんでした。通信状態を確認して再読み込みしてください。');
  }
}

export async function loadVideoDetail(
  videoId: string,
  releaseId: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicVideoDetail> {
  try {
    const shardId = videoShardId(videoId);
    const shard = publicVideoShardSchema.parse(await fetchJson(`data/releases/${releaseId}/video-shards/${shardId}.json`, fetcher));
    const detail = publicVideoDetailSchema.parse(shard.videos[videoId]);
    if (shard.releaseId !== releaseId || shard.shardId !== shardId) throw mismatch();
    if (detail.releaseId !== releaseId || releaseId !== embeddedReleaseId) throw mismatch();
    return detail;
  } catch (error) {
    if (error instanceof PublicDataError) throw error;
    if (isStructureError(error)) throw new PublicDataError('構造不適合', '動画詳細の形式を確認できませんでした。');
    throw new PublicDataError('取得失敗', '動画詳細を取得できませんでした。');
  }
}

function assertSameRelease(bundle: PublicBundle): void {
  const releaseIds = [
    bundle.latest.releaseId,
    bundle.index.releaseId,
    bundle.searchIndex.releaseId,
    bundle.tagIndex.releaseId,
    bundle.aliasIndex.releaseId,
    embeddedReleaseId,
  ];
  if (new Set(releaseIds).size !== 1) throw mismatch();
}

function mismatch(): PublicDataError {
  return new PublicDataError('公開版不一致', '画面と公開データの版が一致しません。再読み込みして、公開更新の完了をお待ちください。');
}

async function fetchJson(relativePath: string, fetcher: typeof fetch): Promise<unknown> {
  const base = import.meta.env.BASE_URL;
  const response = await fetcher(`${base}${relativePath.replace(/^\//u, '')}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function isStructureError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'issues' in error);
}
