# 開発・レビューの原則

- 通常の変更はコード、テスト、必要な要件・生成設計、PRの説明とCI結果で確認する。
- 変更ごとのreview YAML、固定の7節commit本文、Requirements / Design-Impact / Review-Checklist trailerは必須にしない。過去の記録と任意のlegacy監査は保持する。
- この方針は、同梱skillや旧templateの定型成果物要求より優先する。動画の事実確認・候補hash確認・privacy審査の要件は省略しない。
- commitは変更目的が分かる短い日本語の要約にする。重要な要件・設計影響、検証結果、残存リスクはPR本文またはcommitへ必要な分だけ記載する。
- 永続要件が変わる場合だけ正本を更新し、コード由来の設計は生成する。生成物を手編集しない。
- 対象のlint・型・単体・E2E・生成差分・内容検証を実行し、merge前に現在HEADのCIを確認する。失敗を形式変更で回避しない。
- 生ログはCIを正本とし、別のtest reportや変更管理文書を複製しない。一時状態はgitignoreされた`.devflow/run/`へ置く。
- 認証・権限、秘密情報、個人情報、データ損失、費用、不可逆操作には対応する安全確認と明示権限を維持する。
- merge・公開・deployは利用者が承認した範囲だけで行う。


# diopside v8 固有ルール

- Issue #1由来の142件と、それ以後の所有者指示を反映した`spec/requirements/requirements.json`を正本として扱い、受入条件を弱めない。
- TypeScript strictを維持し、公開画面・検索・端末内保存は静的なブラウザ内処理だけで完結させる。
- 動画更新は人がChatGPT／Codex画面から開始する。1回の明示要求で有限の適格タイムスタンプ対象集合を固定し、動画ごとの追加チャット承認を挟まず、全対象を1動画1PRのレビュー可能状態または理由付きの処理不能状態まで進める。1件の失敗を理由に他の対象を止めない。
- ChatGPT Workのタイムスタンプ一括処理は`run-timestamp-work-harness`を入口にし、台帳snapshotのPython確認、公開素材の一時取得、独立`codex exec`判断、決定的検証、1動画draft PRのcommit・push、競合検知付き台帳更新と再読確認までを同じ有限batchで完了する。mergeと公開は人が行う。
- ChatGPT Workを2〜20セッションで分散実行する場合、各workerは1動画だけを扱い、動画IDの大文字小文字を保持したremote branchのGitHub connectorによるref作成を原子的claimにする。競合したworkerは次候補へ進み、claim marker直後に処理中draft PRを作る。branchのforce update・削除・stale claimの自動奪取を行わない。
- ChatGPT Workを1セッションで並列実行する場合、親をGPT-5.6 Sol、子workerをGPT-5.6 Luna mediumの10論理レーンとして構成する。利用可能な同時threadが10未満なら10レーンをqueueから波状実行する。Lunaは1動画の一時素材・候補・一次確認だけを扱い、GitHub・Google Sheetsへ書き込まない。字幕・音声・codex exec・候補構成・確認・検証の回復可能失敗はLunaから親Solへ戻し、親が到達性診断、字幕再試行、native音声、MP3、無料batch-local ASR、Sol/high再構成を実行する。回復可能失敗を台帳の`処理不能`へ書かず、期限内に回復しない場合は再開可能なcheckpointと安全な理由・再開手順を台帳の進行中欄へ記録して再読検証し、他レーンを継続する。親Solだけが各候補を最終確認し、branch・draft PR・commit・台帳を確定する。
- 最大1000件のタイムスタンプcampaignは開始時に対象順序と台帳行指紋を固定し、10件ずつ処理する。1回のWork実行期限をcampaign失効にせず、生素材を除いた安全なcheckpointを専用remote campaign branchへ楽観ロック付きで保存する。Work環境消失・利用制限後は同じcampaign IDを復元し、完了済みを保持して未完了だけを安全な工程から再開する。
- ChatGPT Workのあらすじ一括処理は`run-synopsis-work-harness`を入口にする。最新mainにあらすじがない公開動画だけを対象に、親GPT-5.6 Solと`gpt-5.6-luna` mediumの10論理レーンで処理する。Lunaは1動画の全編根拠、候補、独立した事実・ネタバレ・編集確認だけを扱い、親Solだけが同じcandidate hashを最終確認してGitHub・Google Sheetsへ書き込む。既存あらすじを無断で再生成しない。
- ActionsからAI/APIを呼ばず、予定実行、従量課金API、独自Pages deploy Actions、自動マージを追加しない。検証済みのmainマージ後に限り、正本から静的成果物を決定生成してmainへcommitし、既存のbranch方式Pages buildを要求できる。
- 通常の動画追加は1動画1PRとし、タグ体系、スキル、検証、画面、Pages設定の変更を同梱しない。各PRを人がマージする操作を、その動画の公開承認とする。
- 生の字幕、コメント、チャット、投稿者識別子、秘密情報をGitまたは公開成果物へ保存しない。
- 静的成果物は正本から決定的に生成し、`docs/` と `docs/design/generated/` を直接編集しない。
- GitHub Pagesはbranch方式 `main/docs` とし、`operations/pages-policy.json` と `docs/CNAME` が完全一致する所有者承認済みの独自ドメインだけを使える。有料実行時サービスを使わない。
