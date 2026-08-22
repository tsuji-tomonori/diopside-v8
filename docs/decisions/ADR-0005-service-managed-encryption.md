# ADR-0005: customer-managed KMS keyを廃止しservice標準の保存時暗号化を使う

- 状態: 採用
- 決定日: 2026-08-22
- 置換対象: ADR-0003とADR-0004のcustomer-managed KMS key判断
- 根拠: 所有者指示 `user:2026-08-22`

## 決定

private backfill stackはcustomer-managed KMS keyとaliasを作成しない。private S3はbucket defaultのSSE-S3、DynamoDBはAWS所有鍵による標準暗号化、SQSはSSE-SQS、CloudWatch Logsはservice defaultの保存時暗号化を使う。Lambda workerとlegacy local importerにはKMS権限を付与しない。

生素材の保護は、private bucket、public access block、TLS強制、最小権限IAM、versioning、checksum再読検証、raw/normalized境界で維持する。専用鍵のrotation、無効化、key policy監査を必要とする要件はなく、customer-managed keyの月額費用、request費用、権限運用を持たない構成を優先する。

## 既存環境からの移行条件

S3のdefault encryption変更は新規書込みにだけ適用され、既存のSSE-KMS objectを自動ではSSE-S3へ変えない。旧keyはCloudFormation templateで `DeletionPolicy: Retain` だったため、stack updateでresourceを除いても実keyはCloudFormation管理外に残り、明示的に廃止するまで費用が残り得る。

このPRはdeploy、object再暗号化、key無効化、key削除予約を行わない。既存stackがない場合は新templateをそのままdeployできる。既存stackがある場合は次を別途明示承認された運用で行う。

1. CloudFormation change setでKMS keyが `Retain` によりtemplate管理外へ残り、aliasが削除されること、S3・DynamoDB・SQS・Logsの暗号化変更が意図どおりであることを確認する。
2. S3 InventoryまたはHeadObjectで旧keyを参照する全objectを特定し、必要なobjectを同じobject keyへcopyしてSSE-S3へ再暗号化する。
3. objectのbyte数とSHA-256を再読検証し、DynamoDB、SQS、Logsを含む依存先が旧keyを参照しないことを確認する。
4. 旧keyの利用がないことを確認してから、7〜30日の待機期間を付けた削除予約を別の明示承認で行う。待機中の利用失敗を監視し、必要なら削除予約を取り消す。

参考: [S3 default encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-encryption-faq.html)、[CloudFormation DeletionPolicy](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html)、[KMS key deletion](https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html)

## 運用境界

AWS deploy、既存objectのcopy、KMS keyの無効化または削除予約、素材upload、SQS enqueue、公開、mergeはそれぞれ人の明示承認なしに実行しない。
