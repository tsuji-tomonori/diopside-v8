---
name: chat-first-development
description: Complete features, fixes, refactors, and design work from natural-language requests. Select the execution profile, maintain durable requirements, generate as-built design, record selected checks and a structured commit, and keep CI results external.
---

# Chat-first Development

ordinary natural-language conversationを唯一の利用者インターフェースとし、成果に必要な最小十分な経路を選ぶ。

## 既定成果物

すべてのrepository変更で次を残す。

1. 実際のコード、設定、テスト、要件、設計等の成果物
2. `docs/reference/commit-message.md`に従うCommit Comment
3. 選択チェック結果`governance/reviews/<change-id>.yaml`
4. GitHub Actions等の外部サービスにあるCI結果

恒久的な`work/<id>/`、変更ごとの実行計画、implementation log、test reportは既定では作らない。

一時実行状態が必要な場合だけ`.devflow/run/`へ置き、Git管理せず、変更完了後に削除する。directとassuredで日付+slug計画書、固定template、段階status更新を必須にしない。

## Workflow

1. ユーザーの要求とrepositoryを確認し、結果を変える曖昧さだけを質問する。
2. `$right-size-execution`で`direct`、`assured`、`regulated`を選ぶ。
3. 要件影響と設計影響を仮判定する。
4. 永続要件が変わる場合だけ`$maintain-canonical-requirements`を使う。
5. `governance/checks/catalog.yaml`から変更固有のcheckを選択し、未選択項目をN/Aにしない。as-built設計、API、SQL、sample、E2E、coverage、定量閾値に触れる場合は`verify-against-engineering-standards/references/as-built-design-check-selection.md`を参照する。
6. 実装し、repositoryのtask runnerから対象範囲のformat、lint、type、test、生成物checkと選択された整合checkを実行する。全gateを無条件に実行しない。
7. FastAPI、CDKその他の宣言済み対象では`$generate-implementation-design`で`docs/design/generated/`のas-built設計を生成し、check modeでdriftを検査する。
8. PR前に`$inspect-quality-gates`で選択checkを確認し、review YAMLを保存する。
9. `$japanese-git-commit-gitmoji`で構造化Commit Commentを作成する。
10. PRを作成し、現在HEADのGitHub Actionsを確認する。CIログをrepositoryへ複製しない。
11. blocking failを修正し、advisoryは修正、Issue化、残存リスクのいずれかへ収束させる。
12. 成功後は追加探索を止める。

## Profile

### direct

次を満たす局所変更。

- 可逆
- 外部副作用なし
- 認証・認可、個人情報、データ損失へ影響しない
- 公開契約、DB schema、IaCの重大変更なし

対象test、build、lint、type check、生成物driftだけを実行する。初回承認、work item、独立reviewer、全repository scanは要求しない。

### assured

次のいずれかへ影響する変更。

- 複数module
- 公開API・event契約
- DB schema・migration
- IaC
- dependency・lockfile
- 共有component
- 重要なUI flow
- generator・永続要件・governance

影響固有のRisk-selected checkと、必要なrelated testを追加する。独立reviewerは高影響、oracle不足、検証失敗時だけ使う。

### regulated

次のいずれかに該当する変更。

- 認証・認可
- 個人情報・機密情報
- データ損失
- productionの不可逆操作
- 法令・契約上の統制
- 高額操作
- 明示的に高保証workflowが指定された

この場合だけ`$govern-development-request`、`$author-lifecycle-docs`、`$authorize-autonomous-execution`、hash chain、工程監査を使用できる。

## Requirement impact

外部挙動、業務ルール、受入条件、非機能閾値、権限要求が変わる場合だけ永続要件を更新する。

framework、language、database、architecture、tool、path、process、工程、成果物が依頼に含まれるだけでは要件影響ありとしない。underlying outcome、quality of service、権限ある永続制約、または親要件・承認済みdecisionから下位scopeへflow downする義務が変わる場合だけ`$maintain-canonical-requirements`を使う。

今回だけの実装指示や可逆な選択はcurrent contextまたは実装へ委任する。長期architecture choiceはADR、実装済み構造は生成設計へ置く。exact technologyまたはproject processを永続化する場合は、必要性、authority、lifetime、scope、verificationを確認する。

判定はCommit Commentへ必ず記録する。

## Design impact

実装由来生成設計、ADR、公開契約、data model、resource、恒久的な開発・運用構成への影響を判定し、Commit Commentへ必ず記録する。

詳細設計を手書きで複製しない。コードから生成できない長期判断だけADRにする。

## Check result

`governance/reviews/<change-id>.yaml`には選択されたcheckだけを保存する。

- `Invariant`: trigger該当時はPass必須
- `Risk-selected`: 選択された場合だけblocking
- `Advisory`: 修正、Issue化、残存リスクとして明示できる
- `Periodic`: 個別PRではなく定期監査で扱う

CI実行結果は外部サービスを正本とし、YAMLにはcheck名や証拠pathだけを書く。

## Interaction contract

- 利用者へSkill名、work item、command、test実行を要求しない。
- 可逆な実装判断を質問へ変えない。
- 利用者がnamed solutionを例示または指定しても、current-task instructionとdurable requirementを自動的に同一視しない。
- 通常変更へ一律の初回承認を要求しない。公開API変更は`assured`としてRisk-selected checkを追加し、公開APIであることだけを承認理由にしない。
- 外部書込み、不可逆操作、production、公開、merge、高額操作、regulated条件など実在するauthority boundaryで明示承認を求める。
- 未確実性だけを理由に作業を停止しない。

## Safety boundaries

- secrets、個人情報、production dump、生ログをGitへ入れない。
- 明示権限なしにproduction deploy、merge、削除、高額操作を行わない。
- 対象repositoryの既存指示、build、test、commit規約を優先する。
- gateを通すためにtest、型、lint、security controlを弱めない。
