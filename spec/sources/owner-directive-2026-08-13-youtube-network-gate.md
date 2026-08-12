# YouTube network gateによるclaim storm防止

- 日付: 2026-08-13
- 状態: active
- 根拠: owner instruction

## 指示

1 Sol・10 LunaのタイムスタンプcampaignでYouTubeへのネットワーク承認が失効しても、
到達不能な10動画へbranch、claim marker、Draft PR、deferred台帳更新を先に量産してはならない。

各waveは、公開素材と生本文を含まない安全なsemantic mapを動画ごとに一時準備した後でだけ
claim可能にする。準備前のpreflightはclaim許可として扱わない。campaign-wide network gateの
失敗を検知した場合は未準備レーンのclaimを0件に保ち、1レーンのcanary再検証が成功するまで
gateを閉じない。

Work環境消失後も、章候補、独立review、安全なsemantic map、hash、再開工程を、生字幕、音声、
文字起こし、chat本文、投稿者識別子、資格情報を含まない回復カプセルとしてcampaign checkpointへ
保存し、同じ候補または安全なsemantic工程から再開できるようにする。

既存の1動画1Draft PR、親Solだけの共有書込み、10論理レーン、7時間30分通常処理と30分drain、
固定campaign manifest、force操作禁止、merge・公開禁止は維持する。
