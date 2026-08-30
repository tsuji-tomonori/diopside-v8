# diopside ローカル素材取得とprivate保存

このディレクトリは Issue #465 の有限private backfillを扱います。YouTubeへの取得処理、字幕・音声の正規化、再試行は運用者のローカルPCで実行し、AWSには保存用のprivate S3 bucketとDynamoDB tableだけを配置します。公開画面、GitHub Pages、通常の1動画コンテンツPRとは接続しません。

## 構成

- AWS: versioning・SSE-S3・public block・TLS強制を備えたprivate S3 bucket
- AWS: `video_id`だけをpartition keyに持つPITR有効のDynamoDB table
- ローカル: lock済み`yt-dlp`、`imageio-ffmpeg`、Python worker
- 状態管理: DynamoDBの条件付きclaimと、S3のobject checksum・不変checkpoint manifest

SQS、Lambda、Lambda event source、worker IAM role、CloudWatch worker Log Group、Batch、Fargate、ECR、VPC、EventBridge、予定実行は構成しません。取得元への通信はローカルPCから直接行います。

## AWS保存基盤のデプロイ

`.github/workflows/deploy-ingestion-infra.yml`は、検証済みmainの`DiopsideIngestionStack`だけを人がデプロイする入口です。schedule、push、PRでは起動せず、`DEPLOY`の確認入力とGitHub environment `private-backfill-infra`の承認を必須にします。workflowは保存基盤をデプロイするだけで、素材取得、S3 upload、DynamoDBの動画状態更新、削除、公開、mergeを実行しません。

長期AWS access keyはGitHubへ保存しません。AWS accountにはmodern CDK bootstrapと、`https://token.actions.githubusercontent.com`、audience `sts.amazonaws.com`のOIDC providerが必要です。受けroleは`DiopsideGitHubDeploymentAccessStack`で管理します。

```console
CDK_DEFAULT_ACCOUNT=123456789012 \
CDK_DEFAULT_REGION=us-east-1 \
npm exec -- cdk deploy DiopsideGitHubDeploymentAccessStack \
  --exclusively \
  --parameters 'GitHubOidcSubject=repo:tsuji-tomonori@39981658/diopside-v8@1321865971:environment:private-backfill-infra' \
  --parameters 'TargetDeploymentRegion=ap-northeast-1'
```

GitHub environmentには次を登録します。

- `AWS_ACCOUNT_ID`: 対象AWS account ID
- `AWS_REGION`: `ap-northeast-1`
- `AWS_DEPLOY_ROLE_ARN`: access stackの`GitHubActionsDeployRoleArn` output

共有infra role `diopside-github-actions-deploy`は、対象regionのCDK bootstrap `deploy`、`file-publishing`、`lookup` roleの引受けだけを許可します。SQS、S3、DynamoDB、Lambdaを直接操作する権限は持ちません。deploy workflowもinline session policyで同じ3 roleの引受けだけへ制限します。

### 旧Lambda/SQS stackからの更新

同じ`DiopsideIngestionStack`を更新するため、既存S3 bucketとDynamoDB tableの論理ID、保存形式、`RETAIN`方針は維持されます。一方、CloudFormation change setではSQS request/DLQ、Lambda、event source、worker IAM roleの削除が提示されます。キュー内の未処理messageも失われるため、デプロイ前に不要であることを人が確認してください。

旧worker Log Groupは従来の`DeletionPolicy: Retain`によりstack管理外へ残る場合があります。このrepository変更はLog Groupを削除しません。不要になったLog Groupの確認・削除は、保存要否を確認した後の別の明示操作として扱います。

## ローカルPCの準備

Python 3.12、uv、通常のAWS credential chainを使います。access keyやsecret keyをcommand引数、設定file、Gitへ書かず、既存のAWS profileまたは短期credentialを利用してください。

```console
uv sync --directory infra --locked --all-groups
```

保存先はdeploy outputから取得できます。

```console
BUCKET_NAME="$(aws cloudformation describe-stacks \
  --stack-name DiopsideIngestionStack \
  --region ap-northeast-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`RawMaterialBucketName`].OutputValue' \
  --output text)"
TABLE_NAME="$(aws cloudformation describe-stacks \
  --stack-name DiopsideIngestionStack \
  --region ap-northeast-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`VideoIngestionTableName`].OutputValue' \
  --output text)"
test -n "$BUCKET_NAME"
test -n "$TABLE_NAME"
```

