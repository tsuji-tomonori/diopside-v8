import { expect, test } from '@playwright/test';

import {
  expectNoSeriousAccessibilityViolations,
  expectOnlyAllowedRequests,
  preparePage,
} from './helpers.ts';

test.describe('ゲームジャンル・作品一覧', () => {
  test('ジャンルからゲームを選び、そのゲームをプレイした配信一覧へ進める', async ({ page }) => {
    const requests = await preparePage(page);
    await page.goto('/#/games');

    await expect(page.getByRole('heading', { level: 1, name: 'ゲームを探す' })).toBeVisible();
    const genreCards = page.locator('.game-genre-card');
    await expect(genreCards).toHaveCount(26);
    await expect(genreCards.locator('.game-genre-card-icon')).toHaveCount(26);
    await expect(genreCards.locator('.game-genre-card-icon[aria-hidden="true"]')).toHaveCount(26);
    const adventure = page.locator('.game-genre-card').filter({ has: page.getByRole('heading', { name: 'アドベンチャー' }) });
    await adventure.click();
    await expect(page).toHaveURL(/#\/games\/genres\/tag-content-gameGenre-2ec4e38c680d$/u);

    const wagamama = page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'ワガママハイスペック' }) });
    await expect(wagamama.getByRole('link', { name: '6件の配信を見る →' })).toBeVisible();
    await wagamama.getByRole('link', { name: 'ワガママハイスペック' }).click();

    await expect(page).toHaveURL(/#\/works\/tag-works-gameTitle-ea18b3c09633$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'ワガママハイスペック' })).toBeVisible();
    await expect(page.locator('.game-genre-links').getByRole('link', { name: 'アドベンチャー' })).toBeVisible();
    await expect(page.locator('.game-genre-links').getByRole('link', { name: 'カジュアル' })).toBeVisible();
    await expect(page.locator('.game-genre-links').getByRole('link', { name: 'ビジュアルノベル' })).toBeVisible();
    await expect(page.locator('.game-genre-links').getByRole('link', { name: 'アクション' })).toHaveCount(0);
    await expect(page.locator('.work-results .video-card')).toHaveCount(6);
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('対象動画でもゲーム正本のジャンルだけを表示する', async ({ page }) => {
    const requests = await preparePage(page);
    await page.goto('/#/video/B6D1F1PMMHw');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('ワガママハイスペック');
    const tags = page.locator('.detail-tags');
    await expect(tags.getByRole('link', { name: /アドベンチャー.*このジャンルのゲームを見る/u })).toBeVisible();
    await expect(tags.getByRole('link', { name: /カジュアル.*このジャンルのゲームを見る/u })).toBeVisible();
    await expect(tags.getByRole('link', { name: /ビジュアルノベル.*このジャンルのゲームを見る/u })).toBeVisible();
    await expect(tags.getByText('アクション', { exact: true })).toHaveCount(0);
    await expect(tags.getByRole('link', { name: /ワガママハイスペック.*作品ページを見る/u })).toBeVisible();
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('同じゲームの表記違いを一作品へまとめて全配信を表示する', async ({ page }) => {
    const requests = await preparePage(page);
    await page.goto('/#/games/genres/tag-content-gameGenre-fc55c08efe24');

    await expect(page.getByRole('heading', { level: 2, name: '雀魂 -じゃんたま-', exact: true })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2, name: '雀魂-じゃんたま-', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: '雀魂 -じゃんたま-', exact: true }).click();
    await expect(page.locator('.work-results .video-card')).toHaveCount(23);

    await page.goto('/#/works/tag-works-gameTitle-7533c687b358');
    await expect(page.getByRole('heading', { level: 1, name: '雀魂 -じゃんたま-' })).toBeVisible();
    await expect(page.locator('.work-results .video-card')).toHaveCount(23);
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
  });
});
