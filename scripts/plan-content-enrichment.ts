import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { tagAliasesSchema, tagTaxonomySchema } from '../src/domain/content.ts';
import { validateCanonicalVideo } from '../src/domain/validation.ts';
import { readCanonicalVideos } from './canonical-store.ts';
import { auditContentPreservation } from './content-preservation.ts';
import { canonicalJson, prettyJson, readJson, sha256 } from './lib.ts';
import { preserveContentEnrichment } from './preserve-content-enrichment.ts';

const usage = '使い方: node scripts/plan-content-enrichment.ts --current-root <main> --candidate-root <旧候補> --video-ids <ID,ID> [--draft-dir <現行root/.devflow/run/新規directory>]';
const options = new Map<string, string>();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const key = args[index]!;
  const value = args[index + 1];
  if (!['--current-root', '--candidate-root', '--video-ids', '--draft-dir'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw new Error(usage);
  options.set(key, value);
}
function required(key: string) {
  const value = options.get(key);
  if (!value) throw new Error(usage);
  return value;
}
const root = realpathSync(required('--current-root'));
const sourceRoot = realpathSync(required('--candidate-root'));
const current = readCanonicalVideos(root);
const source = readCanonicalVideos(sourceRoot);
const ids = required('--video-ids').split(',');
const before = auditContentPreservation(current, source, ids);
const taxonomy = tagTaxonomySchema.parse(readJson(path.join(root, 'content/taxonomy/tag-taxonomy.json')));
const aliases = tagAliasesSchema.parse(readJson(path.join(root, 'content/taxonomy/tag-aliases.json')));
const currentById = new Map(current.map((video) => [video.videoId, video]));
const sourceById = new Map(source.map((video) => [video.videoId, video]));
const results = [...new Set(ids)].sort().map((id) => {
  const old = currentById.get(id);
  const next = sourceById.get(id);
  if (!old || !next) throw new Error(`既存動画の補完には両方の正本が必要です: ${id}`);
  const result = preserveContentEnrichment(old, next);
  const validationIssues = validateCanonicalVideo(result.proposed, taxonomy, aliases).map((issue) => ({ code: issue.code, path: issue.path }));
  return { ...result, summary: { ...result.summary, validationIssues } };
});
const projectedById = new Map(results.map((item) => [item.summary.videoId, item.proposed]));
const projected = current.map((video) => projectedById.get(video.videoId) ?? video);
const after = auditContentPreservation(current, projected);
const report = {
  schemaVersion: '1.0.0',
  publicationAllowed: false,
  guard: '隔離した構造上の補完案のみ。既存の承認と審査記録は継承元の履歴であり、新しい追加内容の承認ではない。動画ごとの原資料・同じ候補hashの独立審査・所有権確認・公開ゲートの接続と人のマージ前に採用しない。正本や公開データへの書込み・claim・PR作成は行わない。',
  counts: {
    selectedVideos: results.length,
    draftVideos: results.filter((item) => item.summary.additions.length > 0).length,
    synopsisAdditions: results.filter((item) => item.summary.additions.includes('synopsis')).length,
    timestampAdditions: results.filter((item) => item.summary.additions.includes('timestamps')).length,
    blockedVideos: results.filter((item) => item.summary.blockers.length > 0).length,
    validationIssueVideos: results.filter((item) => item.summary.validationIssues.length > 0).length,
  },
  records: results.map((item) => item.summary),
  before,
  after,
};
const output = options.get('--draft-dir');
if (output) {
  // Constrain proposals to an ignored operator workspace, never a canonical input.
  const parent = realpathSync(path.join(root, '.devflow/run'));
  if (!parent.startsWith(`${root}${path.sep}`)) throw new Error('一時領域が現行root外にあります。');
  const directory = path.resolve(output);
  if (path.dirname(directory) !== parent || directory === sourceRoot || sourceRoot.startsWith(`${directory}${path.sep}`)) throw new Error('draft-dirは現行root/.devflow/run直下の新規directoryだけです。');
  mkdirSync(directory); // Reject existing directories, including symlinks. Do not overwrite.
  mkdirSync(path.join(directory, 'drafts'));
  writeFileSync(path.join(directory, 'plan.json'), prettyJson(report), { flag: 'wx' });
  for (const result of results.filter((item) => item.summary.additions.length > 0)) {
    writeFileSync(path.join(directory, `drafts/${result.summary.videoId}.json`), prettyJson({
      schemaVersion: 'draft-only-1.0.0',
      publicationAllowed: false,
      summary: result.summary,
      proposedVideo: result.proposed,
    }), { flag: 'wx' });
  }
}
console.log(prettyJson({
  publicationAllowed: false,
  counts: report.counts,
  before: before.counts,
  after: after.counts,
  currentCorpusFingerprint: after.currentCorpusFingerprint,
  projectedCorpusFingerprint: after.candidateCorpusFingerprint,
  planFingerprint: sha256(canonicalJson(report)),
}));
if (report.counts.blockedVideos > 0 || report.counts.validationIssueVideos > 0) process.exitCode = 1;