ローカル実行者に必要なAWS data-plane権限は、対象bucketへの`GetObject`、`PutObject`、`AbortMultipartUpload`と、対象tableへの`GetItem`、`UpdateItem`です。`report`は追加で`dynamodb:Scan`、複数動画manifestのuploadは同じbucketへの書込みを使います。削除、IAM、Lambda、SQS、CloudFormation変更の権限は素材取得には不要です。

## 1動画を直接取得する

11文字のYouTube video IDを1件だけ明示します。`--profile`を省略した場合は標準AWS credential chainを使います。

```console
uv run --directory infra --locked diopside-backfill ingest \
  --video-id gl5UkwS_jmM \
  --bucket "$BUCKET_NAME" \
  --table "$TABLE_NAME" \
  --region ap-northeast-1
```

CLI自身がDynamoDBの条件付きclaimを取得し、metadata、description、thumbnail、subtitles、automatic captions、chat、comments、native audio、ASR用派生音声を独立処理します。各uploadはS3を再読してbyte数、content type、SHA-256を確認し、checkpoint後にだけDynamoDBを進めます。

retryableな失敗は既定で最大3 attemptまで同じcommand内で再開します。`--max-attempts`は1〜10に限定されます。別processが同じvideo IDを実行中なら`already_running`として上書きせず終了code 2を返します。既に終端manifestがある場合は`already_complete`として再downloadせず終了code 0を返します。出力JSONには安全なstatus、attempt数、run ID、reason codeだけを含み、生素材やprovider応答本文を含めません。

## 固定manifestをローカル処理する

複数動画では、まずAWS書込みを行わない不変target manifestを作成します。

```console
uv run --directory infra --locked diopside-backfill manifest \
  --repo-root . \
  --revision 1 \
  --output /tmp/diopside-backfill.json
```

固定した順序で各video IDを独立処理します。1件の失敗で後続を止めず、全件の安全な結果を集計して返します。

```console
uv run --directory infra --locked diopside-backfill ingest-manifest \
  --manifest /tmp/diopside-backfill.json \
  --bucket "$BUCKET_NAME" \
  --table "$TABLE_NAME" \
  --region ap-northeast-1
```

完了reportをprivate S3へ保存する場合は既存の`report` commandを使います。

## 検証

```console
npm run verify:ingestion
```

このcommandはRuff format、Ruff lint、Pyright strict、mypy strict、pytest、CDK synth、cdk-nag、生成CDK設計driftを検査します。pytestはMotoのloopback HTTP server上で、ローカルrunnerからDynamoDB claim・retry・checkpoint・completeとS3 manifestまでを実プロトコルで確認します。Dockerを利用できる環境では、同じS3/DynamoDB統合試験を固定版Flociに対して実行できます。

```console
npm run test:ingestion:floci
```

既に起動済みのFlociまたはLocalStackを使う場合、試験専用loopback endpointだけを明示してください。実AWS endpointは統合試験へ指定しません。

```console
DIOPSIDE_AWS_ENDPOINT_URL=http://127.0.0.1:4566 npm run test:ingestion:aws
```

## coverage検証済みlegacy成果物の移行

`../get-archives-info`からは通常workerを経由せず、まずAWS書込みを行わない固定manifestを作成します。

```console
uv run --directory infra --locked diopside-backfill legacy-local-manifest \
  --source-root ../get-archives-info \
  --repo-root . \
  --expected-count 1598 \
  --output /tmp/legacy-local-import.json
```

AWSへの投入は別の明示commandです。全件投入には`--all`、pilotにはmanifest内の`--video-id`を一つ以上指定します。

```console
uv run --directory infra --locked diopside-backfill legacy-local-import \
  --source-root ../get-archives-info \
  --manifest /tmp/legacy-local-import.json \
  --bucket "$BUCKET_NAME" \
  --table "$TABLE_NAME" \
  --video-id dQw4w9WgXcQ
```

importはlocal checksumとS3再読checksumを照合した後だけrun/current manifestとDynamoDBを確定します。生コメント・チャットはprivate rawとして保存し、再利用用JSONLから投稿者名とchannel IDを除去します。不足artifactはlegacy固有の`not_applicable`、動画は`partial`として通常workerの`succeeded`と区別します。
