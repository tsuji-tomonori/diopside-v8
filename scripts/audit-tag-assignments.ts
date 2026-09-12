import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { tagTaxonomySchema } from '../src/domain/content.ts';
import {
  auditTagAssignmentCoverage,
  tagAssignmentAuditSourceSchema,
} from '../src/domain/tag-assignment-audit.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { readJson } from './lib.ts';

const root = path.resolve(import.meta.dirname, '..');
const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
const source = tagAssignmentAuditSourceSchema.parse(readJson(path.join(root, 'spec/sources/tag-assignment-audit-v1.json')));
const result = auditTagAssignmentCoverage({ videos: readCanonicalVideos(root), taxonomy, source });
const output = argument('--output');

if (output) {
  writeFileSync(path.resolve(root, output), `${JSON.stringify({
    schemaVersion: '1.0.0',
    reviewedAt: source.reviewedAt,
    blockingCandidateCount: result.blockingCandidateCount,
    reviewCandidateCount: result.reviewCandidateCount,
    rows: result.rows,
    errors: result.errors,
  }, null, 2)}\n`);
}

if (result.errors.length > 0) {
  console.error(result.errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `タグ付与横断監査合格: blocking候補${result.blockingCandidateCount}件、`
    + `要確認候補${result.reviewCandidateCount}件について期待・実績・候補・理由を確認しました。`,
  );
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
