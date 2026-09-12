# 所有者指示: 1 Sol・10 LunaあらすじWorkハーネス

- 日付: 2026-08-11
- 出典: 所有者によるChatGPT Work指示
- 状態: 承認済み

## 指示

既存のタイムスタンプWorkハーネスの考え方を利用し、動画あらすじ作成を1つのGPT-5.6 Sol親セッションとGPT-5.6 Luna子worker 10論理レーンで継続できるSkillとハーネスとして実装する。既存の`generate-video-synopses`を1動画の生成規則として再利用し、親Solが最終確認した候補だけを1動画draft PRとGoogle Sheets作業台帳へ反映する。

## 必須境界

- 親はGPT-5.6 Sol、子workerはGPT-5.6 Luna mediumの10論理レーンとする。
- 10物理threadを利用できない場合もレーンを減らさず波状実行する。
- 最新mainにあらすじがない公開動画だけを対象とし、既存あらすじを無断で再生成しない。
- Lunaはclaim済み1動画の公開全編根拠、意味区間、候補、独立した事実・ネタバレ・編集確認、決定的検証だけを担当する。
- GitHub branch、draft PR、commit、push、Google Sheets、正本化、Sol review記録は親Solだけが行う。
- 候補hash、0秒から動画末尾までのcoverage、本人発言、ネタバレ・個人情報、独立review、validatorを親Solが確認し、合格記録のない候補を正本化しない。
- 1動画の失敗は理由付きblockedとして分離し、他レーンと期限前の次waveを継続する。
- 生字幕、音声、文字起こし、コメント、チャット、個人識別情報をGit、PR、台帳へ保存しない。
- merge、公開、force update、branch削除、stale claim自動奪取、有料API、認証回避、非公開素材取得を禁止する。
