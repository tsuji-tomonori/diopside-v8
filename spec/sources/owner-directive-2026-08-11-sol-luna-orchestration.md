# 所有者指示: 1 Sol・10 Lunaタイムスタンプオーケストレーション

- 日付: 2026-08-11
- 出典: 所有者によるChatGPT Work指示
- 状態: 承認済み

## 指示

ChatGPT Workのタイムスタンプ処理を、1つのGPT-5.6 Sol親セッションに対してGPT-5.6 Luna子worker 10レーンで実行できるようにする。Lunaは動画別の反復可能な処理を担当し、各結果の最終確認はSolが行う。1件または短時間で停止して人の継続入力を要求する運用を避け、有限対象または指定したキャンペーン期限まで次のwaveを継続できるようにする。

## 必須境界

- 親はGPT-5.6 Sol、子workerはGPT-5.6 Luna mediumへ固定する。
- 10は論理レーン数とし、実環境の同時thread上限が低い場合は波状実行する。
- Lunaは1回の割当につきclaim済み動画1件だけを処理する。
- GitHub branch、draft PR、commit、push、Google Sheets更新は親Solだけが行う。
- Lunaは一時素材、候補、事実確認、編集確認、決定的検証結果だけを親へ返す。
- Solは候補hash、全編根拠、独立確認、validatorを確認し、合格記録のない候補を正本化しない。
- 1動画の失敗はそのレーンだけをblockedにし、他レーンと次waveを止めない。
- merge、公開、force update、branch削除、課金API、認証回避、非公開素材取得は引き続き禁止する。
