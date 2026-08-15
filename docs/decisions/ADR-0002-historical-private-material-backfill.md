# ADR-0002: 有限の非公開動画素材バックフィルを公開Pagesから分離する

- 状態: 採用
- 決定日: 2026-08-15
- 根拠: Issue #465、`V8-INGEST-*`、`V8-COST-*`、`V8-SAFETY-*`、`V8-OPS-*`

## 決定

既知の `video_id` を固定manifestで一度だけ列挙し、運用者が明示開始する有限バックフィルを `infra/` のPython + uv + AWS CDK構成で実行できるようにする。公開Pagesの閲覧、検索、生成、配信には接続しない。

SQS FIFO、短時間のDispatcher Lambda、AWS Batch Fargate worker、DynamoDBの `VideoIngestion` 単一テーブル、暗号化した私有S3、ECR、CloudWatch Logsを用いる。workerはdigest指定したコンテナで匿名の `yt-dlp` とffmpegだけを使い、cookie、認証、proxy、ログイン、認証回避は実装しない。Lambdaは制御面だけに限定し、長時間の素材取得はFargateで実行する。

S3は `{channel_id}/{video_id}/runs/{run_id}/` の不変run成果物と `{channel_id}/{video_id}/manifest.json` のcurrent pointerを分ける。DynamoDBには進捗、段階、分類済み失敗、S3 key、digest等の安全な状態だけを一動画一itemで保持し、生字幕、コメント、チャット、音声、投稿者識別子を保存しない。固定manifest、投入、完了報告も私有S3へ置く。

## 理由

過去の既知動画には、公開面へ置けない素材を、15分制限のない再開可能なworkerで段階的に取得する必要がある。一方で公開サイトのゼロ円・静的・無認証・非追跡の性質は維持する。キューの厳格な一項目契約と条件付きDynamoDB claimを組み合わせることで、重複投入、worker停止、部分成功の後にも同じtarget setを安全に再開できる。

## 採用しない案

- Lambdaだけで素材取得する案: 15分上限と一時領域が長い動画・複数素材の回復に不十分である。
- Pages、Git、PR、review YAMLへ素材を置く案: 生素材と投稿者識別子の公開禁止境界を破る。
- 新着動画をscheduleで継続取得する案: 有限バックフィルの対象固定と費用分離に反する。
- Cookie、login、proxy、bot回避で取得を継続する案: 認証回避を許す安全境界に反する。
- DynamoDBを複数tableやGSIで用途別に分ける案: 一動画一itemの進捗・再開契約を複雑化する。

## 運用境界

このPRはコード、テスト、CDK synth、cdk-nag、container scanの構成だけを追加する。AWS deploy、ECR push、manifest upload、SQS enqueue、実データbackfill、削除、公開、mergeは実行しない。実行する場合は、別途の明示承認、digest指定image、固定manifest、費用観測、完了reportを必要とする。

## 再検討条件

固定manifestが全件終端し不要になった場合、または公開面とprivate backfillの境界を変える必要が生じた場合は、資源の保持・削除を人が判断し、別ADRで再検討する。
