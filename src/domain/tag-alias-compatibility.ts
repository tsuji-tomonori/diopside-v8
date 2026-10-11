import aliasVersion830 from '../../content/taxonomy/alias-history/8.3.0.json' with { type: 'json' };
import { tagAliasesSchema, type TagAliases } from './content.ts';
import { normalizeTagAlias } from './search.ts';

const supportedHistory = new Map<string, TagAliases>([
  ['8.3.0', tagAliasesSchema.parse(aliasVersion830)],
]);

export function aliasHistorySnapshot(version: string): TagAliases | undefined {
  const snapshot = supportedHistory.get(version);
  return snapshot ? structuredClone(snapshot) : undefined;
}

/** Historical snapshots permit only additions, never changed meaning or normalization. */
export function aliasCompatibilityErrors(aliases: TagAliases, version: string): string[] {
  const prior = supportedHistory.get(version);
  if (!prior || prior.aliasVersion !== version || version === aliases.aliasVersion) return ['別名の互換履歴が存在しません。'];
  const errors: string[] = [];
  for (const field of ['schemaVersion', 'normalizationOrder', 'decompositions', 'reviewRequired'] as const) {
    if (JSON.stringify(prior[field]) !== JSON.stringify(aliases[field])) errors.push(`${field}が互換履歴から変更されています。`);
  }
  if (prior.aliases.length === 0) errors.push('空の別名履歴では互換性を確認できません。');
  const seen = new Set<string>();
  for (const entry of prior.aliases) {
    if (seen.has(entry.normalizedAlias) || entry.normalizedAlias !== normalizeTagAlias(entry.alias)) {
      errors.push(`互換履歴の別名「${entry.alias}」が不正です。`);
    }
    seen.add(entry.normalizedAlias);
    const current = aliases.aliases.filter((candidate) => candidate.normalizedAlias === entry.normalizedAlias);
    if (current.length !== 1 || JSON.stringify(current[0]) !== JSON.stringify(entry)) {
      errors.push(`既存の別名「${entry.alias}」が削除・変更・重複されています。`);
    }
  }
  return errors;
}
