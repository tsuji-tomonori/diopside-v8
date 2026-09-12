# GitHub Actionsのprivate backfillインフラロール統合

- 指示日: 2026-08-29
- 指示者: repository owner
- 対象: private backfillのGitHub Actions OIDC roleとprotected environment

## 永続化する結果

1. 1動画SQS投入のために `diopside-github-actions-enqueue` を使用せず、基盤deployと同じ `diopside-github-actions-deploy` を使用する。
2. 基盤deployと1動画投入はGitHub environment `private-backfill-infra`、変数 `AWS_DEPLOY_ROLE_ARN`、immutableな完全一致OIDC subjectを共有する。
3. 共有roleの権限は、対象regionのCDK bootstrap role引受けと固定request FIFOへの `sqs:SendMessage` の和集合だけにする。各workflowはinline session policyで実行中の操作に必要な片方だけへさらに制限する。
4. enqueue専用OIDC subject parameter、role、output、environment変数を正本、実装、生成設計、試験、運用手順から廃止する。
5. AWS stack更新、旧role削除、GitHub environment設定変更、実enqueueはrepository変更とは別に人が明示実行する。

## 出典

- 利用者指示: user:2026-08-29-infra-role-consolidation
