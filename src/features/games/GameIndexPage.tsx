import { Link, useParams } from 'react-router-dom';

import { useBundle } from '../../contexts.ts';
import { formatDate } from '../../format.ts';
import { gameGenreIcon } from './gameGenreIcons.ts';

export function GameIndexPage(): React.JSX.Element {
  const { tagId } = useParams();
  const bundle = useBundle();
  const genreTags = bundle.tagIndex.categories
    .find((category) => category.categoryId === 'content')
    ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'gameGenre')
    ?.tags ?? [];
  const genresByTagId = new Map(genreTags.map((genre) => [genre.tagId, genre]));
  const selectedGenre = tagId ? genresByTagId.get(tagId) : undefined;
  const gameTags = new Map(
    (bundle.tagIndex.categories
      .find((category) => category.categoryId === 'works')
      ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'gameTitle')
      ?.tags ?? []).map((game) => [game.tagId, game]),
  );
  const games = bundle.gameIndex.games
    .filter((game) => !tagId || game.gameGenreTagIds.includes(tagId))
    .sort((left, right) => left.normalizedReading.localeCompare(right.normalizedReading, 'ja') || left.title.localeCompare(right.title, 'ja'));

  if (tagId && !selectedGenre) {
    return (
      <main className="state-panel" role="status">
        <h1>ゲームジャンルが見つかりません</h1>
        <p>公開中のゲームジャンルではありません。</p>
        <Link className="button secondary" to="/games">ゲームを探すへ戻る</Link>
      </main>
    );
  }

  if (!selectedGenre) {
    const genreCards = genreTags.map((genre) => {
      const genreGames = bundle.gameIndex.games.filter((game) => game.gameGenreTagIds.includes(genre.tagId));
      const videoCount = new Set(genreGames.flatMap((game) => game.videoIds)).size;
      return { genre, gameCount: genreGames.length, videoCount };
    }).filter((item) => item.gameCount > 0);
    return (
      <main className="game-page">
        <section className="page-intro game-intro" aria-labelledby="game-heading">
          <p className="eyebrow">プレイした作品から探す</p>
          <h1 id="game-heading">ゲームを探す</h1>
          <p>ゲームジャンルを選ぶと、白雪巴さんがプレイした作品を一覧できます。作品を押すと、そのゲームをプレイした配信が表示されます。</p>
          <p className="updated">ゲーム分類 最終確認: {formatDate(`${bundle.gameIndex.updatedAt}T00:00:00+09:00`)}</p>
        </section>
        <section aria-labelledby="game-genres-heading">
          <div className="results-heading">
            <div><p className="eyebrow">ゲームジャンル</p><h2 id="game-genres-heading">{genreCards.length}ジャンル</h2></div>
          </div>
          <div className="game-genre-grid">
            {genreCards.map(({ genre, gameCount, videoCount }) => {
              const GenreIcon = gameGenreIcon(genre.canonicalName);
              return (
                <Link className="game-genre-card" key={genre.tagId} to={`/games/genres/${genre.tagId}`}>
                  <GenreIcon
                    aria-hidden="true"
                    className="game-genre-card-icon"
                    size={22}
                    strokeWidth={1.7}
                  />
                  <h3>{genre.canonicalName}</h3>
                  <p>{gameCount}作品 · {videoCount}配信</p>
                  <span>作品を見る →</span>
                </Link>
              );
            })}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="game-page">
      <Link className="back-link" to="/games">← ゲームジャンルへ戻る</Link>
      <section className="page-intro game-intro" aria-labelledby="game-genre-heading">
        <p className="eyebrow">ゲームジャンル</p>
        <h1 id="game-genre-heading">{selectedGenre.canonicalName}</h1>
        <p>{games.length}作品から、見たいゲームを選べます。</p>
      </section>
      <section aria-labelledby="games-heading">
        <div className="results-heading">
          <div><p className="eyebrow">プレイしたゲーム</p><h2 id="games-heading">{games.length}作品</h2></div>
        </div>
        <div className="game-grid">
          {games.map((game) => {
            const gameTag = gameTags.get(game.gameTitleTagId);
            return (
              <article className="game-card" key={game.gameTitleTagId}>
                <div className="game-card-genres">
                  {game.gameGenreTagIds.map((genreTagId) => (
                    <Link key={genreTagId} to={`/games/genres/${genreTagId}`}>{genresByTagId.get(genreTagId)?.canonicalName ?? genreTagId}</Link>
                  ))}
                </div>
                <h2><Link to={`/works/${game.gameTitleTagId}`}>{game.title}</Link></h2>
                {gameTag?.introduction ? <p>「{gameTag.introduction.quote}」</p> : null}
                <Link className="game-stream-link" to={`/works/${game.gameTitleTagId}`}>{game.videoIds.length}件の配信を見る →</Link>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
