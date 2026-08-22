# 費用0円の確認

公開更新前と月初に `operations/cost-policy.json`、リポジトリ公開設定、Pages公開元、依存、通信先を確認する。

- 既存のChatGPT／Codex契約以外の月次サービス請求は0円である。
- GitHubリポジトリは公開で、Pagesは `main/docs` のbranch方式と、`operations/pages-policy.json` と `docs/CNAME` が完全一致する所有者承認済みの独自ドメインだけを使う。
- CI、手動運用入口、検証済みmainからの静的成果物生成は、公開リポジトリで追加請求が生じない標準runnerだけを使う。手動ワークフローは検証と候補検出に限定し、予定実行、外部生成、独自Pages deployを行わない。
- 公開面ではAWS、外部検索、データベース、解析、広告、監視、生成、配信、従量課金APIを使わない。独自ドメインはGitHub Pagesの許可済みCNAMEだけを例外とする。
- 実行時通信は同じPages配下の静的ファイル、サムネイル、利用者が明示的に開くYouTubeだけである。

無償条件の変更、請求、利用量上限、ライセンスを確認できない場合は、課金して続行せず公開更新を停止し、運用者へ判断を求める。

## 公式条件（2026-08-04確認）

- [GitHub Pagesのbranch公開](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site): 公開元に任意branchの `/docs` を選べ、公開リポジトリのGitHub Freeで利用できる。
- [GitHub Actionsの料金](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions): 公開リポジトリの標準GitHub-hosted runnerは無料。larger runner、成果物保存、外部有料サービスは使わない。

条件は変更され得るため、上記の日付を最終確認日として扱い、月初確認時に更新する。

## 有限private backfillの費用分離

Issue #465の過去動画素材バックフィルは公開更新ではない。`infra/` に隔離されたAWS KMS、S3、DynamoDB、SQS FIFO、Lambda、CloudWatch Logsだけを使い、AWS Batch、Fargate、ECR、専用VPC、scheduled実行、新着検出、Pages接続、公開データへの投入を持たない。

- 実行前に固定manifest、lock済みLambda asset、サービス利用量・費用の観測方法を人が確認する。
- 月額0円の公開面停止条件をprivate backfillへ自動適用しない。ただし費用、利用量、契約条件を確認できない場合はdeploy、enqueue、backfillを開始せず、人が判断する。
- 全対象が終端したらcompletion reportを確認する。資源の保持、停止、削除はこのPRでは行わず、別の明示承認で決める。
