# ADR-0003: private素材バックフィルを15分上限のLambdaへ単純化する

- 状態: 採用
- 決定日: 2026-08-22
- 置換対象: ADR-0002
- 根拠: 所有者指示 `user:2026-08-22`、`V8-INGEST-*`、`V8-COST-*`

## 決定

既知動画の有限private素材バックフィルは、SQS FIFOから一動画ずつ実処理Lambdaを起動し、成果物を暗号化したprivate S3へ保存する。状態と再開checkpointは単一DynamoDB tableへ保持する。AWS Batch、Fargate、ECR、専用VPC、Batch完了EventBridge、結果処理Lambda、回復Lambdaは使用しない。

実処理Lambdaは900秒で終了し、完了しない処理を成功扱いにしない。hard timeout前に検知できた失敗は安全な状態codeだけをDynamoDBへ保存してpartial batch failureを返し、hard timeoutを含む失敗はSQSのvisibility timeoutとredrive policyで再試行する。3回処理できない要求はrequest DLQへ隔離する。

Lambda zipにはlock済みの`yt-dlp`と`imageio-ffmpeg`を同梱する。cookie、login、proxy、bot回避は使用せず、生素材とprovider diagnosticを通常ログ、Git、PR、公開成果物へ保存しない。

## 理由

所有者が、15分を超える処理はいったんエラーでよく、private backfillの基本構成をSQS、Lambda、S3とする方針を確定した。長時間処理の継続より、deploy資源、network、image運用を減らすことを優先する。DynamoDB、IAM、CloudWatch Logsは、再試行可能な状態管理、最小権限、診断のための補助資源として維持する。保存時暗号化とcustomer-managed KMS keyの扱いはADR-0005で置き換える。

## 影響

- 15分以内に完了しない動画は再試行後にDLQへ到達し得る。
- Fargateの100 GiB一時領域はなくなり、Lambdaの10 GiB一時領域を上限とする。
- 既存S3成果物とDynamoDB checkpointは同じvideo ID・run ID契約で再利用する。
- stack更新時はBatch、ECR、VPC、EventBridgeと関連IAM・Log Groupが削除対象になるため、実deploy前にCloudFormation change setを人が確認する。

## 運用境界

AWS deploy、SQS enqueue、private素材取得、削除、公開、mergeは引き続き人の明示承認を必要とする。実装、test、CDK synth、生成設計更新はdeploy承認を意味しない。
