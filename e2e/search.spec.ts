import { expect, test } from '@playwright/test';

import { embeddedReleaseId } from '../src/generated/release.ts';

import {
  allVideosHeading,
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
    await page.getByLabel('動画タイトル').fill('【#白雪巴誕生日2026】ケーキを食べてパーッとお祝いしちゃおうかしら🎉🎉🎉【白雪巴/にじさんじ】');
    await page.getByRole('button', { name: 'この条件で探す' }).click();
    await expect(page.getByRole('heading', { name: '1件の動画' })).toBeVisible();
    await expect(page.locator('.video-card')).toHaveCount(1);
    await expect(page.locator('.video-card')).toHaveAttribute('data-video-id', 'GoWhHtJmIbk');
    const status = page.getByTestId('result-update-status');
    await expect(status).toContainText('1件の検索結果へ更新しました');
    const elapsed = Number((await status.textContent())?.match(/([\d.]+)ミリ秒/u)?.[1]);
    expect(elapsed).toBeLessThan(100);

    await page.getByLabel('動画タイトル').fill('一致しない架空の動画タイトル');
    await page.getByRole('button', { name: 'この条件で探す' }).click();
    await expect(page.getByRole('heading', { name: '0件の動画' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '一致する動画がありません' })).toBeVisible();
    await page.getByRole('button', { name: '条件をすべて解除' }).click();
    await expect(page.getByRole('heading', { name: allVideosHeading })).toBeVisible();

    await capture(page, testInfo, 'モバイル', 'search-mobile.jpg');
    expectOnlyAllowedRequests(requests);
  });

  test('別名からタグを追加し、完全一致AND・日付・動画長を同時適用する', async ({ page }) => {
    await preparePage(page);
    await openSearch(page);
    await page.getByText('タグ・公開日・動画長で絞り込む').click();
    await page.getByLabel('タグ名または別名から追加').fill('#女王と会長');
    await expect(page.getByLabel('タグ名または別名から追加')).toBeHidden();
    await expect(page.getByRole('heading', { name: /件の動画$/u })).not.toHaveText(allVideosHeading);
    expect(page.url()).toContain('tag=tag-people-unit-d5b1de96b450');
    await page.getByLabel('開始日').fill('2026-01-01');
    await page.getByLabel('終了日').fill('2026-12-31');
    await page.getByLabel('最小（分）').fill('120');
    await page.getByLabel('最大（分）').fill('240');
    await page.getByRole('button', { name: '絞り込みを反映' }).click();
    await expect(page.getByRole('heading', { name: '1件の動画' })).toBeVisible();
    await expect(page.locator('.video-card')).toContainText('魔法使いの愛した子');
    expect(page.url()).toContain('tag=tag-people-unit-d5b1de96b450');
  });

  test('タグの追加と解除だけで検索し、タグ欄を閉じて動画へ戻れる', async ({ page }) => {
    await preparePage(page);
    await openSearch(page);
    await page.getByText('タグ・公開日・動画長で絞り込む').click();
    await page.getByRole('button', { name: /女王と会長/u }).click();

    await expect(page.locator('#results-heading')).toBeFocused();
    await expect(page.locator('#results-heading')).not.toHaveText(allVideosHeading);
    await expect(page.getByLabel('タグ名または別名から追加')).toBeHidden();
    expect(page.url()).toContain('tag=tag-people-unit-d5b1de96b450');
    const openButton = page.getByRole('button', { name: 'タグを開く（選択1件）' });
    await expect(openButton).toHaveAttribute('aria-expanded', 'false');
    await openButton.click();
    const selectedTag = page.getByRole('button', { name: /女王と会長/u });
    await expect(selectedTag).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.tag-choice[aria-pressed="false"] span', { hasText: /^0件$/u })).toHaveCount(0);

    await selectedTag.click();
    await expect(page.locator('#results-heading')).toBeFocused();
    await expect(page.getByRole('heading', { name: allVideosHeading })).toBeVisible();
    await expect(page.getByLabel('タグ名または別名から追加')).toBeHidden();
    expect(page.url()).not.toContain('tag=');
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
    await expect(page.locator('.video-card').first()).toHaveAttribute('data-video-id', 'qp-w9AZJuLs');

    await page.reload();
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await expectMinimumTargets(page);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('公開データ取得失敗を正常な0件と別の日本語状態にする', async ({ page }) => {
    await page.route('**/data/latest.json', async (route) => route.fulfill({ status: 503, body: 'unavailable' }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('取得失敗');
    await expect(page.getByRole('heading', { name: '動画一覧を表示できません' })).toBeVisible();
    await expect(page.getByRole('button', { name: '再読み込み' })).toBeVisible();
  });

  test('375×812・CPU4倍低速化・2,500動画の代表20検索で95パーセンタイルを100ミリ秒以内にする', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'モバイル', 'Issue #1が指定するモバイル条件だけで計測します。');
    await preparePage(page);
    const dataset = performanceDataset();
    await page.route('**/data/releases/*/index.json', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dataset.index) });
    });
    await page.route('**/data/releases/*/search-index.json', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dataset.search) });
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '2500件の動画' })).toBeVisible();

    const elapsed: number[] = [];
    const computation: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const target = (index * 127) % 2500;
      const query = [...searchCode(target)];
      query[0] = '9';
      await page.getByLabel('動画タイトル').fill(query.join(''));
      await page.getByRole('button', { name: 'この条件で探す' }).click();
      const status = page.getByTestId('result-update-status');
      await expect(status).toContainText('1件の検索結果へ更新しました');
      const value = Number((await status.textContent())?.match(/([\d.]+)ミリ秒/u)?.[1]);
      expect(Number.isFinite(value)).toBe(true);
      elapsed.push(value);
      computation.push(Number(await status.getAttribute('data-search-computation-ms')));
    }
    const ordered = [...elapsed].sort((left, right) => left - right);
    const p95Milliseconds = ordered[Math.ceil(ordered.length * 0.95) - 1]!;
    const evidence = {
      videoCount: dataset.search.videos.length,
      viewport: '375x812',
      cpuThrottlingRate: 4,
      browser: page.context().browser()?.version() ?? 'unknown',
      sampleCount: elapsed.length,
      p95Milliseconds,
      limitMilliseconds: 100,
    };
    testInfo.annotations.push({ type: '検索性能', description: JSON.stringify(evidence) });
    process.stdout.write(`検索性能証跡: ${JSON.stringify(evidence)}\n`);
    expect(
      p95Milliseconds,
      `計測順: ${elapsed.map((value, index) => `${value.toFixed(1)}(${computation[index]?.toFixed(1)})`).join(', ')}`,
    ).toBeLessThanOrEqual(100);
  });
});

