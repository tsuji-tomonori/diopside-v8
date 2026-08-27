import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useBundle } from '../../contexts.ts';
import type { PublicSongIndex } from '../../domain/content.ts';
import { normalizeTagAlias } from '../../domain/search.ts';
import { formatDate, formatTimestamp } from '../../format.ts';

type PublicSong = PublicSongIndex['songs'][number];

export function SongIndexPage(): React.JSX.Element {
  const { tagId } = useParams();
  const bundle = useBundle();
  const [query, setQuery] = useState('');
  const selectedSong = tagId ? bundle.songIndex.songs.find((song) => song.tagId === tagId) : undefined;
  const normalizedQuery = normalizeTagAlias(query);
  const songs = useMemo(() => bundle.songIndex.songs.filter((song) => (
    !normalizedQuery
    || normalizeTagAlias(`${song.title} ${song.originalArtist}`).includes(normalizedQuery)
    || song.normalizedReading.includes(normalizedQuery)
  )), [bundle.songIndex.songs, normalizedQuery]);

  if (tagId && !selectedSong) {
    return (
      <main className="state-panel" role="status">
        <h1>楽曲が見つかりません</h1>
        <p>公開中の歌唱実績にない楽曲タグです。</p>
        <Link className="button secondary" to="/songs">歌の一覧へ戻る</Link>
      </main>
    );
  }

  const displayedSongs = selectedSong ? [selectedSong] : songs;
  const appearanceCount = bundle.songIndex.songs.reduce((total, song) => total + song.appearances.length, 0);

  return (
    <main className="song-page">
      <Link className="back-link" to={selectedSong ? '/songs' : '/'}>
        {selectedSong ? '← 歌の一覧へ戻る' : '← 動画検索へ戻る'}
      </Link>
      <section className="page-intro song-intro" aria-labelledby="song-heading">
        <p className="eyebrow">確認済みの歌唱実績</p>
        <h1 id="song-heading">{selectedSong?.title ?? '歌った曲'}</h1>
        {selectedSong ? (
          <p>{selectedSong.originalArtist}の楽曲を歌った場面をまとめています。</p>
        ) : (
          <p>歌枠、歌ってみた、通常配信中の歌唱や鼻歌を、楽曲ごとに探せます。</p>
        )}
        <p className="updated">最終更新: {formatDate(`${bundle.songIndex.updatedAt}T00:00:00+09:00`)}</p>
      </section>

      {!selectedSong ? (
        <section className="song-search" aria-labelledby="song-search-heading">
          <div>
            <p className="eyebrow">楽曲名・原曲アーティスト</p>
            <h2 id="song-search-heading">{bundle.songIndex.songs.length}曲・{appearanceCount}件の歌唱</h2>
          </div>
          <label>
            歌を絞り込む
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="楽曲名やアーティスト" />
          </label>
        </section>
      ) : null}

      <p className="notice song-notice">公開資料で楽曲名と白雪巴の歌唱を確認できた場面だけを掲載しています。</p>
      <section className="song-list" aria-label="歌唱楽曲一覧">
        {displayedSongs.length > 0 ? displayedSongs.map((song) => (
          <SongCard key={song.tagId} song={song} linkedTitle={!selectedSong} />
        )) : (
          <div className="empty-state">
            <h2>一致する楽曲がありません</h2>
            <p>曲名を短くするか、原曲アーティスト名で試してください。</p>
          </div>
        )}
      </section>
    </main>
  );
}

function SongCard({ song, linkedTitle }: { song: PublicSong; linkedTitle: boolean }): React.JSX.Element {
  return (
    <article className="song-card" id={song.tagId}>
      <header>
        <div>
          <p className="eyebrow">楽曲タグ</p>
          <h2>{linkedTitle ? <Link to={`/songs/${song.tagId}`}>{song.title}</Link> : song.title}</h2>
          <p className="song-artist">原曲: {song.originalArtist}</p>
        </div>
        <a className="button secondary" href={song.originalUrl} target="_blank" rel="noreferrer">原曲を聴く ↗</a>
      </header>
      <p className="song-source">原曲リンク: {song.originalSourceLabel}・確認日 {formatDate(`${song.originalRetrievedAt}T00:00:00+09:00`)}</p>
      <ol className="song-appearances">
        {song.appearances.map((appearance) => (
          <li key={appearance.appearanceId}>
            <div>
              <span className="song-kind">{appearance.performanceType}</span>
              <time dateTime={appearance.publishedAt}>{formatDate(appearance.publishedAt)}</time>
              <p>{appearance.videoTitle}</p>
            </div>
            <a href={appearance.youtubeUrl} target="_blank" rel="noreferrer">
              {appearance.startSeconds === 0 ? '動画を見る' : `${formatTimestamp(appearance.startSeconds)} から見る`} ↗
            </a>
          </li>
        ))}
      </ol>
    </article>
  );
}
