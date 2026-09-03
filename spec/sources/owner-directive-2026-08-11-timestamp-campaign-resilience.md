# 所有者指示: タイムスタンプcampaignの回復性

- 日付: 2026-08-11
- 出典: 別ChatGPT Workセッションの失敗ログを受けた所有者指示
- 状態: 承認済み

## 観測した問題

- claim markerと処理中Draft PRだけを残し、動画を完了せず停止した。
- 公開字幕または音声の取得失敗を、そのまま台帳の`処理不能`へ変換した。
- 全編日本語字幕がある場合も、章候補の構成失敗を素材不足と区別せず終了した。
- `codex exec`の`trusted-destination`結果を回復可能な一時失敗として再試行しなかった。
- Lunaの失敗を親Solが引き取らず、1件または短時間で人の追加入力待ちになった。

## 指示

- 1waveは10個のGPT-5.6 Luna medium論理レーンを維持し、同時枠不足時はqueueから波状実行する。
- 各Lunaは1動画の一次処理だけを担当し、回復可能失敗は親GPT-5.6 Solへ返す。
- 親SolはYouTube到達性の一次切り分け、字幕再試行、公開native音声、yt-dlpによるMP3、無料batch-local ASRを順に試す。
- 全編根拠から章候補を構成できない場合は、素材取得失敗ではなく意味構成失敗としてGPT-5.6 Sol highへフォールバックする。
- `codex exec`が`trusted-destination`を返した場合は、上限付きで再試行する。
- 字幕、音声、ASR、codex exec、構成、確認、検証の回復可能失敗をGoogle Sheetsの`処理不能`へ書かない。
- 期限内に回復できない動画は、同じcampaign、wave、batch、Draft PRから再開できるcheckpointを残し、他動画の処理を継続する。
- 親Solは動画ごとの素材経路、モデル、試行、成否、安全な理由、候補hash、PR、commit、台帳照合を把握できるログを残す。
- LunaはGitHub、PR、commit、push、Google Sheetsの共有書込みを行わない。

## 維持する安全境界

- merge、公開、force操作、branch削除、有料API、認証回避、非公開・メンバー素材取得を行わない。
- 生字幕、音声、文字起こし、チャット本文、投稿者識別子、秘密情報をGit、PR、台帳へ保存しない。
- ログは安全な分類、試行回数、モデル、結果、diagnostic digestだけをignored stateへ保存する。
