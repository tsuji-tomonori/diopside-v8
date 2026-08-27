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
  groups: Array<{ tagId: string; name: string; memberTagIds: string[] }>;
};
const aliases = tagAliasesSchema.parse(readJson(path.join(root, 'content/taxonomy/tag-aliases.json')));
const source = readJson(path.join(root, 'spec/sources/collaboration-tag-corrections-v1.json')) as CollaborationAuditSource;
const result = auditCollaborationGroupTags({
  videos: readCanonicalVideos(root),
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
    + `（タイトル明示 ${result.explicitAppearanceCount}件、確認済み出演 ${result.confirmedAppearanceCount}件）に不足はありません。`,
  );
}
