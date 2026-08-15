# diopside 過去動画素材バックフィル

このディレクトリは Issue #465 の一度限りの過去動画素材バックフィル基盤です。公開画面、GitHub Pages、通常の1動画コンテンツPRとは独立しており、CDK deploy、backfill投入、ECRへのimage pushはいずれもこのPRでは実行しません。

## 検証

次の順で実行します。

1. uv sync --locked --all-groups
2. npm ci
3. uv run --locked ruff format --check .
4. uv run --locked ruff check .
5. uv run --locked pyright
6. uv run --locked mypy
7. uv run --locked pytest
8. npx cdk synth

CDK synth中にcdk-nagのAWS Solutions checksを実行します。抑制は生成template内で根拠を確認できる最小範囲だけに限定します。

## 運用上の入口

diopside-backfill manifest は、最新mainの content/catalog と既存台帳snapshotを統合して、不変の対象manifestを生成します。enqueue と report は、そのmanifestを指定して実行します。すべての外部リクエスト本文は video_id だけです。

対象を変更する場合は既存manifestを置き換えず、`manifest --revision <次の整数>` で新しいSHA-256付きmanifestを明示的に作成します。

AWS接続情報、バケット名、キューURL、テーブル名は実行環境の変数から読むため、秘密情報をリポジトリやコマンド履歴へ渡しません。ローカルfallbackは、ECRでdigest固定した同じworker imageを使う infra/scripts/run_local_worker.py を使用します。
