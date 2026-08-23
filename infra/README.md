# diopside 過去動画素材バックフィル

このディレクトリは Issue #465 の一度限りの過去動画素材バックフィル基盤です。公開画面、GitHub Pages、通常の1動画コンテンツPRとは独立しており、CDK deployとbackfill投入はこのPRでは実行しません。

## GitHub Actionsからの基盤デプロイ

`.github/workflows/deploy-ingestion-infra.yml` は、検証済みmainの `DiopsideIngestionStack` だけを人がデプロイする入口です。schedule、push、PRでは起動せず、`DEPLOY` の確認入力とGitHub environment `private-backfill-infra` の承認を必須にします。workflowは基盤をデプロイするだけで、manifest作成、素材upload、SQS enqueue、削除、公開、mergeは実行しません。

長期AWS access keyはGitHubへ保存しません。AWS accountには、事前にmodern CDK bootstrapと `https://token.actions.githubusercontent.com`、audience `sts.amazonaws.com` のOIDC providerが必要です。受けロールは `DiopsideGitHubDeploymentAccessStack` で一度だけ管理者が作成します。このstackはbootstrapを使わないため、既存OIDC providerの正確なsubjectをparameterに指定して単独deployできます。

```console
CDK_DEFAULT_ACCOUNT=123456789012 \
CDK_DEFAULT_REGION=ap-northeast-1 \
npm exec -- cdk deploy DiopsideGitHubDeploymentAccessStack \
  --exclusively \
  --parameters 'GitHubOidcSubject=repo:tsuji-tomonori/diopside-v8:environment:private-backfill-infra'
```

GitHubのimmutable OIDC subjectを有効化しているrepositoryでは、owner IDとrepository IDを含む実際のsubjectを完全一致で指定します。ワイルドカードへ広げません。OIDC providerが未作成の場合はAWS管理者が先に作成し、既存providerがある場合は再作成しません。

GitHub environment `private-backfill-infra` はdeployment branchを `main` だけに限定し、required reviewerとprotection ruleのbypass禁止を設定します。次のenvironment variablesを登録します。

- `AWS_ACCOUNT_ID`: 対象AWS account ID
- `AWS_REGION`: bootstrap済みregion
- `AWS_DEPLOY_ROLE_ARN`: access stackの `GitHubActionsDeployRoleArn` output

受けロールは同じaccountとregionのCDK bootstrap `deploy`、`file-publishing`、`lookup` roleだけを引き受けます。ECR image publishing roleやAWS serviceの直接操作権限は持ちません。workflowはRuff、Pyright strict、mypy strict、pytest、CDK synth、cdk-nag、生成設計driftがすべて合格してからOIDC短期sessionを取得し、CloudFormation change set経由でデプロイします。

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

`pytest`はMotoのHTTP serverを一時起動し、SQS受信からDispatcher、DynamoDBのclaim・checkpoint・complete、S3 manifestまでを実プロトコルで検証します。Dockerを利用できる環境では、同じ統合試験を固定版Flociに対して実行できます。

```console
npm run test:ingestion:floci
```

既に起動済みのFloci、LocalStack等を使う場合は、試験専用endpointを明示します。実AWS endpointは指定しないでください。試験は一意な一時resourceだけを作成し、終了時に削除します。

```console
DIOPSIDE_AWS_ENDPOINT_URL=http://127.0.0.1:4566 npm run test:ingestion:aws
```

## 運用上の入口

diopside-backfill manifest は、最新mainの content/catalog と既存台帳snapshotを統合して、不変の対象manifestを生成します。enqueue と report は、そのmanifestを指定して実行します。すべての外部リクエスト本文は video_id だけです。

対象を変更する場合は既存manifestを置き換えず、`manifest --revision <次の整数>` で新しいSHA-256付きmanifestを明示的に作成します。

AWS接続情報、バケット名、キューURL、テーブル名は実行環境の変数から読むため、秘密情報をリポジトリやコマンド履歴へ渡しません。SQSは一動画ずつ実処理Lambdaを起動し、Lambda zipにはlock済みのyt-dlpとffmpeg runtimeを同梱します。

実処理Lambdaは最大15分で、完了できなければSQSの再試行対象になります。3回処理できない要求はrequest DLQへ移し、成功として扱いません。新着探索や継続実行のscheduleは追加しません。

workerはobject単位のkey、SHA-256、byte数を不変checkpoint manifestへ保存します。raw取得だけではartifactを成功にせず、必要なnormalizeとverifyが完了した時点で終端します。再試行ではcheckpointと各objectを検証してから以前のattemptのobject recordを最終manifestへmergeします。private caption再利用はcurrent manifestに記録されたexact keyだけを読み、byte数とSHA-256を照合します。

## coverage検証済みローカル成果物の移行

`../get-archives-info` からは通常workerを経由せず、まずAWS書込みを行わない固定manifestを作成します。

```console
infra/.venv/bin/diopside-backfill legacy-local-manifest \
  --source-root ../get-archives-info \
  --repo-root . \
  --expected-count 1598 \
  --output /tmp/legacy-local-import.json
```

このcommandはcoverage未達202件を除外し、1,598件すべてのlocal path、byte数、SHA-256と正本channel IDを固定します。対象数、metadataのvideo ID、transcript JSONL、coverage、path境界のいずれかが不正ならmanifestを作成しません。

AWSへの投入は別の明示commandです。全件投入には `--all`、pilotにはmanifest内の `--video-id` を一つ以上指定します。

```console
infra/.venv/bin/diopside-backfill legacy-local-import \
  --source-root ../get-archives-info \
  --manifest /tmp/legacy-local-import.json \
  --bucket "$DIOPSIDE_PRIVATE_BUCKET" \
  --table "$DIOPSIDE_INGESTION_TABLE" \
  --video-id dQw4w9WgXcQ
```

実行者には対象S3のPut/Get/HeadとDynamoDBのGet/Updateだけが必要です。S3 objectはbucket defaultのSSE-S3で暗号化し、customer-managed KMS keyとその権限は使用しません。importはlocal checksumとS3再読checksumを照合した後だけrun/current manifestとDynamoDBを確定します。生コメント・チャットはprivate rawとして保存し、再利用用JSONLから投稿者名とchannel IDを除去します。不足artifactはlegacy固有の`not_applicable`、動画は`partial`として通常workerの`succeeded`と区別します。
