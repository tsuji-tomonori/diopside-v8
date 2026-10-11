# 一時作業領域の回収

`.devflow/run/`は作業用であり、元素材の保存先ではない。
元素材は既存の`/home/t-tsuji/work/data/diopside`を参照する。

あらすじ・タイムスタンプharnessは、新規batchに所有マーカーを作り、
`verify-sheet-update`の台帳再読確認後にそのbatchの回収を試みる。
manifestの全動画と実際のitemsを照合し、全件が`complete`かつ
`sheetVerified=true`の場合だけ回収する。中断、処理不能、再開待ちは保持する。

回収前に、対象が`.devflow/run`配下であること、symlinkや別mountを
経由しないこと、作業コピーに未保存変更・未知のignored fileがないこと、
HEADとremote branchのcommitが一致すること、稼働中processが対象を
使用していないことを検査する。worktreeの強制削除は使わない。
台帳確認コマンドは、回収対象のworktreeの外から実行する。

完了ID、commit、PR、候補hash等の小さな完了記録だけをgitignoreされた
`.devflow/completed/`へ保存する。生素材、文字起こし、候補本文、ログは
コピーしない。statusとcampaign checkpointはこの完了記録を参照できる。
回収不能の場合は応答の`cleanup.status=retained`と`reason`を確認し、
原因解消後に`verify-sheet-update`を再実行する。

所有マーカーのない既存領域は自動回収に登録しない。
現存データの棚卸しは次の読取専用コマンドで行う。

```bash
python3 scripts/audit_devflow_storage.py --output /tmp/diopside-storage-audit.json
```

一覧の完了判定は保存済みローカル記録に基づく。実際の削除前に現在の
PR・台帳・稼働状況を再確認する。親フォルダーと子フォルダーの容量は
重複するため合算しない。素材原本とCodex会話履歴は回収対象に含めない。
