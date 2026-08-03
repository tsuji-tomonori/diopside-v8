---
name: maintain-canonical-requirements
description: Discover, classify, atomize, and persist durable product or project requirements when behavior, rules, acceptance, constraints, documentation, authority, support, or operations change. Maintain the JSON authority and generated human view.
---

# Maintain Canonical Requirements

会話から、今後も維持する必要がある要件だけを正本へ反映する。

## Authority

- `spec/requirements/requirements.json`: 永続要件の唯一の正本
- `docs/requirements/REQUIREMENTS.md`: 人向けの生成表示。直接編集しない
- `docs/standards/REQUIREMENT-CLASSIFICATION.md`: product / projectとfunctional / nonfunctionalの分類規則
- Commit Comment: その変更時点の要件影響、分類理由、適用したID
- Git履歴: add / update / retire差分の履歴

`work/<id>/`、変更ごとの要件文書、適用後の差分コピー、Markdown fileの存在を要件正本として使用しない。

## SWEBOK-aligned classification

要件を原子化する前に、次の二段階で分類する。

### Scope

- `product`: software、Skill、agent、generator、schema、CLI等が利用者またはconsumerへ提供する挙動、interface、品質、制約
- `project`: 開発、保守、review、配布、文書化、運用準備、証跡保持に課す義務

### Category

- `functional`: 主体が実行する能力、処理、変換、応答
- `nonfunctional`: 品質、閾値、制約、技術選択、process、deliverable、operational guarantee

現行catalogとの互換性のため、既存要件は`scope`と`category`を持たなくても有効とする。新規要件または意味を更新する要件では、可能な限り両方を明示する。片方だけを指定しない。

## Solution specificity gateの判定

framework、language、database、architecture style、tool、repository path、実装順、開発手法、工程、成果物を名指しする候補は、最初の文言をそのまま要件化しない。次を判定する。

1. **Underlying obligation**: その具体を外すと失われる利用者結果、observable behavior、quality of service、interoperability、法令・契約適合、安全性、運用保証。
2. **Necessity**: exact choiceが必要か、outcome、quality threshold、interface constraint、supported environmentへ戻せるか。
3. **Authority**: durableな利用者判断、consumer contract、public compatibility、法令・規制・安全義務、採用済み標準、repository policy、既存platform・hardware・protocol・migration・support境界、承認済みADRまたは親要件。例示、agentの提案、一般的best practiceだけでは不足する。
4. **Lifetime and scope**: current-task instructionか、将来も維持する義務か。system、product、project、subsystem、teamのどこへ適用するか。
5. **Placement**: outcome / quality / 外部制約は正本、可逆な実装選択は実装、長期architecture choiceはADR、実装済み構造は生成設計、今回だけの方法はcurrent context、下位拘束は親判断へtraceしたderived requirementへ置く。

利用者が具体技術を名指ししても、それだけでdurable requirementにはしない。今回の実装指示には従い得るが、可逆な選択はrepository conventionとsafe defaultへ委任し、追加質問や正本化を行わない。反対に、exact technology、architecture、process自体が権限ある永続制約なら、`source_refs`、必要性を示す`rationale`、`scope` / `category`、verificationを持たせる。

上位ではarchitecture decisionであっても、下位teamを拘束する場合はderived requirementになり得る。親requirement IDまたはADR path、適用scope、verificationへtraceし、stakeholder requirementとして上位へ過剰一般化しない。architecture上の発見からunderlying obligationを再分析してよいが、要件と設計のauthorityを混同しない。

## Documentation requirements

文書の存在、内容、品質、更新、配布、廃止を求める義務は、原則として次で管理する。

```json
{
  "scope": "project",
  "category": "nonfunctional"
}
```

例外は、help、error message、帳票、利用者向け説明等、その内容自体がproduct behaviorである場合である。

永続的なdocumentation requirementは、受入条件または検証情報として次を明確にする。

1. audience
2. purpose
3. authority
4. update trigger
5. verification
6. maintenance rule
7. retirement condition

文書pathは要件そのものではなく、`traces.design`または`traces.implementation`から到達する実現手段である。sampleは`assets/documentation-project-nfr.example.json`を参照する。

