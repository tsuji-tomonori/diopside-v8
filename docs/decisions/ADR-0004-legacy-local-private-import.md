# ADR-0004: coverage検証済みローカル成果物を専用経路でprivate S3へ移行する

- 状態: 採用
- 決定日: 2026-08-22
- 関連: ADR-0003、ADR-0006、Issue #465、所有者指示 `user:2026-08-22`

## 決定

`../get-archives-info` にある1,800動画のうち、全編文字起こしと連続timeline coverageを検証済みの1,598動画だけを `legacy_local_import_v1` の不変manifestへ固定する。文字起こしなし153動画とcoverage未達49動画は対象外とし、対象数が1,598から変化した場合は処理を開始しない。

専用CLIは各ローカルfileの相対path、byte数、SHA-256と正本台帳のchannel IDをmanifestへ固定する。import時にlocal checksumを再検証し、既存のprovider取得workerやYouTube再downloadを呼ばず、private S3へ保存したobjectを再読してbyte数とSHA-256を照合する。その後にのみ不変run manifest、current manifest、DynamoDB終端状態を確定する。同じmanifestの再実行は同じrun keyとchecksumを使い、内容が異なる不変objectを上書きしない。

検証済み `transcript.jsonl` は独立した `transcript` artifactとして保存する。YouTube字幕だけを元にした場合でも一律にJSON3自動字幕へ偽装せず、ASRまたは字幕とASRが混在する102動画も由来をmanifestへ残す。ローカルにないthumbnail、音声等を `not_present` と断定せず、legacy profileでは `not_applicable` とする。このため1,598動画の動画終端状態は `partial` とし、通常workerの全artifact成功を表す `succeeded` と区別する。

生コメントと生チャットは復旧用rawとしてprivate S3だけへ保存する。再利用用copyは本文、時刻、反応数等の必要項目だけへ正規化し、投稿者名、channel ID、avatar、profile URLを含めない。DynamoDB、manifest、CLI出力、ログ、Git、PR、Pagesには本文や投稿者識別子を置かない。

## 保存時暗号化

このADRで一度採用したcustomer-managed KMS keyの判断は、後続の所有者指示とADR-0005で置き換える。ローカルimportはbucket defaultのSSE-S3を使い、実行者にKMS権限を要求しない。既存環境から移行する場合の再暗号化と鍵廃止条件はADR-0005に従う。

## 運用境界

manifest作成はローカルreadだけでありAWSへ書き込まない。`legacy-local-import` は `--all` またはmanifest内の明示video IDを要求する。AWS deploy、実素材upload、削除、公開、mergeはそれぞれ人の明示承認なしに実行しない。
