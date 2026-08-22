import type { TagTaxonomy } from '../src/domain/content.ts';

export const publicTagProjectionVersion = '1.0.0';

/**
 * Keep role-specific tags in the canonical store while exposing one public tag
 * for the same person. Performer tags are the public identity for people who
 * are also present in the mentioned-person taxonomy.
 */
export function buildPublicTagIdMap(taxonomy: TagTaxonomy): Map<string, string | null> {
  const result = new Map<string, string | null>();
  const performerByName = new Map(
    taxonomy.categories
      .find((category) => category.categoryId === 'people')
      ?.subcategories.find((subcategory) => subcategory.subcategoryId === 'performer')
      ?.tags.filter((tag) => tag.active)
      .map((tag) => [tag.canonicalName, tag.tagId] as const) ?? [],
  );

  for (const category of taxonomy.categories) {
    for (const subcategory of category.subcategories) {
      for (const tag of subcategory.tags) {
        if (category.categoryId === 'people' && subcategory.subcategoryId === 'channel') {
          result.set(tag.tagId, null);
          continue;
        }
        const performerTagId = category.categoryId === 'reference' && subcategory.subcategoryId === 'mentionedPerson'
          ? performerByName.get(tag.canonicalName)
          : undefined;
        result.set(tag.tagId, performerTagId ?? tag.tagId);
      }
    }
  }
  return result;
}
