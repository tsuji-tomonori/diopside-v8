import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
copyFileSync(path.join(root, 'docs/index.html'), path.join(root, 'docs/404.html'));
writeFileSync(path.join(root, 'docs/.nojekyll'), '');
console.log('GitHub Pages 用の404フォールバックと .nojekyll を生成しました。');
