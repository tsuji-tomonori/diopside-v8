---
name: japanese-git-commit-gitmoji
description: Create or propose a Japanese Gitmoji and Conventional Commit message that records purpose, change, requirement and design impact, review path, verification, compatibility, and residual risk.
---

# Japanese Git Commit Comment with Gitmoji

このSkillでは利用者の呼称に合わせて`Commit Comment`と表現する。Gitの正式名称はcommit messageである。

## 目的

Commit Commentだけで、その変更について次を追跡できるようにする。

- 何を達成する変更か
- 何を変更したか
- 永続要件へ影響するか
- as-built設計、ADR、公開契約へ影響するか
- どのチェック結果をレビューしたか
- どのCIが検証するか
- 互換性と残存リスク

独立したChange Manifest、Requirement Impact Result、Design Impact Result、implementation logは作らない。

## 必須形式

```text
<gitmoji> <type>(<scope>): <日本語の要約>

目的:
- <結果>

変更内容:
- <主要変更>

要件影響:
- あり | なし
- 要件ID: <REQ IDs | none>
- 理由: <判定根拠>

設計影響:
- あり | なし
- 対象: <生成設計、ADR、公開契約、構成 | none>
- 生成設計: <path | 対象外>
- ADR: <ADR ID | 不要とした理由>

チェックリスト:
- governance/reviews/<change-id>.yaml

検証契約:
- GitHub Actions: <workflowまたはrequired check>
- ローカル: <必要時だけ>
- 結果の正本: GitHub Actions等

互換性・残存リスク:
- <互換性、移行、未検証範囲、既知制約>

Requirements: <REQ IDs | none>
Design-Impact: <none | generated | adr | contract | governance | mixed>
Review-Checklist: governance/reviews/<change-id>.yaml
Refs: <Issue / ADR。該当時だけ>
```

本文はrepository変更で必須とする。単なるコミット候補の例示で、差分・要件・レビュー結果が与えられていない場合だけ、明示的なplaceholderを使用できる。

## 作成手順

1. staged diffまたは対象差分を確認する。
2. 変更の主目的を一つ決める。
3. type、scope、Gitmojiを選ぶ。
4. Commit Comment本文を、差分、要件正本、生成設計差分、ADR、review YAMLから生成する。
5. 要件影響と設計影響を必ず`あり`または`なし`で判定する。
6. `なし`の場合も、なぜ外部挙動または設計契約が変わらないかを書く。
7. 検証契約にはworkflowまたはrequired check名を書く。まだ実行されていないCIをPassと書かない。
8. 生テストログ、coverage全文、scanner全文を貼り付けない。
9. squash mergeではPR全体の内容へ統合し、中間コミットだけに証跡を残さない。

## 1行目

```text
<emoji> <type>(<scope>): <日本語の要約>
```

代表的なtype:

| type | 用途 | 代表Gitmoji |
|---|---|---|
| `feat` | 利用者に見える機能追加 | ✨ |
| `fix` | 不具合修正 | 🐛 |
| `refactor` | 外部挙動を変えない構造改善 | ♻️ |
| `perf` | 性能改善 | ⚡️ |
| `docs` | 文書変更 | 📝 |
| `test` | テスト追加・修正 | ✅ |
| `build` | build・package設定 | 🔨 |
| `ci` | CI変更 | 👷 |
| `chore` | 設定・定型保守 | 🔧 |
| `revert` | 既存変更の取消 | ⏪️ |
| `release` | release・tag | 🚀 |

破壊的変更では`!`または`BREAKING CHANGE:`を使用する。

## 要件影響の判定

次が変わる場合は`あり`とする。

- 利用者向け挙動
- 業務ルール
- 受入条件
- 非機能閾値
- 権限・security要求
- support対象
- 運用上の保証

内部リファクタリング、テスト追加、既存仕様に戻すバグ修正は通常`なし`だが、根拠を記載する。

## 設計影響の判定

次が変わる場合は`あり`とする。

- 実装由来の生成設計
- API・event・file format等の公開契約
- data modelまたはmigration
- infrastructure resource
- component・state・route等のas-built構造
- 将来の実装を制約する設計判断
- 開発・運用統制の恒久構成

コードから自明でない長期判断がある場合だけADRを作る。

## 検証結果の扱い

単体テスト、build、lint、type check、security scan、coverageの実行結果はGitHub Actions等の外部サービスを正本とする。

Commit Commentへ残すのは次だけである。

- 実行されるworkflowまたはrequired check
- 必要なローカル決定的検査の要約
- 結果の正本が存在する外部サービス

## 完成条件

- 1行目が一つの主目的を表す。
- 7つの必須節が存在する。
- 要件影響と設計影響に判定と理由がある。
- review YAMLへのpathがある。
- CI結果を捏造していない。
- 互換性と残存リスクが隠されていない。
- squash後も証跡が最終コミットに残る。

詳細は`docs/reference/commit-message.md`を参照する。
