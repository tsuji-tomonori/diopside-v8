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

const resultStatusSchema = z.enum(['未実施', '不合格', '合格']);
const acceptanceEvidenceSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  updatedAt: z.iso.datetime({ offset: true }),
  productOwnerApproval: z.object({
    status: resultStatusSchema,
    approvedAt: z.iso.datetime({ offset: true }).nullable(),
    evidenceUrl: z.url().nullable(),
    finding: z.string().min(1),
  }).strict(),
  pagesPublication: z.object({
    status: resultStatusSchema,
    sourceBranch: z.string().nullable(),
    sourceFolder: z.string().nullable(),
    publicUrl: z.url().nullable(),
    verifiedAt: z.iso.datetime({ offset: true }).nullable(),
    finding: z.string().min(1),
  }).strict(),
  monthlyCost: z.object({
    status: resultStatusSchema,
    month: z.string().regex(/^\d{4}-\d{2}$/u),
    totalServiceChargeJpy: z.number().nonnegative().nullable(),
    verifiedAt: z.iso.datetime({ offset: true }).nullable(),
    evidenceUrl: z.url().nullable(),
    finding: z.string().min(1),
  }).strict(),
  mobileUsability: z.object({
    status: resultStatusSchema,
    viewport: z.literal('375x812'),
    taskCount: z.number().int().nonnegative(),
    passedWithin60Seconds: z.number().int().nonnegative(),
    results: z.array(z.object({
      taskId: z.string().min(1),
      elapsedSeconds: z.number().nonnegative(),
      completed: z.boolean(),
    }).strict()),
    finding: z.string().min(1),
  }).strict(),
  searchPerformance: z.object({
    status: resultStatusSchema,
    videoCount: z.number().int().positive(),
    viewport: z.literal('375x812'),
    cpuThrottlingRate: z.number().positive(),
    browser: z.string().min(1),
    sampleCount: z.number().int().positive(),
    p95Milliseconds: z.number().nonnegative(),
    limitMilliseconds: z.number().positive(),
    verifiedAt: z.iso.datetime({ offset: true }),
    finding: z.string().min(1),
  }).strict(),
}).strict();

const pilotEvaluationSchema = z.object({
  sample: z.array(z.unknown()).length(30),
  reportedEvaluation: z.object({
    youtubeFormatPassed: z.number().int(),
    contentQualityPassed: z.number().int(),
    rejectedBeforePublication: z.number().int(),
    approvedForPublicCanonicalData: z.number().int(),
  }).passthrough(),
}).passthrough();

const root = path.resolve(import.meta.dirname, '..');
const catalog = catalogSchema.parse(readJson(path.join(root, 'spec/requirements/requirements.json')));
const acceptanceEvidence = acceptanceEvidenceSchema.parse(readJson(path.join(root, 'operations/acceptance-evidence.json')));
const pilotEvaluation = pilotEvaluationSchema.parse(readJson(path.join(root, 'tests/fixtures/pilot-timestamps-v1.json')));
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
  findings.push(...acceptanceFindings(requirement.id));
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
const externalGateFindings = acceptanceEvidence.productOwnerApproval.status === '合格'
  && acceptanceEvidence.productOwnerApproval.approvedAt !== null
  && acceptanceEvidence.productOwnerApproval.evidenceUrl !== null
  ? []
  : [acceptanceEvidence.productOwnerApproval.finding];
const output = {
  schemaVersion: '1.0.0',
  acceptancePassed: incomplete.length === 0 && externalGateFindings.length === 0,
  requirementCount: rows.length,
  completedCount: rows.length - incomplete.length,
  incompleteCount: incomplete.length,
  externalGates: {
    productOwnerApproval: acceptanceEvidence.productOwnerApproval,
    findings: externalGateFindings,
  },
  rows,
};
const outputArg = argument('--output');
const outputPath = outputArg ? path.resolve(process.cwd(), outputArg) : path.join(root, 'reports/requirements-audit.json');
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, prettyJson(output));
if (incomplete.length > 0 || externalGateFindings.length > 0) {
  const findings = [
    ...incomplete.map((row) => `${row.id}: ${row.findings.join('、')}`),
    ...externalGateFindings.map((finding) => `外部ゲート（プロダクト責任者承認）: ${finding}`),
  ];
  console.error(findings.join('\n'));
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

function acceptanceFindings(requirementId: string): string[] {
  if (requirementId === 'V8-SEARCH-018') {
    const evidence = acceptanceEvidence.searchPerformance;
    return evidence.status === '合格'
      && evidence.videoCount === 2500
      && evidence.cpuThrottlingRate === 4
      && evidence.sampleCount >= 20
      && evidence.limitMilliseconds === 100
      && evidence.p95Milliseconds <= 100
      ? []
      : [evidence.finding];
  }
  if (requirementId === 'V8-TIME-036') {
    const evaluation = pilotEvaluation.reportedEvaluation;
    return evaluation.youtubeFormatPassed === 30
      && evaluation.contentQualityPassed === 30
      && evaluation.rejectedBeforePublication === 0
      ? []
      : [`固定30動画は内容品質合格${evaluation.contentQualityPassed}件・棄却${evaluation.rejectedBeforePublication}件で、全件合格の完了条件を満たさない。`];
  }
  if (requirementId === 'V8-OPS-012' || requirementId === 'V8-COST-002') {
    const evidence = acceptanceEvidence.pagesPublication;
    return evidence.status === '合格'
      && evidence.sourceBranch === 'main'
      && evidence.sourceFolder === '/docs'
      && evidence.publicUrl !== null
      && evidence.verifiedAt !== null
      ? []
      : [evidence.finding];
  }
  if (requirementId === 'V8-COST-001') {
    const evidence = acceptanceEvidence.monthlyCost;
    return evidence.status === '合格'
      && evidence.totalServiceChargeJpy === 0
      && evidence.verifiedAt !== null
      && evidence.evidenceUrl !== null
      ? []
      : [evidence.finding];
  }
  if (requirementId === 'V8-QUALITY-002') {
    const evidence = acceptanceEvidence.mobileUsability;
    return evidence.status === '合格'
      && evidence.taskCount >= 5
      && evidence.results.length >= 5
      && evidence.passedWithin60Seconds >= 4
      && evidence.results.filter((result) => result.completed && result.elapsedSeconds <= 60).length >= 4
      ? []
      : [evidence.finding];
  }
  return [];
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
