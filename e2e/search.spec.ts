import { expect, test, type Locator } from '@playwright/test';

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
    await page.getByRole('combobox', { name: '検索', exact: true }).fill('【#白雪巴誕生日2026】ケーキを食べてパーッとお祝いしちゃおうかしら🎉🎉🎉【白雪巴/にじさんじ】');
    await page.getByRole('button', { name: 'この条件で探す' }).click();
    await expect(page.getByRole('heading', { name: '1件の動画' })).toBeVisible();
    await expect(page.locator('.video-card')).toHaveCount(1);
    await expect(page.locator('.video-card')).toHaveAttribute('data-video-id', 'GoWhHtJmIbk');
    const status = page.getByTestId('result-update-status');
    await expect(status).toContainText('1件の検索結果へ更新しました');
    const elapsed = Number((await status.textContent())?.match(/([\d.]+)ミリ秒/u)?.[1]);
    expect(elapsed).toBeLessThan(100);

    await page.getByRole('combobox', { name: '検索', exact: true }).fill('一致しない架空の動画タイトル');
    await page.getByRole('button', { name: 'この条件で探す' }).click();
    await expect(page.getByRole('heading', { name: '0件の動画' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '一致する動画がありません' })).toBeVisible();
    await page.getByRole('button', { name: '条件をすべて解除' }).click();
    await expect(page.getByRole('heading', { name: allVideosHeading })).toBeVisible();

    await capture(page, testInfo, 'モバイル', 'search-mobile.jpg');
    expectOnlyAllowedRequests(requests);
  });

  test('ひらがな一文字ごとに漢字・カタカナの動画とタグを候補表示し、候補から移動する', async ({ page }) => {
    const requests = await preparePage(page);
    await openSearch(page);
    const input = page.getByRole('combobox', { name: '検索', exact: true });
    for (const query of ['し', 'しら', 'しらゆき', 'しらゆきともえ', 'しらゆきともえたんじょうび2026']) {
      await input.fill(query);
      await expect(page.getByRole('listbox', { name: '検索候補' })).toBeVisible();
      await expect(page.locator('.search-combobox [role="status"]')).toContainText(
        /動画\d+件、タグ\d+件の候補/u,
      );
      await expect(page.getByRole('option').filter({ hasText: '白雪巴誕生日2026' }).first()).toBeVisible();
    }

    await page.getByRole('option', { name: /^タグ 白雪巴誕生日2026 1件$/u }).click();
    await expect(page).toHaveURL(/tag=tag-program-event-c20649aaa08c/u);
    await expect(input).toHaveValue('');
    await expect(page.locator('#results-heading')).toBeFocused();
    await expect(page.getByLabel('タグ名または別名から追加')).toBeHidden();

    await input.fill('けーきをたべて');
    await expect(page.getByRole('listbox', { name: '検索候補' })).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(page).toHaveURL(/#\/video\/GoWhHtJmIbk$/u);
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
    await page.getByRole('button', { name: /公開日の範囲/u }).click();
    await page.getByLabel('開始日').fill('2026-01-01');
    await page.getByLabel('終了日').fill('2026-12-31');
    await expect(page.getByRole('button', { name: /公開日の範囲/u })).toContainText('2026/1/1 — 2026/12/31');
    await page.getByRole('button', { name: '完了' }).click();
    await expect(page.getByLabel('最小（分）')).toHaveAttribute('type', 'range');
    await setRangeValue(page.getByLabel('最小（分）'), 120);
    await setRangeValue(page.getByLabel('最大（分）'), 240);
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

  test('動画長Sliderの連続操作中はタグ候補と画面高を固定し、停止100ミリ秒後に更新する', async ({ page }) => {
    await preparePage(page);
    await openSearch(page);
    await page.getByText('タグ・公開日・動画長で絞り込む').click();

    const tagLayout = async (): Promise<{ tagCount: number; documentHeight: number }> => page.evaluate(() => ({
      tagCount: document.querySelectorAll('.tag-choice').length,
      documentHeight: document.documentElement.scrollHeight,
    }));
    const before = await tagLayout();
    const maximumSlider = page.getByLabel('最大（分）');

    await maximumSlider.evaluate(async (element) => {
      const input = element as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!valueSetter) throw new Error('range inputのnative value setterを取得できません。');
      const values = [600, 480, 360, 240, 120, 60, 30, 1];
      for (const [index, value] of values.entries()) {
        valueSetter.call(input, String(value));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (index < values.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 40));
      }
    });

    await expect(maximumSlider).toHaveValue('1');
    expect(await tagLayout()).toEqual(before);
    await page.waitForTimeout(50);
    expect(await tagLayout()).toEqual(before);

    await expect.poll(async () => (await tagLayout()).tagCount).toBeLessThan(before.tagCount);
    const settled = await tagLayout();
    expect(settled.documentHeight).toBeLessThan(before.documentHeight);
  });

  test('375px幅で絞り込みフォームとヘッダーが画面外へはみ出さない', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'モバイル', 'モバイル固有のレスポンシブ回帰を検証します。');
    await preparePage(page);
    await openSearch(page);
    await page.getByText('タグ・公開日・動画長で絞り込む').click();
    await page.getByRole('button', { name: /女王と会長/u }).click();
    await expect(page.getByRole('button', { name: 'タグを開く（選択1件）' })).toBeVisible();
    await page.getByRole('button', { name: /公開日の範囲/u }).click();

    const layout = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const overflowingElements = Array.from(document.body.querySelectorAll<HTMLElement>('*')).flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0) return [];
        if (rect.left >= -0.5 && rect.right <= viewportWidth + 0.5) return [];
        return [`${element.tagName.toLowerCase()}.${element.className}:${rect.left.toFixed(1)}..${rect.right.toFixed(1)}`];
      });
      return {
        viewportWidth,
        documentWidth: document.documentElement.scrollWidth,
        scrollX: window.scrollX,
        overflowingElements: overflowingElements.slice(0, 20),
      };
    });

    expect(layout.scrollX).toBe(0);
    expect(layout.documentWidth, JSON.stringify(layout.overflowingElements)).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.overflowingElements).toEqual([]);
    await capture(page, testInfo, 'モバイル', 'search-filter-mobile.jpg');
  });

  test('URLの入力矛盾を日本語で示し、Slider・並び替え・キーボード操作を提供する', async ({ page }) => {
    await preparePage(page);
    await page.goto('/#/?min=200&max=100');
    await expect(page.getByRole('heading', { name: '動画を検索' })).toBeVisible();
    await page.getByText('タグ・公開日・動画長で絞り込む').click();
    await expect(page.getByLabel('最小（分）')).toHaveAttribute('type', 'range');
    await expect(page.getByLabel('最大（分）')).toHaveAttribute('type', 'range');
    await expect(page.getByRole('alert')).toContainText('最小値は最大値以下');
    await page.getByRole('button', { name: '指定なし', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const minimumSlider = page.getByLabel('最小（分）');
    await minimumSlider.focus();
    await minimumSlider.press('ArrowRight');
    await expect(minimumSlider).toHaveValue('1');
    await page.getByRole('button', { name: '指定なし', exact: true }).click();
    await page.getByRole('button', { name: '絞り込みを反映' }).click();
    await page.getByLabel('並び順').selectOption('公開日の古い順');
    await expect(page.locator('.video-card').first()).toHaveAttribute('data-video-id', 'qp-w9AZJuLs');

    await page.reload();
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.getByText('タグ・公開日・動画長で絞り込む').click();
    const dateRangeTrigger = page.getByRole('button', { name: /公開日の範囲/u });
    await dateRangeTrigger.click();
    await page.keyboard.press('Escape');
    await expect(dateRangeTrigger).toBeFocused();
    await dateRangeTrigger.click();
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
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== 'モバイル', 'Issue #1が指定するモバイル条件だけで計測します。');
    await preparePage(page);
    const dataset = performanceDataset();
    const fixtureHits = { index: 0, search: 0, tags: 0, aliases: 0 };
    await page.route('**/data/releases/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/search-index.json')) {
        fixtureHits.search += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dataset.search) });
        return;
      }
      if (pathname.endsWith('/tag-index.json')) {
        fixtureHits.tags += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dataset.tags) });
        return;
      }
      if (pathname.endsWith('/alias-index.json')) {
        fixtureHits.aliases += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dataset.aliases) });
        return;
      }
      if (pathname.endsWith('/index.json')) {
        fixtureHits.index += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dataset.index) });
        return;
      }
      await route.continue();
    });
    const cdp = await page.context().newCDPSession(page);
    await page.goto('/');
    try {
      await expect(page.getByRole('heading', { name: '2500件の動画' })).toBeVisible({ timeout: 15_000 });
    } catch (error) {
      const body = (await page.locator('body').innerText()).slice(0, 1_000);
      throw new Error(`性能fixture初期化失敗: hits=${JSON.stringify(fixtureHits)} body=${JSON.stringify(body)}`, { cause: error });
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    const elapsed: number[] = [];
    const computation: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const target = (index * 127) % 2500;
      const query = [...searchCode(target)];
      query[0] = '9';
      await page.getByRole('combobox', { name: '検索', exact: true }).fill(query.join(''));
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
  tags: Record<string, unknown>;
  aliases: Record<string, unknown>;
} {
  const releaseId = embeddedReleaseId;
  const videos = Array.from({ length: 2500 }, (_, index) => {
    const videoId = `perf${String(index).padStart(7, '0')}`;
    const title = `検索符号${searchCode(index)} 第${index}回 マインクラフト 雑談 配信`;
    return {
      videoId,
      title,
      normalizedTitle: `検索符号${searchCode(index)} 第${index}回 まいんくらふと 雑談 配信`,
      normalizedReading: `けんさくふごう${searchCode(index)} だい${index}かい まいんくらふと ざつだん はいしん`,
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
      videos: videos.map(({ videoId, title, normalizedTitle, publishedAt, durationSeconds, thumbnail, youtubeUrl, tagIds }) => ({
        videoId,
        title,
        normalizedTitle,
        publishedAt,
        durationSeconds,
        thumbnail,
        youtubeUrl,
        tagIds,
      })),
    },
    search: {
      schemaVersion: '2.0.0',
      releaseId,
      normalizationVersion: '2.0.0',
      videos: videos.map(({ videoId, normalizedTitle, normalizedReading, publishedAt, durationSeconds, tagIds }) => ({
        videoId,
        normalizedTitle,
        normalizedReading,
        publishedAt,
        durationSeconds,
        tagIds,
      })),
    },
    tags: {
      schemaVersion: '2.0.0',
      releaseId,
      taxonomyVersion: 'performance-fixture',
      aliasVersion: 'performance-fixture',
      categories: [],
    },
    aliases: {
      schemaVersion: '1.0.0',
      releaseId,
      aliasVersion: 'performance-fixture',
      aliases: {},
    },
  };
}

function searchCode(index: number): string {
  return [...String(index).padStart(7, '0')].map((character) => character.repeat(3)).join('');
}

async function setRangeValue(locator: Locator, value: number): Promise<void> {
  await locator.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!valueSetter) throw new Error('range inputのnative value setterを取得できません。');
    valueSetter.call(input, String(nextValue));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
