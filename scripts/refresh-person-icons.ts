import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface PersonProfile {
  name: string;
  channelId: string;
  iconFile: string;
  iconRetrievedAt: string;
  iconKind: 'youtube-channel' | 'generated-placeholder';
}

interface CollaborationProfiles {
  updatedAt: string;
  people: PersonProfile[];
}

const root = process.cwd();
const profilesPath = path.join(root, 'content/people/collaboration-profiles.json');
const profiles = JSON.parse(readFileSync(profilesPath, 'utf8')) as CollaborationProfiles;
const refreshAll = process.argv.includes('--all');
const targets = profiles.people.filter((person) => refreshAll || person.iconKind !== 'youtube-channel');
const retrievedAt = new Date().toISOString().slice(0, 10);

if (targets.length === 0) {
  console.log('更新対象の人物アイコンはありません。');
  process.exit(0);
}

const downloads = await mapWithConcurrency(targets, 4, async (person) => ({
  person,
  image: await fetchChannelIcon(person),
}));

for (const { person, image } of downloads) {
  writeFileSync(path.join(root, 'content/people/icons', person.iconFile), image);
  person.iconKind = 'youtube-channel';
  person.iconRetrievedAt = retrievedAt;
}
profiles.updatedAt = retrievedAt;
writeFileSync(profilesPath, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8');
console.log(`${downloads.length}件のYouTubeチャンネルアイコンを更新しました。`);

async function fetchChannelIcon(person: PersonProfile): Promise<Uint8Array> {
  const channelUrl = `https://www.youtube.com/channel/${person.channelId}`;
  const htmlResponse = await fetchWithRetry(channelUrl, {
    headers: {
      'accept-language': 'ja,en-US;q=0.8,en;q=0.6',
      'user-agent': 'Mozilla/5.0 (compatible; diopside-icon-refresh/1.0)',
    },
  });
  const html = await htmlResponse.text();
  const iconUrl = extractOpenGraphImage(html);
  if (!iconUrl) throw new Error(`${person.name}: YouTubeチャンネル画像を検出できませんでした。`);

  const imageResponse = await fetchWithRetry(normalizeIconSize(iconUrl));
  const contentType = imageResponse.headers.get('content-type') ?? '';
  const image = new Uint8Array(await imageResponse.arrayBuffer());
  if (!contentType.startsWith('image/jpeg') || image.length < 1_024 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
    throw new Error(`${person.name}: 取得したチャンネル画像がJPEGではありません。`);
  }
  return image;
}

function extractOpenGraphImage(html: string): string | undefined {
  const meta = html.match(/<meta\s+(?=[^>]*property=["']og:image["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>/iu);
  return meta?.[1]?.replaceAll('&amp;', '&');
}

function normalizeIconSize(iconUrl: string): string {
  return `${iconUrl.replace(/=s\d+.*$/u, '')}=s256-c-k-c0x00ffffff-no-rj`;
}

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let failure: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      if (response.ok) return response;
      failure = new Error(`HTTP ${response.status}`);
    } catch (error: unknown) {
      failure = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  throw new Error(`取得に3回失敗しました: ${url}`, { cause: failure });
}

async function mapWithConcurrency<T, U>(items: T[], concurrency: number, worker: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!);
    }
  }));
  return results;
}
