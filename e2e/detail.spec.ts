import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { videoShardId } from '../src/domain/content.ts';

import {
  capture,
  expectNoSeriousAccessibilityViolations,
  expectOnlyAllowedRequests,
  preparePage,
} from './helpers.ts';

const root = process.cwd();
const latest = JSON.parse(readFileSync(path.join(root, 'public/data/latest.json'), 'utf8')) as { releaseId: string };

test.describe('動画詳細', () => {
  test('基本情報、確認済みタグ、未提供のタイムスタンプ、更新日、YouTubeリンクを表示する', async ({ page }) => {
    const requests = await preparePage(page);
    await page.goto('/diopside-v8/#/video/7keH8yrqabc');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Detroit: Become Human');
    await expect(page.getByRole('heading', { name: 'タグ' })).toBeVisible();
    await expect(page.getByText('YouTube公式タグではありません')).toBeVisible();
    await expect(page.getByText('主ジャンルゲーム')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'タイムスタンプ' })).toBeVisible();
    await expect(page.locator('.unavailable strong')).toHaveCount(2);
    await expect(page.locator('.unavailable strong').nth(0)).toContainText('未作成 — 全編確認不足');
    await expect(page.locator('.unavailable strong').nth(1)).toContainText('未作成 — 資料不足');
    await expect(page.getByRole('link', { name: 'YouTubeで見る' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=7keH8yrqabc');
    const synopsisCount = await page.getByRole('heading', { name: 'あらすじ' }).count();
    await expect(page.getByText(/最終更新:/u)).toHaveCount(synopsisCount === 1 ? 4 : 3);
    expect(requests.some((url) => url.includes('youtube.com'))).toBe(false);
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('移行した承認済みタイムスタンプを昇順・連続区間・同じYouTube開始秒で表示する', async ({ page }, testInfo) => {
    await preparePage(page);
    const videoId = 'c9TnpjK3ZZE';
    await page.goto(`/diopside-v8/#/video/${videoId}`);
    await expect(page.getByText('由来: diopsideで作成した時刻一覧')).toBeVisible();
    const links = page.locator('.timestamps a');
    await expect(links).toHaveCount(21);
    await expect(links.nth(0)).toHaveAttribute('href', `https://www.youtube.com/watch?v=${videoId}&t=0s`);
    await expect(links.nth(1)).toHaveAttribute('href', `https://www.youtube.com/watch?v=${videoId}&t=221s`);
    await expect(page.getByText('未作成 — 資料不足')).toBeVisible();
    await capture(page, testInfo, 'デスクトップ', 'detail-desktop.jpg');
  });

  test('ネタバレを避けたあらすじと末尾の特徴的なセリフを表示する', async ({ page }) => {
    await preparePage(page);
    const videoId = 'ewtbVStzFUc';
    await page.goto(`/diopside-v8/#/video/${videoId}`);
    await expect(page.getByRole('heading', { name: 'あらすじ' })).toBeVisible();
    await expect(page.locator('.synopsis-copy')).toContainText('新作グラコロと限定ソース');
    await expect(page.locator('.featured-quote')).toContainText('これ明日も食べたいね。');
    await expect(page.getByRole('link', { name: 'この場面から見る' })).toHaveAttribute(
      'href',
      `https://www.youtube.com/watch?v=${videoId}&t=651s`,
    );
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('承認済みワードクラウドを20語以上で描画する', async ({ page }) => {
    await preparePage(page);
    const videoId = 'c9TnpjK3ZZE';
    const shardId = videoShardId(videoId);
    const relative = `public/data/releases/${latest.releaseId}/video-shards/${shardId}.json`;
    const shard = JSON.parse(readFileSync(path.join(root, relative), 'utf8')) as { videos: Record<string, Record<string, unknown>> };
    const detail = shard.videos[videoId]!;
    detail.wordCloud = {
      status: '作成済み',
      words: Array.from({ length: 20 }, (_, index) => ({ term: `確認語${String(index + 1).padStart(2, '0')}`, weight: 100 - index })),
      inputType: '公開字幕',
      exclusionRulesVersion: '8.0.0',
      rulesVersion: '8.0.0',
      updatedAt: '2026-08-03T00:00:00+09:00',
    };
    await page.route(`**/data/releases/${latest.releaseId}/video-shards/${shardId}.json`, async (route) => route.fulfill({ json: shard }));
    await page.goto(`/diopside-v8/#/video/${videoId}`);
    await expect(page.getByLabel('ワードクラウド').locator('span')).toHaveCount(20);
  });

  test('詳細JSONの構造不適合を日本語で停止表示する', async ({ page }) => {
    await preparePage(page);
    const shardId = videoShardId('c9TnpjK3ZZE');
    await page.route(`**/data/releases/${latest.releaseId}/video-shards/${shardId}.json`, async (route) => route.fulfill({ json: { broken: true } }));
    await page.goto('/diopside-v8/#/video/c9TnpjK3ZZE');
    await expect(page.getByRole('heading', { name: '構造不適合' })).toBeVisible();
    await expect(page.getByText('動画詳細の形式を確認できませんでした。')).toBeVisible();
  });

  test('作品タグから公式紹介付きの作品別動画一覧へ移動できる', async ({ page }) => {
    const requests = await preparePage(page);
    await page.goto('/diopside-v8/#/video/Wchiju9lJv0');
    const workLink = page.getByRole('link', { name: /SILENT HILL2/u });
    await expect(workLink).toBeVisible();
    await workLink.click();
    await expect(page).toHaveURL(/#\/works\/tag-works-gameTitle-942446bc56ac$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'SILENT HILL2' })).toBeVisible();
    await expect(page.locator('.work-quote')).toContainText('シリーズ最高傑作と名高いサイコロジカルホラー');
    await expect(page.getByRole('link', { name: 'SILENT HILL 2 公式サイト' })).toHaveAttribute(
      'href',
      'https://www.konami.com/games/silenthill/2r/jp/ja/',
    );
    await expect(page.locator('.work-results .video-card')).toHaveCount(4);
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
  });
});
