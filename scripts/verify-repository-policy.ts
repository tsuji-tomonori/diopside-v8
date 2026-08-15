import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { readJson } from './lib.ts';

const root = path.resolve(import.meta.dirname, '..');
const errors: string[] = [];
const workflows = walk(path.join(root, '.github/workflows')).filter((file) => /\.ya?ml$/u.test(file));
for (const workflow of workflows) {
  const text = readFileSync(workflow, 'utf8');
  const isGeneratedRelease = relative(workflow) === '.github/workflows/update-generated-release.yml';
  reject(workflow, text, /^\s*schedule\s*:/mu, '予定実行を含めてはなりません。');
  reject(workflow, text, /(?:openai|codex|chatgpt|api\.openai\.com|OPENAI_API_KEY)/iu, 'AI/API呼出しを含めてはなりません。');
  reject(workflow, text, /actions\/(?:deploy-pages|upload-pages-artifact|configure-pages)/iu, '独自Pages公開Actionを含めてはなりません。');
  reject(workflow, text, /cron\s*:/iu, 'cronを含めてはなりません。');
  for (const match of text.matchAll(/^\s*runs-on:[ \t]*([^\r\n]+)$/gmu)) {
    if (match[1]?.trim() !== 'ubuntu-latest') errors.push(`${relative(workflow)}: 公開リポジトリの標準ubuntu-latest以外を使ってはなりません。`);
  }
  reject(workflow, text, /actions\/(?:upload-artifact|cache)@/iu, '追加の成果物・キャッシュ保存を使ってはなりません。');
  if (isGeneratedRelease) {
    if (!/^permissions:\s*\n\s+contents:\s*write\s*$/mu.test(text)) {
      errors.push(`${relative(workflow)}: 生成commitに限定したcontents writeが必要です。`);
    }
    reject(workflow, text, /pages\/builds/iu, 'main/docsへのcommitと重複するPages buildを明示要求してはなりません。');
    reject(workflow, text, /(?:pull_request_target|workflow_dispatch)\s*:/iu, '書込workflowを信頼境界外から起動してはなりません。');
    if (!/^on:\s*\n\s+push:\s*\n\s+branches:\s*\n\s+- main\s*$/mu.test(text)) {
      errors.push(`${relative(workflow)}: main pushだけを起動元にしなければなりません。`);
    }
    if (!/run:\s*npm run verify:quality/u.test(text)) {
      errors.push(`${relative(workflow)}: release commit前にblocking品質ゲートを実行しなければなりません。`);
    }
  } else if (!/^permissions:\s*\n\s+contents:\s*read\s*$/mu.test(text)) {
    errors.push(`${relative(workflow)}: 最小権限 contents: read が必要です。`);
  }
}
if (existsSync(path.join(root, 'CNAME')) || existsSync(path.join(root, 'public/CNAME')) || existsSync(path.join(root, 'docs/CNAME'))) {
  errors.push('独自ドメイン用CNAMEを置いてはなりません。');
}
const packageJson = readJson(path.join(root, 'package.json')) as { dependencies?: Record<string, string> };
const allowedRuntime = new Set(['react', 'react-dom', 'react-router-dom', 'zod']);
for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
  if (!allowedRuntime.has(dependency)) errors.push(`実行時依存 ${dependency} は0円静的構成の許可一覧にありません。`);
}
for (const file of walk(path.join(root, 'src'))) {
  if (!/\.[jt]sx?$/u.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (/fetch\s*\(\s*['"]https?:/u.test(text)) errors.push(`${relative(file)}: 外部動的APIへのfetchを含めてはなりません。`);
  if (/(?:google-analytics|googletagmanager|segment\.com|mixpanel|posthog|amplitude)/iu.test(text)) errors.push(`${relative(file)}: 解析・追跡コードを含めてはなりません。`);
  if (/(?:login|sign\s?in|sign\s?up|oauth|auth0|firebase-auth)/iu.test(text) && !relative(file).endsWith('validation.ts')) errors.push(`${relative(file)}: 認証実装らしい文字列があります。`);
}
const secretPattern = /(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/u;
for (const file of walk(root)) {
  const relativePath = relative(file);
  if (/^(?:\.git|node_modules|reports\/playwright|reports\/playwright-html)\//u.test(relativePath)) continue;
  if (!/\.(?:[cm]?[jt]sx?|json|ya?ml|md|html|css|toml|txt)$/u.test(file)) continue;
  if (statSync(file).size > 2_000_000) continue;
  if (secretPattern.test(readFileSync(file, 'utf8'))) errors.push(`${relativePath}: 秘密情報らしい値があります。`);
}
const forbiddenInfrastructure = ['serverless.yml', 'cdk.json', 'terraform', 'Dockerfile', 'vercel.json', 'netlify.toml'];
for (const name of forbiddenInfrastructure) if (existsSync(path.join(root, name))) errors.push(`${name}: 有料クラウドまたは動的配信の構成を置いてはなりません。`);
const cost = readJson(path.join(root, 'operations/cost-policy.json')) as { maximumMonthlyServiceCost?: number };
if (cost.maximumMonthlyServiceCost !== 0) errors.push('月額サービス費用の上限は0円でなければなりません。');

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`リポジトリ方針検証合格: ${workflows.length}ワークフロー、外部動的API・認証・追跡・有料基盤0件`);
}

function reject(file: string, text: string, pattern: RegExp, message: string): void {
  if (pattern.test(text)) errors.push(`${relative(file)}: ${message}`);
}

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const target = path.join(directory, name);
    return statSync(target).isDirectory() ? walk(target) : [target];
  });
}

function relative(file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}
