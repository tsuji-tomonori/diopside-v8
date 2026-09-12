# 1000件タイムスタンプcampaignの永続継続指示

- `get-archiveinfo`の連続queue運用と同様に、ChatGPT Workでも最大1000件を一度の明示要求で固定し、1件の完了・失敗やWork実行の終了でcampaign全体を終えない。
- 1回のWork実行期限はdrain境界でありcampaignの失効期限ではない。同じcampaign IDを次のWork実行が引き継ぐ。
- 対象動画ID、台帳行指紋、順序、claim、Draft PR、commit、完了状態、再開理由だけをGitHubの専用campaign branchへ永続化する。
- 字幕、音声、文字起こし、chat本文、投稿者識別子、資格情報はcheckpointへ含めない。
- checkpoint更新はremote親commitを条件とする楽観ロックとし、競合時は上書きせずremoteを再読する。
- Work環境消失後は完了済みを保持し、処理途中を安全な工程へ巻き戻して再取得・再検証する。
- 利用制限や一時的な全体blockは次回実行時刻を持つpaused状態とし、残り対象を失敗確定しない。
- merge、公開、force操作、branch削除、有料APIは引き続き行わない。
