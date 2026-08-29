# diopside 過去動画素材バックフィル

このディレクトリは Issue #465 の一度限りの過去動画素材バックフィル基盤です。公開画面、GitHub Pages、通常の1動画コンテンツPRとは独立しており、CDK deployとSQSへの実投入は実行ごとに人が承認します。

## GitHub Actionsからの基盤デプロイ

`.github/workflows/deploy-ingestion-infra.yml` は、検証済みmainの `DiopsideIngestionStack` だけを人がデプロイする入口です。schedule、push、PRでは起動せず、`DEPLOY` の確認入力とGitHub environment `private-backfill-infra` の承認を必須にします。workflowは基盤をデプロイするだけで、manifest作成、素材upload、SQS enqueue、削除、公開、mergeは実行しません。

長期AWS access keyはGitHubへ保存しません。AWS accountには、事前にmodern CDK bootstrapと `https://token.actions.githubusercontent.com`、audience `sts.amazonaws.com` のOIDC providerが必要です。受けロールは `DiopsideGitHubDeploymentAccessStack` で一度だけ管理者が作成します。このstackはbootstrapを使わないため、既存OIDC providerの正確なsubjectと、bootstrap済みの対象regionをparameterに指定して単独deployできます。

IAM roleはregionに属しません。一方、CloudFormation stackの配置regionと、受けロールが引き受けるCDK bootstrap roleのregionは別の設定です。既存access stackが `us-east-1` にある場合も削除や再作成はせず、そのstackを更新して委譲先を `ap-northeast-1` にします。

```console
CDK_DEFAULT_ACCOUNT=123456789012 \
CDK_DEFAULT_REGION=us-east-1 \
npm exec -- cdk deploy DiopsideGitHubDeploymentAccessStack \
  --exclusively \
  --parameters 'GitHubOidcSubject=repo:tsuji-tomonori@39981658/diopside-v8@1321865971:environment:private-backfill-infra' \
  --parameters 'GitHubEnqueueOidcSubject=repo:tsuji-tomonori@39981658/diopside-v8@1321865971:environment:private-backfill-enqueue' \
  --parameters 'TargetDeploymentRegion=ap-northeast-1'
```

このrepositoryは2026-07-15以降に作成されたため、GitHubのdefault OIDC subjectはowner IDとrepository IDを含むimmutable形式です。deploy用subjectは `repo:tsuji-tomonori@39981658/diopside-v8@1321865971:environment:private-backfill-infra`、enqueue用subjectは `repo:tsuji-tomonori@39981658/diopside-v8@1321865971:environment:private-backfill-enqueue` に固定し、旧name-based subject、別repository、別environmentをparameterで指定できないようにします。`gh api repos/tsuji-tomonori/diopside-v8/actions/oidc/customization/sub` の `sub_claim_prefix` を変更前に再確認します。OIDC providerが未作成の場合はAWS管理者が先に作成し、既存providerがある場合は再作成しません。

GitHub environment `private-backfill-infra` はdeployment branchを `main` だけに限定し、required reviewerとprotection ruleのbypass禁止を設定します。次のenvironment variablesを登録します。

- `AWS_ACCOUNT_ID`: 対象AWS account ID
- `AWS_REGION`: `ap-northeast-1`
- `AWS_DEPLOY_ROLE_ARN`: access stackの `GitHubActionsDeployRoleArn` output

受けロールは同じaccountの `ap-northeast-1` にあるCDK bootstrap `deploy`、`file-publishing`、`lookup` roleだけを引き受けます。access stack自体の配置regionには依存しません。ECR image publishing roleやAWS serviceの直接操作権限は持ちません。workflowはRuff、Pyright strict、mypy strict、pytest、CDK synth、cdk-nag、生成設計driftがすべて合格してからOIDC短期sessionを取得し、CloudFormation change set経由でデプロイします。

## GitHub Actionsからの1動画投入

`.github/workflows/enqueue-ingestion-video.yml` は、運用者が指定した1件の `video_id` だけを `diopside-ingestion-request.fifo` へ送る入口です。schedule、push、PRでは起動せず、mainからの手動起動、`ENQUEUE` の確認入力、GitHub environment `private-backfill-enqueue` の承認を必須にします。入力は11文字のYouTube video IDに限定し、SQS本文は `{"video_id":"..."}` の一項目だけです。

GitHub environment `private-backfill-enqueue` はdeployment branchを `main` だけに限定し、required reviewerとprotection ruleのbypass禁止を設定します。次のenvironment variablesを登録します。

- `AWS_ACCOUNT_ID`: 対象AWS account ID
- `AWS_REGION`: `ap-northeast-1`（access stackの `GitHubActionsDeploymentRegion` output）
- `AWS_ENQUEUE_ROLE_ARN`: access stackの `GitHubActionsEnqueueRoleArn` output
- `AWS_INGESTION_QUEUE_URL`: `https://sqs.ap-northeast-1.amazonaws.com/<account-id>/diopside-ingestion-request.fifo`

enqueue用ロールはimmutableな完全一致OIDC subjectだけを信頼し、`TargetDeploymentRegion` の対象FIFOへの `sqs:SendMessage` だけを許可します。access stackが `us-east-1` にあってもqueue ARNは `ap-northeast-1` を参照します。S3、DynamoDB、Lambda、CloudFormation、IAM、キュー削除の権限は持ちません。workflowはaccount、region、role ARN、queue URLを相互照合してから送信し、GitHub run IDとvideo IDをdeduplication IDに使います。別のworkflow runは運用者による新しい明示投入として扱います。

実行前にAWS料金、利用量、契約条件、対象動画を確認し、Actionsの「1動画private backfill投入」をmainから開始して `video_id` と `ENQUEUE` を入力します。workflowの成功はその1件のenqueueだけを示し、基盤deploy、素材の完了、削除、公開、mergeを意味しません。

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

複数動画の歴史素材backfillでは、diopside-backfill manifest が最新mainの content/catalog と既存台帳snapshotを統合して、不変の対象manifestを生成します。enqueue と report は、そのmanifestを指定して実行します。1動画だけを追加投入する場合は前節の手動Actionsを使えます。どちらも外部リクエスト本文は video_id だけです。

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
