import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { prettyJson, readJson } from './lib.ts';

const requirementSchema = z.object({
  id: z.string().regex(/^V8-[A-Z]+-\d{3}$/u),
  status: z.literal('active'),
  title: z.string().min(1),
  source_refs: z.array(z.string()).min(1),
  acceptance_criteria: z.array(z.object({
    id: z.string().min(1),
    given: z.string().min(1),
    when: z.string().min(1),
    then: z.string().min(1),
  }).strict()).min(1),
  verification: z.object({ method: z.string().min(1), evidence: z.string().min(1) }).strict(),
  traces: z.object({
    design: z.array(z.string()).min(1),
    implementation: z.array(z.string()).min(1),
    tests: z.array(z.string()).min(1),
    standards: z.array(z.string()).min(1),
  }).strict(),
}).passthrough();

const catalogSchema = z.object({
  schema_version: z.literal(1),
  catalog_revision: z.number().int().positive(),
  requirements: z.array(requirementSchema).length(142),
}).passthrough();

const root = path.resolve(import.meta.dirname, '..');
const catalog = catalogSchema.parse(readJson(path.join(root, 'spec/requirements/requirements.json')));
const sourceMap = z.object({
  mappings: z.array(z.object({
    sourceId: z.string().min(1),
    canonicalId: z.string().min(1),
    priority: z.enum(['必須', '推奨']),
  }).strict()).length(142),
}).passthrough().parse(readJson(path.join(root, 'spec/requirements/source-id-map.json')));
const sourceByCanonicalId = new Map(sourceMap.mappings.map((item) => [item.canonicalId, item]));
const ids = new Set<string>();
const rows = catalog.requirements.map((requirement) => {
  const findings: string[] = [];
  const source = sourceByCanonicalId.get(requirement.id);
  if (!source) findings.push('Issue要件ID対応なし');
  if (ids.has(requirement.id)) findings.push('要件ID重複');
  ids.add(requirement.id);
  const tracePaths = [...requirement.traces.design, ...requirement.traces.implementation, ...requirement.traces.tests];
  for (const tracePath of tracePaths) {
    const target = safePath(tracePath);
    if (!existsSync(target)) findings.push(`証跡なし: ${tracePath}`);
    else if (statSync(target).isDirectory() && !hasFiles(target)) findings.push(`証跡が空: ${tracePath}`);
  }
  for (const evidencePath of requirement.verification.evidence.split(',').map((value) => value.trim()).filter(Boolean)) {
    if (!existsSync(safePath(evidencePath))) findings.push(`検証証跡なし: ${evidencePath}`);
  }
  return {
    id: requirement.id,
    sourceId: source?.sourceId ?? '',
    priority: source?.priority ?? '',
    title: requirement.title,
    acceptanceCriteria: requirement.acceptance_criteria.map((criterion) => criterion.then).join(' / '),
    verification: requirement.verification.method,
    evidence: requirement.verification.evidence,
    status: findings.length === 0 ? '完了' : '未完了',
    findings,
  };
});

const incomplete = rows.filter((row) => row.status !== '完了');
const output = {
  schemaVersion: '1.0.0',
  requirementCount: rows.length,
  completedCount: rows.length - incomplete.length,
  incompleteCount: incomplete.length,
  rows,
};
const outputArg = argument('--output');
if (outputArg) {
  const outputPath = path.resolve(process.cwd(), outputArg);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, prettyJson(output));
}
if (incomplete.length > 0) {
  console.error(incomplete.map((row) => `${row.id}: ${row.findings.join('、')}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`要件追跡監査合格: ${rows.length}件すべてに受入条件・検証方法・実装・試験証跡があります。`);
}

function safePath(relativePath: string): string {
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`リポジトリ外の証跡です: ${relativePath}`);
  return target;
}

function hasFiles(directory: string): boolean {
  return readdirSync(directory, { withFileTypes: true }).some((entry) => entry.isFile() || (entry.isDirectory() && hasFiles(path.join(directory, entry.name))));
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
