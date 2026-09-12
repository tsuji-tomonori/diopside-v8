# ADR-0006: private素材取得をローカルPCへ移しAWSを保存に限定する

- 状態: 採用
- 決定日: 2026-08-29
- 置換対象: ADR-0003のSQS・Lambda実行方式
- 根拠: 所有者指示 `user:2026-08-29`、`V8-INGEST-*`、`V8-OPS-003`

## 決定

YouTubeへのmetadata、字幕、チャット、コメント、音声の取得とffmpeg変換は、運用者がローカルPCで明示的に実行する。AWS stackにはprivate S3 bucketとDynamoDB tableだけを配置し、SQS、Lambda、event source、worker IAM role、worker用CloudWatch Log Groupは構成しない。クラウドIP等の取得元制限を回避するための認証回避は行わず、通信元を運用者PCへ移す。

CLIは11文字のvideo IDを1件、または不変target manifestを受け取り、標準AWS credential chainで対象S3とDynamoDBへ直接書き込む。credential自体は引数として受け取らない。DynamoDBの条件付きclaim、attempt count、再開checkpoint、終端状態と、S3の不変run key、checksum再読、current manifestの契約は維持する。ローカル処理中はcheckpointごとにclaim leaseを延長し、中断後は確定済みcheckpointから有限回だけ再試行する。

公開音声・字幕のGoogle Video ServerによるHTTP 403へ対応するため、lock済みの`bgutil-ytdlp-pot-provider` pluginと同versionのローカルHTTP providerを使い、yt-dlpの`mweb` clientへ動画単位のPO Tokenを供給する。providerはloopbackだけで利用し、Node.jsによるJavaScript challenge処理とは独立させる。PO Tokenは公開配信requestのattestationであり、YouTube account、Cookie、login、proxyを導入しない。providerが停止中またはTokenを取得できない場合も認証へ切り替えず、artifactごとの安全な再試行可能状態へ分類する。

永続work rootを選んだ段階処理は、動画workspaceへ現在状態をatomic JSON、時系列eventを追記型JSONLとして保存する。既存acquire/process manifestはchecksum付きで現在状態へ回復し、再試行は過去eventを削除しない。traceは再開と監査に必要なstage、結果、reason code、attempt、run ID、manifest相対path・checksumだけに限定し、生素材または外部providerの応答本文を含めない。一時work rootを選んだ全段階実行は従来どおり完走後にworkspaceとtraceを削除する。

## 理由

AWS上とCodex Workからの取得が成立せず、クラウド側IPへの制限が原因の可能性がある。保存契約は動作環境に依存しないため、既存Lambda workerの処理本体を再利用し、起動・claim・retryだけをローカルrunnerへ置き換える。これにより取得元制限とLambdaの15分上限から処理を分離し、AWSの実行資源と権限を削減できる。

## 互換性と移行

- `RawMaterialBucket`と`VideoIngestion`のCDK construct ID、CloudFormation論理ID、`RETAIN`、S3 key、DynamoDB item契約を維持する。
- 同じstackのchange setはrequest/DLQ、Lambda、event source、worker IAM roleの削除を提示する。キューの未処理messageは失われるため、deploy前に人が差分と不要性を確認する。
- 旧worker Log Groupは従来の`DeletionPolicy: Retain`によりstack管理外へ残り得る。この変更はそれを削除しない。
- デプロイ用GitHub OIDC roleはCDK bootstrap roleの引受けだけを維持し、素材投入権限を持たない。ローカル実行者には対象bucket/tableの必要なdata-plane権限だけを与える。
- PO Token providerはAWS resource、S3/DynamoDB契約、公開成果物へ追加しない。運用者PCのloopback processとして起動し、plugin/providerのversionを一致させる。

## 運用境界

AWS deploy、ローカル素材取得・upload、削除、公開、mergeはそれぞれ別の明示操作とする。この実装変更、test、CDK synth、PRはAWS deployまたは実データ取得の承認を意味しない。
