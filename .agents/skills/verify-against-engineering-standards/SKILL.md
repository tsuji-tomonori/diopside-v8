---
name: verify-against-engineering-standards
description: Verify only standards and official guidance relevant to the change. Classify controls, record selected decisions in review YAML, keep execution results external, and avoid universalizing all guidance.
---

# Verify Against Engineering Standards

SWEBOK、cloud Well-Architected、security、accessibility等を、正本要件を上書きしない独立した品質レンズとして使用する。

## 原則

- 標準は案件文脈に応じて適用する。
- 完全準拠や認証を、checklist確認だけから主張しない。
- 全カタログをpromptへ入れない。
- 全PRで出典鮮度を調査しない。
- 同じriskを扱う重複controlは証拠を共有する。
- 未選択controlをN/Aとして保存しない。

## Control class

### Invariant

triggerに該当した場合、必ず満たす必要がある少数の境界。

例:

- secret、PII、production dumpをGitへ含めない
- 認可境界を迂回しない
- 未承認の不可逆操作を実行しない
- 変更した受入条件を検証する
- 生成物と生成元を一致させる

### Risk-selected

変更のartifact、risk、path、profileに応じて選択する。

例:

- public API compatibility
- migration safety
- IaC replacement
- dependency integrity
- accessibility interaction
- performance budget
- independent security review

### Advisory

保守性、追加最適化、推奨pattern、文書改善等。単独ではmergeを停止せず、修正、Issue、残存リスクへ収束させる。

### Periodic

個々のPRではなく、月次、release単位、registry再確認期限で扱う。

- standard source freshness
- checklist重複
- false blocker
- selector miss
- 長期的なadvisory滞留

## Selection

次から対象controlを選ぶ。

- direct / assured / regulated
- changed path
- artifact tag
- risk tag
- requirement / design impact
- public contract、DB、IaC、dependency、UI、security trigger
- 現在のcheck timing

selectorの入力と選択IDはreview YAMLまたは外部CI metadataから追跡可能にする。全catalogの結果ファイルは作らない。

as-built設計、API/OpenAPI/sample、SQL/CRUD/E2E、coverage、test構造、定量閾値、Rule ID抑制を変更する場合は`references/as-built-design-check-selection.md`を読み、artifactに対応するcheckだけを選ぶ。

## Source registry

`governance/standards/registry.json`に、title、version、canonical URL、checked date、scope、prior-version差分、再確認期限を保持する。外部標準は発行元の公式URL、repository-owned標準はcanonical repository URLとlocal artifact SHA-256を使用する。

鮮度確認を行う条件:

- 再確認期限へ到達した
- 対象標準を直接変更する
- 公式資料が変更された証拠がある
- 法令・契約上の最新版確認が必要

通常の局所PRで、無関係な全標準を再調査しない。

## Review timing

### 変更開始前

riskとartifactから候補controlを選ぶ。

### 実装中

機械検証可能なcontrolをCI workflow、static analysis、test、generatorへ落とす。

### PR前

判断が必要なcontrol、N/A、Advisory、残存リスクをreview YAMLへ記録する。

### Merge前

現在HEADに対するblocking resultだけを確認する。

### 定期監査

出典鮮度、重複、false blocker、見逃し、不要controlを見直す。

## Verdict

### Pass

repository path、test、generator、CI required check等の直接証拠がある。CIログ本文はrepositoryへ保存しない。

### N/A

選択後に具体的な適用外事実が判明した場合だけ使用し、noteを必須とする。

### Fail

- Invariantとblocking Risk-selectedは修正する。
- Advisoryは修正、Issue、residual riskを選べる。
- その場で修正するFailへ一律にIssue、owner、due dateを要求しない。

## Completion

- 現在の変更に関連するcontrolだけが選択される。
- trigger該当のInvariantがPassする。
- 選択したblocking Risk-selectedがPassする。
- Advisoryの扱いが明示される。
- source freshness確認は必要な条件でのみ行われる。
- review結果は`governance/reviews/<change-id>.yaml`へ保存される。
- automated resultの正本はGitHub Actions等にある。
