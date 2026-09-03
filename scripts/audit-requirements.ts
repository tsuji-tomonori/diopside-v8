import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { prettyJson, readJson } from './lib.ts';

const requirementSchema = z.object({
  id: z.string().regex(/^V8-[A-Z]+-\d{3}$/u),
  status: z.enum(['active', 'retired']),
  retirement_reason: z.string().min(1).optional(),
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
  requirements: z.array(requirementSchema).min(142),
}).passthrough();

const resultStatusSchema = z.enum(['未実施', '不合格', '合格']);
const acceptedIncompleteRequirementSchema = z.object({
  requirementId: z.enum(['V8-COST-001', 'V8-QUALITY-002']),
  decision: z.literal('non-blocking'),
  acceptedAt: z.iso.datetime({ offset: true }),
  acceptedBy: z.literal('product-owner'),
  sourceRef: z.literal('user:2026-08-08'),
  scope: z.literal('GitHub Actionsの受入監査における非blocking扱い。merge・公開の承認は含まない。'),
  finding: z.string().min(1),
}).strict();
const acceptanceEvidenceSchema = z.object({
  schemaVersion: z.literal('1.1.0'),
  updatedAt: z.iso.datetime({ offset: true }),
  productOwnerApproval: z.object({
    status: resultStatusSchema,
    approvedAt: z.iso.datetime({ offset: true }).nullable(),
    evidenceUrl: z.url().nullable(),
    finding: z.string().min(1),
  }).strict(),
  acceptedIncompleteRequirements: z.array(acceptedIncompleteRequirementSchema).length(2).superRefine((items, context) => {
    if (new Set(items.map((item) => item.requirementId)).size !== items.length) {
      context.addIssue({ code: 'custom', message: '許可済み未完了要件のIDが重複しています。' });
    }
  }),
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

const migrationEvaluationSchema = z.object({
  sample: z.array(z.unknown()).length(30),
  evaluation: z.object({
    sourceApprovalPassed: z.number().int(),
    deterministicValidationPassed: z.number().int(),
    labelSafetyPassed: z.number().int(),
    rejectedBeforePublication: z.number().int(),
    approvedForPublicCanonicalData: z.number().int(),
  }).passthrough(),
}).passthrough();

const root = path.resolve(import.meta.dirname, '..');
const catalog = catalogSchema.parse(readJson(path.join(root, 'spec/requirements/requirements.json')));
const acceptanceEvidence = acceptanceEvidenceSchema.parse(readJson(path.join(root, 'operations/acceptance-evidence.json')));
const migrationEvaluation = migrationEvaluationSchema.parse(readJson(path.join(root, 'tests/fixtures/legacy-migration-acceptance-v1.json')));
const sourceMap = z.object({
  mappings: z.array(z.object({
    sourceId: z.string().min(1),
    canonicalId: z.string().min(1),
    priority: z.enum(['必須', '推奨']),
  }).strict()).length(142),
}).passthrough().parse(readJson(path.join(root, 'spec/requirements/source-id-map.json')));
const sourceByCanonicalId = new Map(sourceMap.mappings.map((item) => [item.canonicalId, item]));
const acceptedIncompleteById = new Map<string, (typeof acceptanceEvidence.acceptedIncompleteRequirements)[number]>(
  acceptanceEvidence.acceptedIncompleteRequirements.map((item) => [item.requirementId, item]),
);
const ids = new Set<string>();
const activeRequirements = catalog.requirements.filter((requirement) => requirement.status === 'active');
const rows = activeRequirements.map((requirement) => {
  const findings: string[] = [];
  const source = sourceByCanonicalId.get(requirement.id);
  const ownerDirective = requirement.source_refs.find((reference) => reference.startsWith('spec/sources/owner-directive-'));
  const issue465 = requirement.source_refs.find((reference) => reference === 'Issue #465');
  if (!source && !ownerDirective && !issue465) findings.push('Issue要件IDまたは所有者指示対応なし');
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
  const requirementAcceptanceFindings = acceptanceFindings(requirement.id);
  const structuralFindingCount = findings.length;
  findings.push(...requirementAcceptanceFindings);
  const acceptedIncomplete = structuralFindingCount === 0 && requirementAcceptanceFindings.length > 0
    ? acceptedIncompleteById.get(requirement.id)
    : undefined;
  return {
    id: requirement.id,
    sourceId: source?.sourceId ?? ownerDirective ?? issue465 ?? '',
    priority: source?.priority ?? (ownerDirective ? '所有者指示' : issue465 ? 'Issue' : ''),
    title: requirement.title,
    acceptanceCriteria: requirement.acceptance_criteria.map((criterion) => criterion.then).join(' / '),
    verification: requirement.verification.method,
    evidence: requirement.verification.evidence,
    status: findings.length === 0 ? '完了' : acceptedIncomplete ? '許可済み未完了' : '未完了',
    findings,
    acceptedIncomplete: acceptedIncomplete ?? null,
  };
});

const incomplete = rows.filter((row) => row.status !== '完了');
const blockingIncomplete = rows.filter((row) => row.status === '未完了');
const acceptedIncomplete = rows.filter((row) => row.status === '許可済み未完了');
const externalGateFindings = acceptanceEvidence.productOwnerApproval.status === '合格'
  && acceptanceEvidence.productOwnerApproval.approvedAt !== null
  && acceptanceEvidence.productOwnerApproval.evidenceUrl !== null
  ? []
  : [acceptanceEvidence.productOwnerApproval.finding];
const output = {
  schemaVersion: '1.1.0',
  acceptancePassed: incomplete.length === 0 && externalGateFindings.length === 0,
  authorizationPassed: blockingIncomplete.length === 0 && externalGateFindings.length === 0,
  catalogRequirementCount: catalog.requirements.length,
  retiredRequirementCount: catalog.requirements.length - activeRequirements.length,
  requirementCount: rows.length,
  completedCount: rows.length - incomplete.length,
  incompleteCount: incomplete.length,
  blockingIncompleteCount: blockingIncomplete.length,
  acceptedIncompleteCount: acceptedIncomplete.length,
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
if (blockingIncomplete.length > 0 || externalGateFindings.length > 0) {
  const findings = [
    ...blockingIncomplete.map((row) => `${row.id}: ${row.findings.join('、')}`),
    ...externalGateFindings.map((finding) => `外部ゲート（プロダクト責任者承認）: ${finding}`),
  ];
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else if (acceptedIncomplete.length > 0) {
  console.warn([
    `要件追跡監査許可: ${rows.length - incomplete.length}件完了、${acceptedIncomplete.length}件は所有者許可済み未完了です。`,
    ...acceptedIncomplete.map((row) => `${row.id}: ${row.findings.join('、')}（${row.acceptedIncomplete?.finding}）`),
  ].join('\n'));
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
    const evaluation = migrationEvaluation.evaluation;
    return evaluation.sourceApprovalPassed === 30
      && evaluation.deterministicValidationPassed === 30
      && evaluation.labelSafetyPassed === 30
      && evaluation.rejectedBeforePublication === 0
      && evaluation.approvedForPublicCanonicalData === 30
      ? []
      : ['承認済み旧データ移行の固定30動画が、承認元・決定的検証・ラベル安全へ全件合格していない。'];
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
