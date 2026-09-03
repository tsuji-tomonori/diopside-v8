import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { afterAll, beforeAll, expect, test } from 'vitest';

import { embeddedReleaseId } from '../src/generated/release.ts';

const execFileAsync = promisify(execFile);
let server: Server;
let siteOrigin = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', siteOrigin).pathname;
    const body = path === '/data/latest.json'
      ? { releaseId: embeddedReleaseId, indexPath: `data/releases/${embeddedReleaseId}/index.json` }
      : path.endsWith('/index.json')
        ? { releaseId: embeddedReleaseId, videos: [{ videoId: 'oY8Bex-CK9I' }] }
        : path.endsWith('/video-shards/85.json')
          ? { releaseId: embeddedReleaseId, shardId: '85', videos: { 'oY8Bex-CK9I': { releaseId: embeddedReleaseId } } }
          : undefined;
    response.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP fixtureを開始できません。');
  siteOrigin = `http://127.0.0.1:${address.port}/`;
});

afterAll(() => server.close());

test('公開済みlatest・index・動画詳細shardを同じreleaseとして検査する', async () => {
  const releaseSource = await readFile('src/generated/release.ts', 'utf8');
  expect(releaseSource).toContain(`embeddedReleaseId = '${embeddedReleaseId}'`);
  await expect(execFileAsync(process.execPath, ['.github/scripts/smoke-pages-publication.mjs'], {
    env: { ...process.env, PAGES_SITE_ORIGIN: siteOrigin },
  })).resolves.toMatchObject({ stdout: expect.stringContaining(embeddedReleaseId) });
});
