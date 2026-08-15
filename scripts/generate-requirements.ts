import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

interface SourceRequirement {
  sourceId: string;
  priority: string;
  requirement: string;
  acceptance: string;
  verification: string;
}

interface TraceSet {
  design: string[];
  implementation: string[];
  tests: string[];
}

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'spec/sources/issue-1.md');
const specPath = path.join(root, 'spec/requirements/requirements.json');
const mapPath = path.join(root, 'spec/requirements/source-id-map.json');

const groupMap = {
  検索: 'SEARCH',
  表示: 'DISPLAY',
  端末: 'DEVICE',
  運用: 'OPS',
  タグ: 'TAG',
  時刻: 'TIME',
  費用: 'COST',
  品質: 'QUALITY',
  安全: 'SAFETY',
} as const;

const traceMap: Record<keyof typeof groupMap, TraceSet> = {
  検索: {
    design: ['docs/design/generated/system.gen.md'],
    implementation: ['src/domain/search.ts', 'src/features/search/SearchPage.tsx'],
    tests: ['src/domain/search.test.ts', 'e2e/search.spec.ts'],
  },
  表示: {
    design: ['docs/design/generated/system.gen.md'],
    implementation: ['src/features/detail/VideoDetailPage.tsx', 'src/styles.css'],
    tests: ['src/domain/validation.test.ts', 'e2e/detail.spec.ts'],
  },
  端末: {
    design: ['docs/design/generated/system.gen.md'],
    implementation: ['src/data/deviceStore.ts', 'src/features/library/DeviceLibraryPage.tsx'],
    tests: ['src/data/deviceStore.test.ts', 'e2e/library.spec.ts'],
  },
  運用: {
    design: ['docs/design/generated/system.gen.md', 'docs/operations/manual-content-update.md'],
    implementation: ['scripts/detect-video-candidates.ts', 'scripts/validate-content.ts', 'scripts/build-public-data.ts'],
    tests: ['tests/operations.test.ts', 'tests/generated.test.ts'],
  },
  タグ: {
    design: ['docs/design/generated/system.gen.md', 'content/taxonomy/tag-taxonomy.json'],
    implementation: ['src/domain/content.ts', 'scripts/validate-content.ts'],
    tests: ['src/domain/validation.test.ts', 'tests/content-validation.test.ts'],
  },
  時刻: {
    design: ['docs/design/generated/system.gen.md', 'docs/operations/manual-content-update.md'],
    implementation: ['src/domain/content.ts', 'scripts/diff-timestamps.ts'],
    tests: ['src/domain/validation.test.ts', 'tests/pilot-timestamps.test.ts'],
  },
  費用: {
    design: ['docs/decisions/ADR-0001-zero-cost-static-pages.md', 'docs/operations/cost-check.md'],
    implementation: ['operations/cost-policy.json', 'scripts/verify-repository-policy.ts'],
    tests: ['tests/repository-policy.test.ts'],
  },
  品質: {
    design: ['docs/design/generated/system.gen.md'],
    implementation: ['src', 'scripts'],
    tests: ['src', 'tests', 'e2e'],
  },
  安全: {
    design: ['docs/design/generated/system.gen.md', 'docs/operations/privacy-and-safety.md'],
    implementation: ['scripts/validate-content.ts', 'scripts/verify-repository-policy.ts'],
    tests: ['tests/content-validation.test.ts', 'tests/repository-policy.test.ts'],
  },
};

function parseSource(markdown: string): SourceRequirement[] {
  const requirements: SourceRequirement[] = [];
  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.match(/^\| (V8-([^|]+)-\d{3}) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/u);
    if (!match) continue;
    const [, sourceId, , priority, requirement, acceptance, verification] = match;
    if (!sourceId || !priority || !requirement || !acceptance || !verification) {
      throw new Error(`要件行を解析できません: ${line}`);
    }
    requirements.push({
      sourceId: sourceId.trim(),
      priority: priority.trim(),
      requirement: requirement.trim(),
      acceptance: acceptance.trim(),
      verification: verification.trim(),
    });
  }
  const ids = new Set(requirements.map((item) => item.sourceId));
  if (requirements.length !== 142 || ids.size !== 142) {
    throw new Error(`Issue #1の原子的要件は142件必要です（解析結果: ${requirements.length}件、固有: ${ids.size}件）`);
  }
  return requirements;
}

function canonicalId(sourceId: string): string {
  const match = sourceId.match(/^V8-([^-]+)-(\d{3})$/u);
  if (!match?.[1] || !match[2]) throw new Error(`要件IDが不正です: ${sourceId}`);
  const group = groupMap[match[1] as keyof typeof groupMap];
  if (!group) throw new Error(`未知の要件群です: ${sourceId}`);
  return `V8-${group}-${match[2]}`;
}

function groupOf(sourceId: string): keyof typeof groupMap {
  const group = sourceId.split('-')[1];
  if (!group || !(group in groupMap)) throw new Error(`未知の要件群です: ${sourceId}`);
  return group as keyof typeof groupMap;
}

function classify(item: SourceRequirement): {
  scope: 'product' | 'project';
  category: 'functional' | 'nonfunctional';
  type: 'functional' | 'quality' | 'constraint' | 'interface' | 'data' | 'operational';
} {
  const group = groupOf(item.sourceId);
  if (group === '運用' || group === '費用') {
    return { scope: 'project', category: 'nonfunctional', type: 'operational' };
  }
  if (group === '品質') {
    return { scope: 'product', category: 'nonfunctional', type: 'quality' };
  }
  if (group === '安全') {
    return { scope: 'product', category: 'nonfunctional', type: 'constraint' };
  }
  if (group === 'タグ' || group === '時刻') {
    return { scope: 'product', category: 'functional', type: 'data' };
  }
  if (item.sourceId === 'V8-検索-018' || item.sourceId === 'V8-検索-019') {
    return { scope: 'product', category: 'nonfunctional', type: 'quality' };
  }
  return { scope: 'product', category: 'functional', type: 'functional' };
}

function rationale(group: keyof typeof groupMap): string {
  const values: Record<keyof typeof groupMap, string> = {
    検索: '利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。',
    表示: '利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。',
    端末: '個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。',
    運用: '候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。',
    タグ: '表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。',
    時刻: '見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。',
    費用: '既存のChatGPT／Codex契約以外の運用請求を発生させず、個人運用を持続可能にするため。',
    品質: '主要な利用環境で、速く、理解しやすく、支援技術でも利用できる状態を保証するため。',
    安全: '信頼できない外部入力、秘密情報、公開禁止資料が公開物へ混入することを防ぐため。',
  };
  return values[group];
}

