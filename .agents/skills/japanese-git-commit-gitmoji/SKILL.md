---
name: japanese-git-commit-gitmoji
description: Write a concise Japanese Gitmoji and Conventional Commit message with the purpose and any important risk or compatibility impact.
---

# 日本語のcommitメッセージ

変更の主目的が分かる短い要約を書く。既存のGitmoji・Conventional Commit表記は読みやすさの慣例であり、本文の固定7節やtrailerの形式をmerge条件にしない。

例: `🐛 fix(search): Escapeでタグ入力が消える動作を修正`

- 差分を確認してから、変更理由と利用者への影響を簡潔に説明する。
- 重要な要件・設計影響、互換性、検証、残存リスクはPRまたはcommit本文に必要な分だけ記載する。
- 同じ説明を複数の文書へ複製しない。変更ごとのreview YAMLは必須にしない。
- CI結果は外部CIを正本とし、未実行の検証を合格と書かない。
- squash時はPR全体の内容が分かる要約にする。
- 動画の事実確認、privacy、候補hash、秘密情報、費用、承認の確認は内容側の要件どおり維持する。

過去の構造化メッセージとreview記録は履歴として保持し、書き換えない。
