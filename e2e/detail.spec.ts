import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  capture,
  expectNoSeriousAccessibilityViolations,
  expectOnlyAllowedRequests,
  openSearch,
  preparePage,
} from './helpers.ts';

const root = process.cwd();
const latest = JSON.parse(readFileSync(path.join(root, 'public/data/latest.json'), 'utf8')) as { releaseId: string };

test.describe('動画詳細', () => {
  test('基本情報、確認済みタグ、未作成状態、更新日、YouTubeリンクを表示する', async ({ page }, testInfo) => {
    const requests = await preparePage(page);
    await openSearch(page);
    await page.locator('[data-video-id="Oq6BZEyCMEQ"]').getByRole('link', { name: '詳細を見る', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('SILENT HILL2');
    await expect(page.getByRole('heading', { name: 'タグ' })).toBeVisible();
    await expect(page.getByText('YouTube公式タグではありません')).toBeVisible();
    await expect(page.getByText('主ジャンルゲーム')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'タイムスタンプ' })).toBeVisible();
    await expect(page.locator('.unavailable strong')).toHaveCount(2);
    await expect(page.locator('.unavailable strong').nth(0)).toContainText('未作成 — 全編確認不足');
    await expect(page.locator('.unavailable strong').nth(1)).toContainText('未作成 — 資料不足');
    await expect(page.getByRole('link', { name: 'YouTubeで見る' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=Oq6BZEyCMEQ');
    await expect(page.getByText(/最終更新:/u)).toHaveCount(3);
    expect(requests.some((url) => url.includes('youtube.com'))).toBe(false);
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
    await capture(page, testInfo, 'デスクトップ', 'detail-desktop.jpg');
  });

  test('承認済みタイムスタンプを昇順・連続区間・同じYouTube開始秒で表示し、ワードクラウドを描画する', async ({ page }) => {
    await preparePage(page);
    const videoId = 'Oq6BZEyCMEQ';
    const relative = `public/data/releases/${latest.releaseId}/videos/${videoId}.json`;
    const detail = JSON.parse(readFileSync(path.join(root, relative), 'utf8')) as Record<string, unknown>;
    detail.timestamps = {
      status: '作成済み',
      origin: 'diopsideで作成した時刻一覧',
      updatedAt: '2026-08-03T00:00:00+09:00',
      items: [
        { timestampId: 'timestamp-opening', startSeconds: 0, endSeconds: 600, label: '探索の準備', confidence: '高', youtubeUrl: `https://www.youtube.com/watch?v=${videoId}&t=0s` },
        { timestampId: 'timestamp-area', startSeconds: 600, endSeconds: 1200, label: '次の区域を探索', confidence: '高', youtubeUrl: `https://www.youtube.com/watch?v=${videoId}&t=600s` },
        { timestampId: 'timestamp-closing', startSeconds: 1200, endSeconds: 17705, label: '終盤の探索', confidence: '中', youtubeUrl: `https://www.youtube.com/watch?v=${videoId}&t=1200s` },
      ],
    };
    detail.wordCloud = {
      status: '作成済み',
      words: Array.from({ length: 20 }, (_, index) => ({ term: `確認語${String(index + 1).padStart(2, '0')}`, weight: 100 - index })),
      inputType: '公開字幕',
      exclusionRulesVersion: '8.0.0',
      rulesVersion: '8.0.0',
      updatedAt: '2026-08-03T00:00:00+09:00',
    };
    await page.route(`**/data/releases/${latest.releaseId}/videos/${videoId}.json`, async (route) => route.fulfill({ json: detail }));
    await page.goto(`/diopside-v8/#/video/${videoId}`);
    await expect(page.getByText('由来: diopsideで作成した時刻一覧')).toBeVisible();
    const links = page.locator('.timestamps a');
    await expect(links).toHaveCount(3);
    await expect(links.nth(0)).toHaveAttribute('href', `https://www.youtube.com/watch?v=${videoId}&t=0s`);
    await expect(links.nth(1)).toContainText('10:00–20:00');
    await expect(page.getByLabel('ワードクラウド').locator('span')).toHaveCount(20);
  });

  test('詳細JSONの構造不適合を日本語で停止表示する', async ({ page }) => {
    await preparePage(page);
    await page.route(`**/data/releases/${latest.releaseId}/videos/Oq6BZEyCMEQ.json`, async (route) => route.fulfill({ json: { broken: true } }));
    await page.goto('/diopside-v8/#/video/Oq6BZEyCMEQ');
    await expect(page.getByRole('heading', { name: '構造不適合' })).toBeVisible();
    await expect(page.getByText('動画詳細の形式を確認できませんでした。')).toBeVisible();
  });
});