const source = readFileSync(sourcePath, 'utf8');
const sourceRequirements = parseSource(source);
const requirements = sourceRequirements.map((item) => {
  const group = groupOf(item.sourceId);
  const id = canonicalId(item.sourceId);
  const classification = classify(item);
  const title = item.requirement.replace(/[。．]$/u, '').slice(0, 80);
  const requirement = {
    id,
    revision: 1,
    status: 'active',
    ...classification,
    title,
    subject: `diopside v8の${group}`,
    action: 'satisfy',
    object: item.requirement.replaceAll(';', '；'),
    rationale: rationale(group),
    source_refs: [`Issue #1 ${item.sourceId}`, 'user:2026-08-03'],
    acceptance_criteria: [{
      id: `AC-${id}-1`,
      given: `${item.sourceId}の前提を満たす公開データまたは操作がある`,
      when: item.verification,
      then: item.acceptance,
    }],
    verification: {
      method: item.verification,
      evidence: traceMap[group].tests.join(', '),
    },
    traces: {
      design: [...traceMap[group].design],
      implementation: [...traceMap[group].implementation],
      tests: [...traceMap[group].tests],
      standards: ['Issue #1', 'dev-standard default profile'],
    },
    last_changed_by: 'ISSUE-1-IMPLEMENTATION',
  };
  if (id === 'V8-OPS-001') {
    requirement.revision = 2;
    requirement.title = 'タイムスタンプ一括処理は、人の1回の明示要求で有限の適格対象集合を固定して開始しなければならない';
    requirement.object = 'タイムスタンプ一括処理は、運用者による1回の明示的なChatGPT／Codex要求で指定された識別子または有限の選定条件から、今回処理する適格動画の有限集合を開始時に固定しなければならない。固定後は、動画ごとの追加チャット承認を開始条件としてはならない。';
    requirement.source_refs.push('owner-directive:2026-08-08-timestamp-batch');
    requirement.acceptance_criteria = [
      {
        id: 'AC-V8-OPS-001-1',
        given: '運用者がタイムスタンプ対象の識別子または有限の選定条件を明示した',
        when: '一括処理の開始境界・対象集合固定試験',
        then: '要求から有限の適格対象集合を一度だけ固定し、人の開始操作がない状態では候補生成、ブランチ作成、プルリクエスト作成を行わない。',
      },
      {
        id: 'AC-V8-OPS-001-2',
        given: '明示要求によって対象集合を固定済みである',
        when: '動画ごとの状態遷移試験',
        then: '集合内の各動画は、動画ごとの追加チャット承認を待たずに処理を開始できる。',
      },
    ];
    requirement.verification = {
      method: '一括処理の開始境界・対象集合固定・状態遷移試験',
      evidence: 'tests/operations.test.ts, tests/timestamp_tools_test.py',
    };
    requirement.traces.implementation.push('.agents/skills/generate-stream-timestamps');
    requirement.traces.tests.push('tests/timestamp_tools_test.py');
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-08-TIMESTAMP-BATCH';
  }
  if (id === 'V8-OPS-005') {
    requirement.revision = 3;
    requirement.title = '1回の明示要求で固定した有限の適格タイムスタンプ対象集合を、全件が終端結果へ到達するまで処理しなければならない';
    requirement.object = '1回の明示要求で固定した有限の適格タイムスタンプ対象集合は、各動画が1動画だけを対象とするdraft PRの作成・最終commitのpush・台帳反映確認を完了した状態、または根拠を示した処理不能状態のいずれかへ到達するまで処理しなければならない。ある動画の失敗を理由に、集合内の未処理動画を停止してはならない。';
    requirement.source_refs.push('owner-directive:2026-08-08-timestamp-batch', 'spec/sources/owner-directive-2026-08-11-timestamp-work-harness.md', 'user:2026-08-11');
    requirement.acceptance_criteria = [
      {
        id: 'AC-V8-OPS-005-1',
        given: '同じ公開情報、同じ正本、同じ明示要求がある',
        when: '対象集合の固定データ試験',
        then: '同じ有限の適格対象集合を固定する。',
      },
      {
        id: 'AC-V8-OPS-005-2',
        given: '固定した集合に成功可能な動画と処理不能になる動画が含まれる',
        when: '一括処理の終端・失敗分離試験',
        then: '全動画が1動画draft PR作成・最終commit push・台帳反映確認済み、または理由付き処理不能の終端結果を持ち、処理不能動画があっても残りの動画を処理する。',
      },
    ];
    requirement.verification = {
      method: '対象集合の固定データ・一括処理の終端・失敗分離試験',
      evidence: 'tests/operations.test.ts, tests/timestamp_tools_test.py, tests/timestamp_harness_test.py',
    };
    requirement.traces.implementation.push('.agents/skills/generate-stream-timestamps', '.agents/skills/run-timestamp-work-harness');
    requirement.traces.tests.push('tests/timestamp_tools_test.py', 'tests/timestamp_harness_test.py');
    requirement.last_changed_by = 'CHG-20260811-timestamp-work-harness';
  }
  if (id === 'V8-OPS-009') {
    requirement.revision = 2;
    requirement.title = 'プルリクエスト作成前の決定的検証は動画ごとに判定し、不合格を他の対象へ波及させてはならない';
    requirement.object = 'プルリクエスト作成前に、構造、タグ、タイムスタンプ、ワードクラウド、検索索引、公開禁止情報、静的画面を動画ごとに決定的スクリプトで検証しなければならない。不合格は当該動画のプルリクエスト作成だけを止め、理由付き処理不能として記録し、同じ有限集合の他の動画の処理を止めてはならない。';
    requirement.source_refs.push('owner-directive:2026-08-08-timestamp-batch');
    requirement.acceptance_criteria[0]!.given = '固定した有限集合の各動画に、プルリクエスト作成前の候補がある';
    requirement.acceptance_criteria[0]!.when = '不正データ試験・動画単位の失敗分離試験・手順試験';
    requirement.acceptance_criteria[0]!.then = 'いずれか1件の不合格で当該動画のプルリクエスト作成を止め、原因を日本語で示す一方、他の対象動画の検証と処理を継続する。';
    requirement.verification = {
      method: '不正データ試験・動画単位の失敗分離試験・手順試験',
      evidence: 'tests/operations.test.ts, tests/generated.test.ts, tests/timestamp_tools_test.py',
    };
    requirement.traces.implementation.push('.agents/skills/generate-stream-timestamps');
    requirement.traces.tests.push('tests/timestamp_tools_test.py');
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-08-TIMESTAMP-BATCH';
  }
  if (id === 'V8-OPS-010') {
    requirement.revision = 2;
    requirement.title = '各動画の終端結果は、PRレビュー内容または処理不能理由を日本語で確認できなければならない';
    requirement.object = 'PRレビュー可能な動画のプルリクエスト本文は、対象動画、タグ候補、タイムスタンプ候補、ワードクラウド語句、根拠、検証結果、YouTube確認リンクを日本語で示さなければならない。処理不能の動画は、失敗した段階と根拠を含む理由を日本語で示さなければならない。';
    requirement.source_refs.push('owner-directive:2026-08-08-timestamp-batch');
    requirement.acceptance_criteria = [
      {
        id: 'AC-V8-OPS-010-1',
        given: '動画がPRレビュー可能な終端結果へ到達した',
        when: 'プルリクエスト表示確認',
        then: '人が構造化データを直接読まずに対象動画、各候補、根拠、検証結果、YouTube確認リンクを確認できる。',
      },
      {
        id: 'AC-V8-OPS-010-2',
        given: '動画が理由付き処理不能の終端結果へ到達した',
        when: '一括処理の結果表示確認',
        then: '失敗した段階、根拠、再開に必要な条件を日本語で確認でき、成功または公開対象として表示されない。',
      },
    ];
    requirement.verification = {
      method: 'プルリクエスト・一括処理結果の表示確認',
      evidence: 'tests/operations.test.ts, tests/timestamp_tools_test.py',
    };
    requirement.traces.implementation.push('.agents/skills/generate-stream-timestamps');
    requirement.traces.tests.push('tests/timestamp_tools_test.py');
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-08-TIMESTAMP-BATCH';
  }
  if (id === 'V8-OPS-003') {
    requirement.revision = 3;
    requirement.source_refs.push('owner-directive:2026-08-04', 'spec/sources/owner-directive-2026-08-08-post-merge-release.md');
    requirement.acceptance_criteria[0]!.then = '`.github/workflows` に予定実行、AI/API呼出し、独自Pages deployが存在しない。人が開始する `workflow_dispatch` は読取専用の検証と候補検出に限定し、静的成果物生成は検証済みmainだけを入力とする。';
    requirement.traces.implementation.push('.github/workflows/manual-content-operation.yml');
    requirement.traces.implementation = [...requirement.traces.implementation, '.github/workflows/update-generated-release.yml'];
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-08-POST-MERGE-RELEASE';
  }
  if (id === 'V8-OPS-007') {
    requirement.revision = 2;
    requirement.object = '通常の動画追加プルリクエストは、正本動画データを1件だけ変更対象とし、公開用のrelease ID、版付きJSON、画面bundle、`main/docs`を含めてはならない。静的公開成果物は人が当該プルリクエストをmainへマージした後に生成しなければならない。';
    requirement.source_refs.push('spec/sources/owner-directive-2026-08-08-post-merge-release.md');
    requirement.acceptance_criteria[0]!.then = '1件の正本動画データと、その正本件数・更新日時を持つmanifestおよび確認用資料だけを変更し、release ID、版付き公開JSON、画面bundle、`main/docs`を差分に含めない。';
    requirement.traces.implementation = [
      ...requirement.traces.implementation,
      'scripts/validate-video-pr-scope.ts',
      'scripts/validate-release-pr-scope.ts',
      '.github/workflows/update-generated-release.yml',
    ];
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-08-POST-MERGE-RELEASE';
  }
  if (id === 'V8-SEARCH-008') {
    requirement.revision = 2;
    requirement.title = 'タグ補助候補欄は検索欄と分離し、該当する候補だけを表示して折り畳めなければならない';
    requirement.object = 'タグ補助候補欄は検索欄と分離し、選択可能な日本語名と追加選択後の該当件数を表示しなければならない。現在の条件では該当件数が0件になる未選択タグを表示してはならない。利用者はタグ補助候補欄を折り畳み、選択条件を反映した動画一覧へ移動できなければならない。';
    requirement.source_refs.push('owner-directive:2026-08-07');
    requirement.acceptance_criteria = [
      {
        id: 'AC-V8-SEARCH-008-1',
        given: 'タイトル・公開日・動画長・選択済みタグの現在条件がある',
        when: 'タグ候補の画面試験・件数契約試験',
        then: '候補タグを1件追加した場合の件数が1件以上の未選択タグと、解除できる選択済みタグだけを日本語名と件数付きで示す。検索語を入力してもタグは自動選択されない。',
      },
      {
        id: 'AC-V8-SEARCH-008-2',
        given: '利用者がタグ候補を選択している',
        when: 'タグ候補欄の折り畳み操作試験',
        then: 'タグ候補欄を折り畳む操作で選択条件を反映し、動画件数見出しへフォーカスと表示位置が移る。再度タグ候補欄を開くと選択状態を維持している。',
      },
    ];
    requirement.verification = {
      method: 'タグ候補の画面試験・件数契約試験・折り畳み操作試験',
      evidence: 'src/domain/search.test.ts, e2e/search.spec.ts',
    };
    requirement.last_changed_by = 'CHG-20260807-improve-tag-navigation';
  }
  if (['V8-TIME-027', 'V8-TIME-028', 'V8-TIME-029'].includes(id)) {
    requirement.revision = 2;
    requirement.title = `${requirement.title}（新規・変更候補。承認済み旧データ移行は別経路）`;
    requirement.object = `${requirement.object} 新規・変更候補にはIssue #1の独立確認を適用する。既存承認済みデータは、承認元・入力指紋・同一候補ハッシュ・v8決定的検証・現在の所有者承認を解決できる場合に限り移行できる。`;
    requirement.source_refs.push('owner-directive:2026-08-04');
    requirement.acceptance_criteria[0]!.then = '新規・変更候補はIssue #1の独立確認に合格する。承認済み旧データ移行は、承認元、同一候補ハッシュ、決定的検証、現在の所有者承認をすべて持つ。';
    requirement.traces.implementation.push('scripts/import-legacy-content.ts');
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-04';
  }
  if (id === 'V8-TIME-029') {
    requirement.revision = 3;
    requirement.title = '事実確認と編集確認が同じ候補版へ合格した動画だけをPRレビュー可能とし、人のマージを公開承認としなければならない';
    requirement.object = '新規・変更候補は、事実確認と編集確認の両方が同じ候補版へ合格した場合だけ、1動画だけを対象とするPRのレビュー可能状態へ進めなければならない。対象集合を固定した後に動画ごとの追加チャット承認を要求してはならず、人が当該PRを確認してマージする操作を公開の最終承認としなければならない。既存承認済みデータは、承認元・入力指紋・同一候補ハッシュ・v8決定的検証・現在の所有者承認を解決できる場合に限り移行できる。';
    requirement.source_refs.push('owner-directive:2026-08-08-timestamp-batch');
    requirement.acceptance_criteria = [
      {
        id: 'AC-V8-TIME-029-1',
        given: '新規・変更タイムスタンプ候補に事実確認と編集確認の結果がある',
        when: '候補版・状態遷移・PR範囲試験',
        then: '同じ候補版への両確認合格時だけ1動画のPRをレビュー可能にし、候補修正後は旧確認を無効にして両方を再実施する。',
      },
      {
        id: 'AC-V8-TIME-029-2',
        given: '1回の明示要求で対象集合を固定し、動画の候補がレビュー可能になった',
        when: '承認境界・公開境界試験',
        then: '動画ごとの追加チャット承認なしでPRレビュー可能状態まで進み、人が当該PRをマージするまで公開されず、自動マージまたは自動公開されない。',
      },
      {
        id: 'AC-V8-TIME-029-3',
        given: '承認済み旧データを移行する',
        when: '移行経路の版・状態遷移試験',
        then: '承認元、同一候補ハッシュ、決定的検証、現在の所有者承認をすべて持つ。',
      },
    ];
    requirement.verification = {
      method: '候補版・状態遷移・PR範囲・承認境界・公開境界試験',
      evidence: 'src/domain/validation.test.ts, tests/pilot-timestamps.test.ts, tests/timestamp_tools_test.py',
    };
    requirement.traces.implementation.push('.agents/skills/generate-stream-timestamps');
    requirement.traces.tests.push('tests/timestamp_tools_test.py');
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-08-TIMESTAMP-BATCH';
  }
  if (id === 'V8-TIME-030') {
    requirement.revision = 2;
    requirement.title = '決定的検証は必須条件を動画ごとに確認し、不合格動画だけを理由付き処理不能にしなければならない';
    requirement.object = '決定的検証は、0秒開始、3件以上、整数、昇順、10秒以上、動画長内、全区間網羅、非空名、許可確度、根拠参照、未解決重大指摘なしを動画ごとにすべて確認しなければならない。いずれかの不合格は当該動画の作成済みへの遷移とプルリクエスト作成を止め、理由付き処理不能とし、同じ有限集合の他の動画の処理を止めてはならない。';
    requirement.source_refs.push('owner-directive:2026-08-08-timestamp-batch');
    requirement.acceptance_criteria = [
      {
        id: 'AC-V8-TIME-030-1',
        given: '固定した有限集合の各動画にタイムスタンプ候補がある',
        when: '不正データ総当たり・動画単位の失敗分離試験',
        then: 'いずれか1件の不合格で当該動画の作成済みへの遷移とプルリクエスト作成を止め、理由付き処理不能にする一方、他の対象動画の処理を継続する。',
      },
    ];
    requirement.verification = {
      method: '不正データ総当たり・動画単位の失敗分離試験',
      evidence: 'src/domain/validation.test.ts, tests/pilot-timestamps.test.ts, tests/timestamp_tools_test.py',
    };
    requirement.traces.implementation.push('.agents/skills/generate-stream-timestamps');
    requirement.traces.tests.push('tests/timestamp_tools_test.py');
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-08-TIMESTAMP-BATCH';
  }
  if (id === 'V8-TIME-036') {
    requirement.revision = 2;
    requirement.title = '初回公開前に、指定8ジャンルの固定30動画で新規経路または承認済み旧データ移行経路の品質を確認しなければならない';
    requirement.object = '初回公開前に、ゲーム8件、企画6件、雑談5件、ASMR3件、歌2件、朗読・声劇2件、同時視聴2件、TRPG2件の固定30動画で品質を確認しなければならない。承認済み旧データを使う場合は、旧パイロットの不合格を合格へ読み替えず、別の承認済み固定30件を選び、承認元とv8決定的検証を確認する。';
    requirement.source_refs.push('owner-directive:2026-08-04');
    requirement.acceptance_criteria[0]!.then = '本人・外部を含む固定30件が、承認元の解決、v8決定的検証、ラベル安全検査に全件合格する。旧パイロットの不合格記録は保持する。';
    requirement.traces.implementation.push('scripts/import-legacy-content.ts');
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-04';
  }
  if (id === 'V8-TAG-013') {
    requirement.revision = 2;
    requirement.title = 'コラボ相手は人物名で登録し、多人数の凸待ち・継続ラジオでは役割で限定しなければならない';
    requirement.object = 'コラボ動画には白雪巴以外の実出演者をチャンネル表示名ではなく人物名で登録しなければならない。ただし、凸待ち・逆凸は配信主だけ、継続する公式ラジオ等は固定の相手だけをコラボ相手とし、他の凸参加者、単発ゲスト、スタッフ、言及人物、クレジット制作者を含めてはならない。';
    requirement.source_refs.push('spec/sources/owner-directive-2026-08-15-collaboration-pages.md', 'user:2026-08-15');
    requirement.acceptance_criteria = [
      {
        id: 'AC-V8-TAG-013-1',
        given: '通常のコラボ動画に白雪巴以外の実出演者がいる',
        when: '人物タグの正本・表示名検査',
        then: '実出演者を人物名の出演者タグとして登録し、チャンネル表示名を人物タグへ保存しない。',
      },
      {
        id: 'AC-V8-TAG-013-2',
        given: '白雪巴が凸待ちまたは逆凸の一部へ参加する',
        when: '役割別コラボ相手選別試験',
        then: '配信主だけをコラボ相手とし、同じ配信の他の凸参加者を登録しない。',
      },
      {
        id: 'AC-V8-TAG-013-3',
        given: '白雪巴が継続する公式ラジオ等へ固定出演し、その回に単発ゲストもいる',
        when: '役割別コラボ相手選別試験',
        then: '固定の相手だけをコラボ相手とし、単発ゲストとスタッフを登録しない。',
      },
    ];
    requirement.verification = {
      method: '人物タグ正本・表示名・役割別コラボ相手選別試験',
      evidence: 'src/domain/collaboration.test.ts, tests/content-validation.test.ts',
    };
    requirement.traces.implementation.push('src/domain/collaboration.ts', 'content/people/collaboration-profiles.json');
    requirement.traces.tests.push('src/domain/collaboration.test.ts');
    requirement.last_changed_by = 'CHG-20260815-collaboration-pages';
  }
  return requirement;
});

