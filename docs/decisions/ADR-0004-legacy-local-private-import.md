# ADR-0004: coverage検証済みローカル成果物を専用経路でprivate S3へ移行する

- 状態: 採用
- 決定日: 2026-08-22
- 関連: ADR-0003、Issue #465、所有者指示 `user:2026-08-22`

## 決定

`../get-archives-info` にある1,800動画のうち、全編文字起こしと連続timeline coverageを検証済みの1,598動画だけを `legacy_local_import_v1` の不変manifestへ固定する。文字起こしなし153動画とcoverage未達49動画は対象外とし、対象数が1,598から変化した場合は処理を開始しない。

専用CLIは各ローカルfileの相対path、byte数、SHA-256と正本台帳のchannel IDをmanifestへ固定する。import時にlocal checksumを再検証し、既存のprovider取得workerやYouTube再downloadを呼ばず、private S3へ保存したobjectを再読してbyte数とSHA-256を照合する。その後にのみ不変run manifest、current manifest、DynamoDB終端状態を確定する。同じmanifestの再実行は同じrun keyとchecksumを使い、内容が異なる不変objectを上書きしない。

検証済み `transcript.jsonl` は独立した `transcript` artifactとして保存する。YouTube字幕だけを元にした場合でも一律にJSON3自動字幕へ偽装せず、ASRまたは字幕とASRが混在する102動画も由来をmanifestへ残す。ローカルにないthumbnail、音声等を `not_present` と断定せず、legacy profileでは `not_applicable` とする。このため1,598動画の動画終端状態は `partial` とし、通常workerの全artifact成功を表す `succeeded` と区別する。

生コメントと生チャットは復旧用rawとしてprivate S3だけへ保存する。再利用用copyは本文、時刻、反応数等の必要項目だけへ正規化し、投稿者名、channel ID、avatar、profile URLを含めない。DynamoDB、manifest、CLI出力、ログ、Git、PR、Pagesには本文や投稿者識別子を置かない。

## KMSを維持する理由

現在のcustomer-managed KMS keyは、S3、SQS、DynamoDB、CloudWatch Logsの保存時暗号化に共用している。暗号化そのものはS3の標準暗号化でも実現できるが、生の字幕、コメント、チャット、約78.7 GBの元音声を扱うため、鍵policyによる利用主体の限定、鍵の失効、rotation、CloudTrailでの鍵利用監査を一つの管理境界として維持する。

ローカルimport実行者には対象S3へのPut/Get/Head、VideoIngestion tableへのGet/Updateと、当該keyの `kms:GenerateDataKey` / `kms:Decrypt` が必要である。bucket default encryptionを使うためCLIが個々のPutへkey ARNを埋め込まない。KMS key policyとIAM policyの両方が許可しなければ処理できない。

customer-managed keyには月額とAPI request費用、権限設定の運用負荷がある。中央での失効・監査要件が不要になった場合は、AWS管理keyまたはS3 managed encryptionへ置き換えられるが、raw素材の保護方針と既存データの再暗号化を伴う別の設計変更として扱う。

## 運用境界

manifest作成はローカルreadだけでありAWSへ書き込まない。`legacy-local-import` は `--all` またはmanifest内の明示video IDを要求する。AWS deploy、実素材upload、SQS enqueue、削除、公開、mergeはそれぞれ人の明示承認なしに実行しない。
