import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import { videoExclusionsSchema, videoShardId } from '../src/domain/content.ts';
import { readCanonicalVideos } from './canonical-store.ts';

const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/u);
const sha = z.string().regex(/^[0-9a-f]{40}$/u);
const rows = z.array(z.object({ videoId, complete: z.boolean() }).strict());
export const archiveAuditInput = z.object({
  discovered: z.array(videoId),
  timestampsLedger: rows,
  synopsisLedger: rows,
  pullRequests: z.array(z.object({
    videoId,
    number: z.number().int().positive(),
    headSha: sha,
    draft: z.boolean(),
    mergeable: z.boolean().nullable(),
    check: z.object({
      headSha: sha,
      conclusion: z.enum(['running', 'success', 'failure']),
    }).strict().nullable(),
  }).strict()),
}).strict();

type Input = z.infer<typeof archiveAuditInput>;
type Features = { timestamps: boolean; synopsis: boolean };
const missing = { timestamps: false, synopsis: false };
const isComplete = (f: Features) => f.timestamps && f.synopsis;
function indexUnique<T>(items: T[], key: (item: T) => string, name: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    if (result.has(id)) throw new Error(`${name}でIDが重複: ${id}`);
    result.set(id, item);
  }
  return result;
}

export function reconcileArchives(
  input: Input,
  canonical: Map<string, Features>,
  published: Map<string, Features>,
  excluded: Set<string>,
) {
  const timestamps = indexUnique(input.timestampsLedger, row => row.videoId, '時刻台帳');
  const synopses = indexUnique(input.synopsisLedger, row => row.videoId, 'あらすじ台帳');
  const ids = indexUnique(input.discovered, id => id, '配信元');
  const pullRequests = new Map<string, Input['pullRequests']>();
  for (const pr of indexUnique(input.pullRequests, pr => String(pr.number), 'PR').values()) {
    const list = pullRequests.get(pr.videoId) ?? [];
    list.push(pr);
    pullRequests.set(pr.videoId, list);
  }
  return [...ids.keys()].sort().map(videoId => {
    const open = pullRequests.get(videoId) ?? [];
    const source = canonical.get(videoId);
    const live = published.get(videoId);
    const ledger = {
      timestamps: timestamps.get(videoId)?.complete ?? null,
      synopsis: synopses.get(videoId)?.complete ?? null,
    };
    const ledgerMissing = ledger.timestamps === null || ledger.synopsis === null;
    const ledgerMismatch = (ledger.timestamps !== null && ledger.timestamps !== (live ?? missing).timestamps)
      || (ledger.synopsis !== null && ledger.synopsis !== (live ?? missing).synopsis);
    const checks = open.map(pr => {
      const status = pr.mergeable === false ? 'conflict'
        : pr.check?.headSha !== pr.headSha ? 'latest-check-missing'
          : pr.check.conclusion === 'failure' ? 'check-failed'
            : pr.check.conclusion === 'running' ? 'check-running'
              : pr.draft ? 'draft'
                : pr.mergeable === null ? 'mergeability-unknown' : 'review-merge-conditions';
      return { number: pr.number, headSha: pr.headSha, draft: pr.draft, status };
    });
    const publicationIncomplete = source && (!live
      || (source.timestamps && !live.timestamps) || (source.synopsis && !live.synopsis));
    return {
      videoId,
      registered: !ledgerMissing,
      ledger,
      ledgerIssues: [...(ledgerMissing ? ['missing-row'] : []), ...(ledgerMismatch ? ['differs-from-public'] : [])],
      canonical: source ?? null,
      published: live ?? null,
      pullRequests: checks,
      stage: excluded.has(videoId) ? 'excluded'
        : !source && live ? 'public-not-in-canonical'
          : publicationIncomplete ? 'awaiting-publication'
            : live && isComplete(live) ? 'published'
              : checks.length > 0 ? 'open-pull-request'
                : source ? 'enrichment-missing' : ledgerMissing ? 'register' : 'prepare',
    };
  });
}

