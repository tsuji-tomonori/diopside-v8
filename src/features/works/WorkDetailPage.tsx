import { Link, useParams } from 'react-router-dom';

import { VideoCard } from '../../components/VideoCard.tsx';
import { useBundle } from '../../contexts.ts';
import type { PublicVideoSummary } from '../../domain/content.ts';
import { formatDate } from '../../format.ts';

export function WorkDetailPage(): React.JSX.Element {
  const { tagId = '' } = useParams();
  const bundle = useBundle();
  const work = bundle.tagIndex.categories
    .find((category) => category.categoryId === 'works')
    ?.subcategories.flatMap((subcategory) => subcategory.tags.map((tag) => ({
      ...tag,
      subcategoryName: subcategory.name,
    })))
    .find((tag) => tag.tagId === tagId);
  const game = bundle.gameIndex.games.find((item) => (
    item.gameTitleTagId === tagId || item.equivalentGameTitleTagIds?.includes(tagId)
  ));
  const gameGenres = game?.gameGenreTagIds.flatMap((genreTagId) => {
    const genre = bundle.tagIndex.categories
      .find((category) => category.categoryId === 'content')
      ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'gameGenre')
      ?.tags.find((tag) => tag.tagId === genreTagId);
    return genre ? [genre] : [];
  }) ?? [];

  if (!work) {
    return <main className="state-panel" role="status"><h1>作品が見つかりません</h1><p>公開中の作品タグではありません。</p><Link className="button secondary" to="/">動画検索へ戻る</Link></main>;
  }

  const summaries = new Map(bundle.index.videos.map((video) => [video.videoId, video]));
  const videos = (game?.videoIds ?? work.videoIds)
    .flatMap((videoId) => summaries.get(videoId) ? [summaries.get(videoId) as PublicVideoSummary] : [])
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime() || left.videoId.localeCompare(right.videoId));

  return (
    <main className="work-page">
      <Link className="back-link" to={game ? '/games' : '/'}>← {game ? 'ゲームを探す' : '動画検索'}へ戻る</Link>
      <section className="page-intro work-intro" aria-labelledby="work-heading">
        <p className="eyebrow">{work.subcategoryName}</p>
        <h1 id="work-heading">{game?.title ?? work.canonicalName}</h1>
        {game ? (
          <section className="game-classification" aria-labelledby="game-classification-heading">
            <h2 id="game-classification-heading">ゲーム単位のジャンル</h2>
            <div className="game-genre-links">
              {gameGenres.map((genre) => <Link key={genre.tagId} to={`/games/genres/${genre.tagId}`}>{genre.canonicalName}</Link>)}
            </div>
            <ul className="game-sources" aria-label="ゲームジャンル確認元">
              {game.sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`ゲームジャンル確認元を開く: ${new URL(source.url).hostname}`}
                  >
                    {source.label}
                  </a>
                  {' '}（確認日: {formatDate(`${source.checkedAt}T00:00:00+09:00`)}）
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {work.introduction ? (
          <>
            <blockquote className="work-quote"><p>「{work.introduction.quote}」</p></blockquote>
            <p className="work-source">
              引用元: <a href={work.introduction.officialUrl} target="_blank" rel="noreferrer">{work.introduction.sourceLabel}</a>
              <span>確認日: {formatDate(`${work.introduction.retrievedAt}T00:00:00+09:00`)}</span>
            </p>
          </>
        ) : work.introductionUnavailable ? (
          <div className="notice">
            <p><strong>公式紹介文を掲載できない理由</strong></p>
            <p>{work.introductionUnavailable.reason}</p>
            {work.introductionUnavailable.reference ? (
              <p>確認先: <a href={work.introductionUnavailable.reference.url} target="_blank" rel="noreferrer">{work.introductionUnavailable.reference.label}</a></p>
            ) : null}
            <p>調査日: {formatDate(`${work.introductionUnavailable.checkedAt}T00:00:00+09:00`)}</p>
          </div>
        ) : (
          <p className="notice">作品紹介の調査結果がありません。</p>
        )}
      </section>

      <section className="results work-results" aria-labelledby="work-videos-heading">
        <div className="results-heading">
          <div><p className="eyebrow">この作品の動画</p><h2 id="work-videos-heading">{videos.length}件の動画</h2></div>
        </div>
        {videos.length > 0 ? (
          <div className="video-grid">{videos.map((video) => <VideoCard key={video.videoId} video={video} />)}</div>
        ) : (
          <div className="empty-state"><h3>公開中の動画がありません</h3><p>この作品タグが付いた動画の公開をお待ちください。</p></div>
        )}
      </section>
    </main>
  );
}
