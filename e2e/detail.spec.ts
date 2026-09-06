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
  test('基本情報、AI生成タグ、未提供のタイムスタンプ、更新日、YouTubeリンクを表示する', async ({ page }) => {
    const requests = await preparePage(page);
    await page.goto('/#/video/7keH8yrqabc');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Detroit: Become Human');
    await expect(page.getByRole('heading', { name: 'タグ' })).toBeVisible();
    await expect(page.getByText('AIが生成した検索情報')).toBeVisible();
    await expect(page.getByText('YouTube公式タグではありません')).toBeVisible();
    await expect(page.getByText('主ジャンルゲーム')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'タイムスタンプ' })).toBeVisible();
    await expect(page.getByText('AIが生成した動画内の目次')).toBeVisible();
    await expect(page.getByText('diopside — 白雪巴さんの公開アーカイブを探せる非公式ファンサイトです。')).toBeVisible();
    await expect(page.getByText('タグ・あらすじ・タイムスタンプはAIが生成しており、誤りを含む場合があります。')).toBeVisible();
    await expect(page.getByText('未作成 — 全編確認不足', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'YouTubeで見る' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=7keH8yrqabc');
    const synopsisCount = await page.getByRole('heading', { name: 'あらすじ' }).count();
    const customEmojiCount = await page.getByRole('heading', { name: 'カスタム絵文字' }).count();
    await expect(page.getByText(/最終更新:/u)).toHaveCount(3 + synopsisCount + customEmojiCount);
    expect(requests.some((url) => url.includes('youtube.com'))).toBe(false);
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('移行した承認済みタイムスタンプを昇順・連続区間・同じYouTube開始秒で表示する', async ({ page }, testInfo) => {
    await preparePage(page);
    const videoId = 'c9TnpjK3ZZE';
    await page.goto(`/#/video/${videoId}`);
    await expect(page.getByText('由来: diopsideで作成した時刻一覧')).toBeVisible();
    const links = page.locator('.timestamps a');
    await expect(links).toHaveCount(21);
    await expect(links.nth(0)).toHaveAttribute('href', `https://www.youtube.com/watch?v=${videoId}&t=0s`);
    await expect(links.nth(1)).toHaveAttribute('href', `https://www.youtube.com/watch?v=${videoId}&t=221s`);
    await capture(page, testInfo, 'デスクトップ', 'detail-desktop.jpg');
  });

  test('ネタバレを避けたあらすじと末尾の特徴的なセリフを表示する', async ({ page }) => {
    await preparePage(page);
    const videoId = 'ewtbVStzFUc';
    await page.goto(`/#/video/${videoId}`);
    await expect(page.getByRole('heading', { name: 'あらすじ' })).toBeVisible();
    await expect(page.getByText('AIが生成した配信のまとめ')).toBeVisible();
    await expect(page.locator('.synopsis-copy')).toContainText('新作グラコロと限定ソース');
    await expect(page.locator('.featured-quote')).toContainText('これ明日も食べたいね。');
    await expect(page.getByRole('link', { name: 'この場面から見る' })).toHaveAttribute(
      'href',
      `https://www.youtube.com/watch?v=${videoId}&t=651s`,
    );
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('視聴者コメントの熱量を20語以上の密集ワードクラウドで描画する', async ({ page }) => {
    await preparePage(page);
    const videoId = 'c9TnpjK3ZZE';
    const shardId = videoShardId(videoId);
    const relative = `public/data/releases/${latest.releaseId}/video-shards/${shardId}.json`;
    const shard = JSON.parse(readFileSync(path.join(root, relative), 'utf8')) as { videos: Record<string, Record<string, unknown>> };
    const detail = shard.videos[videoId]!;
    detail.wordCloud = {
      status: '作成済み',
      words: [
        '最高', 'かわいい', '白雪巴', '名場面', '爆笑', '天才', 'コラボ', 'ゲーム', '歌声', '雑談',
        'リアクション', '初見', 'びっくり', '面白い', '優しい', '企画', '配信', '感動', '衣装', '物語',
        '実況', '応援', '待機', '拍手', '解説', '神回', '笑顔', '挑戦', 'クリア', 'アンコール',
      ].map((term, index) => ({ term, weight: Math.max(8, 100 - index * 3) })),
      inputType: '公開チャット',
      exclusionRulesVersion: '9.0.0',
      rulesVersion: '9.0.0',
      updatedAt: '2026-09-04T00:00:00Z',
    };
    await page.route(`**/data/releases/${latest.releaseId}/video-shards/${shardId}.json`, async (route) => route.fulfill({ json: shard }));
    await page.goto(`/#/video/${videoId}`);
    await expect(page.getByText('視聴者の公開チャットから抽出')).toBeVisible();
    const cloud = page.locator('svg.word-cloud');
    await expect(cloud).toBeVisible();
    await expect(cloud.locator('text')).toHaveCount(30);
    expect(await cloud.locator('[data-rotation="90"]').count()).toBeGreaterThan(0);
    const sizes = await cloud.locator('text').evaluateAll((nodes) => (
      nodes.map((node) => Number(node.getAttribute('font-size')))
    ));
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(2.4);
    await expectNoSeriousAccessibilityViolations(page);

    await page.goto('/#/video/Hg32eUA03Fo');
    await expect(page.getByText('動画の公開字幕から抽出')).toBeVisible();
    await expect(page.getByText('視聴者の公開チャットから抽出')).toHaveCount(0);
  });

  test('カスタム絵文字を画像、ショートコード、回数、比率付きで表示する', async ({ page }) => {
    await preparePage(page);
    const customEmojiImageUrl = 'https://yt3.ggpht.com/emoji-kusa=w48-h48-c-k-nd';
    const videoId = 'c9TnpjK3ZZE';
    const shardId = videoShardId(videoId);
    const relative = `public/data/releases/${latest.releaseId}/video-shards/${shardId}.json`;
    const shard = JSON.parse(readFileSync(path.join(root, relative), 'utf8')) as { videos: Record<string, Record<string, unknown>> };
    const detail = shard.videos[videoId]!;
    detail.customEmojiUsage = {
      status: '集計済み',
      totalCount: 100,
      items: [
        { customEmojiId: 'custom-emoji-1111111111111111', label: ':kusa:', imageUrl: customEmojiImageUrl, count: 60 },
        { customEmojiId: 'custom-emoji-2222222222222222', label: ':wan:', count: 25 },
        { customEmojiId: 'custom-emoji-3333333333333333', label: ':taiki:', count: 15 },
      ],
      rulesVersion: '1.1.0',
      updatedAt: '2026-09-03T00:00:00Z',
    };
    await page.route(`**/data/releases/${latest.releaseId}/video-shards/${shardId}.json`, async (route) => route.fulfill({ json: shard }));
    await page.goto(`/#/video/${videoId}`);

    await expect(page.getByRole('heading', { name: 'カスタム絵文字' })).toBeVisible();
    const emojiImage = page.locator('img.custom-emoji-image');
    await expect(emojiImage).toHaveCount(1);
    await expect(emojiImage).toHaveAttribute('src', customEmojiImageUrl);
    await expect(page.getByText(':wan:', { exact: true })).toBeVisible();
    await expect(page.getByLabel('カスタム絵文字の使用比率').locator('li')).toHaveCount(3);
    await expect(page.getByText('60回')).toBeVisible();
    await expect(page.getByText('60.0%')).toBeVisible();
    await expect(page.getByLabel(':kusa: 60.0%')).toHaveAttribute('value', '60');
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('先行3動画で実集計した全種類と総使用回数を表示する', async ({ page }) => {
    await preparePage(page);
    const pilots = [
      { videoId: 'UZcmZzKQWYc', totalCount: '2,314', uniqueCount: 37 },
      { videoId: '4zN7YiSw06c', totalCount: '400', uniqueCount: 15 },
      { videoId: 'BZkCPMIsz1k', totalCount: '1,012', uniqueCount: 16 },
    ];
    for (const pilot of pilots) {
      await page.goto(`/#/video/${pilot.videoId}`);
      const section = page.locator('.custom-emoji-section');
      await expect(section.getByRole('heading', { name: 'カスタム絵文字' })).toBeVisible();
      await expect(section.getByText(pilot.totalCount, { exact: true })).toBeVisible();
      await expect(section.locator('.custom-emoji-chart li')).toHaveCount(pilot.uniqueCount);
      await expect(section.locator('img.custom-emoji-image').first()).toHaveAttribute(
        'src',
        /^https:\/\/yt3\.ggpht\.com\//u,
      );
    }
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('絵文字の波を全選択で開き、マウス・タッチと秒単位の操作で自由に範囲選択する', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await preparePage(page);
    await page.route('https://yt3.ggpht.com/**', (route) => route.abort());
    const videoId = 'c9TnpjK3ZZE';
    const shardId = videoShardId(videoId);
    const shard = JSON.parse(readFileSync(path.join(root, `public/data/releases/${latest.releaseId}/video-shards/${shardId}.json`), 'utf8')) as { videos: Record<string, Record<string, unknown>> };
    const detail = shard.videos[videoId]!;
    const bins: Array<Array<[number, number]>> = Array.from({ length: 32 }, () => []);
    bins[0] = [[0, 2]]; bins[14] = [[1, 3]]; bins[15] = [[0, 5]]; bins[31] = [[0, 3], [1, 4]];
    detail.durationSeconds = 1865;
    detail.customEmojiUsage = {
      status: '集計済み', totalCount: 20,
      items: [
        { customEmojiId: 'custom-emoji-1111111111111111', label: ':kusa:', count: 12, imageUrl: 'https://yt3.ggpht.com/test=s48' },
        { customEmojiId: 'custom-emoji-2222222222222222', label: ':wan:', count: 8 },
      ],
      timeline: { bucketSeconds: 60, durationSeconds: 1865, bins, beforeStartCount: 1, afterEndCount: 1, unpositionedCount: 1 },
      rulesVersion: '2.0.0', updatedAt: '2026-09-05T00:00:00Z',
    };
    await page.route(`**/data/releases/${latest.releaseId}/video-shards/${shardId}.json`, (route) => route.fulfill({ json: shard }));
    await page.goto(`/#/video/${videoId}`);
    const wave = page.locator('.emoji-density');
    const startHandle = wave.getByRole('slider', { name: '区間の開始', exact: true });
    const endHandle = wave.getByRole('slider', { name: '区間の終了', exact: true });
    await expect(startHandle).toHaveAttribute('aria-valuenow', '0');
    await expect(endHandle).toHaveAttribute('aria-valuenow', '1865');
    await expect(wave.getByText('集計範囲で 17回 ・ 再生時間内の100.0%')).toBeVisible();
    await expect(wave.locator('.emoji-wave-cells')).toHaveCount(0);
    await startHandle.focus();
    await page.keyboard.press('ArrowRight');
    await expect(startHandle).toHaveAttribute('aria-valuenow', '1');
    await expect(wave.getByRole('link', { name: '区間の頭 0:01 から見る' })).toHaveAttribute('href', `https://www.youtube.com/watch?v=${videoId}&t=1s`);
    await page.keyboard.press('Home');
    await endHandle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(endHandle).toHaveAttribute('aria-valuenow', '1864');
    await page.keyboard.press('End');

    // Real pointer input verifies capture and movement on desktop and touchscreens.
    const drag = async (boundary: 'start' | 'end', seconds: number): Promise<void> => {
      const handle = boundary === 'start' ? startHandle : endHandle;
      await wave.locator('.emoji-wave').evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const track = (await wave.locator('.emoji-wave').boundingBox())!;
      const box = (await handle.boundingBox())!;
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const to = { x: track.x + track.width * seconds / 1865, y: from.y };
      if (testInfo.project.name === 'モバイル') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...to, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await page.mouse.up();
      }
    };
    await drag('start', 317);
    expect(Math.abs(Number(await startHandle.getAttribute('aria-valuenow')) - 317)).toBeLessThanOrEqual(1);
    await drag('end', 1459);
    expect(Math.abs(Number(await endHandle.getAttribute('aria-valuenow')) - 1459)).toBeLessThanOrEqual(1);
    await expect(wave.getByText('集計範囲で 8回 ・ 再生時間内の47.1%')).toBeVisible();
    await expect(wave.getByText(/回数・内訳は重なる1分区間の集計です/)).toBeVisible();
    await startHandle.focus();
    await page.keyboard.press('End');
    expect(Number(await endHandle.getAttribute('aria-valuenow')) - Number(await startHandle.getAttribute('aria-valuenow'))).toBe(1);
    await page.keyboard.press('ArrowRight');
    expect(Number(await endHandle.getAttribute('aria-valuenow')) - Number(await startHandle.getAttribute('aria-valuenow'))).toBe(1);
    await wave.getByRole('button', { name: '全体を選択' }).click();
    await expect(wave.getByRole('link', { name: '区間の頭 0:00 から見る' })).toHaveAttribute('href', `https://www.youtube.com/watch?v=${videoId}&t=0s`);
    await expect(wave.getByRole('link', { name: '一番濃い 31:00 へ' })).toHaveAttribute('href', `https://www.youtube.com/watch?v=${videoId}&t=1860s`);
    await wave.getByRole('button', { name: 'ピークの1分に絞る' }).click();
    await expect(wave.getByText(/平均 84.0回\/分/)).toBeVisible();
    await expect(wave.getByLabel('選択区間の絵文字別使用回数')).toContainText(':kusa:3回');
    await expect(wave.getByLabel('選択区間の絵文字別使用回数')).toContainText(':wan:4回');
    await wave.getByLabel('区間の開始（秒）').fill('1864');
    await expect(wave.getByText(/平均 84.0回\/分/)).toBeVisible();
    await expect(wave.getByRole('link', { name: '一番濃い 31:04 へ' })).toHaveAttribute('href', `https://www.youtube.com/watch?v=${videoId}&t=1864s`);
    await wave.getByLabel('区間の開始（秒）').fill('960');
    await wave.getByLabel('区間の終了（秒）').fill('1020');
    await expect(wave.getByText('この区間はカスタム絵文字が0回です。')).toBeVisible();
    await expect(wave.getByRole('button', { name: 'ピークの1分に絞る' })).toBeDisabled();
    await expect(wave.getByRole('link', { name: /一番濃い/u })).toHaveCount(0);
    await wave.getByRole('button', { name: '全体を選択' }).focus();
    await page.keyboard.press('Enter');
    await expect(wave.getByText('集計範囲で 17回 ・ 再生時間内の100.0%')).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await wave.screenshot({ path: testInfo.outputPath('emoji-density.png') });
  });

  test('詳細JSONの構造不適合を日本語で停止表示する', async ({ page }) => {
    await preparePage(page);
    const shardId = videoShardId('c9TnpjK3ZZE');
    await page.route(`**/data/releases/${latest.releaseId}/video-shards/${shardId}.json`, async (route) => route.fulfill({ json: { broken: true } }));
    await page.goto('/#/video/c9TnpjK3ZZE');
    await expect(page.getByRole('heading', { name: '構造不適合' })).toBeVisible();
    await expect(page.getByText('動画詳細の形式を確認できませんでした。')).toBeVisible();
  });

  test('作品タグから公式紹介付きの作品別動画一覧へ移動できる', async ({ page }) => {
    const requests = await preparePage(page);
    await page.goto('/#/video/Wchiju9lJv0');
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
    await expect(page.locator('.work-results .video-card')).toHaveCount(5);
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('定期・連続企画名から同じシリーズの動画一覧へ移動できる', async ({ page }) => {
    const requests = await preparePage(page);
    await page.goto('/#/video/9AG7wO0Ua0w');
    const seriesLink = page.getByRole('link', { name: /いっ杯晩酌/u });
    await expect(seriesLink).toBeVisible();
    await seriesLink.click();
    await expect(page).toHaveURL(/#\/series\/tag-program-recurringSeries-4eb7f61b38ea$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'いっ杯晩酌' })).toBeVisible();
    await expect(page.locator('.series-results .video-card')).toHaveCount(14);
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test('人物名タグから公式説明と関連ユニットをたどり、その動画一覧へ移動できる', async ({ page }) => {
    const requests = await preparePage(page);
    await page.goto('/#/video/FG7ED1X6PSM');

    const personLink = page.getByRole('link', { name: /ルイス・キャミー/u });
    await expect(personLink).toBeVisible();
    await expect(personLink.locator('img')).toHaveAttribute('src', /\/people\/icons\//u);
    await personLink.click();
    await expect(page).toHaveURL(/#\/collaborators\/tag-people-performer-/u);
    await expect(page.getByRole('heading', { level: 1, name: 'ルイス・キャミー' })).toBeVisible();
    await expect(page.getByText(/闇夜を駆ける女怪盗/u)).toBeVisible();
    await expect(page.getByRole('link', { name: 'にじさんじ公式プロフィール「ルイス・キャミー」' })).toHaveAttribute('href', 'https://www.nijisanji.jp/talents/l/luis-cammy');
    await expect(page.getByRole('link', { name: 'YouTubeチャンネルを見る' })).toHaveAttribute('href', /^https:\/\/www\.youtube\.com\/channel\//u);
    await expect(page.getByRole('heading', { level: 2, name: '白雪巴とのユニット' })).toBeVisible();
    await expect(page.locator('.related-group-card')).toHaveCount(2);
    await expect(page.locator('.related-group-card').filter({ hasText: 'ふるとな' })).toBeVisible();
    expectOnlyAllowedRequests(requests);

    await page.locator('.related-group-card').filter({ hasText: 'フルトイ' }).click();
    await expect(page).toHaveURL(/#\/groups\/tag-people-unit-/u);
    await expect(page.getByRole('heading', { level: 1, name: 'フルトイ' })).toBeVisible();
    await expect(page.getByText(/フミ、ルイス・キャミー、白雪巴/u)).toBeVisible();
    await expect(page.locator('.member-card')).toHaveCount(3);
    await expect(page.locator('.member-card img')).toHaveCount(3);
    expectOnlyAllowedRequests(requests);
    await expectNoSeriousAccessibilityViolations(page);
  });
});
