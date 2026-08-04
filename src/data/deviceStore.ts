import { z } from 'zod';

import { publicVideoSummarySchema, type PublicVideoSummary } from '../domain/content.ts';
import type { SearchCondition } from '../domain/search.ts';

export interface HistoryEntry extends PublicVideoSummary {
  viewedAt: string;
}

export interface FavoriteEntry extends PublicVideoSummary {
  savedAt: string;
}

export interface RecentSearchEntry {
  key: string;
  condition: SearchCondition;
  savedAt: string;
}

export interface CachedBundle {
  releaseId: string;
  value: unknown;
  cachedAt: string;
}

interface StoredData {
  history: HistoryEntry[];
  favorites: FavoriteEntry[];
  recentSearches: RecentSearchEntry[];
  publicCache: CachedBundle | null;
}

type StoreKey = keyof StoredData;
type Notice = (message: string) => void;

const databaseName = 'diopside-v8';
const objectStoreName = '端末内データ';
const defaultData: StoredData = {
  history: [],
  favorites: [],
  recentSearches: [],
  publicCache: null,
};

const historySchema = z.array(publicVideoSummarySchema.extend({ viewedAt: z.iso.datetime({ offset: true }) }).strict()).max(200);
const favoritesSchema = z.array(publicVideoSummarySchema.extend({ savedAt: z.iso.datetime({ offset: true }) }).strict()).max(500);
const searchConditionSchema = z.object({
  query: z.string().max(200),
  tagIds: z.array(z.string()).max(30),
  publishedFrom: z.iso.date().optional(),
  publishedTo: z.iso.date().optional(),
  durationBucket: z.enum(['30分未満', '30分以上1時間未満', '1時間以上2時間未満', '2時間以上']).optional(),
  durationMinMinutes: z.number().nonnegative().finite().optional(),
  durationMaxMinutes: z.number().nonnegative().finite().optional(),
  sort: z.enum(['関連度順', '公開日の新しい順', '公開日の古い順', '動画長の短い順', '動画長の長い順']).optional(),
}).strict();
const recentSearchesSchema = z.array(z.object({
  key: z.string().min(1),
  condition: searchConditionSchema,
  savedAt: z.iso.datetime({ offset: true }),
}).strict()).max(20);
const publicCacheSchema = z.object({
  releaseId: z.string().regex(/^release-[a-f0-9]{16}$/u),
  value: z.unknown(),
  cachedAt: z.iso.datetime({ offset: true }),
}).strict().nullable();

export class DeviceStore {
  private readonly memory: StoredData = structuredClone(defaultData);
  private databasePromise: Promise<IDBDatabase | null> | null = null;
  private disabled = false;
  private pendingNotice = '';
  private notify: Notice = () => undefined;
  private noticeHandlerReady = false;

  public constructor(notify?: Notice) {
    if (notify) {
      this.notify = notify;
      this.noticeHandlerReady = true;
    }
  }

  public setNoticeHandler(notify: Notice): void {
    this.notify = notify;
    this.noticeHandlerReady = true;
    if (this.pendingNotice) {
      notify(this.pendingNotice);
      this.pendingNotice = '';
    }
  }

  public async listHistory(): Promise<HistoryEntry[]> {
    return this.read('history');
  }

  public async recordHistory(video: PublicVideoSummary): Promise<void> {
    const current = await this.listHistory();
    await this.write('history', [
      { ...video, viewedAt: new Date().toISOString() },
      ...current.filter((item) => item.videoId !== video.videoId),
    ].slice(0, 200));
  }

  public async deleteHistory(videoId: string): Promise<void> {
    await this.write('history', (await this.listHistory()).filter((item) => item.videoId !== videoId));
  }

  public async listFavorites(): Promise<FavoriteEntry[]> {
    return this.read('favorites');
  }

  public async isFavorite(videoId: string): Promise<boolean> {
    return (await this.listFavorites()).some((item) => item.videoId === videoId);
  }

  public async toggleFavorite(video: PublicVideoSummary): Promise<boolean> {
    const current = await this.listFavorites();
    const exists = current.some((item) => item.videoId === video.videoId);
    await this.write('favorites', exists
      ? current.filter((item) => item.videoId !== video.videoId)
      : [{ ...video, savedAt: new Date().toISOString() }, ...current]);
    return !exists;
  }

  public async deleteFavorite(videoId: string): Promise<void> {
    await this.write('favorites', (await this.listFavorites()).filter((item) => item.videoId !== videoId));
  }

  public async listRecentSearches(): Promise<RecentSearchEntry[]> {
    return this.read('recentSearches');
  }

