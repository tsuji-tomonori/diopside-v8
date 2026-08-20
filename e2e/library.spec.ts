import { expect, test } from '@playwright/test';

import {
  allVideosHeading,
  capture,
  expectNoSeriousAccessibilityViolations,
  expectOnlyAllowedRequests,
  openSearch,
  preparePage,
} from './helpers.ts';

test.describe('端末内リスト', () => {
  test('お気に入り・履歴・検索条件をIndexedDBへ保存し、再読み込み後も個別削除できる', async ({ page }, testInfo) => {
    const requests = await preparePage(page);
    await openSearch(page);
    const card = page.locator('.video-card').first();
    const title = (await card.locator('h2').textContent())?.trim();
    expect(title).toBeTruthy();
    await card.getByRole('button', { name: 'お気に入りに追加' }).click();
    await card.getByRole('link', { name: '詳細を見る', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(title!);
    await page.getByRole('link', { name: '動画を探す' }).click();
    await page.getByLabel('検索').fill('新年');
    await page.getByRole('button', { name: 'この条件で探す' }).click();
    await page.getByRole('link', { name: '端末内リスト' }).click();
    await expect(page.getByRole('heading', { name: /お気に入り/u })).toContainText('1件');
    await expect(page.getByRole('heading', { name: /閲覧履歴/u })).toContainText('1件');
    await expect(page.getByRole('heading', { name: /最近の検索条件/u })).toContainText('1件');

    await page.reload();
    await expect(page.getByRole('heading', { name: /お気に入り/u })).toContainText('1件');
    await page.getByRole('button', { name: 'このお気に入りを削除' }).click();
    await page.locator('.library-section').filter({ has: page.getByRole('heading', { name: /閲覧履歴/u }) }).getByRole('button', { name: '削除', exact: true }).click();
    await page.locator('.library-section').filter({ has: page.getByRole('heading', { name: /最近の検索条件/u }) }).getByRole('button', { name: '削除', exact: true }).click();
    await expect(page.getByRole('heading', { name: /お気に入り/u })).toContainText('0件');
    await expect(page.getByRole('heading', { name: /閲覧履歴/u })).toContainText('0件');
    await expect(page.getByRole('heading', { name: /最近の検索条件/u })).toContainText('0件');
    await capture(page, testInfo, 'モバイル', 'library-mobile.jpg');
    expectOnlyAllowedRequests(requests);
  });

  test('一括削除は確認後にdiopsideの4種類の端末データを消す', async ({ page }) => {
    await preparePage(page);
    await openSearch(page);
    const card = page.locator('.video-card').first();
    await card.getByRole('button', { name: 'お気に入りに追加' }).click();
    await card.getByRole('link', { name: '詳細を見る', exact: true }).click();
    await page.getByRole('link', { name: '端末内リスト' }).click();
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('端末内データをすべて削除');
      await dialog.accept();
    });
    await page.getByRole('button', { name: '端末内データをすべて削除' }).click();
    await expect(page.getByRole('heading', { name: /お気に入り/u })).toContainText('0件');
    await expect(page.getByRole('heading', { name: /閲覧履歴/u })).toContainText('0件');
  });

  test('IndexedDBを拒否されても通知して検索・閲覧を続ける', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
    });
    await preparePage(page);
    await openSearch(page);
    await page.locator('.video-card').first().getByRole('button', { name: 'お気に入りに追加' }).click();
    await expect(page.locator('.storage-notice')).toContainText('端末内への保存を利用できません');
    await expect(page.getByRole('heading', { name: allVideosHeading })).toBeVisible();
    await page.locator('.video-card').first().getByRole('link', { name: '詳細を見る', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
  });
});
