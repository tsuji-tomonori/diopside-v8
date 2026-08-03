import { rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const docs = path.join(root, 'docs');

for (const relativePath of ['assets', 'data', 'index.html', '404.html', '.nojekyll']) {
  rmSync(path.join(docs, relativePath), { recursive: true, force: true });
}

console.log('既存のサイト生成物だけを削除しました。要件・生成設計は保持します。');
