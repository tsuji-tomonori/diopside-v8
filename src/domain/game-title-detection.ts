import type { TagAliases, TagTaxonomy } from './content.ts';
import { buildTaxonomyLookup } from './content.ts';
import { normalizeTagAlias } from './search.ts';

const quotedWorkPattern = /[【『「]([^】』」]+)[】』」]/gu;

/**
 * 公開タイトルに作品名が明示されているゲーム配信を、タグ付与漏れのまま通さないための検出です。
 * 別名は正本で明示的に管理された表記だけを全文照合し、正規名は括弧・引用符内だけを照合します。
 */
export function detectExplicitGameTitleTagIds(
  title: string,
  taxonomy: TagTaxonomy,
  aliases: TagAliases,
): string[] {
  const lookup = buildTaxonomyLookup(taxonomy);
  const normalizedTitle = normalizeTagAlias(title);
  const quotedWorks = [...title.matchAll(quotedWorkPattern)]
    .map((match) => normalizeTagAlias(match[1] ?? ''));
  const detected = new Set<string>();
  const activeTagIds = new Set(taxonomy.categories.flatMap((category) => (
    category.subcategories.flatMap((subcategory) => subcategory.tags.filter((tag) => tag.active).map((tag) => tag.tagId))
  )));

  for (const alias of aliases.aliases) {
    const tag = lookup.get(alias.tagId);
    if (tag?.categoryId !== 'works' || tag.subcategoryId !== 'gameTitle') continue;
    if (alias.normalizedAlias.length < 3) continue;
    if (normalizedTitle.includes(alias.normalizedAlias)) detected.add(alias.tagId);
  }

  for (const tag of lookup.values()) {
    if (tag.categoryId !== 'works' || tag.subcategoryId !== 'gameTitle' || !activeTagIds.has(tag.tagId)) continue;
    const normalizedName = normalizeTagAlias(tag.canonicalName);
    if (normalizedName.length < 3) continue;
    if (quotedWorks.some((work) => isCanonicalWorkMention(work, normalizedName))) detected.add(tag.tagId);
  }

  return [...detected].sort();
}

function isCanonicalWorkMention(work: string, canonicalName: string): boolean {
  if (work === canonicalName) return true;
  if (!work.startsWith(canonicalName)) return false;
  const suffix = work.slice(canonicalName.length);
  return /^(?:\s*[#＃]\s*\d|\s+\d)/u.test(suffix);
}
