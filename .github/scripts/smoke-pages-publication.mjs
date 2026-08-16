import { readFile } from 'node:fs/promises';

const siteOrigin = new URL(process.env.PAGES_SITE_ORIGIN ?? 'https://tme.page.diopside.net/');
const retries = 30;
const retryDelayMs = 10_000;

const releaseSource = await readFile(new URL('../../src/generated/release.ts', import.meta.url), 'utf8');
const expectedReleaseId = releaseSource.match(/embeddedReleaseId\s*=\s*'([^']+)'/u)?.[1];
if (!expectedReleaseId) throw new Error('公開対象commitから埋め込みrelease IDを取得できません。');

for (let attempt = 1; attempt <= retries; attempt += 1) {
  try {
    await verifyPublishedRelease();
    console.log(`GitHub Pagesの公開データを確認しました: ${expectedReleaseId}`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (attempt === retries) throw new Error(`GitHub Pages公開データの確認が期限内に完了しませんでした: ${message}`);
    console.log(`公開反映待ち (${attempt}/${retries}): ${message}`);
    await delay(retryDelayMs);
  }
}

async function verifyPublishedRelease() {
  const latest = await fetchJson('data/latest.json');
  if (latest.releaseId !== expectedReleaseId) {
    throw new Error(`data/latest.jsonのrelease IDが不一致です: expected=${expectedReleaseId}, actual=${latest.releaseId}`);
  }
  if (typeof latest.indexPath !== 'string') throw new Error('data/latest.jsonにindexPathがありません。');

  const index = await fetchJson(latest.indexPath);
  if (index.releaseId !== expectedReleaseId || !Array.isArray(index.videos) || index.videos.length === 0) {
    throw new Error('公開index.jsonが期待するreleaseまたは動画一覧を返していません。');
  }

  const candidates = [
    index.videos.find((video) => video.videoId === 'oY8Bex-CK9I'),
    index.videos[0],
    index.videos.at(-1),
  ].filter((video, position, videos) => video && videos.findIndex((value) => value.videoId === video.videoId) === position);

  for (const video of candidates) {
    const shardId = videoShardId(video.videoId);
    const shard = await fetchJson(`data/releases/${expectedReleaseId}/video-shards/${shardId}.json`);
    if (shard.releaseId !== expectedReleaseId || shard.shardId !== shardId || shard.videos?.[video.videoId]?.releaseId !== expectedReleaseId) {
      throw new Error(`動画詳細shardが公開されていません: video=${video.videoId}, shard=${shardId}`);
    }
  }
}

async function fetchJson(relativePath) {
  const url = new URL(relativePath.replace(/^\//u, ''), siteOrigin);
  url.searchParams.set('pages-smoke', expectedReleaseId);
  const response = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`${url.pathname} のHTTP応答が ${response.status} です。`);
  return response.json();
}

function videoShardId(videoId) {
  let hash = 0x811c9dc5;
  for (const character of videoId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 256).toString(16).padStart(2, '0');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
