import { expect, test } from '@playwright/test';

import {
  expectNoSeriousAccessibilityViolations,
  expectOnlyAllowedRequests,
  openSearch,
  preparePage,
} from './helpers.ts';

test.describe('歌唱楽曲一覧', () => {
  test('ジャンル「歌」から移動し、原曲と配信開始秒を開ける', async ({ page }) => {
    const requests = await preparePage(page);
    await openSearch(page);
    await page.getByText('タグ・公開日・動画長で絞り込む').click();
    await page.getByRole('button', { name: /^歌\d+件$/u }).first().click();

    await expect(page).toHaveURL(/#\/songs$/u);
    await expect(page.getByRole('heading', { level: 1, name: '歌った曲' })).toBeVisible();
    await expect(page.getByRole('link', { name: '10:33 から見る ↗' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=ARViApkvV-E&t=633s',
    );
    const song = page.locator('.song-card').filter({ has: page.getByRole('heading', { name: '可愛くてごめん' }) });
    await expect(song.getByRole('link', { name: '原曲を聴く ↗' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=K4xLi8IF1FM',
    );
    await expect(song.getByRole('link', { name: '動画を見る ↗' })).toHaveClass(/primary/u);
    await expect(song.getByRole('link', { name: '原曲を聴く ↗' })).toHaveClass(/secondary/u);
    const sectionOrder = await song.locator('.song-performance, .song-original').evaluateAll(
      (sections) => sections.map((section) => section.className),
    );
    expect(sectionOrder).toEqual(['song-performance', 'song-original']);
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('動画詳細の楽曲タグから曲別実績へ移動できる', async ({ page }) => {
    const requests = await preparePage(page);
    await page.goto('/#/video/ARViApkvV-E');
    const songLink = page.getByRole('link', { name: /可愛くてごめん.*歌唱実績を見る/u });
    await expect(songLink).toBeVisible();
    await songLink.click();

    await expect(page).toHaveURL(/#\/songs\/tag-works-songTitle-f7c683c127e9$/u);
    await expect(page.getByRole('heading', { level: 1, name: '可愛くてごめん' })).toBeVisible();
    await expect(page.locator('.song-card')).toHaveCount(1);
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
  });
});
