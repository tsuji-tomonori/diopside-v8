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
      { videoId: 'UZcmZzKQWYc', totalCount: '2,335', uniqueCount: 37 },
      { videoId: '4zN7YiSw06c', totalCount: '401', uniqueCount: 15 },
      { videoId: 'BZkCPMIsz1k', totalCount: '1,015', uniqueCount: 16 },
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