  public async saveRecentSearch(condition: SearchCondition): Promise<void> {
    const normalized = normalizeCondition(condition);
    const key = JSON.stringify(normalized);
    if (!normalized.query && normalized.tagIds.length === 0 && Object.keys(normalized).length === 2) return;
    const current = await this.listRecentSearches();
    await this.write('recentSearches', [
      { key, condition: normalized, savedAt: new Date().toISOString() },
      ...current.filter((item) => item.key !== key),
    ].slice(0, 20));
  }

  public async deleteRecentSearch(key: string): Promise<void> {
    await this.write('recentSearches', (await this.listRecentSearches()).filter((item) => item.key !== key));
  }

  public async readPublicCache(): Promise<CachedBundle | null> {
    return this.read('publicCache');
  }

  public async writePublicCache(releaseId: string, value: unknown): Promise<void> {
    await this.write('publicCache', { releaseId, value, cachedAt: new Date().toISOString() });
  }

  public async clearAll(): Promise<void> {
    await Promise.all((Object.keys(defaultData) as StoreKey[]).map(async (key) => this.write(key, structuredClone(defaultData[key]) as StoredData[typeof key])));
  }

  private async read<Key extends StoreKey>(key: Key): Promise<StoredData[Key]> {
    const database = await this.open();
    if (!database) return structuredClone(this.memory[key]);
    try {
      const value = await request<unknown>(database.transaction(objectStoreName, 'readonly').objectStore(objectStoreName).get(key));
      return structuredClone(parseStoredValue(key, value ?? defaultData[key]));
    } catch {
      this.disableStorage('端末内データを読み取れないため、この画面では一時保存へ切り替えました。検索と閲覧は続けられます。');
      return structuredClone(this.memory[key]);
    }
  }

  private async write<Key extends StoreKey>(key: Key, value: StoredData[Key]): Promise<void> {
    this.memory[key] = structuredClone(value) as StoredData[Key];
    const database = await this.open();
    if (!database) return;
    try {
      await transactionDone(database.transaction(objectStoreName, 'readwrite'), key, value);
    } catch {
      this.disableStorage('端末内へ保存できないため、この画面では一時保存へ切り替えました。検索と閲覧は続けられます。');
    }
  }

  private async open(): Promise<IDBDatabase | null> {
    if (this.disabled) return null;
    if (typeof indexedDB === 'undefined') {
      this.disableStorage('端末内への保存を利用できません。検索と閲覧はこのまま続けられます。');
      return null;
    }
    this.databasePromise ??= new Promise((resolve) => {
      try {
        const opening = indexedDB.open(databaseName, 1);
        opening.onupgradeneeded = () => {
          if (!opening.result.objectStoreNames.contains(objectStoreName)) opening.result.createObjectStore(objectStoreName);
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => resolve(null);
        opening.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    const database = await this.databasePromise;
    if (!database) this.disableStorage('端末内への保存を利用できません。検索と閲覧はこのまま続けられます。');
    return database;
  }

  private disableStorage(message: string): void {
    if (this.disabled) return;
    this.disabled = true;
    if (this.noticeHandlerReady) this.notify(message);
    else this.pendingNotice = message;
  }
}

function parseStoredValue<Key extends StoreKey>(key: Key, value: unknown): StoredData[Key] {
  const schemas = {
    history: historySchema,
    favorites: favoritesSchema,
    recentSearches: recentSearchesSchema,
    publicCache: publicCacheSchema,
  } satisfies Record<StoreKey, z.ZodType>;
  return schemas[key].parse(value) as StoredData[Key];
}

function normalizeCondition(condition: SearchCondition): SearchCondition {
  return {
    query: condition.query.trim(),
    tagIds: [...new Set(condition.tagIds)].sort(),
    ...(condition.publishedFrom ? { publishedFrom: condition.publishedFrom } : {}),
    ...(condition.publishedTo ? { publishedTo: condition.publishedTo } : {}),
    ...(condition.durationBucket ? { durationBucket: condition.durationBucket } : {}),
    ...(condition.durationMinMinutes !== undefined ? { durationMinMinutes: condition.durationMinMinutes } : {}),
    ...(condition.durationMaxMinutes !== undefined ? { durationMaxMinutes: condition.durationMaxMinutes } : {}),
    ...(condition.sort ? { sort: condition.sort } : {}),
  };
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function transactionDone<Key extends StoreKey>(transaction: IDBTransaction, key: Key, value: StoredData[Key]): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.objectStore(objectStoreName).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