const ownerDirectiveRequirements = [
  {
    id: 'V8-DISPLAY-011',
    revision: 2,
    status: 'active',
    scope: 'product',
    category: 'functional',
    type: 'data',
    title: '動画詳細は、ネタバレを避けた100〜150字のあらすじを、白雪巴の特徴的なセリフで締めて表示しなければならない',
    subject: 'diopside v8の表示',
    action: 'satisfy',
    object: '全編根拠を確認できる動画の詳細は、視聴意欲を促しつつ結末、正体、勝敗等のネタバレを避けた日本語あらすじを表示しなければならない。本文と末尾の引用符付きセリフは合計100〜150文字とし、最後に対象配信で白雪巴が実際に発した特徴的なセリフを一つ置かなければならない。',
    rationale: '利用者が結末を知らずに動画の雰囲気と見どころを把握し、安心して視聴を選べるようにするため。',
    source_refs: [
      'spec/sources/owner-directive-2026-08-08-video-synopsis.md',
      'spec/sources/owner-directive-2026-08-11-synopsis-work-harness.md',
      'user:2026-08-08',
      'user:2026-08-11',
    ],
    acceptance_criteria: [
      {
        id: 'AC-V8-DISPLAY-011-1',
        given: '全編根拠と承認済みのあらすじ候補を持つ動画がある',
        when: 'あらすじ候補検証・公開データ検証・動画詳細画面試験',
        then: '本文と末尾の引用符付きセリフが100〜150文字で、結末、正体、勝敗等を明かさず、最後に根拠時刻へ移動できる白雪巴の特徴的なセリフを一つ表示する。',
      },
      {
        id: 'AC-V8-DISPLAY-011-2',
        given: '全編字幕または文字起こしを使ってあらすじ候補を作る',
        when: '公開境界検査・repository差分確認',
        then: '生字幕・文字起こしをGitまたは公開成果物へ含めず、安全な根拠ラベル、入力指紋、全編範囲だけを正本へ保持する。',
      },
      {
        id: 'AC-V8-DISPLAY-011-3',
        given: '新しいあらすじ候補を一括生成する',
        when: 'rules 1.1.0の候補を検証する',
        then: '0秒から動画末尾まで隙間のない意味区間を確認し、同じ候補hashに対する独立した事実・発言者確認、ネタバレ・個人情報確認、編集確認が全て合格する。歌詞、ゲーム・映像・朗読の台詞、他出演者の発言を白雪巴の引用として採用しない。',
      },
    ],
    verification: {
      method: 'あらすじ候補検証・公開データ検証・動画詳細画面試験・公開境界検査',
      evidence: 'src/domain/validation.test.ts, tests/content-validation.test.ts, e2e/detail.spec.ts',
    },
    traces: {
      design: ['docs/design/generated/system.gen.md'],
      implementation: [
        '.agents/skills/generate-video-synopses',
        '.agents/skills/run-synopsis-work-harness',
        'src/domain/content.ts',
        'src/domain/validation.ts',
        'scripts/build-public-data.ts',
        'src/features/detail/VideoDetailPage.tsx',
        'src/styles.css',
      ],
      tests: ['src/domain/validation.test.ts', 'tests/content-validation.test.ts', 'tests/synopsis_harness_test.py', 'e2e/detail.spec.ts'],
      standards: ['Issue #1', 'spec/sources/owner-directive-2026-08-08-video-synopsis.md', 'spec/sources/owner-directive-2026-08-11-synopsis-work-harness.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260811-synopsis-work-harness',
  },
  {
    id: 'V8-OPS-017',
    revision: 1,
    status: 'active',
    scope: 'project',
    category: 'nonfunctional',
    type: 'operational',
    title: '静的公開成果物は、検証済みmainマージ後にだけ自動生成してrelease commitしなければならない',
    subject: 'diopside v8の運用',
    action: 'satisfy',
    object: 'release ID、版付き公開JSON、画面bundle、`main/docs`は、mainの品質ゲートに合格した人承認済み正本から決定的に生成し、差分がある場合だけmainへrelease commitしなければならない。生成中にmainが更新された場合は古い結果をcommitしてはならない。',
    rationale: '内容レビュー対象の正本と機械生成される公開版を分離し、通常プルリクエストごとの全公開物差分とrelease ID競合をなくしながら、人のマージ承認後だけ一貫した静的版を公開するため。',
    source_refs: ['spec/sources/owner-directive-2026-08-08-post-merge-release.md', 'user:2026-08-08'],
    acceptance_criteria: [
      {
        id: 'AC-V8-OPS-017-1',
        given: '人が正本変更をmainへマージし、そのmain commitの品質ゲートが合格した',
        when: 'post-merge生成workflow契約試験',
        then: '同じ検証済みcommitから静的成果物を生成・検証し、後続main更新がなく生成差分がある場合だけrelease commitする。',
      },
      {
        id: 'AC-V8-OPS-017-2',
        given: 'release commitがmainへ追加された',
        when: 'Pages公開経路試験',
        then: '独自deploy artifactを使わず、既存のmain/docs branch方式Pages buildを要求する。',
      },
    ],
    verification: {
      method: 'post-merge生成workflow契約試験・Pages公開経路試験',
      evidence: 'tests/repository-policy.test.ts, tests/operations.test.ts, tests/generated.test.ts',
    },
    traces: {
      design: ['docs/decisions/ADR-0001-zero-cost-static-pages.md', 'docs/design/generated/system.gen.md'],
      implementation: ['.github/workflows/update-generated-release.yml', 'scripts/build-public-data.ts', 'scripts/validate-video-pr-scope.ts', 'scripts/validate-release-pr-scope.ts', 'scripts/verify-generated-source.ts'],
      tests: ['tests/repository-policy.test.ts', 'tests/operations.test.ts', 'tests/generated.test.ts'],
      standards: ['spec/sources/owner-directive-2026-08-08-post-merge-release.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260808-post-merge-release',
  },
];
const timestampHarnessRequirements = [
  {
    id: 'V8-OPS-018',
    revision: 1,
    status: 'active',
    scope: 'project',
    category: 'nonfunctional',
    type: 'operational',
    title: 'Work用タイムスタンプ処理はPythonで台帳行を固定し中断後も同じ集合から再開できなければならない',
    subject: 'diopside v8のタイムスタンプ運用',
    action: 'satisfy',
    object: 'ChatGPT Workから開始するタイムスタンプ処理は、PythonでGoogle Sheetsの対象動画台帳を列名で読み、作成済み・除外・既存PRを除いた適格対象を行番号と行指紋を含む有限集合として固定し、同じbatch IDでは集合を変更せず中断後も再開できなければならない。',
    rationale: '長時間処理の中断や台帳の並行更新があっても対象の追加・脱落・誤上書きを防ぎ、今後のChatGPT Work実行を同じ手順で再現するため。Python、Google Sheets、ChatGPT Workは所有者が将来運用に指定した支持環境であり、この運用範囲に限定して保持する。',
    source_refs: ['spec/sources/owner-directive-2026-08-11-timestamp-work-harness.md', 'user:2026-08-11'],
    acceptance_criteria: [{
      id: 'AC-V8-OPS-018-1',
      given: '対象動画台帳のsnapshotと一意なbatch IDがある',
      when: 'Pythonハーネスを初期化し、同一または変更したsnapshotで再実行する',
      then: '同一入力は同じ有限集合を再開し、行または対象集合が変わる同一batch IDを拒否し、0件ではbranch・PR・台帳書込みを行わない。',
    }],
    verification: { method: '台帳snapshot・immutable manifest・再開・0件試験', evidence: 'tests/timestamp_harness_test.py' },
    traces: {
      design: ['docs/design/generated/system.gen.md', '.agents/skills/run-timestamp-work-harness/references/workflow.md'],
      implementation: ['.agents/skills/run-timestamp-work-harness/scripts/harness.py', '.agents/skills/run-timestamp-work-harness/scripts/harness_common.py'],
      tests: ['tests/timestamp_harness_test.py'],
      standards: ['spec/sources/owner-directive-2026-08-11-timestamp-work-harness.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260811-timestamp-work-harness',
  },
  {
    id: 'V8-OPS-019',
    revision: 1,
    status: 'active',
    scope: 'project',
    category: 'nonfunctional',
    type: 'operational',
    title: '意味判断は独立したcodex execで実行し素材取得と決定的検証で囲まなければならない',
    subject: 'diopside v8のタイムスタンプ運用',
    action: 'satisfy',
    object: 'ハーネスは作成者時刻一覧または公開日本語字幕を優先し、必要時に公開音声と無償ローカル音声認識、匿名化したチャット補助信号を取得し、章構成・事実確認・編集確認の意味判断を役割ごとに独立した非対話のcodex execで実行して、同じ候補hashへの決定的検証合格を必須としなければならない。',
    rationale: '素材収集と意味判断と採用判定を分離し、既存ChatGPT／Codex契約の範囲で全編根拠、独立確認、機械検証を再現可能にするため。codex execは所有者が判断実行方式として明示した永続的な運用制約である。',
    source_refs: ['spec/sources/owner-directive-2026-08-11-timestamp-work-harness.md', 'user:2026-08-11'],
    acceptance_criteria: [
      {
        id: 'AC-V8-OPS-019-1',
        given: '固定対象に公開字幕がある、または公開音声から全編ローカル音声認識が可能である',
        when: 'ハーネスで素材取得と候補作成を実行する',
        then: '生素材をGitへ保存せず、compose、fact、editorialを別のephemeral codex execとして実行し、同じ候補hashの独立確認と決定的検証に合格した候補だけをPR工程へ進める。',
      },
      {
        id: 'AC-V8-OPS-019-2',
        given: 'チャット補助信号が必要で公開live chatを取得できる',
        when: 'チャット取得を実行する',
        then: '本文と投稿者識別子を破棄した時間帯別反応量だけを一時保持し、チャット単独で境界または全編根拠を決めない。',
      },
    ],
    verification: { method: 'Codex実行契約・role分離・候補hash・匿名chat・公開境界試験', evidence: 'tests/timestamp_harness_test.py, tests/timestamp_tools_test.py' },
    traces: {
      design: ['docs/design/generated/system.gen.md', '.agents/skills/run-timestamp-work-harness/references/workflow.md'],
      implementation: ['.agents/skills/run-timestamp-work-harness/scripts/harness.py', '.agents/skills/run-timestamp-work-harness/scripts/download_live_chat.py', '.agents/skills/prepare-stream-evidence', '.agents/skills/audit-stream-chapters'],
      tests: ['tests/timestamp_harness_test.py', 'tests/timestamp_tools_test.py'],
      standards: ['spec/sources/owner-directive-2026-08-11-timestamp-work-harness.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260811-timestamp-work-harness',
  },
  {
    id: 'V8-OPS-020',
    revision: 1,
    status: 'active',
    scope: 'project',
    category: 'nonfunctional',
    type: 'operational',
    title: '合格動画のdraft PR作成と全終端結果の台帳反映を自律的に完了しなければならない',
    subject: 'diopside v8のタイムスタンプ運用',
    action: 'satisfy',
    object: 'ハーネスは合格した各動画について1動画branchをcommit・pushしてdraft PRを作成し、実在PR URLを正本候補へ記録して最終commitをpushした後、PR URL・commit SHA・レビュー待ち状態を対象台帳行へ反映して再読確認しなければならない。処理不能動画も安全な理由と再開条件を台帳へ反映し、行指紋が変わった場合は上書きしてはならない。',
    rationale: '候補作成だけで停止せず、人が確認できるGitHub単位と進捗台帳を一致させ、誤って未マージ候補を作成済みまたは公開済みと扱わないため。',
    source_refs: ['spec/sources/owner-directive-2026-08-11-timestamp-work-harness.md', 'user:2026-08-11'],
    acceptance_criteria: [
      {
        id: 'AC-V8-OPS-020-1',
        given: '候補が全編根拠、独立確認、決定的検証に合格した',
        when: 'PR工程と台帳同期を実行する',
        then: '1動画だけのdraft PRへ最終commitがpushされ、台帳は作成済みFALSE、PR作成済み（レビュー待ち）、実在PR URL、最終commit SHAを示し、更新後の再読で一致する。',
      },
      {
        id: 'AC-V8-OPS-020-2',
        given: '動画が処理不能である、または開始後に台帳行が変更された',
        when: '終端結果を台帳へ同期する',
        then: '他動画を継続し、処理不能の段階・安全な理由・再開条件を記録し、競合行は上書きしない。',
      },
    ],
    verification: { method: '1動画PR scope・PR URL gate・行指紋競合・exact range write・更新後再読試験', evidence: 'tests/timestamp_harness_test.py, tests/finalize_candidate_pr_merge_test.py, tests/operations.test.ts' },
    traces: {
      design: ['docs/design/generated/system.gen.md', '.agents/skills/run-timestamp-work-harness/references/workflow.md'],
      implementation: ['.agents/skills/run-timestamp-work-harness', '.agents/skills/generate-stream-timestamps/scripts/finalize_candidate.py', 'scripts/validate-video-pr-scope.ts'],
      tests: ['tests/timestamp_harness_test.py', 'tests/finalize_candidate_pr_merge_test.py', 'tests/operations.test.ts'],
      standards: ['spec/sources/owner-directive-2026-08-11-timestamp-work-harness.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260811-timestamp-work-harness',
  },
  {
    id: 'V8-OPS-021',
    revision: 1,
    status: 'active',
    scope: 'project',
    category: 'nonfunctional',
    type: 'operational',
    title: '2〜20のWorkセッションはremote branchの原子的claimで別動画を1件ずつ処理しなければならない',
    subject: 'diopside v8の分散タイムスタンプ運用',
    action: 'satisfy',
    object: '2〜20の独立したChatGPT Workセッションでタイムスタンプを並列処理する場合、各workerは動画IDを人が事前配布せず、動画IDの大文字小文字を保持した専用remote branchをGitHub connectorで原子的にref作成して未確保動画を1件だけ所有し、競合に負けたworkerは次候補へ進み、勝者はclaim markerと処理中draft PRを直ちに作成して同じPRと台帳行を完了まで処理しなければならない。',
    rationale: '独立Workセッション間に共有ローカル状態がなくても、GitHubのremote ref作成をcompare-and-setとして利用し、二重素材処理、同一branch更新、同一動画PR、台帳行の誤上書きを防ぐため。処理中draft PRにより中断したclaimも人が発見して再開判断できる。',
    source_refs: ['spec/sources/owner-directive-2026-08-11-timestamp-distributed-workers.md', 'user:2026-08-11'],
    acceptance_criteria: [
      {
        id: 'AC-V8-OPS-021-1',
        given: '同じ台帳snapshotから同じ未処理動画を選ぶ2つのworkerがある',
        when: '両workerがGitHub connectorで同じ動画の専用remote branchをref作成してclaimする',
        then: 'GitHubがref作成を受理した1workerだけが所有権を得てclaim markerと処理中draft PRを作り、競合workerはforce updateやbranch削除をせず次候補へ進む。',
      },
      {
        id: 'AC-V8-OPS-021-2',
        given: '適格動画数より多いworkerが起動した、またはclaim済み動画だけが残っている',
        when: 'workerがclaim-nextを完了する',
        then: '余剰workerはno_unclaimed_targetとしてbranch、PR、台帳書込みを行わず正常終了する。',
      },
      {
        id: 'AC-V8-OPS-021-3',
        given: 'claim済みworkerが処理中に停止した',
        when: '別workerまたは人がGitHub上の状態を確認する',
        then: '処理中draft PRとclaim markerから所有権を識別でき、自動奪取せず同じbatchとbranchで再開判断できる。',
      },
    ],
    verification: { method: 'connector compare-and-set plan・1動画worker・余剰worker no-op・exact-case branch・認証分離契約試験', evidence: 'tests/timestamp_harness_test.py' },
    traces: {
      design: ['docs/design/generated/system.gen.md', '.agents/skills/run-timestamp-work-harness/references/workflow.md'],
      implementation: ['.agents/skills/run-timestamp-work-harness/scripts/harness.py', '.agents/skills/run-timestamp-work-harness/SKILL.md'],
      tests: ['tests/timestamp_harness_test.py'],
      standards: ['spec/sources/owner-directive-2026-08-11-timestamp-distributed-workers.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260811-timestamp-distributed-workers',
  },
  {
    id: 'V8-OPS-022',
    revision: 2,
    status: 'active',
    scope: 'project',
    category: 'nonfunctional',
    type: 'operational',
    title: '1つのWorkセッションは1 Solと10 Lunaでタイムスタンプを並列処理しSolが最終確認しなければならない',
    subject: 'diopside v8のタイムスタンプオーケストレーション',
    action: 'satisfy',
    object: '1つのChatGPT Workセッションでタイムスタンプを並列処理する場合、親をGPT-5.6 Sol、子をGPT-5.6 Luna mediumの10論理レーンとして構成し、Lunaは1動画の一時素材取得・候補作成・独立一次確認だけを行わなければならない。利用可能な同時threadが10未満でも10個のlane slotを維持してqueueから波状実行し、Lunaの回復可能失敗は親Solが同じ動画を引き取らなければならない。親Solが候補hashと全編根拠と確認結果を最終確認した後だけ1動画draft PRと対象台帳行を確定しなければならない。',
    rationale: '反復的で明確な動画処理を高速なLunaへ分散し、回復処理、共有GitHub・台帳書込み、高価値の最終判断をSolへ一元化することで、人の継続入力、競合、未確認候補、素材取得の一時失敗による放置を減らすため。',
    source_refs: ['spec/sources/owner-directive-2026-08-11-sol-luna-orchestration.md', 'spec/sources/owner-directive-2026-08-11-timestamp-campaign-resilience.md', 'user:2026-08-11'],
    acceptance_criteria: [
      {
        id: 'AC-V8-OPS-022-1',
        given: '1つのWorkチャットで複数の適格動画を処理する明示要求がある',
        when: '親Solが1波を計画して子agentへ割り当てる',
        then: '10個の論理lane slotがGPT-5.6 Luna mediumへ固定され、対象不足のslotはinactive_no_targetとなり、各active Lunaは異なるclaim済み動画を最大1件だけ処理し、同時thread上限が低い場合はqueueから波状実行する。',
      },
      {
        id: 'AC-V8-OPS-022-2',
        given: 'Lunaが候補、事実確認、編集確認、決定的検証結果を返した',
        when: '正本化、PR最終commit、台帳同期へ進む',
        then: '親GPT-5.6 Solが同じ候補hashと全編根拠を最終確認したpass記録がない候補を拒否し、GitHubとGoogle Sheetsへの確定書込みをLunaへ行わせない。',
      },
      {
        id: 'AC-V8-OPS-022-3',
        given: '1波のLunaがcomplete、needs_sol_recovery、または安全上のblockedへ到達し、有限対象が残っている',
        when: 'キャンペーン期限前に次の処理を判断する',
        then: '親Solがneeds_sol_recoveryを先に引き取り、人の追加入力を待たず次の10レーンを計画し、対象枯渇、期限のdrain、または全体権限・安全blockまで継続する。',
      },
    ],
    verification: { method: 'agent設定・10レーン計画・Lunaモデル固定・Sol最終確認gate・共有書込み境界試験', evidence: 'tests/timestamp_harness_test.py' },
    traces: {
      design: ['docs/design/generated/system.gen.md', '.agents/skills/run-timestamp-work-harness/references/workflow.md'],
      implementation: ['.codex/agents/timestamp-luna-worker.toml', '.agents/skills/run-timestamp-work-harness/scripts/harness.py', '.agents/skills/run-timestamp-work-harness/SKILL.md'],
      tests: ['tests/timestamp_harness_test.py'],
      standards: ['spec/sources/owner-directive-2026-08-11-sol-luna-orchestration.md', 'spec/sources/owner-directive-2026-08-11-timestamp-campaign-resilience.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260811-timestamp-campaign-resilience',
  },
  {
    id: 'V8-OPS-023',
    revision: 1,
    status: 'active',
    scope: 'project',
    category: 'nonfunctional',
    type: 'operational',
    title: '公開動画の証拠取得は到達性診断から無料のbatch-local ASRまで段階的に回復しなければならない',
    subject: 'diopside v8のタイムスタンプ証拠取得',
    action: 'satisfy',
    object: '公開動画のタイムスタンプ証拠取得に失敗した場合、親Solは認証情報を使わないYouTube到達性診断、公開日本語字幕の上限付き再試行、公開native音声、yt-dlpによるMP3変換、無料のbatch-local ASRを順に試さなければならない。private、member-only、年齢制限、削除済み等の安全分類と試行結果だけをignored stateへ保存し、生字幕、音声、文字起こし、チャット本文をGit、PR、台帳へ保存してはならない。',
    rationale: '公開素材の一時的な取得失敗を即時の処理不能へ誤分類せず、無料かつ認証回避のない代替経路で完了可能性を高めながら、証拠と個人情報を公開面から分離するため。',
    source_refs: ['spec/sources/owner-directive-2026-08-11-timestamp-campaign-resilience.md', 'user:2026-08-11'],
    acceptance_criteria: [
      {
        id: 'AC-V8-OPS-023-1',
        given: '公開動画の字幕または音声取得が一時的に失敗する',
        when: '親Solが証拠取得の回復処理を行う',
        then: '到達性診断、字幕再試行、native音声、MP3、batch-local ASRを順に試し、前段が成功した時点で後段を省略する。',
      },
      {
        id: 'AC-V8-OPS-023-2',
        given: '公開取得経路が利用不能である',
        when: '診断と回復処理の結果を永続化する',
        then: '安全な分類、試行回数、経路、結果、diagnostic digestだけをignored stateへ保存し、生素材をGit、PR、台帳へ含めない。',
      },
      {
        id: 'AC-V8-OPS-023-3',
        given: 'ローカルASR依存関係またはモデルが未導入である',
        when: '親Solが最後の無料回復経路を実行する',
        then: '依存関係とモデルをbatch root配下のignored directoryへ導入し、global環境、有料API、認証回避を使用しない。',
      },
    ],
    verification: { method: 'YouTube診断・字幕再試行・native/MP3 fallback・batch-local ASR・公開禁止物検査', evidence: 'tests/timestamp_harness_test.py, tests/timestamp_tools_test.py' },
    traces: {
      design: ['docs/operations/manual-content-update.md', '.agents/skills/prepare-stream-evidence/references/local-asr.md', '.agents/skills/run-timestamp-work-harness/references/workflow.md'],
      implementation: ['.agents/skills/prepare-stream-evidence/scripts/diagnose_youtube_access.py', '.agents/skills/prepare-stream-evidence/scripts/download_captions.py', '.agents/skills/prepare-stream-evidence/scripts/download_audio.py', '.agents/skills/prepare-stream-evidence/scripts/transcribe_local_asr.py', '.agents/skills/run-timestamp-work-harness/scripts/harness.py'],
      tests: ['tests/timestamp_harness_test.py', 'tests/timestamp_tools_test.py'],
      standards: ['spec/sources/owner-directive-2026-08-11-timestamp-campaign-resilience.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260811-timestamp-campaign-resilience',
  },
  {
    id: 'V8-OPS-024',
    revision: 1,
    status: 'active',
    scope: 'project',
    category: 'nonfunctional',
    type: 'operational',
    title: '回復可能な実行・意味構成失敗はSolへ引き継ぎ台帳の処理不能へ確定してはならない',
    subject: 'diopside v8のタイムスタンプ失敗回復',
    action: 'satisfy',
    object: 'Lunaが字幕、音声、ASR、codex exec、意味構成、確認、決定的検証で回復可能な失敗へ到達した場合、needs_sol_recoveryとして親Solへ返し、親SolはGPT-5.6 Sol highで同じ動画を回復しなければならない。codex execのtrusted-destination結果は上限付きで再試行し、全編日本語字幕があるのに章候補を構成できない場合は素材不足ではなく意味構成失敗として扱わなければならない。期限内に回復できない場合はdeferred_recovery checkpointを残し、Google Sheetsへ処理不能を書いてはならない。',
    rationale: '子agentや一時実行環境の能力・接続失敗を動画固有の処理不能と混同せず、親の強いモデルと回復経路を使って完了まで押し進め、期限後も安全に再開できるようにするため。',
    source_refs: ['spec/sources/owner-directive-2026-08-11-timestamp-campaign-resilience.md', 'user:2026-08-11'],
    acceptance_criteria: [
      {
        id: 'AC-V8-OPS-024-1',
        given: 'Lunaが回復可能な証拠取得、codex exec、意味構成、確認、または検証失敗へ到達する',
        when: 'Lunaの1動画処理が終了する',
        then: 'blockedや台帳の処理不能ではなくneeds_sol_recoveryを返し、親Solが同じbatch、wave、video、branch、Draft PRを引き継ぐ。',
      },
      {
        id: 'AC-V8-OPS-024-2',
        given: 'codex execがtrusted-destinationを返す、または全編日本語字幕から章候補を構成できない',
        when: '親Solが回復処理を行う',
        then: 'trusted-destinationは上限付き再試行し、意味構成失敗はGPT-5.6 Sol highで再実行して素材不足と区別する。',
      },
      {
        id: 'AC-V8-OPS-024-3',
        given: 'campaignのdrain期限までに回復可能失敗を解消できない',
        when: '親Solが最終状態と台帳更新可否を判定する',
        then: 'safe reasonと再開情報を持つdeferred_recovery checkpointをignored stateへ残し、当該動画をGoogle Sheetsの処理不能へ更新せず、他動画の処理を継続する。',
      },
    ],
    verification: { method: 'trusted-destination再試行・Luna回復委譲・Sol high fallback・drain checkpoint・台帳書込みgate試験', evidence: 'tests/timestamp_harness_test.py' },
    traces: {
      design: ['docs/design/generated/system.gen.md', '.agents/skills/run-timestamp-work-harness/references/workflow.md', '.agents/skills/run-timestamp-work-harness/references/web-work-prompt.md'],
      implementation: ['.codex/agents/timestamp-luna-worker.toml', '.agents/skills/run-timestamp-work-harness/scripts/harness.py', '.agents/skills/run-timestamp-work-harness/SKILL.md'],
      tests: ['tests/timestamp_harness_test.py'],
      standards: ['spec/sources/owner-directive-2026-08-11-timestamp-campaign-resilience.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260811-timestamp-campaign-resilience',
  },
  {
    id: 'V8-OPS-026',
    revision: 1,
    status: 'active',
    scope: 'project',
    category: 'nonfunctional',
    type: 'operational',
    title: '最大1000件のWork campaignは固定manifestと安全なremote checkpointで実行環境をまたいで継続しなければならない',
    subject: 'diopside v8の大規模タイムスタンプcampaign',
    action: 'satisfy',
    object: '最大1000件のタイムスタンプcampaignは開始時に対象動画ID、順序、台帳行指紋、base commitを一度だけ固定し、10件ずつ処理しなければならない。各Work実行のdrain前と各wave後に、生字幕、音声、文字起こし、chat本文、識別子、資格情報を含まない安全なcheckpointを専用GitHub campaign branchへ観測済み親commitを条件として保存し、Work環境消失または利用制限後は同じcampaign IDを復元して完了済みを保持し未完了だけを安全な工程から再開しなければならない。',
    rationale: '単一Work実行の時間・利用量・ローカル状態保持へ1000件の完了可能性を依存させず、旧連続queueと同等の対象固定、失敗隔離、再開性を保ちながら生素材の公開を防ぐため。',
    source_refs: ['spec/sources/owner-directive-2026-08-12-thousand-video-campaign.md', 'user:2026-08-12'],
    acceptance_criteria: [
      {
        id: 'AC-V8-OPS-026-1',
        given: '1000件までの適格動画を処理する明示要求と対象動画台帳snapshotがある',
        when: '親Solがcampaignを初期化し100wave以上を計画する',
        then: '対象順序と行指紋をimmutable manifestへ一度だけ固定し、各waveは未変更manifestの連続する最大10件だけを重複なく割り当てる。',
      },
      {
        id: 'AC-V8-OPS-026-2',
        given: 'waveが終端した、drainへ入る、または利用制限で停止する',
        when: '親Solがcampaign checkpointを永続化する',
        then: '専用remote branchを観測済み親commitとのcompare-and-setで更新し、生素材と資格情報を含めず、競合時はforceせずremoteを再読する。',
      },
      {
        id: 'AC-V8-OPS-026-3',
        given: '別のWork環境で同じcampaignを再開する',
        when: '親Solがremote checkpointを検証してrestoreする',
        then: '完了済み状態を保持し、処理途中だけを安全な回復境界へ巻き戻し、同じcampaign IDと固定対象の残りを継続する。',
      },
      {
        id: 'AC-V8-OPS-026-4',
        given: '1000件のsynthetic manifest、101以上のwave、または途中kill後のcheckpointがある',
        when: '耐久・復元試験を実行する',
        then: '対象の欠落・重複・完了状態の回帰・生素材のcheckpoint混入がなく、次waveを決定的に再計画できる。',
      },
    ],
    verification: { method: '1000件manifest・101wave境界・checkpoint漏えい禁止・kill/restore・楽観ロックaction試験', evidence: 'tests/timestamp_harness_test.py' },
    traces: {
      design: ['docs/design/generated/system.gen.md', '.agents/skills/run-timestamp-work-harness/references/workflow.md'],
      implementation: ['.agents/skills/run-timestamp-work-harness/scripts/harness.py', '.agents/skills/run-timestamp-work-harness/SKILL.md'],
      tests: ['tests/timestamp_harness_test.py'],
      standards: ['spec/sources/owner-directive-2026-08-12-thousand-video-campaign.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260812-thousand-video-campaign',
  },
];
const synopsisHarnessRequirements = [
  {
    id: 'V8-OPS-025',
    revision: 1,
    status: 'active',
    scope: 'project',
    category: 'nonfunctional',
    type: 'operational',
    title: 'Work用あらすじ処理は1 Sol・10 Lunaと候補hash gateで有限対象を継続しなければならない',
    subject: 'diopside v8のあらすじ運用',
    action: 'satisfy',
    object: 'ChatGPT Workから開始する未作成あらすじcampaignは、親GPT-5.6 SolとGPT-5.6 Luna mediumの10論理レーンとして構成し、最新mainの正本にあらすじがない公開動画だけを原子的にclaimしなければならない。Lunaはclaim済み1動画の一時全編根拠、候補、独立確認、決定的検証だけを行い、親Solだけが現在の候補hashを最終確認して1動画draft PRとあらすじ作業台帳を確定しなければならない。',
    rationale: '長時間の全編確認と反復的な候補作成をLunaへ分散しながら、既存あらすじの上書き、未確認候補の正本化、共有先の競合、動画単位の失敗によるcampaign停止を防ぐため。',
    source_refs: ['spec/sources/owner-directive-2026-08-11-synopsis-work-harness.md', 'user:2026-08-11'],
    acceptance_criteria: [
      {
        id: 'AC-V8-OPS-025-1',
        given: '最新mainと対象動画・あらすじ作業台帳のsnapshotがある',
        when: '親Solが1波を計画する',
        then: '既存あらすじ、除外、処理中、既存draft PRを除き、exact-case動画branchを原子的claimとする重複しない最大10論理レーンをGPT-5.6 Luna mediumへ割り当てる。同時thread上限が低い場合も同じ10レーンを波状実行する。',
      },
      {
        id: 'AC-V8-OPS-025-2',
        given: 'Lunaが全編coverage、候補、独立三確認、決定的validatorを返した',
        when: '正本化、PR最終commit、台帳更新へ進む',
        then: '親GPT-5.6 Solが同じcandidate hashへ合格を記録していない候補を拒否し、LunaによるGitHub・Google Sheets書込みと既存あらすじの上書きを拒否する。',
      },
      {
        id: 'AC-V8-OPS-025-3',
        given: '1波の各動画がcompleteまたは理由付きblockedとなった',
        when: '台帳再読を完了し期限前に適格動画が残る',
        then: '人の追加入力を待たず次のwaveを計画し、対象枯渇、期限のdrain、または全体権限・安全blockまで継続する。行指紋が変わった動画だけをledger conflictとして分離する。',
      },
    ],
    verification: {
      method: '10レーン計画・既存あらすじ除外・全編coverage・独立review hash・Sol gate・台帳行競合試験',
      evidence: 'tests/synopsis_harness_test.py',
    },
    traces: {
      design: ['docs/design/generated/system.gen.md', '.agents/skills/run-synopsis-work-harness/references/workflow.md'],
      implementation: ['.codex/agents/synopsis-luna-worker.toml', '.agents/skills/run-synopsis-work-harness/scripts/harness.py', '.agents/skills/run-synopsis-work-harness/scripts/validate_dossier.py', '.agents/skills/run-synopsis-work-harness/SKILL.md'],
      tests: ['tests/synopsis_harness_test.py'],
      standards: ['spec/sources/owner-directive-2026-08-11-synopsis-work-harness.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260811-synopsis-work-harness',
  },
];
const workPageRequirements = [
  {
    id: 'V8-DISPLAY-012',
    revision: 1,
    status: 'active',
    scope: 'product',
    category: 'functional',
    type: 'functional',
    title: '作品タグは公式紹介付きの作品別動画一覧へ移動できなければならない',
    subject: 'diopside v8の作品タグと作品ページ',
    action: 'satisfy',
    object: '動画詳細の作品タグは、その作品タグを持つ公開動画の一覧ページへ移動できなければならない。ゲーム作品ページは、確認日を持つ短い公式説明の引用、引用元名、HTTPSの公式ページリンクを表示し、外部ページは利用者がリンクを押した場合だけ開かなければならない。',
    rationale: '同じゲームや作品の配信を連続して探せるようにし、作品を知らない利用者にも出典を明示した一次情報で概要を伝えるため。',
    source_refs: ['spec/sources/owner-directive-2026-08-15-work-pages.md', 'user:2026-08-15'],
    acceptance_criteria: [
      {
        id: 'AC-V8-DISPLAY-012-1',
        given: '動画詳細に作品分類の承認済みタグが表示されている',
        when: '利用者が作品タグを押す',
        then: '不変タグIDをURLに持つ作品ページへ移動し、そのタグを持つ公開動画だけを公開日の新しい順で表示する。',
      },
      {
        id: 'AC-V8-DISPLAY-012-2',
        given: 'ゲーム作品タグに確認済みの公式紹介が登録されている',
        when: '作品ページを表示する',
        then: '短い引用、引用元名、確認日、HTTPSの公式ページリンクを表示し、ページ表示だけでは外部サイトへ通信しない。',
      },
      {
        id: 'AC-V8-DISPLAY-012-3',
        given: '公式紹介をまだ登録していない作品タグがある',
        when: '作品ページを表示する',
        then: '根拠のない紹介文を生成せず確認中と示し、作品別動画一覧は利用できる。',
      },
    ],
    verification: {
      method: '公開データ構造試験、作品タグ遷移E2E、公式リンク・引用表示・外部自動通信禁止試験',
      evidence: 'tests/content-validation.test.ts, tests/generated.test.ts, src/features/works/WorkDetailPage.test.tsx, e2e/detail.spec.ts',
    },
    traces: {
      design: ['docs/design/generated/system.gen.md'],
      implementation: ['content/works/work-introductions.json', 'scripts/build-public-data.ts', 'src/features/detail/VideoDetailPage.tsx', 'src/features/works/WorkDetailPage.tsx'],
      tests: ['tests/content-validation.test.ts', 'tests/generated.test.ts', 'src/features/works/WorkDetailPage.test.tsx', 'e2e/detail.spec.ts'],
      standards: ['spec/sources/owner-directive-2026-08-15-work-pages.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260815-work-pages',
  },
];
const collaborationPageRequirements = [
  {
    id: 'V8-DISPLAY-013',
    revision: 1,
    status: 'active',
    scope: 'product',
    category: 'functional',
    type: 'functional',
    title: '人物名とコンビ・ユニットのタグから出典・YouTube導線付き動画一覧へ移動できなければならない',
    subject: 'diopside v8のコラボ相手タグとコンビ・ユニットページ',
    action: 'satisfy',
    object: '動画詳細のコラボ相手タグとコンビ・ユニットタグは押下可能でなければならない。人物ページはYouTubeチャンネルアイコン、人物名、YouTubeチャンネルリンク、その人物との公開動画を表示する。コンビ・ユニットページは出典付きの説明、全メンバーのアイコン・人物名・YouTubeチャンネルリンク、その名称を持つ公開動画を表示する。ページ表示だけで外部サイトへ通信してはならない。',
    rationale: 'コラボ動画を相手や定着した組み合わせから連続して探し、名称だけを知らない利用者も人物と関係を視覚的に把握できるようにするため。',
    source_refs: ['spec/sources/owner-directive-2026-08-15-collaboration-pages.md', 'user:2026-08-15'],
    acceptance_criteria: [
      {
        id: 'AC-V8-DISPLAY-013-1',
        given: '動画詳細に白雪巴以外の人物名タグが表示されている',
        when: '利用者が人物タグを押す',
        then: '人物アイコン、人物名、YouTubeチャンネルリンク、その人物タグを持つ公開動画だけを新しい順で表示する。',
      },
      {
        id: 'AC-V8-DISPLAY-013-2',
        given: '動画詳細に確認済みのコンビ・ユニットタグが表示されている',
        when: '利用者がコンビ・ユニットタグを押す',
        then: '参考元と確認日を持つ説明、全メンバーのアイコン・人物名・各YouTubeチャンネルリンク、そのタグを持つ公開動画を表示する。',
      },
      {
        id: 'AC-V8-DISPLAY-013-3',
        given: '人物またはコンビ・ユニットページを表示する',
        when: 'ブラウザの通信先を検査する',
        then: '保存済みローカルアイコンだけを読み、利用者が外部リンクを押すまでYouTubeまたは参考元へ通信しない。',
      },
    ],
    verification: {
      method: '公開データ構造・人物名・コンビ説明・メンバーリンク・ローカルアイコン・外部自動通信禁止試験',
      evidence: 'tests/content-validation.test.ts, tests/generated.test.ts, src/features/collaborations/CollaborationDetailPages.test.tsx, e2e/detail.spec.ts',
    },
    traces: {
      design: ['docs/design/generated/system.gen.md'],
      implementation: ['content/people/collaboration-profiles.json', 'scripts/build-public-data.ts', 'src/features/detail/VideoDetailPage.tsx', 'src/features/collaborations/CollaboratorDetailPage.tsx', 'src/features/collaborations/GroupDetailPage.tsx'],
      tests: ['tests/content-validation.test.ts', 'tests/generated.test.ts', 'src/features/collaborations/CollaborationDetailPages.test.tsx', 'e2e/detail.spec.ts'],
      standards: ['spec/sources/owner-directive-2026-08-15-collaboration-pages.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260815-collaboration-pages',
  },
];
const canonicalRequirements = [
  ...requirements,
  ...ownerDirectiveRequirements,
  ...timestampHarnessRequirements,
  ...synopsisHarnessRequirements,
  ...workPageRequirements,
  ...collaborationPageRequirements,
];

mkdirSync(path.dirname(specPath), { recursive: true });
writeFileSync(specPath, `${JSON.stringify({
  schema_version: 1,
  catalog_revision: 11,
  product: 'diopside v8',
  updated_at: '2026-08-15',
  requirements: canonicalRequirements,
}, null, 2)}\n`);
writeFileSync(mapPath, `${JSON.stringify({
  schemaVersion: 1,
  source: 'https://github.com/tsuji-tomonori/diopside-v8/issues/1',
  count: requirements.length,
  mappings: sourceRequirements.map((item) => ({
    sourceId: item.sourceId,
    canonicalId: canonicalId(item.sourceId),
    priority: item.priority,
  })),
}, null, 2)}\n`);

console.log(`Issue #1由来${requirements.length}件と所有者指示${ownerDirectiveRequirements.length + timestampHarnessRequirements.length + synopsisHarnessRequirements.length + workPageRequirements.length + collaborationPageRequirements.length}件の要件正本を生成しました。`);
