import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { VideoCard } from '../../components/VideoCard.tsx';
import { useDeviceStore } from '../../contexts.ts';
import type { FavoriteEntry, HistoryEntry, RecentSearchEntry } from '../../data/deviceStore.ts';
import { serializeCondition } from '../../domain/search.ts';
import { formatDate } from '../../format.ts';

export function DeviceLibraryPage(): React.JSX.Element {
  const store = useDeviceStore();
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [recent, setRecent] = useState<RecentSearchEntry[]>([]);
  const refresh = useCallback(async () => {
    const [nextHistory, nextFavorites, nextRecent] = await Promise.all([
      store.listHistory(), store.listFavorites(), store.listRecentSearches(),
    ]);
    setHistory(nextHistory);
    setFavorites(nextFavorites);
    setRecent(nextRecent);
  }, [store]);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <main className="library-page">
      <section className="page-intro">
        <p className="eyebrow">このブラウザだけに保存</p>
        <h1>端末内リスト</h1>
        <p>閲覧履歴、お気に入り、最近の検索条件はサーバーへ送信されません。ブラウザやサイトデータを削除すると失われ、別の端末へは同期されません。</p>
        <button className="button danger" type="button" onClick={() => {
          if (window.confirm('diopsideが保存した端末内データをすべて削除しますか？')) void store.clearAll().then(refresh);
        }}>端末内データをすべて削除</button>
      </section>

      <section className="library-section">
        <h2>お気に入り <span>{favorites.length}件</span></h2>
        {favorites.length === 0 ? <Empty message="お気に入りはまだありません。" /> : (
          <div className="video-grid">
            {favorites.map((video) => (
              <div className="library-item" key={video.videoId}>
                <VideoCard video={video} />
                <button className="text-button" type="button" onClick={() => void store.deleteFavorite(video.videoId).then(refresh)}>このお気に入りを削除</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="library-section">
        <h2>閲覧履歴 <span>{history.length}件</span></h2>
        {history.length === 0 ? <Empty message="閲覧履歴はまだありません。" /> : (
          <ul className="simple-list">
            {history.map((video) => (
              <li key={video.videoId}>
                <Link to={`/video/${video.videoId}`}>{video.title}</Link>
                <span>{formatDate(video.viewedAt)}</span>
                <button className="text-button" type="button" onClick={() => void store.deleteHistory(video.videoId).then(refresh)}>削除</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="library-section">
        <h2>最近の検索条件 <span>{recent.length}件</span></h2>
        {recent.length === 0 ? <Empty message="保存された検索条件はまだありません。" /> : (
          <ul className="simple-list">
            {recent.map((item) => (
              <li key={item.key}>
                <button className="condition-button" type="button" onClick={() => navigate({ pathname: '/', search: serializeCondition(item.condition).toString() })}>
                  {describeCondition(item)}
                </button>
                <span>{formatDate(item.savedAt)}</span>
                <button className="text-button" type="button" onClick={() => void store.deleteRecentSearch(item.key).then(refresh)}>削除</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Empty({ message }: { message: string }): React.JSX.Element {
  return <p className="empty-inline">{message}</p>;
}

function describeCondition(item: RecentSearchEntry): string {
  const parts = [item.condition.query || 'タイトル指定なし'];
  if (item.condition.tagIds.length > 0) parts.push(`タグ${item.condition.tagIds.length}件`);
  if (item.condition.publishedFrom || item.condition.publishedTo) parts.push('公開日指定');
  if (item.condition.durationBucket || item.condition.durationMinMinutes !== undefined || item.condition.durationMaxMinutes !== undefined) parts.push('動画長指定');
  return parts.join('・');
}
