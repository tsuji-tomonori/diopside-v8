import type { GameCatalog, TagTaxonomy } from './content.ts';

/**
 * ゲーム作品名を正本に、動画へ公開するゲームジャンルを決定します。
 * 個々の動画に残る移行前のジャンル指定は、登録済みゲームでは公開に使いません。
 */
export function applyGameCatalogGenres(
  assignedTagIds: Iterable<string>,
  taxonomy: TagTaxonomy,
  catalog: GameCatalog,
): string[] {
  const effective = new Set(assignedTagIds);
  const gameGenreTagIds = new Set(
    taxonomy.categories
      .find((category) => category.categoryId === 'content')
      ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'gameGenre')
      ?.tags.filter((tag) => tag.active).map((tag) => tag.tagId) ?? [],
  );
  const gamesByTagId = new Map(catalog.games.flatMap((game) => (
    [game.gameTitleTagId, ...(game.equivalentGameTitleTagIds ?? [])].map((tagId) => [tagId, game] as const)
  )));
  const assignedGames = [...effective].flatMap((tagId) => {
    const game = gamesByTagId.get(tagId);
    return game ? [game] : [];
  });

  if (assignedGames.length === 0) return [...effective].sort();

  for (const tagId of gameGenreTagIds) effective.delete(tagId);
  for (const game of assignedGames) {
    for (const genreTagId of game.gameGenreTagIds) effective.add(genreTagId);
  }
  return [...effective].sort();
}

export function catalogGameGenreTagIds(
  assignedTagIds: Iterable<string>,
  catalog: GameCatalog,
): string[] {
  const assigned = new Set(assignedTagIds);
  return [...new Set(catalog.games
    .filter((game) => [game.gameTitleTagId, ...(game.equivalentGameTitleTagIds ?? [])].some((tagId) => assigned.has(tagId)))
    .flatMap((game) => game.gameGenreTagIds))].sort();
}
