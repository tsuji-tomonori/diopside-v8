# 非公開動画素材リポジトリ

字幕・音声・リプレイチャット・公開コメント・動画メタ情報を一度取得し、タイムスタンプとあらすじの作成で再利用します。保存先は必ずGitHubのprivateリポジトリにしてください。収集CLIはGitHub APIでvisibilityとwrite権限を確認し、publicリポジトリなら取得前に停止します。

## 前提

- Python 3.12以上
- `yt-dlp`、`ffmpeg`、`git-lfs`
- 保存先privateリポジトリを読書きできるGit credential
- 保存先確認用の`GH_TOKEN`または`GITHUB_TOKEN`
- コメント取得をYouTube Data APIで行う場合だけ`YOUTUBE_API_KEY`（未設定時は`yt-dlp`へフォールバック）

cookieが必要な公開動画では、Netscape形式のcookie fileを保存先worktreeの外に置き、`--cookies`で実行時だけ渡します。cookie、API key、tokenはファイル、manifest、Commit Commentへ保存されません。

保存先がまだない場合は、GitHub tokenにリポジトリ作成権限を付け、初回だけ`--create-repository`を追加します。既存リポジトリを勝手に作り替えることはなく、作成後もprivate設定を再読確認します。

## 収集

まず副作用のないplanを確認します。

```bash
npm run collect:evidence -- 1UMA5rGgmzs \
  --repository tsuji-tomonori/diopside-video-evidence
```

取得してprivateリポジトリへ反映します。

```bash
npm run collect:evidence -- 1UMA5rGgmzs \
  --repository tsuji-tomonori/diopside-video-evidence \
  --execute --push
```

既存cloneを使う場合は`--worktree /path/to/diopside-video-evidence`を追加します。既定では取得済みでSHA-256が一致するartifactを再利用し、不足・失敗分だけを取得します。公開側の内容が更新されたときだけ`--refresh`を指定します。更新取得が失敗しても既存artifactは残ります。

## ハーネスからの再利用

privateリポジトリをcloneし、音声のLFS objectも取得します。

```bash
git clone https://github.com/tsuji-tomonori/diopside-video-evidence.git
git -C diopside-video-evidence lfs pull
export DIOPSIDE_EVIDENCE_REPOSITORY="$PWD/diopside-video-evidence"
```

この環境変数を設定した状態でタイムスタンプ／あらすじハーネスを起動すると、manifestの動画ID・path・SHA-256を検証し、字幕、音声、チャットをネットワーク取得より先に再利用します。LFS pointerしかない場合は音声として読まず、安全なエラーで停止します。

## 保存形式

```text
data/youtube/<video-id>/
├── manifest.json
├── metadata/info.json
├── captions/source.<language>.json3
├── audio/source.opus
├── chat/live_chat.jsonl.gz
└── comments/comments.jsonl.gz
```

`manifest.json`はartifact別の成功・失敗と全fileのSHA-256・sizeを保持します。コメントとチャットは本文・時刻などの分析用情報を残し、投稿者名、channel ID、avatar、handle、client ID、tracking情報を再帰的に除去します。音声はGit LFSで管理します。
