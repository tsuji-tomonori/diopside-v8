/** Keep the requirements catalog authoritative when historical import defaults are regenerated. */
export function preserveCanonicalRequirements<T extends { id: string }>(
  generated: T[],
  existing: Record<string, unknown>[],
  overrideIds: ReadonlySet<string>,
): (T | Record<string, unknown>)[] {
  const previous = new Map(existing.map((item) => [String(item.id), item]));
  const generatedIds = new Set(generated.map((item) => item.id));
  return [
    ...generated.map((item) => {
      const canonical = previous.get(item.id);
      const importedRevision = 'revision' in item && typeof item.revision === 'number' ? item.revision : 0;
      return canonical && (overrideIds.has(item.id) || (typeof canonical.revision === 'number' && canonical.revision > importedRevision)) ? canonical : item;
    }),
    ...existing.filter((item) => !generatedIds.has(String(item.id))),
  ].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}
