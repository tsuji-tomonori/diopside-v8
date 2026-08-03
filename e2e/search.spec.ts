import { expect, test } from '@playwright/test';

import {
  capture,
  expectMinimumTargets,
  expectNoSeriousAccessibilityViolations,
  expectOnlyAllowedRequests,
  openSearch,
  preparePage,
} from './helpers.ts';

test.describe('動画検索', () => {
  test('タイトルだけを検索し、0件と条件解除を区別する', async ({ page }, testInfo) => {
    const requests = await preparePage(page);
    await openSearch(page);
    await page.getByLabel('動画タイトル').fill('誕生日2026');
    await page.getByRole('button', { name: 'この条件で探す' }).click();
    await expect(page.getByRole('heading', { name: '1件の動画' })).toBeVisible();
    await expect(page.locator('.video-card')).toHaveCount(1);
    await expect(page.locator('.video-card')).toContainText('白雪巴誕生日2026');
    const status = page.getByTestId('result-update-status');
    await expect(status).toContainText('1件の検索結果へ更新しました');
    const elapsed = Number((await status.textContent())?.match(/([\d.]+)ミリ秒/u)?.[1]);
    expect(elapsed).toBeLessThan(100);

    await page.getByLabel('動画タイトル').fill('一致しない架空の動画タイトル');
    await page.getByRole('button', { name: 'この条件で探す' }).click();
    await expect(page.getByRole('heading', { name: '0件の動画' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '一致する動画がありません' })).toBeVisible();
    await page.getByRole('button', { name: '条件をすべて解除' }).click();
    await expect(page.getByRole('heading', { name: '8件の動画' })).toBeVisible();

    await capture(page, testInfo, 'モバイル', 'search-mobile.jpg');
    expectOnlyAllowedRequests(requests);
  });

  test('別名からタグを追加し、完全一致AND・日付・動画長を同時適用する', async ({ page }) => {
    await preparePage(page);
    await openSearch(page);
    await page.getByText('タグ・公開日・動画長で絞り込む').click();
    await page.getByLabel('タグ名または別名から追加').fill('#女王と会長');
    await page.getByRole('button', { name: 'タグを追加' }).click();
    await expect(page.getByRole('button', { name: /女王と会長/u })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('開始日').fill('2026-01-01');
    await page.getByLabel('終了日').fill('2026-12-31');
    await page.getByLabel('最小（分）').fill('120');
    await page.getByLabel('最大（分）').fill('240');
    await page.getByRole('button', { name: '絞り込みを反映' }).click();
    await expect(page.getByRole('heading', { name: '1件の動画' })).toBeVisible();
    await expect(page.locator('.video-card')).toContainText('魔法使いの愛した子');
    expect(page.url()).toContain('tag=tag-people-unit-d5b1de96b450');
  });

  test('入力矛盾を日本語で示し、並び替えとキーボード操作を提供する', async ({ page }) => {
    await preparePage(page);
    await openSearch(page);
    await page.getByText('タグ・公開日・動画長で絞り込む').click();
    await page.getByLabel('最小（分）').fill('200');
    await page.getByLabel('最大（分）').fill('100');
    await expect(page.getByRole('alert')).toContainText('最小値は最大値以下');
    await page.getByLabel('最小（分）').fill('');
    await page.getByLabel('最大（分）').fill('');
    await page.getByLabel('並び順').selectOption('公開日の古い順');
    await expect(page.locator('.video-card').first()).toHaveAttribute('data-video-id', 'kOvsSm2Apoo');

    await page.reload();
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await expectMinimumTargets(page);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('公開データ取得失敗を正常な0件と別の日本語状態にする', async ({ page }) => {
    await page.route('**/data/latest.json', async (route) => route.fulfill({ status: 503, body: 'unavailable' }));
    await page.goto('/diopside-v8/');
    await expect(page.getByRole('alert')).toContainText('取得失敗');
    await expect(page.getByRole('heading', { name: '動画一覧を表示できません' })).toBeVisible();
    await expect(page.getByRole('button', { name: '再読み込み' })).toBeVisible();
  });
});
