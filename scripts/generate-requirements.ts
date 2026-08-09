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
    requirement.revision = 2;
    requirement.title = '1回の明示要求で固定した有限の適格タイムスタンプ対象集合を、全件が終端結果へ到達するまで処理しなければならない';
    requirement.object = '1回の明示要求で固定した有限の適格タイムスタンプ対象集合は、各動画が1動画だけを対象とするPRのレビュー可能状態、または根拠を示した処理不能状態のいずれかへ到達するまで処理しなければならない。ある動画の失敗を理由に、集合内の未処理動画を停止してはならない。';
    requirement.source_refs.push('owner-directive:2026-08-08-timestamp-batch');
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
        then: '全動画がPRレビュー可能または理由付き処理不能の終端結果を持ち、処理不能動画があっても残りの動画を処理する。',
      },
    ];
    requirement.verification = {
      method: '対象集合の固定データ・一括処理の終端・失敗分離試験',
      evidence: 'tests/operations.test.ts, tests/timestamp_tools_test.py',
    };
    requirement.traces.implementation.push('.agents/skills/generate-stream-timestamps');
    requirement.traces.tests.push('tests/timestamp_tools_test.py');
    requirement.last_changed_by = 'OWNER-DIRECTIVE-2026-08-08-TIMESTAMP-BATCH';
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
  return requirement;
});

const ownerDirectiveRequirements = [
  {
    id: 'V8-DISPLAY-011',
    revision: 1,
    status: 'active',
    scope: 'product',
    category: 'functional',
    type: 'data',
    title: '動画詳細は、ネタバレを避けた100〜150字のあらすじを、白雪巴の特徴的なセリフで締めて表示しなければならない',
    subject: 'diopside v8の表示',
    action: 'satisfy',
    object: '全編根拠を確認できる動画の詳細は、視聴意欲を促しつつ結末、正体、勝敗等のネタバレを避けた日本語あらすじを表示しなければならない。本文と末尾の引用符付きセリフは合計100〜150文字とし、最後に対象配信で白雪巴が実際に発した特徴的なセリフを一つ置かなければならない。',
    rationale: '利用者が結末を知らずに動画の雰囲気と見どころを把握し、安心して視聴を選べるようにするため。',
    source_refs: ['spec/sources/owner-directive-2026-08-08-video-synopsis.md', 'user:2026-08-08'],
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
    ],
    verification: {
      method: 'あらすじ候補検証・公開データ検証・動画詳細画面試験・公開境界検査',
      evidence: 'src/domain/validation.test.ts, tests/content-validation.test.ts, e2e/detail.spec.ts',
    },
    traces: {
      design: ['docs/design/generated/system.gen.md'],
      implementation: [
        '.agents/skills/generate-video-synopses',
        'src/domain/content.ts',
        'src/domain/validation.ts',
        'scripts/build-public-data.ts',
        'src/features/detail/VideoDetailPage.tsx',
        'src/styles.css',
      ],
      tests: ['src/domain/validation.test.ts', 'tests/content-validation.test.ts', 'e2e/detail.spec.ts'],
      standards: ['Issue #1', 'spec/sources/owner-directive-2026-08-08-video-synopsis.md', 'dev-standard default profile'],
    },
    last_changed_by: 'CHG-20260808-add-video-synopses',
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
const canonicalRequirements = [...requirements, ...ownerDirectiveRequirements];

mkdirSync(path.dirname(specPath), { recursive: true });
writeFileSync(specPath, `${JSON.stringify({
  schema_version: 1,
  catalog_revision: 5,
  product: 'diopside v8',
  updated_at: '2026-08-08',
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

console.log(`Issue #1由来${requirements.length}件と所有者指示${ownerDirectiveRequirements.length}件の要件正本を生成しました。`);
