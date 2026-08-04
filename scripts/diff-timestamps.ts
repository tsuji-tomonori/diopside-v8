import path from 'node:path';
import { z } from 'zod';

import { canonicalVideoSchema } from '../src/domain/content.ts';
import { readJson } from './lib.ts';

const beforeArg = argument('--before');
const afterArg = argument('--after');
const reasonsArg = argument('--reasons');
if (!beforeArg || !afterArg) throw new Error('使い方: node scripts/diff-timestamps.ts --before <旧.json> --after <新.json> [--reasons <理由.json>]');
const before = canonicalVideoSchema.parse(readJson(path.resolve(process.cwd(), beforeArg)));
const after = canonicalVideoSchema.parse(readJson(path.resolve(process.cwd(), afterArg)));
if (before.videoId !== after.videoId) throw new Error('異なる動画のタイムスタンプは比較できません。');
const prior = before.timestamps.status === '作成済み' ? new Map(before.timestamps.items.map((item) => [item.timestampId, item])) : new Map();
const next = after.timestamps.status === '作成済み' ? new Map(after.timestamps.items.map((item) => [item.timestampId, item])) : new Map();
const changes = [
  ...[...next].flatMap(([id, item]) => {
    const old = prior.get(id);
    if (!old) return [{ kind: '追加', timestampId: id, after: item }];
    const result = [];
    if (old.startSeconds !== item.startSeconds) result.push({ kind: '移動', timestampId: id, before: old.startSeconds, after: item.startSeconds });
    if (old.label !== item.label) result.push({ kind: '改名', timestampId: id, before: old.label, after: item.label });
    return result;
  }),
  ...[...prior].flatMap(([id, item]) => next.has(id) ? [] : [{ kind: '削除', timestampId: id, before: item }]),
].sort((left, right) => left.timestampId.localeCompare(right.timestampId) || left.kind.localeCompare(right.kind, 'ja'));
if (changes.length === 0) {
  console.log('タイムスタンプ差分はありません。');
} else {
  if (!reasonsArg) throw new Error('タイムスタンプ変更には追加・削除・移動・改名ごとの理由ファイルが必要です。');
  const reasons = z.object({
    schemaVersion: z.literal('1.0.0'),
    videoId: z.literal(before.videoId),
    reasons: z.array(z.object({
      kind: z.enum(['追加', '削除', '移動', '改名']),
      timestampId: z.string(),
      reason: z.string().min(2).max(240),
    }).strict()),
  }).strict().parse(readJson(path.resolve(process.cwd(), reasonsArg)));
  const reasonByChange = new Map(reasons.reasons.map((reason) => [`${reason.timestampId}\0${reason.kind}`, reason.reason]));
  const enriched = changes.map((change) => {
    const reason = reasonByChange.get(`${change.timestampId}\0${change.kind}`);
    if (!reason) throw new Error(`${change.timestampId} の「${change.kind}」に変更理由がありません。`);
    return { ...change, reason };
  });
  const expectedKeys = new Set(changes.map((change) => `${change.timestampId}\0${change.kind}`));
  const extras = reasons.reasons.filter((reason) => !expectedKeys.has(`${reason.timestampId}\0${reason.kind}`));
  if (extras.length > 0) throw new Error('実際の差分に対応しない変更理由があります。');
  console.log(JSON.stringify({ videoId: before.videoId, changes: enriched }, null, 2));
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