function performanceDataset(): {
  index: Record<string, unknown>;
  search: { videos: Array<Record<string, unknown>> } & Record<string, unknown>;
} {
  const releaseId = embeddedReleaseId;
  const videos = Array.from({ length: 2500 }, (_, index) => {
    const videoId = `perf${String(index).padStart(7, '0')}`;
    const title = `検索符号${searchCode(index)} 第${index}回 マインクラフト 雑談 配信`;
    return {
      videoId,
      title,
      normalizedTitle: `検索符号${searchCode(index)} 第${index}回 まいんくらふと 雑談 配信`,
      publishedAt: new Date(Date.UTC(2020 + (index % 6), index % 12, 1)).toISOString(),
      durationSeconds: 600 + index,
      thumbnail: { url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 480, height: 360 },
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      tagIds: ['tag-format-media-45323ed44f37'],
    };
  });
  return {
    index: {
      schemaVersion: '1.0.0',
      releaseId,
      updatedAt: '2026-08-03T00:00:00+09:00',
      videos,
    },
    search: {
      schemaVersion: '1.0.0',
      releaseId,
      normalizationVersion: '1.0.0',
      videos: videos.map(({ videoId, normalizedTitle, publishedAt, durationSeconds, tagIds }) => ({
        videoId,
        normalizedTitle,
        publishedAt,
        durationSeconds,
        tagIds,
      })),
    },
  };
}

function searchCode(index: number): string {
  return [...String(index).padStart(7, '0')].map((character) => character.repeat(3)).join('');
}
