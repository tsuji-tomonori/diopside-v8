import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { prettyJson, sha256 } from './lib.ts';

interface ExportItem {
  file: string;
  name: string;
  kind: string;
}

interface Inventory {
  schemaVersion: '1.0.0';
  generator: 'scripts/generate-design.ts';
  sourceDigests: Array<{ path: string; sha256: string }>;
  exports: ExportItem[];
  routes: string[];
  tests: string[];
}

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'docs/design/generated');
const requirements = JSON.parse(readFileSync(path.join(root, 'spec/requirements/requirements.json'), 'utf8')) as {
  requirements: Array<{ id: string }>;
};
const sources = ['src', 'scripts']
  .flatMap((directory) => walk(path.join(root, directory)))
  .filter((file) => /\.(?:ts|tsx)$/u.test(file))
  .sort();
const tests = walk(path.join(root, 'src')).concat(existsSync(path.join(root, 'e2e')) ? walk(path.join(root, 'e2e')) : [])
  .filter((file) => /(?:\.test\.[jt]sx?|\.spec\.[jt]s)$/u.test(file))
  .map(relative)
  .sort();
const exports = sources.flatMap(readExports).sort((left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name));
const appSource = readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const routes = [...appSource.matchAll(/<Route\s+path="([^"]+)"/gu)].map((match) => match[1]!).sort();
const inventory: Inventory = {
  schemaVersion: '1.0.0',
  generator: 'scripts/generate-design.ts',
  sourceDigests: sources.map((file) => ({ path: relative(file), sha256: sha256(readFileSync(file)) })),
  exports,
  routes,
  tests,
};
const categoryCounts = new Map<string, number>();
for (const requirement of requirements.requirements) {
  const category = requirement.id.split('-')[1] ?? 'OTHER';
  categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
}
const markdown = `<!-- 直接編集禁止: npm run generate:design で生成 / npm run generate:design -- --check で検査 -->
# diopside v8 実装由来設計

この文書はTypeScript実装、ルート宣言、テスト、要件正本から決定的に生成した現在状態です。意図は \`spec/requirements/requirements.json\`、判断理由は \`docs/decisions/\` を正本とします。

## 実行構成

| 領域 | 実装 | 境界 |
|---|---|---|
| 公開画面 | React + TypeScript + HashRouter | GitHub Pages上の静的ファイルだけ |
| 公開データ | 正本JSONから版付きJSONを決定的生成 | \`public/data/latest.json\` と同一release IDだけ受理 |
| 検索 | タイトル専用正規化索引をブラウザ内処理 | 外部検索API、タグ等の文字検索混入なし |
| 端末内データ | IndexedDB、失敗時はメモリ縮退 | サーバー送信、ログイン、端末間同期なし |
| 更新運用 | 人がChatGPT／Codex画面から明示開始 | 1動画1PR、人の承認前は非公開 |

## 画面ルート

${routes.map((route) => `- \`${route}\``).join('\n')}

## 要件正本

| 分類 | 件数 |
|---|---:|
${[...categoryCounts].sort(([left], [right]) => left.localeCompare(right)).map(([category, count]) => `| ${category} | ${count} |`).join('\n')}
| **合計** | **${requirements.requirements.length}** |

## 公開データの流れ

\`content/videos\` + \`content/taxonomy\` → 構造・意味・公開境界検証 → release ID算出 → \`public/data/releases/<release-id>\` → Vite → \`docs\`

## TypeScript公開契約

| ファイル | 種別 | 名前 |
|---|---|---|
${exports.map((item) => `| \`${item.file}\` | ${item.kind} | \`${item.name}\` |`).join('\n')}

## 自動試験

${tests.map((file) => `- \`${file}\``).join('\n') || '- なし'}

## 入力指紋

machine-readableな完全一覧は \`inventory.gen.json\` に保存します。入力${inventory.sourceDigests.length}ファイル、公開契約${inventory.exports.length}件です。
`;

const files = new Map([
  ['system.gen.md', markdown],
  ['inventory.gen.json', prettyJson(inventory)],
]);
const check = process.argv.includes('--check');
const differences: string[] = [];
for (const [name, value] of files) {
  const target = path.join(outDir, name);
  if (check) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== value) differences.push(relative(target));
  } else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(target, value);
  }
}
if (differences.length > 0) {
  console.error(`生成設計が実装と一致しません:\n${differences.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(check ? '生成設計の差分はありません。' : `生成設計を更新しました（${inventory.sourceDigests.length}入力）。`);
}

function readExports(file: string): ExportItem[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return source.statements.flatMap((statement) => {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return [];
    if (
      (ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement)
        || ts.isEnumDeclaration(statement))
      && statement.name
      && ts.isIdentifier(statement.name)
    ) {
      return [{ file: relative(file), name: statement.name.text, kind: ts.SyntaxKind[statement.kind] ?? '宣言' }];
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.flatMap((declaration) => (
        ts.isIdentifier(declaration.name)
          ? [{ file: relative(file), name: declaration.name.text, kind: 'VariableStatement' }]
          : []
      ));
    }
    return [];
  });
}

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function relative(file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}
