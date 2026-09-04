import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('サイトの立場とAI生成情報の表示', () => {
  it('非公式ファンサイトであることとAI生成対象を公開画面のソースへ明記する', () => {
    const app = read('src/App.tsx');
    const search = read('src/features/search/SearchPage.tsx');
    const detail = read('src/features/detail/VideoDetailPage.tsx');
    const index = read('index.html');
    expect(app).toContain('白雪巴さんの公開アーカイブを探せる非公式ファンサイトです。');
    expect(app).toContain('タグ・あらすじ・タイムスタンプはAIが生成しており、誤りを含む場合があります。');
    expect(index).toContain('非公式ファンサイト「diopside」');
    expect(search).toContain('AIが生成したタグ');
    expect(detail).toContain('AIが生成した配信のまとめ');
    expect(detail).toContain('AIが生成した検索情報');
    expect(detail).toContain('AIが生成した動画内の目次');
  });

  it('利用者向け画面から人による確認済みと受け取られる表現を除外する', () => {
    const publicSources = [
      read('src/App.tsx'),
      read('src/features/search/SearchPage.tsx'),
      read('src/features/detail/VideoDetailPage.tsx'),
    ].join('\n');

    expect(publicSources).not.toMatch(/人が確認した|整理・確認した/u);
  });
});
