import path from 'node:path';

import {
  auditCollaborationGroupTags,
  type CollaborationAuditSource,
} from '../src/domain/collaboration-group-audit.ts';
import { tagAliasesSchema } from '../src/domain/content.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { readJson } from './lib.ts';

const root = path.resolve(import.meta.dirname, '..');
const profiles = readJson(path.join(root, 'content/people/collaboration-profiles.json')) as {
  people: Array<{ tagId: string; name: string }>;
  groups: Array<{ tagId: string; name: string; memberTagIds: string[] }>;
};
const aliases = tagAliasesSchema.parse(readJson(path.join(root, 'content/taxonomy/tag-aliases.json')));
const source = readJson(path.join(root, 'spec/sources/collaboration-tag-corrections-v1.json')) as CollaborationAuditSource;
const result = auditCollaborationGroupTags({
  // 除外後も既存の参加者確認根拠は過去の監査記録として検証する。
  videos: readCanonicalVideos(root, { includeExcluded: true }),
  people: profiles.people,
  groups: profiles.groups,
  aliases: aliases.aliases,
  source,
});

if (result.errors.length > 0) {
  console.error(result.errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `コラボ・ユニットタグ横断監査合格: ${result.auditedAppearanceCount}件`
    + `（判定候補 ${result.candidateAppearanceCount}件、タイトル明示 ${result.explicitAppearanceCount}件、`
    + `確認済み出演 ${result.confirmedAppearanceCount}件、除外確認 ${result.excludedAppearanceCount}件）、`
    + `出演者集合 ${result.confirmedParticipantVideoCount}動画・${result.confirmedParticipantCount}人、`
    + `旧出演者タグ ${result.auditedLegacyPerformerCount}件`
    + `（個別確認 ${result.confirmedLegacyPerformerCount}件）、`
    + `出演者除外 ${result.excludedPerformerCount}件、必須出演者 ${result.requiredPerformerCount}件に不整合はありません。`,
  );
}