## 更新する条件

次のいずれかが変わる場合に使用する。

- 利用者向けの振る舞い
- 業務ルール
- 受入条件
- 非機能要求の閾値または制約
- 認証・認可・privacy要求
- support対象
- 運用上の保証
- projectの恒久的なprocessまたはdeliverable義務
- documentation requirement
- 明示的な禁止事項

通常は更新しない例:

- 外部挙動または恒久project義務を変えないrefactor
- test追加
- lint・type修正
- 既存要件へ戻すbug fix
- 生成文書だけの再生成
- CI・Skill・開発補助の変更でproduct / project requirementの意味が変わらない場合
- 今回だけの計画、調査メモ、implementation log、test result
- 永続理由のないnamed technology、architecture、tool、path、process、工程、成果物

具体的なsolutionが依頼に含まれるだけでは要件影響ありとしない。underlying outcome、quality threshold、権限ある永続制約、または親判断からflow downする義務が変わる場合だけ正本を更新する。

ただしCommit Commentには`要件影響: なし`と理由を必ず記録する。

## Conversation workflow

1. ユーザーの目的、対象、制約、例外、受入条件を確認する。
2. 今後も維持する義務と、今回だけの作業情報を分ける。
3. named technology、architecture、tool、path、process、工程、成果物を検出し、underlying obligation、necessity、authority、lifetime、scope、placementを判定する。
4. `product` / `project`と`functional` / `nonfunctional`を判定する。
5. 結果を変える曖昧さだけを一問で確認し、可逆な詳細はrepository conventionとsafe defaultへ委任する。
6. 一つの主体、一つの行為、一つの対象、一つの検証可能な義務へ原子化する。
7. exact choiceを保持する場合はsource、rationale、scope、verificationを、derived requirementでは親判断へのtraceを付与する。
8. 現在の正本と比較し、`add`、`update`、`retire`を作る。
9. base catalog revisionとitem revisionの競合を検査する。
10. 完全なcandidateを検証してから原子的に置換する。
11. 人向け文書を再生成し、byte driftを検査する。
12. requirement IDを実装、test、文書、必要な生成設計へ接続する。
13. Commit Commentの要件影響節へ、判定、分類、ID、solution specificityの理由を記録する。

承認が必要なのは、要件の意味、外部副作用、権限境界、不可逆性が新しく変わる場合だけである。trace path、実装順序、使用tool、test file名の変更を要件承認の失効理由にしない。

## Atomicity

- 一つのrequirement IDに独立した複数義務を入れない。
- acceptance criteriaを必須とする。
- IDと履歴を維持する。
- 削除は`retire`とし、過去の正本を消さない。
- stale catalog revisionとpartial updateを拒否する。
- consequenceの大きいproduct choiceまたはproject constraintを黙って推測しない。
- solution-only prescriptionをunderlying outcomeまたは権限あるconstraintなしに永続化しない。
- current-task instruction、reversible implementation choice、ADR、as-built design、derived requirementを正しいartifactへ分ける。
- derived requirementは親要件または承認済みdecisionと下位scopeへtraceする。
- `scope`または`category`を使用する場合は両方を指定する。
- 文書fileとdocumentation requirementを同一視しない。

## Temporary proposal

承認前の差分を一時保存する必要がある場合だけ`.devflow/run/<change-id>/requirements-delta.json`を使用できる。この領域はGit管理せず、正本適用後に削除する。

## Completion

- 正本がschemaに適合する。
- add / update / retireが競合なく適用される。
- 新規または意味更新した要件のscopeとcategoryが明確である。
- named solutionを含む候補でnecessity、authority、lifetime、scope、placementが判定されている。
- 可逆なsolution choiceが正本へ固定されず、exact choiceを保持する場合はsource、rationale、scope、verificationを持つ。
- derived requirementが親要件またはdecisionへtraceされ、上位scopeへ過剰一般化されていない。
- documentation requirementがaudience、authority、trigger、verification、retirementを持つ。
- 人向け文書が正本から再生成される。
- requirement IDが実装・test・文書・必要な生成設計へ到達できる。
- Commit Commentへ要件影響、分類、ID、理由が記録される。
- 一時差分が正本として残っていない。
