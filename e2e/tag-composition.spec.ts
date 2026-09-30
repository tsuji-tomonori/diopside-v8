import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { capture, expectNoSeriousAccessibilityViolations, expectOnlyAllowedRequests, openSearch, preparePage } from './helpers.ts';

const latest = JSON.parse(readFileSync('public/data/latest.json', 'utf8')) as { searchIndexPath: string; tagIndexPath: string };
const searchIndex = JSON.parse(readFileSync(`public/${latest.searchIndexPath}`, 'utf8')) as { videos: Array<{ tagIds: string[] }> };
const tagIndex = JSON.parse(readFileSync(`public/${latest.tagIndexPath}`, 'utf8')) as { categories: Array<{ subcategories: Array<{ tags: Array<{ tagId: string; count: number }> }> }> };
const gameTag = 'tag-content-primary-0dbfa3115896';
const collaborationTag = 'tag-context-participation-a4911ea059bb';
const personTag = 'tag-people-performer-1c769eb2f6a6';
const gameCount = searchIndex.videos.filter((video) => video.tagIds.includes(gameTag)).length;
const bothCount = searchIndex.videos.filter((video) => video.tagIds.includes(gameTag) && video.tagIds.includes(collaborationTag)).length;
const anyCount = searchIndex.videos.filter((video) => video.tagIds.includes(gameTag) || video.tagIds.includes(collaborationTag)).length;
const excludedCount = searchIndex.videos.filter((video) => !video.tagIds.includes(gameTag) && video.tagIds.includes(collaborationTag)).length;

async function chooseTag(page: Page, query: string, tagId: string): Promise<void> {
  await page.getByRole('combobox', { name: 'タグ名・別名・読みで探す' }).fill(query);
  await page.locator(`.tag-composer-option[data-tag-id="${tagId}"]`).click();
}

function params(page: Page): URLSearchParams {
  return new URLSearchParams(page.url().split('?')[1] ?? '');
}

test('タグを連続追加し、AND・OR・除外・戻る進む・再読込で同じ条件と結果を復元する', async ({ page }, testInfo) => {
  const requests = await preparePage(page);
  await openSearch(page);
  const composer = page.getByRole('region', { name: 'タグを組み合わせて探す' });
  await expect(composer).toBeVisible();
  await expect(page.locator('.filter-drawer')).not.toHaveAttribute('open');
  await chooseTag(page, 'げーむ', gameTag);
  await expect(page.locator('#results-heading')).toHaveText(`${gameCount}件の動画`);
  await expect(page.locator('.filter-drawer')).not.toHaveAttribute('open');
  await expect(page.getByRole('combobox', { name: 'タグ名・別名・読みで探す' })).toBeFocused();
  await chooseTag(page, 'こらぼ', collaborationTag);
  await expect(page.locator('#results-heading')).toHaveText(`${bothCount}件の動画`);
  await page.getByLabel('含めるタグの条件').selectOption('any');
  await expect(page.locator('#results-heading')).toHaveText(`${anyCount}件の動画`);
  await expect.poll(() => params(page).get('tagMatch')).toBe('any');
  await page.getByLabel('追加する条件').selectOption('exclude');
  await chooseTag(page, 'げーむ', gameTag);
  await expect(page.locator('#results-heading')).toHaveText(`${excludedCount}件の動画`);
  await expect.poll(() => params(page).getAll('exclude')).toEqual([gameTag]);
  expect(params(page).getAll('tag')).toEqual([collaborationTag]);

  await page.goBack();
  await expect(page.locator('#results-heading')).toHaveText(`${anyCount}件の動画`);
  await expect(composer.getByRole('button', { name: 'いずれかを含む: ゲームを解除' })).toBeVisible();
  await expect(composer.getByRole('button', { name: '除外する: ゲームを解除' })).toHaveCount(0);
  await page.goForward();
  await expect(page.locator('#results-heading')).toHaveText(`${excludedCount}件の動画`);
  await page.reload();
  await expect(page.locator('#results-heading')).toHaveText(`${excludedCount}件の動画`);
  await expect(composer.getByRole('button', { name: '除外する: ゲームを解除' })).toBeVisible();
  await page.getByLabel('追加する条件').selectOption('include');
  await chooseTag(page, 'げーむ', gameTag);
  await expect(page.locator('#results-heading')).toHaveText(`${anyCount}件の動画`);
  await expect.poll(() => params(page).getAll('exclude')).toEqual([]);
  await composer.getByRole('button', { name: 'いずれかを含む: コラボを解除' }).click();
  await expect(page.locator('#results-heading')).toHaveText(`${gameCount}件の動画`);
  await capture(page, testInfo, testInfo.project.name, 'tag-composition.jpg');
  await composer.getByRole('button', { name: 'タグ条件だけ解除' }).click();
  await expect(page.locator('#results-heading')).toHaveText(`${searchIndex.videos.length}件の動画`);
  await expect.poll(() => params(page).toString()).toBe('');
  expectOnlyAllowedRequests(requests);
});

test('人物タグをキーボードで絞り込み、同名分類を区別し、モバイルでもはみ出さない', async ({ page }) => {
  await preparePage(page);
  await openSearch(page);
  const input = page.getByRole('combobox', { name: 'タグ名・別名・読みで探す' });
  await input.fill('しらゆきともえ');
  await input.press('Escape');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'tag-composer-option-0');
  await input.press('Enter');
  await expect.poll(() => params(page).getAll('tag')).toEqual([personTag]);
  await expect(page.locator('#results-heading')).toHaveText('1件の動画');
  await page.getByRole('button', { name: 'タグ条件だけ解除' }).click();
  await input.fill('ゲーム');
  await expect(page.locator(`.tag-composer-option[data-tag-id="${gameTag}"]`)).toContainText('内容 / 主ジャンル');
  await expect(page.locator('.tag-composer-option[data-tag-id="tag-content-secondary-164dbab60187"]')).toContainText('内容 / 副ジャンル');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);
});

test('主検索の候補から31件目のタグを選んでもURLと保存済み条件を壊さない', async ({ page }) => {
  await preparePage(page);
  const selected = tagIndex.categories.flatMap((category) => category.subcategories.flatMap((subcategory) => subcategory.tags))
    .filter((tag) => tag.count > 0 && tag.tagId !== collaborationTag).slice(0, 30).map((tag) => tag.tagId);
  const query = new URLSearchParams({ tagMatch: 'any' });
  for (const tagId of selected) query.append('tag', tagId);
  await page.goto(`/#/?${query.toString()}`);
  await expect(page.getByRole('heading', { name: '動画を検索' })).toBeVisible();
  const input = page.getByRole('combobox', { name: '検索', exact: true });
  await input.fill('コラボ');
  await page.locator('.search-combobox').getByRole('option', { name: /^分類\s*コラボ\s*\d+件$/u }).click();
  await expect(page.getByRole('alert')).toContainText('それぞれ30件まで');
  expect(params(page).getAll('tag')).toEqual(selected);
  await page.reload();
  expect(params(page).getAll('tag')).toEqual(selected);
  await expect(page.getByRole('button', { name: 'いずれかを含む: コラボを解除' })).toHaveCount(0);
});