const releaseIdSchema = z.string().regex(/^release-[0-9a-f]{16}$/u);
const pointerSchema = z.object({ releaseId: releaseIdSchema });
const siteIndexSchema = z.object({ releaseId: releaseIdSchema, videos: z.array(z.object({ videoId })) });
const shardSchema = z.object({
  releaseId: releaseIdSchema,
  shardId: z.string(),
  videos: z.record(videoId, z.object({
    videoId, releaseId: releaseIdSchema,
    timestamps: z.object({ status: z.string(), items: z.array(z.unknown()).optional() }),
    synopsis: z.object({ body: z.string().min(1) }).optional(),
  })),
});

export async function readPublishedArchives(
  ids: string[], read: (relativePath: string) => Promise<unknown>,
): Promise<{ releaseId: string; videos: Map<string, Features> }> {
  const { releaseId } = pointerSchema.parse(await read('data/latest.json'));
  const release = `data/releases/${releaseId}`;
  const index = siteIndexSchema.parse(await read(`${release}/index.json`));
  if (index.releaseId !== releaseId) throw new Error('公開索引の版が最新版ポインターと一致しません。');
  const indexById = indexUnique(index.videos, item => item.videoId, '公開索引');
  const grouped = new Map<string, string[]>();
  for (const id of ids) {
    if (!indexById.has(id)) continue;
    const shard = videoShardId(id);
    const list = grouped.get(shard) ?? [];
    list.push(id);
    grouped.set(shard, list);
  }
  const videos = new Map<string, Features>();
  for (const [shard, list] of grouped) {
    const detail = shardSchema.parse(await read(`${release}/video-shards/${shard}.json`));
    if (detail.releaseId !== releaseId || detail.shardId !== shard) throw new Error(`公開詳細の版またはシャードが不一致: ${shard}`);
    for (const id of list) {
      const video = detail.videos[id];
      if (video?.videoId !== id || video.releaseId !== releaseId) throw new Error(`公開索引にある動画詳細が未確認: ${id}`);
      videos.set(id, {
        timestamps: video.timestamps.status === '作成済み' && (video.timestamps.items?.length ?? 0) > 0,
        synopsis: video.synopsis !== undefined,
      });
    }
  }
  if (pointerSchema.parse(await read('data/latest.json')).releaseId !== releaseId) {
    throw new Error('確認中に公開版が切り替わりました。最新版を再取得してください。');
  }
  return { releaseId, videos };
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('使い方: npm run audit:archive-publication -- <正規化した照合入力.json> <照合出力.json>');
  const input = archiveAuditInput.parse(JSON.parse(readFileSync(inputPath, 'utf8')));
  const root = path.resolve(import.meta.dirname, '..');
  const canonical = new Map(readCanonicalVideos(root).map(video => [
    video.videoId,
    { timestamps: video.timestamps.status === '作成済み', synopsis: video.synopsis !== undefined },
  ]));
  const exclusions = videoExclusionsSchema.parse(JSON.parse(readFileSync(path.join(root, 'content/exclusions.json'), 'utf8')));
  const policy = z.object({ customDomain: z.literal('tme.page.diopside.net') })
    .parse(JSON.parse(readFileSync(path.join(root, 'operations/pages-policy.json'), 'utf8')));
  const published = await readPublishedArchives(input.discovered, async relativePath => {
    const res = await fetch(`https://${policy.customDomain}/${relativePath}`, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`公開データ未確認 (${res.status}): ${relativePath}`);
    return res.json() as Promise<unknown>;
  });
  const records = reconcileArchives(input, canonical, published.videos, new Set(exclusions.records.map(row => row.videoId)));
  writeFileSync(outputPath, JSON.stringify({ releaseId: published.releaseId, records }, null, 2) + '\n', { flag: 'wx' });
  console.log(`${records.length}件を照合しました: ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
