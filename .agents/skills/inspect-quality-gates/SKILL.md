---
name: inspect-quality-gates
description: Inspect only checks selected for the current change and timing. Record decisions in governance/reviews/<change-id>.yaml, keep CI results external, and use legacy phase gates only for regulated work.
---

# Inspect Quality Gates

選択されたcheckだけを、変更イベントに応じた時点で確認する。

## 既定の証跡

- review判断: `governance/reviews/<change-id>.yaml`
- check定義の正本: `governance/checks/catalog.yaml`
- automated result: GitHub Actions等の外部サービス
- requirement / design impact: Commit Comment
- implementation evidence: code、test、生成設計、ADR、Git diff

変更ごとのtest report、implementation log、release reportは作らない。

## Check class

### Invariant

triggerに該当した場合はPass必須。Failを残したままmergeしない。

例:

- secretsや個人情報をGitへ入れない
- 必要な対象test、build、type checkが実行される
- 認可境界を迂回しない
- 未承認の不可逆操作を行わない
- 生成物と生成元が一致する
- Commit Commentに要件・設計影響がある

### Risk-selected

変更のrisk、artifact、pathから選択された場合だけblocking。

例:

- API compatibility
- migration / rollback
- IaC replacement
- dependency integrity
- keyboard / focus
- independent security review

### Advisory

その変更で確認する価値はあるが、単独ではmergeを停止しない。

- 修正する
- Issue化する
- residual riskへ記載する

のいずれかへ収束させる。

## Timing

### 変更開始前: Impact Check

確認するもの:

- profile
- requirement impact
- design impact
- authority impact
- public contract、DB、IaC、dependency、security trigger
- selected check

この時点で全checkのPass/N/Aを記録しない。

### 実装中: Fast Feedback Check

自動検査を小さい変更スライスごとに実行する。

- targeted test
- build / syntax
- lint / type check
- generated drift
- secret scan
- contract diff、SQL parse、synth等の選択check

結果の正本は外部CIとし、repositoryへログを複製しない。

### PR作成前: Affected-scope Check

- requirement / design impactの判定と差分が一致する
- 受入条件へ対応するtestがCIで実行される
- selected checkのresultと証拠がある
- blocking failがない
- advisoryの扱いが決まっている
- review YAMLがschemaに適合する
- Commit Commentの必須節が埋まっている

### Merge前: Revision Integrity Check

- CIが現在HEADを対象としている
- 生成物が最新
- blocking failがない
- advisoryとresidual riskの扱いが明示されている
- squash後のCommit Commentに証跡が残る
- merge、release、deployが権限境界内

過去の全工程を最初から再検査しない。HEAD変更で無効化された証拠だけを再確認する。

### Deploy後: Operational Check

production deploy、migration、外部書込みがある場合だけ実施する。

- deploy status
- smoke test
- migration status
- monitoring
- rollback / roll-forward判断

結果はdeployment service、monitoring service、GitHub Actions等へ残す。

### 定期: Governance Audit

個別PRから分離して次を確認する。

- false blocker
- escaped defect
- selector miss
- Skill・hookの指示競合
- 不要成果物
- standard registryの鮮度
- token / tool / reviewerコスト
- advisory滞留

## Review result rules

### Pass

直接証拠が必要。CIの場合はworkflow名またはrequired check名と、検証対象となるtest・設定への参照を記録する。生ログは保存しない。

### N/A

selectorで選ばれた後、具体的事実により適用外と判明した場合だけ使用する。noteを必須とする。

### Fail

- Invariantとblocking Risk-selectedは修正する。
- Advisoryは修正、Issue、residual riskのいずれかを記録する。
- その場で修正するFailへ一律にIssue、期限、責任者を要求しない。

## Regulated compatibility

`regulated` profileでは、既存の`tools/devflow.py`によるphase gate、承認、hash chain、監査を追加できる。このlegacy harnessを`direct`または`assured`へ強制しない。

## Completion

- `python governance/reviews/validate.py --root . --commit HEAD`が成功する。
- review YAMLがschemaに適合する。
- trigger該当のInvariantがすべてPass。
- 選択したblocking Risk-selectedがすべてPass。
- Advisoryの扱いが決まっている。
- CI結果をrepositoryへ複製していない。
- Commit Commentの要件影響、設計影響、review path、検証契約が完成している。
