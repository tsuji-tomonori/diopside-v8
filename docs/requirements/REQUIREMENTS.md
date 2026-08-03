<!-- specflow.pyによる自動生成。spec/requirements/requirements.jsonを編集すること。 -->
# diopside v8 要件一覧

- カタログ版: 1
- 更新日: 2026-08-03
- 正本: `spec/requirements/requirements.json`

| ID | 版 | 状態 | 種別 | 原子的な義務 | 検証方法 |
|---|---:|---|---|---|---|
| `V8-SEARCH-001` | 1 | 有効 | 機能 | diopside v8の検索は、文字検索は、承認済み動画の動画タイトルだけを検索対象としなければならない。を**satisfy** | 固定検索データによる単体試験・画面試験 |
| `V8-SEARCH-002` | 1 | 有効 | 機能 | diopside v8の検索は、説明文、タグ、タイムスタンプ、ワードクラウド、字幕、コメント、チャット、チャンネル名、生成来歴を文字検索対象にしてはならない。を**satisfy** | 除外対象ごとの否定試験 |
| `V8-SEARCH-003` | 1 | 有効 | 機能 | diopside v8の検索は、検索時は、表示用タイトルを変えずに、照合専用文字列を定義済みの順序で正規化しなければならない。を**satisfy** | 正規化表の境界値試験 |
| `V8-SEARCH-004` | 1 | 有効 | 機能 | diopside v8の検索は、空白で区切られた複数の検索語は、すべてが同じ動画タイトルに一致する場合だけ検索一致としなければならない。を**satisfy** | 複数語の組合せ試験 |
| `V8-SEARCH-005` | 1 | 有効 | 機能 | diopside v8の検索は、3文字以上の検索語には、軽微な脱字、余分な1文字、1文字の誤り、隣接2文字の入れ替わりを許容するあいまい検索を適用しなければならない。を**satisfy** | 編集距離の正常・境界・超過試験 |
| `V8-SEARCH-006` | 1 | 有効 | 機能 | diopside v8の検索は、あいまい一致は、検索語の長さを `n`、許容編集距離を `d` としたとき、タイトル内の長さ `n-d` から `n+d` までの連続部分との最小Damerau–Levenshtein距離で判定しなければならない。を**satisfy** | 長文タイトルの固定例試験 |
| `V8-SEARCH-007` | 1 | 有効 | 機能 | diopside v8の検索は、検索結果は、一致の確かさが高い順に決定的に並べなければならない。を**satisfy** | 順位契約試験 |
| `V8-SEARCH-008` | 1 | 有効 | 機能 | diopside v8の検索は、タグは検索欄とは分離し、選択可能な補助候補として日本語名と追加選択後の該当件数を表示しなければならない。を**satisfy** | 画面試験・件数契約試験 |
| `V8-SEARCH-009` | 1 | 有効 | 機能 | diopside v8の検索は、タグ絞り込みは、選択された承認済みタグの不変識別子との完全一致で判定しなければならない。を**satisfy** | タグ契約試験 |
| `V8-SEARCH-010` | 1 | 有効 | 機能 | diopside v8の検索は、複数タグを選択した場合は、選択したすべてのタグを持つ動画だけを表示しなければならない。を**satisfy** | 2件・3件・未知タグの積集合試験 |
| `V8-SEARCH-011` | 1 | 有効 | 機能 | diopside v8の検索は、公開日の開始日と終了日は、日本標準時の日付として両端を含めて絞り込まなければならない。を**satisfy** | 時差・月末・年末・逆転範囲試験 |
| `V8-SEARCH-012` | 1 | 有効 | 機能 | diopside v8の検索は、動画長は秒数を正本とし、画面では「30分未満」「30分以上1時間未満」「1時間以上2時間未満」「2時間以上」の重複しない区分で絞り込めなければならない。を**satisfy** | 境界値試験 |
| `V8-SEARCH-013` | 1 | 有効 | 機能 | diopside v8の検索は、動画長の最小値・最大値を分単位で指定でき、最小値以上かつ最大値以下の動画だけを表示しなければならない。を**satisfy** | 範囲・欠損・誤入力試験 |
| `V8-SEARCH-014` | 1 | 有効 | 機能 | diopside v8の検索は、タイトル検索、選択タグ、公開日、動画長は、指定された条件をすべて満たす動画だけを残すよう同時適用しなければならない。を**satisfy** | 組合せ試験 |
| `V8-SEARCH-015` | 1 | 有効 | 機能 | diopside v8の検索は、検索語がある場合の初期並び順は関連度順、検索語がない場合の初期並び順は公開日の新しい順としなければならない。を**satisfy** | 画面状態試験 |
| `V8-SEARCH-016` | 1 | 有効 | 機能 | diopside v8の検索は、利用者は、公開日の新しい順・古い順、動画長の短い順・長い順へ並べ替えられなければならない。を**satisfy** | 並び替え試験 |
| `V8-SEARCH-017` | 1 | 有効 | 機能 | diopside v8の検索は、空の検索、結果0件、条件解除をそれぞれ区別して表示しなければならない。を**satisfy** | 画面試験 |
| `V8-SEARCH-018` | 1 | 有効 | 品質 | diopside v8の検索は、2,500動画の標準データでは、検索・絞り込み開始から結果更新までを100ミリ秒以内に完了しなければならない。を**satisfy** | ブラウザ性能試験 |
| `V8-SEARCH-019` | 1 | 有効 | 品質 | diopside v8の検索は、あいまい検索の品質を、版管理した日本語の固定評価データで検証しなければならない。を**satisfy** | 検索品質試験 |
| `V8-DISPLAY-001` | 1 | 有効 | 機能 | diopside v8の表示は、動画一覧は、動画タイトル、公開日、動画長、サムネイルを動画基本情報として表示しなければならない。を**satisfy** | 画面契約試験 |
| `V8-DISPLAY-002` | 1 | 有効 | 機能 | diopside v8の表示は、動画詳細は、動画基本情報とは別に、承認済みタグを「タグ」として表示しなければならない。を**satisfy** | 画面試験・用語確認 |
| `V8-DISPLAY-003` | 1 | 有効 | 機能 | diopside v8の表示は、動画詳細は、承認済みタイムスタンプを時刻の昇順で表示しなければならない。を**satisfy** | 境界値試験・画面試験 |
| `V8-DISPLAY-004` | 1 | 有効 | 機能 | diopside v8の表示は、各タイムスタンプは、対象動画の該当時刻をYouTubeで開けなければならない。を**satisfy** | リンク契約試験 |
| `V8-DISPLAY-005` | 1 | 有効 | 機能 | diopside v8の表示は、動画詳細は、承認済みのワードクラウドを表示しなければならない。を**satisfy** | 表示試験・再現性試験 |
| `V8-DISPLAY-006` | 1 | 有効 | 機能 | diopside v8の表示は、ワードクラウドの語句は、公開字幕、公開概要欄、または運用者が明示的に提供した公開本文を一時的に処理して作り、人の承認前に公開してはならない。を**satisfy** | 生成来歴確認・人手確認 |
| `V8-DISPLAY-007` | 1 | 有効 | 機能 | diopside v8の表示は、ワードクラウドの語句には、重要度を比較できる1～100の整数値を持たせなければならない。を**satisfy** | 構造・境界値試験 |
| `V8-DISPLAY-008` | 1 | 有効 | 機能 | diopside v8の表示は、ワードクラウドの入力資料を利用できない動画は、推測で語句を補わず「未作成」と表示しなければならない。を**satisfy** | 否定試験・画面試験 |
| `V8-DISPLAY-009` | 1 | 有効 | 機能 | diopside v8の表示は、ワードクラウドの語句をタイトル文字検索の対象へ混入してはならない。を**satisfy** | 検索除外試験 |
| `V8-DISPLAY-010` | 1 | 有効 | 機能 | diopside v8の表示は、動画詳細は、タグ、タイムスタンプ、ワードクラウドの最終更新日を日本語で示さなければならない。を**satisfy** | 画面契約試験 |
| `V8-DEVICE-001` | 1 | 有効 | 機能 | diopside v8の端末は、閲覧履歴はブラウザ内データベースへ保存しなければならない。を**satisfy** | ブラウザ試験 |
| `V8-DEVICE-002` | 1 | 有効 | 機能 | diopside v8の端末は、お気に入りはブラウザ内データベースへ保存しなければならない。を**satisfy** | ブラウザ試験 |
| `V8-DEVICE-003` | 1 | 有効 | 機能 | diopside v8の端末は、最近の検索語と絞り込み条件はブラウザ内データベースへ保存しなければならない。を**satisfy** | ブラウザ試験 |
| `V8-DEVICE-004` | 1 | 有効 | 機能 | diopside v8の端末は、利用者は、履歴、お気に入り、最近の検索条件を個別に削除できなければならない。を**satisfy** | 画面試験 |
| `V8-DEVICE-005` | 1 | 有効 | 機能 | diopside v8の端末は、利用者は、diopsideが保存した端末内データを一括削除できなければならない。を**satisfy** | ブラウザ試験 |
| `V8-DEVICE-006` | 1 | 有効 | 機能 | diopside v8の端末は、公開用の静的データはブラウザのキャッシュへ保存できなければならない。を**satisfy** | キャッシュ更新試験 |
| `V8-DEVICE-007` | 1 | 有効 | 機能 | diopside v8の端末は、ブラウザ内データの破損、容量超過、利用拒否が起きても、検索と閲覧を継続できなければならない。を**satisfy** | 障害注入試験 |
| `V8-DEVICE-008` | 1 | 有効 | 機能 | diopside v8の端末は、履歴、お気に入り、最近の検索条件をサーバーへ送信してはならない。を**satisfy** | 通信監査・画面試験 |
| `V8-DEVICE-009` | 1 | 有効 | 機能 | diopside v8の端末は、利用者向けログイン、アカウント登録、認証用画面、認証用クッキーを実装してはならない。を**satisfy** | 画面・通信・コード確認 |
| `V8-DEVICE-010` | 1 | 有効 | 機能 | diopside v8の端末は、端末内データはブラウザやサイトデータの削除で失われ、別端末へ同期されないことを日本語で説明しなければならない。を**satisfy** | 文言確認 |
| `V8-DEVICE-011` | 1 | 有効 | 機能 | diopside v8の端末は、利用者行動を解析・追跡する外部送信を行ってはならない。を**satisfy** | 通信監査・依存関係確認 |
| `V8-OPS-001` | 1 | 有効 | 運用 | diopside v8の運用は、動画の追加・更新処理は、運用者がChatGPT／Codexの画面から明示的に開始しなければならない。を**satisfy** | 運用手順確認 |
| `V8-OPS-002` | 1 | 有効 | 運用 | diopside v8の運用は、GitHub ActionsからChatGPT／Codexを呼び出してはならない。を**satisfy** | リポジトリ静的確認 |
| `V8-OPS-003` | 1 | 有効 | 運用 | diopside v8の運用は、動画確認、候補生成、検証、静的成果物生成、公開準備を行う独自の定期GitHub Actionsを持ってはならない。を**satisfy** | リポジトリ静的確認・手順試験 |
| `V8-OPS-004` | 1 | 有効 | 運用 | diopside v8の運用は、ChatGPT／Codexの利用は、運用者が契約済みの画面上の利用範囲に限定しなければならない。を**satisfy** | 構成確認・秘密情報確認 |
| `V8-OPS-005` | 1 | 有効 | 運用 | diopside v8の運用は、1回の手動実行で、公開動画と正本データを比較し、新規・更新・削除候補を特定できなければならない。を**satisfy** | 固定データ試験 |
| `V8-OPS-006` | 1 | 有効 | 運用 | diopside v8の運用は、対象候補が0件の場合は、生成物、ブランチ、プルリクエストを作成してはならない。を**satisfy** | 否定試験 |
| `V8-OPS-007` | 1 | 有効 | 運用 | diopside v8の運用は、通常の動画追加プルリクエストは、1動画だけを内容確認の対象としなければならない。を**satisfy** | 変更範囲試験 |
| `V8-OPS-008` | 1 | 有効 | 運用 | diopside v8の運用は、通常の動画追加プルリクエストでは、スキル、生成規則、タグ体系、構造定義、検証スクリプト、画面実装、Pages設定を変更してはならない。を**satisfy** | 変更範囲の否定試験 |
| `V8-OPS-009` | 1 | 有効 | 運用 | diopside v8の運用は、プルリクエスト作成前に、構造、タグ、タイムスタンプ、ワードクラウド、検索索引、公開禁止情報、静的画面を決定的スクリプトで検証しなければならない。を**satisfy** | 不正データ試験・手順試験 |
| `V8-OPS-010` | 1 | 有効 | 運用 | diopside v8の運用は、プルリクエスト本文は、対象動画、タグ候補、タイムスタンプ候補、ワードクラウド語句、根拠、検証結果、YouTube確認リンクを日本語で示さなければならない。を**satisfy** | プルリクエスト表示確認 |
| `V8-OPS-011` | 1 | 有効 | 運用 | diopside v8の運用は、生成候補は、人が確認してマージするまで公開してはならない。を**satisfy** | ブランチ境界試験 |
| `V8-OPS-012` | 1 | 有効 | 運用 | diopside v8の運用は、GitHub Pagesは、`main` ブランチの `/docs` にコミット済みの静的成果物だけを公開しなければならない。を**satisfy** | リポジトリ設定確認・公開確認 |
| `V8-OPS-013` | 1 | 有効 | 運用 | diopside v8の運用は、静的成果物は正本データから決定的に生成し、手作業で直接編集してはならない。を**satisfy** | 再現性試験 |
| `V8-OPS-014` | 1 | 有効 | 運用 | diopside v8の運用は、公開データと画面は、同じ公開版の識別子を持たなければならない。を**satisfy** | 契約試験 |
| `V8-OPS-015` | 1 | 有効 | 運用 | diopside v8の運用は、承認済み変更の取り消しによって、直前の正しい公開状態を再生成できなければならない。を**satisfy** | 復元訓練 |
| `V8-OPS-016` | 1 | 有効 | 運用 | diopside v8の運用は、更新頻度は自動の日次保証とせず、最終更新日時を画面で確認できなければならない。を**satisfy** | 画面試験 |
| `V8-TAG-001` | 1 | 有効 | データ | diopside v8のタグは、承認済み動画のタグは、版管理したタグ体系に基づかなければならない。を**satisfy** | 構造試験・追跡性確認 |
| `V8-TAG-002` | 1 | 有効 | データ | diopside v8のタグは、タグは大分類、小分類、タグの3層で管理し、表示名だけの平坦な配列を正本にしてはならない。を**satisfy** | 構造試験 |
| `V8-TAG-003` | 1 | 有効 | データ | diopside v8のタグは、各正規タグは表示名と独立した不変タグ識別子を持たなければならない。を**satisfy** | 移行試験 |
| `V8-TAG-004` | 1 | 有効 | データ | diopside v8のタグは、同じ表示名でも小分類または意味が異なるタグは別の不変識別子として扱わなければならない。を**satisfy** | 同名異義試験 |
| `V8-TAG-005` | 1 | 有効 | データ | diopside v8のタグは、承認済みの全動画は主ジャンルをちょうど1件持たなければならない。を**satisfy** | 基数試験 |
| `V8-TAG-006` | 1 | 有効 | データ | diopside v8のタグは、承認済みの全動画は動画形式をちょうど1件持たなければならない。を**satisfy** | 基数試験 |
| `V8-TAG-007` | 1 | 有効 | データ | diopside v8のタグは、承認済みの全動画は公開チャンネルをちょうど1件持たなければならない。を**satisfy** | 基数試験・人手確認 |
| `V8-TAG-008` | 1 | 有効 | データ | diopside v8のタグは、主ジャンル、動画形式、公開チャンネル以外は、タグ体系に定めた基数の範囲で異なる検索軸のタグを複数付与できなければならない。を**satisfy** | 基数・組合せ試験 |
| `V8-TAG-009` | 1 | 有効 | データ | diopside v8のタグは、ゲームを主または副ジャンルに持つ動画は、ゲーム作品名を1件以上、ゲームジャンルを1件以上3件以下持たなければならない。を**satisfy** | 条件付き必須試験 |
| `V8-TAG-010` | 1 | 有効 | データ | diopside v8のタグは、雑談を主または副ジャンルに持つ動画は、雑談種別を1件以上3件以下持たなければならない。を**satisfy** | 条件付き必須試験 |
| `V8-TAG-011` | 1 | 有効 | データ | diopside v8のタグは、同時視聴を主ジャンルに持つ動画は、同時視聴メディアを1件持ち、動画タイトル、動画固有の説明、公式作品表記のいずれかが一つの作品を示す場合は同時視聴作品名を1件以上持たなければならない。を**satisfy** | 条件付き必須・否定試験 |
| `V8-TAG-012` | 1 | 有効 | データ | diopside v8のタグは、朗読・声劇を主ジャンルに持つ動画は、朗読・声劇種別を1件持たなければならない。を**satisfy** | 条件付き必須試験 |
| `V8-TAG-013` | 1 | 有効 | データ | diopside v8のタグは、チャンネル主以外と共同で内容を行う動画は「コラボ」と、声、映像、通話、ゲーム・セッション参加、公式参加者表記で確認できる全出演者を持ち、チャンネル主を出演者へ重複登録してはならない。を**satisfy** | 意味論試験・人手確認 |
| `V8-TAG-014` | 1 | 有効 | データ | diopside v8のタグは、ユニット・チームタグを持つ動画は「コラボ」と実際に出演した構成員を持ち、欠席者や対戦相手を自動追加してはならない。を**satisfy** | 固定例試験・人手確認 |
| `V8-TAG-015` | 1 | 有効 | データ | diopside v8のタグは、実出演者と、配信中に名前を話題にしただけの言及人物を分離しなければならない。を**satisfy** | 排他試験 |
| `V8-TAG-016` | 1 | 有効 | データ | diopside v8のタグは、一つのタグには一つの検索対象または一つの分類事実だけを保存し、複数人物や独立概念を連結したタグは分解しなければならない。を**satisfy** | 分解規則試験 |
| `V8-TAG-017` | 1 | 有効 | データ | diopside v8のタグは、タグ照合はUnicode互換正規化、前後空白除去、連続空白の統合、英字大小の同一視、先頭ハッシュ記号の同一視を定義順で行わなければならない。を**satisfy** | 正規化境界値試験 |
| `V8-TAG-018` | 1 | 有効 | データ | diopside v8のタグは、登録済み別名は完全一致で正規タグへ解決し、公開データと画面には正規タグだけを表示しなければならない。を**satisfy** | 別名契約試験 |
| `V8-TAG-019` | 1 | 有効 | データ | diopside v8のタグは、既存タグ体系にない語を動画追加と同時に正規タグとして発行してはならない。を**satisfy** | 変更範囲の否定試験 |
| `V8-TAG-020` | 1 | 有効 | データ | diopside v8のタグは、「その他」「不明」「要確認」「未分類」「レビュー」を確定タグとして保存してはならない。を**satisfy** | 禁止値試験 |
| `V8-TAG-021` | 1 | 有効 | データ | diopside v8のタグは、各タグ付与は、タグ固有の付与理由、根拠の種類、根拠参照、確度を持たなければならない。を**satisfy** | 構造試験・人手監査 |
| `V8-TAG-022` | 1 | 有効 | データ | diopside v8のタグは、タグ判断は、動画タイトル、動画固有の説明、公式の出演者・作品・企画表記、全編字幕または文字起こし、公式一次資料、既存の承認済みタグの順に確認しなければならない。を**satisfy** | 根拠優先順位試験 |
| `V8-TAG-023` | 1 | 有効 | データ | diopside v8のタグは、コメントまたはチャットの単発言及だけで、出演者、コラボ、作品、企画、言及タグを確定してはならない。を**satisfy** | 攻撃・誤検出試験 |
| `V8-TAG-024` | 1 | 有効 | データ | diopside v8のタグは、公開可能なタグ付与の確度は「高」または「中」だけとし、「低」および確認待ちを公開してはならない。を**satisfy** | 許可値・根拠組合せ試験 |
| `V8-TAG-025` | 1 | 有効 | データ | diopside v8のタグは、同一動画内で同一タグ識別子を重複させず、タグ件数はそのタグを持つ異なる動画数として数えなければならない。を**satisfy** | 重複・件数試験 |
| `V8-TAG-026` | 1 | 有効 | データ | diopside v8のタグは、タグ正本は構造版、タグ体系版、別名版、生成規則版、生成日時、入力一覧、動画件数、付与件数を持たなければならない。を**satisfy** | 構造・件数試験 |
| `V8-TAG-027` | 1 | 有効 | データ | diopside v8のタグは、公開用動画データは不変タグ識別子だけを参照し、表示名と分類は同じ公開版のタグ索引から解決しなければならない。を**satisfy** | 参照整合性試験 |
| `V8-TAG-028` | 1 | 有効 | データ | diopside v8のタグは、タグ固有の理由と根拠参照は確認用正本またはプルリクエストに保持し、公開用JSONへ字幕断片、コメント本文、投稿者情報を含めてはならない。を**satisfy** | 公開境界試験 |
| `V8-TAG-029` | 1 | 有効 | データ | diopside v8のタグは、同じ動画入力、タグ体系版、別名版、生成規則版から同じ論理タグ集合を再生成できなければならない。を**satisfy** | 再現性試験 |
| `V8-TAG-030` | 1 | 有効 | データ | diopside v8のタグは、タグ、別名、分類を変更する場合は、包含基準、除外基準、影響件数、既存データ移行、版更新を同じ保守変更で定めなければならない。を**satisfy** | 変更管理試験 |
| `V8-TAG-031` | 1 | 有効 | データ | diopside v8のタグは、必須タグを確定できない動画は承認済み公開データへ入れず、確認待ち理由を残さなければならない。を**satisfy** | 集合一致試験 |
| `V8-TAG-032` | 1 | 有効 | データ | diopside v8のタグは、公開画面はタグをdiopsideが整理・確認した情報として示し、YouTube公式分類と誤認させてはならない。を**satisfy** | 文言・画面試験 |
| `V8-TAG-033` | 1 | 有効 | データ | diopside v8のタグは、動画詳細は承認済みタグを大分類ごとにまとめ、同名異義タグには小分類の文脈を示さなければならない。を**satisfy** | 画面・アクセシビリティ試験 |
| `V8-TAG-034` | 1 | 有効 | データ | diopside v8のタグは、タグ表示名は公式な日本語名がある場合は日本語を用い、公式固有名詞と一般に定着した略称は出典表記を保たなければならない。を**satisfy** | 文言一覧・人手確認 |
| `V8-TAG-035` | 1 | 有効 | データ | diopside v8のタグは、人物・グループ分類を除くタグが1動画あたり12件を超える候補は、過剰付与の確認待ちにしなければならない。を**satisfy** | 基数集計・人手確認 |
| `V8-TIME-001` | 1 | 有効 | データ | diopside v8の時刻は、タイムスタンプは動画全体を移動するための目次として作り、見どころ候補と別のデータとして扱わなければならない。を**satisfy** | 意味論監査 |
| `V8-TIME-002` | 1 | 有効 | データ | diopside v8の時刻は、v8.0では動画形式が「配信」の動画を既定の作成対象とし、「Shorts」と単曲の「歌ってみた」は対象外にしなければならない。を**satisfy** | 対象集合・境界値試験 |
| `V8-TIME-003` | 1 | 有効 | データ | diopside v8の時刻は、各対象動画は「作成済み」または理由付きの「未作成」の状態を持たなければならない。を**satisfy** | 状態遷移・画面試験 |
| `V8-TIME-004` | 1 | 有効 | データ | diopside v8の時刻は、動画長が30秒未満の動画は、YouTube章の最小条件を満たせないため「短尺」として未作成にしなければならない。を**satisfy** | 境界値試験 |
| `V8-TIME-005` | 1 | 有効 | データ | diopside v8の時刻は、作成者が概要欄等に有効な時刻一覧を公開している場合は、それを最優先の候補として保持し、無断で全置換してはならない。を**satisfy** | 形式検証・差分確認 |
| `V8-TIME-006` | 1 | 有効 | データ | diopside v8の時刻は、新規生成の根拠は、作成者の時刻一覧、公開の日本語原文字幕、公開の日本語字幕、全編を覆う無償のローカル音声認識または運用者提供の文字起こしの順に使用しなければならない。を**satisfy** | 入力経路試験・費用確認 |
| `V8-TIME-007` | 1 | 有効 | データ | diopside v8の時刻は、作成者の有効な時刻一覧をそのまま採用する場合を除き、新規生成は動画の0秒から動画末尾までを処理対象にした字幕または文字起こしを確認してから行わなければならない。を**satisfy** | 全編網羅試験 |
| `V8-TIME-008` | 1 | 有効 | データ | diopside v8の時刻は、全編根拠を用意できない場合は、既知のコメント時刻周辺だけを調べて残りを推測してはならない。を**satisfy** | 否定試験 |
| `V8-TIME-009` | 1 | 有効 | データ | diopside v8の時刻は、コメント、返信、チャット、反応量の山は境界候補の補助にだけ使用し、単独では最終境界または章名の根拠にしてはならない。を**satisfy** | 根拠種別試験 |
| `V8-TIME-010` | 1 | 有効 | データ | diopside v8の時刻は、タイムスタンプ境界は内容の開始・転換・終了に置き、固定間隔または固定章数で作ってはならない。を**satisfy** | 固定例による意味論監査 |
| `V8-TIME-011` | 1 | 有効 | データ | diopside v8の時刻は、ジャンルごとの境界と公開名は、本節の基準表に従わなければならない。を**satisfy** | ジャンル別受入試験 |
| `V8-TIME-012` | 1 | 有効 | データ | diopside v8の時刻は、各タイムスタンプは一意な識別子、開始秒、公開用の短い日本語名、確度、根拠参照を持たなければならない。を**satisfy** | 構造試験 |
| `V8-TIME-013` | 1 | 有効 | データ | diopside v8の時刻は、最初のタイムスタンプは0秒でなければならない。を**satisfy** | 境界値試験 |
| `V8-TIME-014` | 1 | 有効 | データ | diopside v8の時刻は、作成済みのタイムスタンプは3件以上でなければならない。を**satisfy** | 基数試験 |
| `V8-TIME-015` | 1 | 有効 | データ | diopside v8の時刻は、開始秒は整数、重複なし、厳密な昇順とし、隣接する開始秒の差を10秒以上にしなければならない。を**satisfy** | 順序・境界値試験 |
| `V8-TIME-016` | 1 | 有効 | データ | diopside v8の時刻は、各開始秒は0以上かつ動画長未満でなければならない。を**satisfy** | 範囲試験 |
| `V8-TIME-017` | 1 | 有効 | データ | diopside v8の時刻は、各章の終了秒は次の章の開始秒、最終章の終了秒は動画長として導出し、動画全体を重複なく連続して覆わなければならない。を**satisfy** | 区間連続性試験 |
| `V8-TIME-018` | 1 | 有効 | データ | diopside v8の時刻は、0秒の公開名は、待機時間ではなく最初の有用な移動区間の内容を示さなければならない。を**satisfy** | 冒頭固定例試験 |
| `V8-TIME-019` | 1 | 有効 | データ | diopside v8の時刻は、内容のない冒頭待機、休止画面、末尾無音だけを独立した章にしてはならない。を**satisfy** | 否定試験 |
| `V8-TIME-020` | 1 | 有効 | データ | diopside v8の時刻は、隣接する章が同じ移動目的を持つ場合は統合し、継続する話題・試合・曲・場面を探す助けにならない単発のリアクションや出来事を独立章にしてはならない。を**satisfy** | 過分割試験 |
| `V8-TIME-021` | 1 | 有効 | データ | diopside v8の時刻は、公開用の章名は、該当区間の根拠から直接確認できる内容だけを表さなければならない。を**satisfy** | 事実確認 |
| `V8-TIME-022` | 1 | 有効 | データ | diopside v8の時刻は、ゲーム、TRPG、同時視聴、朗読・声劇の公開用章名は、犯人、秘密、正体、判定結果、結末、最終遭遇等のネタバレを避けなければならない。を**satisfy** | ネタバレ試験・人手確認 |
| `V8-TIME-023` | 1 | 有効 | データ | diopside v8の時刻は、公開用章名は1文字以上60文字以下の自然な日本語を基本とし、公式固有名詞は出典表記を保たなければならない。を**satisfy** | 文字数・文言試験 |
| `V8-TIME-024` | 1 | 有効 | データ | diopside v8の時刻は、公開可能なタイムスタンプの確度は「高」または「中」だけとし、「低」および確認待ちを公開してはならない。を**satisfy** | 許可値試験 |
| `V8-TIME-025` | 1 | 有効 | データ | diopside v8の時刻は、0秒を除くすべての境界は、作成者の時刻一覧または境界前後の字幕・文字起こしへ解決できる根拠参照を持たなければならない。を**satisfy** | 参照整合性試験 |
| `V8-TIME-026` | 1 | 有効 | データ | diopside v8の時刻は、根拠が競合する境界、音声認識が不明瞭な境界、時刻が一意に定まらない境界は確定せず、確認待ち理由を残さなければならない。を**satisfy** | 曖昧入力試験 |
| `V8-TIME-027` | 1 | 有効 | データ | diopside v8の時刻は、候補の事実確認では、適用経路が作成者一覧の採用または全編根拠による生成のいずれかであること、根拠参照、境界前後、章名の裏付け、根拠競合を確認しなければならない。を**satisfy** | 独立レビュー確認 |
| `V8-TIME-028` | 1 | 有効 | データ | diopside v8の時刻は、候補の編集確認では、移動価値、過分割、分割不足、名称統一、ネタバレを事実確認とは別に確認しなければならない。を**satisfy** | 入力記録・独立レビュー確認 |
| `V8-TIME-029` | 1 | 有効 | データ | diopside v8の時刻は、事実確認と編集確認の両方が同じ候補版へ合格した場合だけ、人の最終確認へ進めなければならない。を**satisfy** | 版・状態遷移試験 |
| `V8-TIME-030` | 1 | 有効 | データ | diopside v8の時刻は、決定的検証は、0秒開始、3件以上、整数、昇順、10秒以上、動画長内、全区間網羅、非空名、許可確度、根拠参照、未解決重大指摘なしをすべて確認しなければならない。を**satisfy** | 不正データ総当たり試験 |
| `V8-TIME-031` | 1 | 有効 | データ | diopside v8の時刻は、動画詳細の各タイムスタンプは、対象動画の同じ開始秒をYouTubeで開く確認リンクを持たなければならない。を**satisfy** | リンク契約試験 |
| `V8-TIME-032` | 1 | 有効 | データ | diopside v8の時刻は、タイムスタンプの章名をタイトル文字検索へ混入してはならない。を**satisfy** | 検索除外試験 |
| `V8-TIME-033` | 1 | 有効 | データ | diopside v8の時刻は、公開用データには承認済みの時刻、公開名、確度、必要最小限の生成来歴だけを含め、生の字幕、文字起こし、コメント、チャットを含めてはならない。を**satisfy** | 公開境界試験 |
| `V8-TIME-034` | 1 | 有効 | データ | diopside v8の時刻は、既存の承認済みタイムスタンプを更新する場合は、追加、削除、移動、改名の差分と理由を人へ提示しなければならない。を**satisfy** | 差分契約試験 |
| `V8-TIME-035` | 1 | 有効 | データ | diopside v8の時刻は、タイムスタンプ生成来歴から、動画、入力指紋、根拠の種類と範囲、生成規則版、生成日時、確認結果、確認プルリクエストを追跡できなければならない。を**satisfy** | 追跡性・冪等性試験 |
| `V8-TIME-036` | 1 | 有効 | データ | diopside v8の時刻は、初回公開前に、ゲーム8件、企画6件、雑談5件、ASMR3件、歌2件、朗読・声劇2件、同時視聴2件、TRPG2件の固定30動画で品質を確認しなければならない。を**satisfy** | 固定評価データによる受入試験 |
| `V8-TIME-037` | 1 | 有効 | データ | diopside v8の時刻は、公開画面は各タイムスタンプの由来を「作成者による時刻一覧」「作成者一覧を基にdiopsideで調整」「diopsideで作成した時刻一覧」のいずれかとして区別し、YouTube公式情報と誤認させてはならない。を**satisfy** | 文言・画面試験 |
| `V8-COST-001` | 1 | 有効 | 運用 | diopside v8の費用は、サービス運用に起因する請求額は、既存のChatGPT／Codex契約を除いて毎月0円でなければならない。を**satisfy** | 月次請求確認 |
| `V8-COST-002` | 1 | 有効 | 運用 | diopside v8の費用は、公開基盤は、公開リポジトリで利用できるGitHub Pagesと既定の `github.io` 配下のURLに限定しなければならない。を**satisfy** | リポジトリ・Pages設定確認 |
| `V8-COST-003` | 1 | 有効 | 運用 | diopside v8の費用は、AWSその他の有料クラウド資源をv8の閲覧・検索・生成・公開に使用してはならない。を**satisfy** | 構成確認 |
| `V8-COST-004` | 1 | 有効 | 運用 | diopside v8の費用は、有料または従量課金の検索、データベース、アクセス解析、監視、生成、配信サービスへ依存してはならない。を**satisfy** | 依存関係・通信確認 |
| `V8-COST-005` | 1 | 有効 | 運用 | diopside v8の費用は、外部サービスの料金または無償条件が変わり請求が発生し得る場合は、課金して継続せず、該当処理を停止しなければならない。を**satisfy** | 運用手順確認 |
| `V8-QUALITY-001` | 1 | 有効 | 品質 | diopside v8の品質は、検索、絞り込み、履歴、お気に入り、ワードクラウド描画はブラウザ内で処理しなければならない。を**satisfy** | 通信監査 |
| `V8-QUALITY-002` | 1 | 有効 | 品質 | diopside v8の品質は、公開画面はスマートフォンを主要環境とし、検索からYouTubeを開くまでを初見利用者が1分以内に完了できなければならない。を**satisfy** | 利用者試験 |
| `V8-QUALITY-003` | 1 | 有効 | 品質 | diopside v8の品質は、操作対象は44画素以上、キーボード操作可能、フォーカス表示あり、状態変化を読み上げ可能でなければならない。を**satisfy** | 自動試験・手動確認 |
| `V8-QUALITY-004` | 1 | 有効 | 品質 | diopside v8の品質は、画面の見出し、ボタン、説明、状態、エラー、絞り込み名は自然な日本語でなければならない。を**satisfy** | 文言一覧の機械確認・人手確認 |
| `V8-QUALITY-005` | 1 | 有効 | 品質 | diopside v8の品質は、公開データの取得失敗、構造不適合、公開版不一致、正常な0件を区別して日本語で表示しなければならない。を**satisfy** | 障害注入試験 |
| `V8-SAFETY-001` | 1 | 有効 | 制約 | diopside v8の安全は、動画タイトル、説明、字幕、コメント、チャット、Issue本文、プルリクエスト本文の外部入力を、命令ではなく信頼できない資料として扱わなければならない。を**satisfy** | 攻撃入力試験 |
| `V8-SAFETY-002` | 1 | 有効 | 制約 | diopside v8の安全は、生の字幕、生のコメント、生のチャット、投稿者識別子をGit履歴またはPagesへ保存してはならない。を**satisfy** | 公開境界試験 |
| `V8-SAFETY-003` | 1 | 有効 | 制約 | diopside v8の安全は、秘密情報をリポジトリ、プルリクエスト、確認報告、Pagesへ含めてはならない。を**satisfy** | 秘密情報検査 |
| `V8-SAFETY-004` | 1 | 有効 | 制約 | diopside v8の安全は、削除、非公開化、対象外化が確認された動画を次の公開版から除外し、再追加を防止しなければならない。を**satisfy** | 削除・再追加試験 |

## V8-SEARCH-001: 文字検索は、承認済み動画の動画タイトルだけを検索対象としなければならない

diopside v8の検索は、文字検索は、承認済み動画の動画タイトルだけを検索対象としなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-001-1` 前提: V8-検索-001の前提を満たす公開データまたは操作がある。条件: 固定検索データによる単体試験・画面試験。期待結果: 検索語がタイトルにある動画だけが文字一致候補になる。。

要求源: Issue #1 V8-検索-001, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-002: 説明文、タグ、タイムスタンプ、ワードクラウド、字幕、コメント、チャット、チャンネル名、生成来歴を文字検索対象にしてはならない

diopside v8の検索は、説明文、タグ、タイムスタンプ、ワードクラウド、字幕、コメント、チャット、チャンネル名、生成来歴を文字検索対象にしてはならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-002-1` 前提: V8-検索-002の前提を満たす公開データまたは操作がある。条件: 除外対象ごとの否定試験。期待結果: 検索語が除外対象にだけ存在する動画は、文字検索だけでは表示されない。。

要求源: Issue #1 V8-検索-002, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-003: 検索時は、表示用タイトルを変えずに、照合専用文字列を定義済みの順序で正規化しなければならない

diopside v8の検索は、検索時は、表示用タイトルを変えずに、照合専用文字列を定義済みの順序で正規化しなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-003-1` 前提: V8-検索-003の前提を満たす公開データまたは操作がある。条件: 正規化表の境界値試験。期待結果: Unicode互換正規化、英字小文字化、カタカナのひらがな化、文字・数字・仮名・漢字・長音記号以外の空白化、連続空白の1文字化、前後空白除去の順に処理し、元タイトルは原文表示される。。

要求源: Issue #1 V8-検索-003, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-004: 空白で区切られた複数の検索語は、すべてが同じ動画タイトルに一致する場合だけ検索一致としなければならない

diopside v8の検索は、空白で区切られた複数の検索語は、すべてが同じ動画タイトルに一致する場合だけ検索一致としなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-004-1` 前提: V8-検索-004の前提を満たす公開データまたは操作がある。条件: 複数語の組合せ試験。期待結果: 2語の一方だけを含むタイトルは除外され、両方を含むタイトルは語順にかかわらず残る。。

要求源: Issue #1 V8-検索-004, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-005: 3文字以上の検索語には、軽微な脱字、余分な1文字、1文字の誤り、隣接2文字の入れ替わりを許容するあいまい検索を適用しなければならない

diopside v8の検索は、3文字以上の検索語には、軽微な脱字、余分な1文字、1文字の誤り、隣接2文字の入れ替わりを許容するあいまい検索を適用しなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-005-1` 前提: V8-検索-005の前提を満たす公開データまたは操作がある。条件: 編集距離の正常・境界・超過試験。期待結果: 正規化後3～5文字は編集距離1以内、6文字以上は編集距離2以内で候補になり、1～2文字にはあいまい検索を適用しない。。

要求源: Issue #1 V8-検索-005, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-006: あいまい一致は、検索語の長さを `n`、許容編集距離を `d` としたとき、タイトル内の長さ `n-d` から `n+d` までの連続部分との最小Damerau

diopside v8の検索は、あいまい一致は、検索語の長さを `n`、許容編集距離を `d` としたとき、タイトル内の長さ `n-d` から `n+d` までの連続部分との最小Damerau–Levenshtein距離で判定しなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-006-1` 前提: V8-検索-006の前提を満たす公開データまたは操作がある。条件: 長文タイトルの固定例試験。期待結果: 長いタイトル内の一部にある軽微な誤入力を拾い、許容距離を1超えた候補は除外される。。

要求源: Issue #1 V8-検索-006, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-007: 検索結果は、一致の確かさが高い順に決定的に並べなければならない

diopside v8の検索は、検索結果は、一致の確かさが高い順に決定的に並べなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-007-1` 前提: V8-検索-007の前提を満たす公開データまたは操作がある。条件: 順位契約試験。期待結果: 正規化後のタイトル全体一致、検索語全体の先頭一致、検索語全体の部分一致、全検索語の正確な部分一致、1語以上をあいまい一致させた全検索語一致の順とし、同順位は編集距離合計の小さい順、公開日の新しい順、動画識別子の順で固定される。。

要求源: Issue #1 V8-検索-007, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-008: タグは検索欄とは分離し、選択可能な補助候補として日本語名と追加選択後の該当件数を表示しなければならない

diopside v8の検索は、タグは検索欄とは分離し、選択可能な補助候補として日本語名と追加選択後の該当件数を表示しなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-008-1` 前提: V8-検索-008の前提を満たす公開データまたは操作がある。条件: 画面試験・件数契約試験。期待結果: 現在のタイトル・公開日・動画長・選択済みタグへ候補タグを1件追加した場合の件数を示す。検索語を入力してもタグは自動選択されない。。

要求源: Issue #1 V8-検索-008, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-009: タグ絞り込みは、選択された承認済みタグの不変識別子との完全一致で判定しなければならない

diopside v8の検索は、タグ絞り込みは、選択された承認済みタグの不変識別子との完全一致で判定しなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-009-1` 前提: V8-検索-009の前提を満たす公開データまたは操作がある。条件: タグ契約試験。期待結果: 部分一致、あいまい一致、同名の別タグでは一致しない。登録済み別名から選んだ場合も同じ不変識別子へ解決される。。

要求源: Issue #1 V8-検索-009, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-010: 複数タグを選択した場合は、選択したすべてのタグを持つ動画だけを表示しなければならない

diopside v8の検索は、複数タグを選択した場合は、選択したすべてのタグを持つ動画だけを表示しなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-010-1` 前提: V8-検索-010の前提を満たす公開データまたは操作がある。条件: 2件・3件・未知タグの積集合試験。期待結果: タグAとタグBの選択時に、AだけまたはBだけの動画を除外し、AとBの両方を持つ動画だけを残す。。

要求源: Issue #1 V8-検索-010, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-011: 公開日の開始日と終了日は、日本標準時の日付として両端を含めて絞り込まなければならない

diopside v8の検索は、公開日の開始日と終了日は、日本標準時の日付として両端を含めて絞り込まなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-011-1` 前提: V8-検索-011の前提を満たす公開データまたは操作がある。条件: 時差・月末・年末・逆転範囲試験。期待結果: 開始日の0時0分0秒から終了日の23時59分59秒までを含み、開始日が終了日より後の場合は日本語で入力誤りを示す。。

要求源: Issue #1 V8-検索-011, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-012: 動画長は秒数を正本とし、画面では「30分未満」「30分以上1時間未満」「1時間以上2時間未満」「2時間以上」の重複しない区分で絞り込めなければならない

diopside v8の検索は、動画長は秒数を正本とし、画面では「30分未満」「30分以上1時間未満」「1時間以上2時間未満」「2時間以上」の重複しない区分で絞り込めなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-012-1` 前提: V8-検索-012の前提を満たす公開データまたは操作がある。条件: 境界値試験。期待結果: 1799、1800、3599、3600、7199、7200秒が定義された区分に一意に入る。区分の選択は同じ境界値を最小値・最大値欄へ反映する。。

要求源: Issue #1 V8-検索-012, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-013: 動画長の最小値・最大値を分単位で指定でき、最小値以上かつ最大値以下の動画だけを表示しなければならない

diopside v8の検索は、動画長の最小値・最大値を分単位で指定でき、最小値以上かつ最大値以下の動画だけを表示しなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-013-1` 前提: V8-検索-013の前提を満たす公開データまたは操作がある。条件: 範囲・欠損・誤入力試験。期待結果: 片側だけの指定、同値、最小値が最大値を超える入力、動画長不明を定義どおり処理する。手入力時は区分選択を解除し、動画長不明は動画長指定時に除外する。。

要求源: Issue #1 V8-検索-013, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-014: タイトル検索、選択タグ、公開日、動画長は、指定された条件をすべて満たす動画だけを残すよう同時適用しなければならない

diopside v8の検索は、タイトル検索、選択タグ、公開日、動画長は、指定された条件をすべて満たす動画だけを残すよう同時適用しなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-014-1` 前提: V8-検索-014の前提を満たす公開データまたは操作がある。条件: 組合せ試験。期待結果: 各条件単独では残るが、全条件を満たさない動画は複合絞り込みで除外される。。

要求源: Issue #1 V8-検索-014, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-015: 検索語がある場合の初期並び順は関連度順、検索語がない場合の初期並び順は公開日の新しい順としなければならない

diopside v8の検索は、検索語がある場合の初期並び順は関連度順、検索語がない場合の初期並び順は公開日の新しい順としなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-015-1` 前提: V8-検索-015の前提を満たす公開データまたは操作がある。条件: 画面状態試験。期待結果: 入力の有無を切り替えたとき、定義された並び順へ一意に切り替わる。。

要求源: Issue #1 V8-検索-015, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-016: 利用者は、公開日の新しい順・古い順、動画長の短い順・長い順へ並べ替えられなければならない

diopside v8の検索は、利用者は、公開日の新しい順・古い順、動画長の短い順・長い順へ並べ替えられなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-016-1` 前提: V8-検索-016の前提を満たす公開データまたは操作がある。条件: 並び替え試験。期待結果: 同値時の順序が動画識別子で固定され、再読み込みでも同じになる。。

要求源: Issue #1 V8-検索-016, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-017: 空の検索、結果0件、条件解除をそれぞれ区別して表示しなければならない

diopside v8の検索は、空の検索、結果0件、条件解除をそれぞれ区別して表示しなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-SEARCH-017-1` 前提: V8-検索-017の前提を満たす公開データまたは操作がある。条件: 画面試験。期待結果: 空の検索は全承認済み動画、0件は日本語の案内と条件解除導線、全解除は初期状態を表示する。。

要求源: Issue #1 V8-検索-017, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-018: 2,500動画の標準データでは、検索・絞り込み開始から結果更新までを100ミリ秒以内に完了しなければならない

diopside v8の検索は、2,500動画の標準データでは、検索・絞り込み開始から結果更新までを100ミリ秒以内に完了しなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `nonfunctional`

受入条件:
- `AC-V8-SEARCH-018-1` 前提: V8-検索-018の前提を満たす公開データまたは操作がある。条件: ブラウザ性能試験。期待結果: 画面幅375×812画素、Chromium安定版、4倍のCPU低速化、公開データ取得済みの条件で、代表検索20件の95パーセンタイルが100ミリ秒以下である。。

要求源: Issue #1 V8-検索-018, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SEARCH-019: あいまい検索の品質を、版管理した日本語の固定評価データで検証しなければならない

diopside v8の検索は、あいまい検索の品質を、版管理した日本語の固定評価データで検証しなければならない。を**satisfy**。

根拠: 利用者が題名の断片や表記揺れから、意図した公開アーカイブを速く再発見できるようにするため。

分類: `product` / `nonfunctional`

受入条件:
- `AC-V8-SEARCH-019-1` 前提: V8-検索-019の前提を満たす公開データまたは操作がある。条件: 検索品質試験。期待結果: 完全一致、かな表記差、全半角差、空白差、1文字誤り、脱字、余字、隣接入替、誤一致防止を含む20件以上がすべて期待順位を満たす。。

要求源: Issue #1 V8-検索-019, user:2026-08-03
検証証跡: src/domain/search.test.ts, e2e/search.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/domain/search.ts,src/features/search/SearchPage.tsx; テスト=src/domain/search.test.ts,e2e/search.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DISPLAY-001: 動画一覧は、動画タイトル、公開日、動画長、サムネイルを動画基本情報として表示しなければならない

diopside v8の表示は、動画一覧は、動画タイトル、公開日、動画長、サムネイルを動画基本情報として表示しなければならない。を**satisfy**。

根拠: 利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DISPLAY-001-1` 前提: V8-表示-001の前提を満たす公開データまたは操作がある。条件: 画面契約試験。期待結果: 値あり・値なしの固定データで、欠損を0や空文字として偽装しない。。

要求源: Issue #1 V8-表示-001, user:2026-08-03
検証証跡: src/domain/validation.test.ts, e2e/detail.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/features/detail/VideoDetailPage.tsx,src/styles.css; テスト=src/domain/validation.test.ts,e2e/detail.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DISPLAY-002: 動画詳細は、動画基本情報とは別に、承認済みタグを「タグ」として表示しなければならない

diopside v8の表示は、動画詳細は、動画基本情報とは別に、承認済みタグを「タグ」として表示しなければならない。を**satisfy**。

根拠: 利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DISPLAY-002-1` 前提: V8-表示-002の前提を満たす公開データまたは操作がある。条件: 画面試験・用語確認。期待結果: 複数分類の付加情報がすべてタグ欄にまとまり、別名の分類欄が出ない。。

要求源: Issue #1 V8-表示-002, user:2026-08-03
検証証跡: src/domain/validation.test.ts, e2e/detail.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/features/detail/VideoDetailPage.tsx,src/styles.css; テスト=src/domain/validation.test.ts,e2e/detail.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DISPLAY-003: 動画詳細は、承認済みタイムスタンプを時刻の昇順で表示しなければならない

diopside v8の表示は、動画詳細は、承認済みタイムスタンプを時刻の昇順で表示しなければならない。を**satisfy**。

根拠: 利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DISPLAY-003-1` 前提: V8-表示-003の前提を満たす公開データまたは操作がある。条件: 境界値試験・画面試験。期待結果: 0秒、通常時刻、最終章、未作成の各状態が定義どおり表示され、最終章の終了は動画長と一致する。。

要求源: Issue #1 V8-表示-003, user:2026-08-03
検証証跡: src/domain/validation.test.ts, e2e/detail.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/features/detail/VideoDetailPage.tsx,src/styles.css; テスト=src/domain/validation.test.ts,e2e/detail.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DISPLAY-004: 各タイムスタンプは、対象動画の該当時刻をYouTubeで開けなければならない

diopside v8の表示は、各タイムスタンプは、対象動画の該当時刻をYouTubeで開けなければならない。を**satisfy**。

根拠: 利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DISPLAY-004-1` 前提: V8-表示-004の前提を満たす公開データまたは操作がある。条件: リンク契約試験。期待結果: 動画識別子と秒数を含む正しいリンクが生成される。。

要求源: Issue #1 V8-表示-004, user:2026-08-03
検証証跡: src/domain/validation.test.ts, e2e/detail.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/features/detail/VideoDetailPage.tsx,src/styles.css; テスト=src/domain/validation.test.ts,e2e/detail.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DISPLAY-005: 動画詳細は、承認済みのワードクラウドを表示しなければならない

diopside v8の表示は、動画詳細は、承認済みのワードクラウドを表示しなければならない。を**satisfy**。

根拠: 利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DISPLAY-005-1` 前提: V8-表示-005の前提を満たす公開データまたは操作がある。条件: 表示試験・再現性試験。期待結果: 20～50語を重要度に応じた大きさで表示し、同じ入力、画面幅、描画規則から同じ語句、大きさ、位置を再現できる。。

要求源: Issue #1 V8-表示-005, user:2026-08-03
検証証跡: src/domain/validation.test.ts, e2e/detail.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/features/detail/VideoDetailPage.tsx,src/styles.css; テスト=src/domain/validation.test.ts,e2e/detail.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DISPLAY-006: ワードクラウドの語句は、公開字幕、公開概要欄、または運用者が明示的に提供した公開本文を一時的に処理して作り、人の承認前に公開してはならない

diopside v8の表示は、ワードクラウドの語句は、公開字幕、公開概要欄、または運用者が明示的に提供した公開本文を一時的に処理して作り、人の承認前に公開してはならない。を**satisfy**。

根拠: 利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DISPLAY-006-1` 前提: V8-表示-006の前提を満たす公開データまたは操作がある。条件: 生成来歴確認・人手確認。期待結果: 使用した入力種別、除外語規則、生成規則の版と確認結果をプルリクエストから追跡できる。。

要求源: Issue #1 V8-表示-006, user:2026-08-03
検証証跡: src/domain/validation.test.ts, e2e/detail.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/features/detail/VideoDetailPage.tsx,src/styles.css; テスト=src/domain/validation.test.ts,e2e/detail.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DISPLAY-007: ワードクラウドの語句には、重要度を比較できる1～100の整数値を持たせなければならない

diopside v8の表示は、ワードクラウドの語句には、重要度を比較できる1～100の整数値を持たせなければならない。を**satisfy**。

根拠: 利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DISPLAY-007-1` 前提: V8-表示-007の前提を満たす公開データまたは操作がある。条件: 構造・境界値試験。期待結果: 0、101、小数、欠損、重複語を検証で拒否し、正規化後の同一語を統合する。。

要求源: Issue #1 V8-表示-007, user:2026-08-03
検証証跡: src/domain/validation.test.ts, e2e/detail.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/features/detail/VideoDetailPage.tsx,src/styles.css; テスト=src/domain/validation.test.ts,e2e/detail.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DISPLAY-008: ワードクラウドの入力資料を利用できない動画は、推測で語句を補わず「未作成」と表示しなければならない

diopside v8の表示は、ワードクラウドの入力資料を利用できない動画は、推測で語句を補わず「未作成」と表示しなければならない。を**satisfy**。

根拠: 利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DISPLAY-008-1` 前提: V8-表示-008の前提を満たす公開データまたは操作がある。条件: 否定試験・画面試験。期待結果: 入力なしの固定データで空の画像を作らず、理由を日本語で表示する。。

要求源: Issue #1 V8-表示-008, user:2026-08-03
検証証跡: src/domain/validation.test.ts, e2e/detail.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/features/detail/VideoDetailPage.tsx,src/styles.css; テスト=src/domain/validation.test.ts,e2e/detail.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DISPLAY-009: ワードクラウドの語句をタイトル文字検索の対象へ混入してはならない

diopside v8の表示は、ワードクラウドの語句をタイトル文字検索の対象へ混入してはならない。を**satisfy**。

根拠: 利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DISPLAY-009-1` 前提: V8-表示-009の前提を満たす公開データまたは操作がある。条件: 検索除外試験。期待結果: ワードクラウドにだけ存在する語で検索しても、文字検索だけでは動画が一致しない。。

要求源: Issue #1 V8-表示-009, user:2026-08-03
検証証跡: src/domain/validation.test.ts, e2e/detail.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/features/detail/VideoDetailPage.tsx,src/styles.css; テスト=src/domain/validation.test.ts,e2e/detail.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DISPLAY-010: 動画詳細は、タグ、タイムスタンプ、ワードクラウドの最終更新日を日本語で示さなければならない

diopside v8の表示は、動画詳細は、タグ、タイムスタンプ、ワードクラウドの最終更新日を日本語で示さなければならない。を**satisfy**。

根拠: 利用者が動画を開く前に、承認済みの内容と移動先を確認できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DISPLAY-010-1` 前提: V8-表示-010の前提を満たす公開データまたは操作がある。条件: 画面契約試験。期待結果: 更新日あり・なしを区別し、生成日を公開日と誤表示しない。。

要求源: Issue #1 V8-表示-010, user:2026-08-03
検証証跡: src/domain/validation.test.ts, e2e/detail.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/features/detail/VideoDetailPage.tsx,src/styles.css; テスト=src/domain/validation.test.ts,e2e/detail.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DEVICE-001: 閲覧履歴はブラウザ内データベースへ保存しなければならない

diopside v8の端末は、閲覧履歴はブラウザ内データベースへ保存しなければならない。を**satisfy**。

根拠: 個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DEVICE-001-1` 前提: V8-端末-001の前提を満たす公開データまたは操作がある。条件: ブラウザ試験。期待結果: 同一ブラウザ・同一配信元で再読み込み後も復元され、最大200件を新しい順に保持する。。

要求源: Issue #1 V8-端末-001, user:2026-08-03
検証証跡: src/data/deviceStore.test.ts, e2e/library.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/data/deviceStore.ts,src/features/library/DeviceLibraryPage.tsx; テスト=src/data/deviceStore.test.ts,e2e/library.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DEVICE-002: お気に入りはブラウザ内データベースへ保存しなければならない

diopside v8の端末は、お気に入りはブラウザ内データベースへ保存しなければならない。を**satisfy**。

根拠: 個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DEVICE-002-1` 前提: V8-端末-002の前提を満たす公開データまたは操作がある。条件: ブラウザ試験。期待結果: 同じ動画を重複保存せず、利用者が解除するまで同一ブラウザ・同一配信元で復元される。。

要求源: Issue #1 V8-端末-002, user:2026-08-03
検証証跡: src/data/deviceStore.test.ts, e2e/library.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/data/deviceStore.ts,src/features/library/DeviceLibraryPage.tsx; テスト=src/data/deviceStore.test.ts,e2e/library.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DEVICE-003: 最近の検索語と絞り込み条件はブラウザ内データベースへ保存しなければならない

diopside v8の端末は、最近の検索語と絞り込み条件はブラウザ内データベースへ保存しなければならない。を**satisfy**。

根拠: 個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DEVICE-003-1` 前提: V8-端末-003の前提を満たす公開データまたは操作がある。条件: ブラウザ試験。期待結果: 最大20件を新しい順に保持し、同一条件の再保存は1件へ統合する。。

要求源: Issue #1 V8-端末-003, user:2026-08-03
検証証跡: src/data/deviceStore.test.ts, e2e/library.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/data/deviceStore.ts,src/features/library/DeviceLibraryPage.tsx; テスト=src/data/deviceStore.test.ts,e2e/library.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DEVICE-004: 利用者は、履歴、お気に入り、最近の検索条件を個別に削除できなければならない

diopside v8の端末は、利用者は、履歴、お気に入り、最近の検索条件を個別に削除できなければならない。を**satisfy**。

根拠: 個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DEVICE-004-1` 前提: V8-端末-004の前提を満たす公開データまたは操作がある。条件: 画面試験。期待結果: 対象だけが削除され、他の端末内データは残る。。

要求源: Issue #1 V8-端末-004, user:2026-08-03
検証証跡: src/data/deviceStore.test.ts, e2e/library.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/data/deviceStore.ts,src/features/library/DeviceLibraryPage.tsx; テスト=src/data/deviceStore.test.ts,e2e/library.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DEVICE-005: 利用者は、diopsideが保存した端末内データを一括削除できなければならない

diopside v8の端末は、利用者は、diopsideが保存した端末内データを一括削除できなければならない。を**satisfy**。

根拠: 個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DEVICE-005-1` 前提: V8-端末-005の前提を満たす公開データまたは操作がある。条件: ブラウザ試験。期待結果: 確認後に履歴、お気に入り、最近の検索条件、公開データのキャッシュが削除される。。

要求源: Issue #1 V8-端末-005, user:2026-08-03
検証証跡: src/data/deviceStore.test.ts, e2e/library.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/data/deviceStore.ts,src/features/library/DeviceLibraryPage.tsx; テスト=src/data/deviceStore.test.ts,e2e/library.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DEVICE-006: 公開用の静的データはブラウザのキャッシュへ保存できなければならない

diopside v8の端末は、公開用の静的データはブラウザのキャッシュへ保存できなければならない。を**satisfy**。

根拠: 個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DEVICE-006-1` 前提: V8-端末-006の前提を満たす公開データまたは操作がある。条件: キャッシュ更新試験。期待結果: 公開版の識別子が一致する間だけ再利用し、新版検出時は混在させない。。

要求源: Issue #1 V8-端末-006, user:2026-08-03
検証証跡: src/data/deviceStore.test.ts, e2e/library.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/data/deviceStore.ts,src/features/library/DeviceLibraryPage.tsx; テスト=src/data/deviceStore.test.ts,e2e/library.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DEVICE-007: ブラウザ内データの破損、容量超過、利用拒否が起きても、検索と閲覧を継続できなければならない

diopside v8の端末は、ブラウザ内データの破損、容量超過、利用拒否が起きても、検索と閲覧を継続できなければならない。を**satisfy**。

根拠: 個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DEVICE-007-1` 前提: V8-端末-007の前提を満たす公開データまたは操作がある。条件: 障害注入試験。期待結果: 保存機能だけを無効化し、日本語で通知し、画面全体を停止しない。。

要求源: Issue #1 V8-端末-007, user:2026-08-03
検証証跡: src/data/deviceStore.test.ts, e2e/library.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/data/deviceStore.ts,src/features/library/DeviceLibraryPage.tsx; テスト=src/data/deviceStore.test.ts,e2e/library.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DEVICE-008: 履歴、お気に入り、最近の検索条件をサーバーへ送信してはならない

diopside v8の端末は、履歴、お気に入り、最近の検索条件をサーバーへ送信してはならない。を**satisfy**。

根拠: 個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DEVICE-008-1` 前提: V8-端末-008の前提を満たす公開データまたは操作がある。条件: 通信監査・画面試験。期待結果: 通信記録に端末内データの書込み・同期要求が0件である。。

要求源: Issue #1 V8-端末-008, user:2026-08-03
検証証跡: src/data/deviceStore.test.ts, e2e/library.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/data/deviceStore.ts,src/features/library/DeviceLibraryPage.tsx; テスト=src/data/deviceStore.test.ts,e2e/library.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DEVICE-009: 利用者向けログイン、アカウント登録、認証用画面、認証用クッキーを実装してはならない

diopside v8の端末は、利用者向けログイン、アカウント登録、認証用画面、認証用クッキーを実装してはならない。を**satisfy**。

根拠: 個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DEVICE-009-1` 前提: V8-端末-009の前提を満たす公開データまたは操作がある。条件: 画面・通信・コード確認。期待結果: 未ログイン状態だけで全公開機能を利用でき、ログイン導線と認証通信が存在しない。。

要求源: Issue #1 V8-端末-009, user:2026-08-03
検証証跡: src/data/deviceStore.test.ts, e2e/library.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/data/deviceStore.ts,src/features/library/DeviceLibraryPage.tsx; テスト=src/data/deviceStore.test.ts,e2e/library.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DEVICE-010: 端末内データはブラウザやサイトデータの削除で失われ、別端末へ同期されないことを日本語で説明しなければならない

diopside v8の端末は、端末内データはブラウザやサイトデータの削除で失われ、別端末へ同期されないことを日本語で説明しなければならない。を**satisfy**。

根拠: 個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DEVICE-010-1` 前提: V8-端末-010の前提を満たす公開データまたは操作がある。条件: 文言確認。期待結果: 履歴・お気に入り画面から説明を確認できる。。

要求源: Issue #1 V8-端末-010, user:2026-08-03
検証証跡: src/data/deviceStore.test.ts, e2e/library.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/data/deviceStore.ts,src/features/library/DeviceLibraryPage.tsx; テスト=src/data/deviceStore.test.ts,e2e/library.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-DEVICE-011: 利用者行動を解析・追跡する外部送信を行ってはならない

diopside v8の端末は、利用者行動を解析・追跡する外部送信を行ってはならない。を**satisfy**。

根拠: 個人の利用履歴を外部へ送らず、同じブラウザ内で探索を継続できるようにするため。

分類: `product` / `functional`

受入条件:
- `AC-V8-DEVICE-011-1` 前提: V8-端末-011の前提を満たす公開データまたは操作がある。条件: 通信監査・依存関係確認。期待結果: アクセス解析、広告、指紋採取、独自利用者識別子への通信が0件である。。

要求源: Issue #1 V8-端末-011, user:2026-08-03
検証証跡: src/data/deviceStore.test.ts, e2e/library.spec.ts
トレース: 設計=docs/design/generated/system.gen.md; 実装=src/data/deviceStore.ts,src/features/library/DeviceLibraryPage.tsx; テスト=src/data/deviceStore.test.ts,e2e/library.spec.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-001: 動画の追加・更新処理は、運用者がChatGPT／Codexの画面から明示的に開始しなければならない

diopside v8の運用は、動画の追加・更新処理は、運用者がChatGPT／Codexの画面から明示的に開始しなければならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-001-1` 前提: V8-運用-001の前提を満たす公開データまたは操作がある。条件: 運用手順確認。期待結果: 人の開始操作がない状態では、候補生成、ブランチ作成、プルリクエスト作成が起きない。。

要求源: Issue #1 V8-運用-001, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-002: GitHub ActionsからChatGPT／Codexを呼び出してはならない

diopside v8の運用は、GitHub ActionsからChatGPT／Codexを呼び出してはならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-002-1` 前提: V8-運用-002の前提を満たす公開データまたは操作がある。条件: リポジトリ静的確認。期待結果: リポジトリのワークフローと設定にCodex Action、OpenAI API呼出し、モデル用秘密情報が存在しない。。

要求源: Issue #1 V8-運用-002, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-003: 動画確認、候補生成、検証、静的成果物生成、公開準備を行う独自の定期GitHub Actionsを持ってはならない

diopside v8の運用は、動画確認、候補生成、検証、静的成果物生成、公開準備を行う独自の定期GitHub Actionsを持ってはならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-003-1` 前提: V8-運用-003の前提を満たす公開データまたは操作がある。条件: リポジトリ静的確認・手順試験。期待結果: `.github/workflows` にv8の予定実行・生成・公開処理が存在せず、手動手順だけで完了できる。。

要求源: Issue #1 V8-運用-003, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-004: ChatGPT／Codexの利用は、運用者が契約済みの画面上の利用範囲に限定しなければならない

diopside v8の運用は、ChatGPT／Codexの利用は、運用者が契約済みの画面上の利用範囲に限定しなければならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-004-1` 前提: V8-運用-004の前提を満たす公開データまたは操作がある。条件: 構成確認・秘密情報確認。期待結果: OpenAI APIキー、従量課金API、外部モデルAPIを必要としない。。

要求源: Issue #1 V8-運用-004, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-005: 1回の手動実行で、公開動画と正本データを比較し、新規・更新・削除候補を特定できなければならない

diopside v8の運用は、1回の手動実行で、公開動画と正本データを比較し、新規・更新・削除候補を特定できなければならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-005-1` 前提: V8-運用-005の前提を満たす公開データまたは操作がある。条件: 固定データ試験。期待結果: 同じ公開情報と同じ正本から同じ候補集合を得る。。

要求源: Issue #1 V8-運用-005, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-006: 対象候補が0件の場合は、生成物、ブランチ、プルリクエストを作成してはならない

diopside v8の運用は、対象候補が0件の場合は、生成物、ブランチ、プルリクエストを作成してはならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-006-1` 前提: V8-運用-006の前提を満たす公開データまたは操作がある。条件: 否定試験。期待結果: 0件の固定データで差分0・プルリクエスト0件となる。。

要求源: Issue #1 V8-運用-006, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-007: 通常の動画追加プルリクエストは、1動画だけを内容確認の対象としなければならない

diopside v8の運用は、通常の動画追加プルリクエストは、1動画だけを内容確認の対象としなければならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-007-1` 前提: V8-運用-007の前提を満たす公開データまたは操作がある。条件: 変更範囲試験。期待結果: 1件の正本動画データと、それから決定的に生成される索引・詳細・ワードクラウド・確認報告だけを変更する。。

要求源: Issue #1 V8-運用-007, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-008: 通常の動画追加プルリクエストでは、スキル、生成規則、タグ体系、構造定義、検証スクリプト、画面実装、Pages設定を変更してはならない

diopside v8の運用は、通常の動画追加プルリクエストでは、スキル、生成規則、タグ体系、構造定義、検証スクリプト、画面実装、Pages設定を変更してはならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-008-1` 前提: V8-運用-008の前提を満たす公開データまたは操作がある。条件: 変更範囲の否定試験。期待結果: 許可範囲外の変更を検証で拒否し、別の保守プルリクエストへ分離する。。

要求源: Issue #1 V8-運用-008, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-009: プルリクエスト作成前に、構造、タグ、タイムスタンプ、ワードクラウド、検索索引、公開禁止情報、静的画面を決定的スクリプトで検証しなければならない

diopside v8の運用は、プルリクエスト作成前に、構造、タグ、タイムスタンプ、ワードクラウド、検索索引、公開禁止情報、静的画面を決定的スクリプトで検証しなければならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-009-1` 前提: V8-運用-009の前提を満たす公開データまたは操作がある。条件: 不正データ試験・手順試験。期待結果: いずれか1件の不合格でプルリクエスト作成を止め、原因を日本語で示す。。

要求源: Issue #1 V8-運用-009, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-010: プルリクエスト本文は、対象動画、タグ候補、タイムスタンプ候補、ワードクラウド語句、根拠、検証結果、YouTube確認リンクを日本語で示さなければならない

diopside v8の運用は、プルリクエスト本文は、対象動画、タグ候補、タイムスタンプ候補、ワードクラウド語句、根拠、検証結果、YouTube確認リンクを日本語で示さなければならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-010-1` 前提: V8-運用-010の前提を満たす公開データまたは操作がある。条件: プルリクエスト表示確認。期待結果: 人が構造化データを直接読まずに各候補を確認できる。。

要求源: Issue #1 V8-運用-010, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-011: 生成候補は、人が確認してマージするまで公開してはならない

diopside v8の運用は、生成候補は、人が確認してマージするまで公開してはならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-011-1` 前提: V8-運用-011の前提を満たす公開データまたは操作がある。条件: ブランチ境界試験。期待結果: 未マージ、却下、終了済み未マージの差分がPagesの公開元に含まれない。。

要求源: Issue #1 V8-運用-011, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-012: GitHub Pagesは、`main` ブランチの `/docs` にコミット済みの静的成果物だけを公開しなければならない

diopside v8の運用は、GitHub Pagesは、`main` ブランチの `/docs` にコミット済みの静的成果物だけを公開しなければならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-012-1` 前提: V8-運用-012の前提を満たす公開データまたは操作がある。条件: リポジトリ設定確認・公開確認。期待結果: Pagesの公開元がbranch方式の `main/docs` で、独自の公開Actionsを必要としない。。

要求源: Issue #1 V8-運用-012, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-013: 静的成果物は正本データから決定的に生成し、手作業で直接編集してはならない

diopside v8の運用は、静的成果物は正本データから決定的に生成し、手作業で直接編集してはならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-013-1` 前提: V8-運用-013の前提を満たす公開データまたは操作がある。条件: 再現性試験。期待結果: 同一の正本と生成規則から2回生成した成果物の内容が一致する。。

要求源: Issue #1 V8-運用-013, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-014: 公開データと画面は、同じ公開版の識別子を持たなければならない

diopside v8の運用は、公開データと画面は、同じ公開版の識別子を持たなければならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-014-1` 前提: V8-運用-014の前提を満たす公開データまたは操作がある。条件: 契約試験。期待結果: 異なる公開版の一覧、索引、タグ、詳細、ワードクラウドが混在すると表示前に拒否される。。

要求源: Issue #1 V8-運用-014, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-015: 承認済み変更の取り消しによって、直前の正しい公開状態を再生成できなければならない

diopside v8の運用は、承認済み変更の取り消しによって、直前の正しい公開状態を再生成できなければならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-015-1` 前提: V8-運用-015の前提を満たす公開データまたは操作がある。条件: 復元訓練。期待結果: 取り消し後の `/docs` が対象変更を除いた一貫した公開版となる。。

要求源: Issue #1 V8-運用-015, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-OPS-016: 更新頻度は自動の日次保証とせず、最終更新日時を画面で確認できなければならない

diopside v8の運用は、更新頻度は自動の日次保証とせず、最終更新日時を画面で確認できなければならない。を**satisfy**。

根拠: 候補生成と公開の間に決定的検証と人の承認を置き、誤公開を防ぐため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-OPS-016-1` 前提: V8-運用-016の前提を満たす公開データまたは操作がある。条件: 画面試験。期待結果: 更新がない期間も誤って「最新」と表示せず、公開データの最終更新日時を日本語で示す。。

要求源: Issue #1 V8-運用-016, user:2026-08-03
検証証跡: tests/operations.test.ts, tests/generated.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=scripts/detect-video-candidates.ts,scripts/validate-content.ts,scripts/build-public-data.ts; テスト=tests/operations.test.ts,tests/generated.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-001: 承認済み動画のタグは、版管理したタグ体系に基づかなければならない

diopside v8のタグは、承認済み動画のタグは、版管理したタグ体系に基づかなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-001-1` 前提: V8-タグ-001の前提を満たす公開データまたは操作がある。条件: 構造試験・追跡性確認。期待結果: 各動画が使用したタグ体系の版を一意に追跡できる。。

要求源: Issue #1 V8-タグ-001, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-002: タグは大分類、小分類、タグの3層で管理し、表示名だけの平坦な配列を正本にしてはならない

diopside v8のタグは、タグは大分類、小分類、タグの3層で管理し、表示名だけの平坦な配列を正本にしてはならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-002-1` 前提: V8-タグ-002の前提を満たす公開データまたは操作がある。条件: 構造試験。期待結果: すべてのタグに大分類と小分類があり、分類不明のタグが0件である。。

要求源: Issue #1 V8-タグ-002, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-003: 各正規タグは表示名と独立した不変タグ識別子を持たなければならない

diopside v8のタグは、各正規タグは表示名と独立した不変タグ識別子を持たなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-003-1` 前提: V8-タグ-003の前提を満たす公開データまたは操作がある。条件: 移行試験。期待結果: 表示名訂正や別名追加の前後で同じ概念の識別子が変わらない。。

要求源: Issue #1 V8-タグ-003, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-004: 同じ表示名でも小分類または意味が異なるタグは別の不変識別子として扱わなければならない

diopside v8のタグは、同じ表示名でも小分類または意味が異なるタグは別の不変識別子として扱わなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-004-1` 前提: V8-タグ-004の前提を満たす公開データまたは操作がある。条件: 同名異義試験。期待結果: ゲームジャンルの「ホラー」と中心テーマの「ホラー」、歌種別の「ライブ」と同時視聴メディアの「ライブ」が別タグになる。。

要求源: Issue #1 V8-タグ-004, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-005: 承認済みの全動画は主ジャンルをちょうど1件持たなければならない

diopside v8のタグは、承認済みの全動画は主ジャンルをちょうど1件持たなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-005-1` 前提: V8-タグ-005の前提を満たす公開データまたは操作がある。条件: 基数試験。期待結果: 主ジャンル0件または2件以上の動画を検証で拒否する。。

要求源: Issue #1 V8-タグ-005, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-006: 承認済みの全動画は動画形式をちょうど1件持たなければならない

diopside v8のタグは、承認済みの全動画は動画形式をちょうど1件持たなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-006-1` 前提: V8-タグ-006の前提を満たす公開データまたは操作がある。条件: 基数試験。期待結果: 「配信」「動画」「Shorts」のいずれか1件だけを持つ。。

要求源: Issue #1 V8-タグ-006, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-007: 承認済みの全動画は公開チャンネルをちょうど1件持たなければならない

diopside v8のタグは、承認済みの全動画は公開チャンネルをちょうど1件持たなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-007-1` 前提: V8-タグ-007の前提を満たす公開データまたは操作がある。条件: 基数試験・人手確認。期待結果: 実際のYouTubeチャンネルを確認できない候補は承認済みにならない。。

要求源: Issue #1 V8-タグ-007, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-008: 主ジャンル、動画形式、公開チャンネル以外は、タグ体系に定めた基数の範囲で異なる検索軸のタグを複数付与できなければならない

diopside v8のタグは、主ジャンル、動画形式、公開チャンネル以外は、タグ体系に定めた基数の範囲で異なる検索軸のタグを複数付与できなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-008-1` 前提: V8-タグ-008の前提を満たす公開データまたは操作がある。条件: 基数・組合せ試験。期待結果: 条件に該当する複数の作品、人物、企画、特性を省略せず保持し、基数超過を拒否する。。

要求源: Issue #1 V8-タグ-008, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-009: ゲームを主または副ジャンルに持つ動画は、ゲーム作品名を1件以上、ゲームジャンルを1件以上3件以下持たなければならない

diopside v8のタグは、ゲームを主または副ジャンルに持つ動画は、ゲーム作品名を1件以上、ゲームジャンルを1件以上3件以下持たなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-009-1` 前提: V8-タグ-009の前提を満たす公開データまたは操作がある。条件: 条件付き必須試験。期待結果: 作品名またはゲームジャンルが不足するゲーム動画を承認できない。。

要求源: Issue #1 V8-タグ-009, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-010: 雑談を主または副ジャンルに持つ動画は、雑談種別を1件以上3件以下持たなければならない

diopside v8のタグは、雑談を主または副ジャンルに持つ動画は、雑談種別を1件以上3件以下持たなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-010-1` 前提: V8-タグ-010の前提を満たす公開データまたは操作がある。条件: 条件付き必須試験。期待結果: 雑談種別のない雑談動画と4件以上の動画を拒否する。。

要求源: Issue #1 V8-タグ-010, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-011: 同時視聴を主ジャンルに持つ動画は、同時視聴メディアを1件持ち、動画タイトル、動画固有の説明、公式作品表記のいずれかが一つの作品を示す場合は同時視聴作品名を1件以

diopside v8のタグは、同時視聴を主ジャンルに持つ動画は、同時視聴メディアを1件持ち、動画タイトル、動画固有の説明、公式作品表記のいずれかが一つの作品を示す場合は同時視聴作品名を1件以上持たなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-011-1` 前提: V8-タグ-011の前提を満たす公開データまたは操作がある。条件: 条件付き必須・否定試験。期待結果: メディア種別不足を拒否し、複数候補または根拠なしの場合は仮の作品名を作らない。。

要求源: Issue #1 V8-タグ-011, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-012: 朗読・声劇を主ジャンルに持つ動画は、朗読・声劇種別を1件持たなければならない

diopside v8のタグは、朗読・声劇を主ジャンルに持つ動画は、朗読・声劇種別を1件持たなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-012-1` 前提: V8-タグ-012の前提を満たす公開データまたは操作がある。条件: 条件付き必須試験。期待結果: 種別0件または2件以上を拒否する。。

要求源: Issue #1 V8-タグ-012, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-013: チャンネル主以外と共同で内容を行う動画は「コラボ」と、声、映像、通話、ゲーム・セッション参加、公式参加者表記で確認できる全出演者を持ち、チャンネル主を出演者へ重

diopside v8のタグは、チャンネル主以外と共同で内容を行う動画は「コラボ」と、声、映像、通話、ゲーム・セッション参加、公式参加者表記で確認できる全出演者を持ち、チャンネル主を出演者へ重複登録してはならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-013-1` 前提: V8-タグ-013の前提を満たす公開データまたは操作がある。条件: 意味論試験・人手確認。期待結果: コラボだけで出演者がない動画、言及・クレジットだけの非出演者、チャンネル主の重複を拒否する。。

要求源: Issue #1 V8-タグ-013, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-014: ユニット・チームタグを持つ動画は「コラボ」と実際に出演した構成員を持ち、欠席者や対戦相手を自動追加してはならない

diopside v8のタグは、ユニット・チームタグを持つ動画は「コラボ」と実際に出演した構成員を持ち、欠席者や対戦相手を自動追加してはならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-014-1` 前提: V8-タグ-014の前提を満たす公開データまたは操作がある。条件: 固定例試験・人手確認。期待結果: 正規グループ名だけから全構成員を無条件展開しない。。

要求源: Issue #1 V8-タグ-014, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-015: 実出演者と、配信中に名前を話題にしただけの言及人物を分離しなければならない

diopside v8のタグは、実出演者と、配信中に名前を話題にしただけの言及人物を分離しなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-015-1` 前提: V8-タグ-015の前提を満たす公開データまたは操作がある。条件: 排他試験。期待結果: 同一人物が同じ動画で出演者と言及人物の両方にならず、言及だけで「コラボ」が付かない。。

要求源: Issue #1 V8-タグ-015, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-016: 一つのタグには一つの検索対象または一つの分類事実だけを保存し、複数人物や独立概念を連結したタグは分解しなければならない

diopside v8のタグは、一つのタグには一つの検索対象または一つの分類事実だけを保存し、複数人物や独立概念を連結したタグは分解しなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-016-1` 前提: V8-タグ-016の前提を満たす公開データまたは操作がある。条件: 分解規則試験。期待結果: 既知の複合旧タグは各正規タグへ分かれ、公式人名、作品名、グループ名の内部記号は誤分割されない。。

要求源: Issue #1 V8-タグ-016, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-017: タグ照合はUnicode互換正規化、前後空白除去、連続空白の統合、英字大小の同一視、先頭ハッシュ記号の同一視を定義順で行わなければならない

diopside v8のタグは、タグ照合はUnicode互換正規化、前後空白除去、連続空白の統合、英字大小の同一視、先頭ハッシュ記号の同一視を定義順で行わなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-017-1` 前提: V8-タグ-017の前提を満たす公開データまたは操作がある。条件: 正規化境界値試験。期待結果: 表示名は公式表記を保ち、照合専用表現だけが正規化される。。

要求源: Issue #1 V8-タグ-017, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-018: 登録済み別名は完全一致で正規タグへ解決し、公開データと画面には正規タグだけを表示しなければならない

diopside v8のタグは、登録済み別名は完全一致で正規タグへ解決し、公開データと画面には正規タグだけを表示しなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-018-1` 前提: V8-タグ-018の前提を満たす公開データまたは操作がある。条件: 別名契約試験。期待結果: 別名と正規名が同じ動画集合へ解決され、別名が別タグとして重複表示されない。。

要求源: Issue #1 V8-タグ-018, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-019: 既存タグ体系にない語を動画追加と同時に正規タグとして発行してはならない

diopside v8のタグは、既存タグ体系にない語を動画追加と同時に正規タグとして発行してはならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-019-1` 前提: V8-タグ-019の前提を満たす公開データまたは操作がある。条件: 変更範囲の否定試験。期待結果: 新語は理由付きのタグ体系変更候補へ分離され、承認と版更新の前は動画へ付与されない。。

要求源: Issue #1 V8-タグ-019, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-020: 「その他」「不明」「要確認」「未分類」「レビュー」を確定タグとして保存してはならない

diopside v8のタグは、「その他」「不明」「要確認」「未分類」「レビュー」を確定タグとして保存してはならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-020-1` 前提: V8-タグ-020の前提を満たす公開データまたは操作がある。条件: 禁止値試験。期待結果: 禁止値が承認済みタグに0件で、不明な動画は作業状態と理由を持つ。。

要求源: Issue #1 V8-タグ-020, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-021: 各タグ付与は、タグ固有の付与理由、根拠の種類、根拠参照、確度を持たなければならない

diopside v8のタグは、各タグ付与は、タグ固有の付与理由、根拠の種類、根拠参照、確度を持たなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-021-1` 前提: V8-タグ-021の前提を満たす公開データまたは操作がある。条件: 構造試験・人手監査。期待結果: 理由が対象タグ名またはその判定事実を示さず、根拠参照も同一の汎用文だけである候補を拒否する。。

要求源: Issue #1 V8-タグ-021, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-022: タグ判断は、動画タイトル、動画固有の説明、公式の出演者・作品・企画表記、全編字幕または文字起こし、公式一次資料、既存の承認済みタグの順に確認しなければならない

diopside v8のタグは、タグ判断は、動画タイトル、動画固有の説明、公式の出演者・作品・企画表記、全編字幕または文字起こし、公式一次資料、既存の承認済みタグの順に確認しなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-022-1` 前提: V8-タグ-022の前提を満たす公開データまたは操作がある。条件: 根拠優先順位試験。期待結果: 毎回同じ定型説明、販売リンク、SNS、クレジットだけを根拠にタグを付けない。。

要求源: Issue #1 V8-タグ-022, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-023: コメントまたはチャットの単発言及だけで、出演者、コラボ、作品、企画、言及タグを確定してはならない

diopside v8のタグは、コメントまたはチャットの単発言及だけで、出演者、コラボ、作品、企画、言及タグを確定してはならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-023-1` 前提: V8-タグ-023の前提を満たす公開データまたは操作がある。条件: 攻撃・誤検出試験。期待結果: 単発コメント、視聴者の推測、字幕の単発誤認識は未採用または確認待ちになる。。

要求源: Issue #1 V8-タグ-023, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-024: 公開可能なタグ付与の確度は「高」または「中」だけとし、「低」および確認待ちを公開してはならない

diopside v8のタグは、公開可能なタグ付与の確度は「高」または「中」だけとし、「低」および確認待ちを公開してはならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-024-1` 前提: V8-タグ-024の前提を満たす公開データまたは操作がある。条件: 許可値・根拠組合せ試験。期待結果: タイトル、動画固有説明、公式参加者・作品表記から直接確認できる場合を「高」、全編文脈または独立した公開根拠2件以上で確認できる場合を「中」とし、それ以外を公開しない。。

要求源: Issue #1 V8-タグ-024, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-025: 同一動画内で同一タグ識別子を重複させず、タグ件数はそのタグを持つ異なる動画数として数えなければならない

diopside v8のタグは、同一動画内で同一タグ識別子を重複させず、タグ件数はそのタグを持つ異なる動画数として数えなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-025-1` 前提: V8-タグ-025の前提を満たす公開データまたは操作がある。条件: 重複・件数試験。期待結果: 重複付与が0件で、索引の件数と動画識別子の一意件数が一致する。。

要求源: Issue #1 V8-タグ-025, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-026: タグ正本は構造版、タグ体系版、別名版、生成規則版、生成日時、入力一覧、動画件数、付与件数を持たなければならない

diopside v8のタグは、タグ正本は構造版、タグ体系版、別名版、生成規則版、生成日時、入力一覧、動画件数、付与件数を持たなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-026-1` 前提: V8-タグ-026の前提を満たす公開データまたは操作がある。条件: 構造・件数試験。期待結果: 宣言件数と実配列件数が一致し、使用した各版を再特定できる。。

要求源: Issue #1 V8-タグ-026, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-027: 公開用動画データは不変タグ識別子だけを参照し、表示名と分類は同じ公開版のタグ索引から解決しなければならない

diopside v8のタグは、公開用動画データは不変タグ識別子だけを参照し、表示名と分類は同じ公開版のタグ索引から解決しなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-027-1` 前提: V8-タグ-027の前提を満たす公開データまたは操作がある。条件: 参照整合性試験。期待結果: 未知の識別子、異なる版の混在、表示名を識別子として使うデータを拒否する。。

要求源: Issue #1 V8-タグ-027, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-028: タグ固有の理由と根拠参照は確認用正本またはプルリクエストに保持し、公開用JSONへ字幕断片、コメント本文、投稿者情報を含めてはならない

diopside v8のタグは、タグ固有の理由と根拠参照は確認用正本またはプルリクエストに保持し、公開用JSONへ字幕断片、コメント本文、投稿者情報を含めてはならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-028-1` 前提: V8-タグ-028の前提を満たす公開データまたは操作がある。条件: 公開境界試験。期待結果: 公開成果物に禁止情報が0件で、人はプルリクエストから付与理由を確認できる。。

要求源: Issue #1 V8-タグ-028, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-029: 同じ動画入力、タグ体系版、別名版、生成規則版から同じ論理タグ集合を再生成できなければならない

diopside v8のタグは、同じ動画入力、タグ体系版、別名版、生成規則版から同じ論理タグ集合を再生成できなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-029-1` 前提: V8-タグ-029の前提を満たす公開データまたは操作がある。条件: 再現性試験。期待結果: 2回の生成で動画識別子とタグ識別子の集合ハッシュが一致する。。

要求源: Issue #1 V8-タグ-029, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-030: タグ、別名、分類を変更する場合は、包含基準、除外基準、影響件数、既存データ移行、版更新を同じ保守変更で定めなければならない

diopside v8のタグは、タグ、別名、分類を変更する場合は、包含基準、除外基準、影響件数、既存データ移行、版更新を同じ保守変更で定めなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-030-1` 前提: V8-タグ-030の前提を満たす公開データまたは操作がある。条件: 変更管理試験。期待結果: 5項目のいずれかが欠けるタグ体系変更を承認できない。。

要求源: Issue #1 V8-タグ-030, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-031: 必須タグを確定できない動画は承認済み公開データへ入れず、確認待ち理由を残さなければならない

diopside v8のタグは、必須タグを確定できない動画は承認済み公開データへ入れず、確認待ち理由を残さなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-031-1` 前提: V8-タグ-031の前提を満たす公開データまたは操作がある。条件: 集合一致試験。期待結果: 母集団と承認済み集合と確認待ち集合の和が対象集合に一致し、黙って欠落する動画が0件である。。

要求源: Issue #1 V8-タグ-031, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-032: 公開画面はタグをdiopsideが整理・確認した情報として示し、YouTube公式分類と誤認させてはならない

diopside v8のタグは、公開画面はタグをdiopsideが整理・確認した情報として示し、YouTube公式分類と誤認させてはならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-032-1` 前提: V8-タグ-032の前提を満たす公開データまたは操作がある。条件: 文言・画面試験。期待結果: タグ欄の近接表示から情報の作成主体が分かり、「YouTube公式タグ」と表示しない。。

要求源: Issue #1 V8-タグ-032, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-033: 動画詳細は承認済みタグを大分類ごとにまとめ、同名異義タグには小分類の文脈を示さなければならない

diopside v8のタグは、動画詳細は承認済みタグを大分類ごとにまとめ、同名異義タグには小分類の文脈を示さなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-033-1` 前提: V8-タグ-033の前提を満たす公開データまたは操作がある。条件: 画面・アクセシビリティ試験。期待結果: すべての承認済みタグを確認でき、「ホラー」「ライブ」の同名異義を読み分けられる。。

要求源: Issue #1 V8-タグ-033, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-034: タグ表示名は公式な日本語名がある場合は日本語を用い、公式固有名詞と一般に定着した略称は出典表記を保たなければならない

diopside v8のタグは、タグ表示名は公式な日本語名がある場合は日本語を用い、公式固有名詞と一般に定着した略称は出典表記を保たなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-034-1` 前提: V8-タグ-034の前提を満たす公開データまたは操作がある。条件: 文言一覧・人手確認。期待結果: 不要な英語だけの独自タグが0件で、作品・人物・ASMR等の正式表記を勝手に翻訳しない。。

要求源: Issue #1 V8-タグ-034, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TAG-035: 人物・グループ分類を除くタグが1動画あたり12件を超える候補は、過剰付与の確認待ちにしなければならない

diopside v8のタグは、人物・グループ分類を除くタグが1動画あたり12件を超える候補は、過剰付与の確認待ちにしなければならない。を**satisfy**。

根拠: 表示名の変更や同名異義に耐える、根拠付きの分類を維持するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TAG-035-1` 前提: V8-タグ-035の前提を満たす公開データまたは操作がある。条件: 基数集計・人手確認。期待結果: 13件以上を自動却下せず人が必要性を確認し、理由のない過剰タグが承認済み動画に0件である。。

要求源: Issue #1 V8-タグ-035, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/content-validation.test.ts
トレース: 設計=docs/design/generated/system.gen.md,content/taxonomy/tag-taxonomy.json; 実装=src/domain/content.ts,scripts/validate-content.ts; テスト=src/domain/validation.test.ts,tests/content-validation.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-001: タイムスタンプは動画全体を移動するための目次として作り、見どころ候補と別のデータとして扱わなければならない

diopside v8の時刻は、タイムスタンプは動画全体を移動するための目次として作り、見どころ候補と別のデータとして扱わなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-001-1` 前提: V8-時刻-001の前提を満たす公開データまたは操作がある。条件: 意味論監査。期待結果: 短い反応や名場面だけを並べた一覧をタイムスタンプとして承認しない。。

要求源: Issue #1 V8-時刻-001, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-002: v8.0では動画形式が「配信」の動画を既定の作成対象とし、「Shorts」と単曲の「歌ってみた」は対象外にしなければならない

diopside v8の時刻は、v8.0では動画形式が「配信」の動画を既定の作成対象とし、「Shorts」と単曲の「歌ってみた」は対象外にしなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-002-1` 前提: V8-時刻-002の前提を満たす公開データまたは操作がある。条件: 対象集合・境界値試験。期待結果: 対象集合がタグ正本から決定的に算出される。「動画」は3章以上、各章10秒以上、二つ以上の意味ある内容転換を満たす候補を人が承認した場合だけ個別に追加できる。。

要求源: Issue #1 V8-時刻-002, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-003: 各対象動画は「作成済み」または理由付きの「未作成」の状態を持たなければならない

diopside v8の時刻は、各対象動画は「作成済み」または理由付きの「未作成」の状態を持たなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-003-1` 前提: V8-時刻-003の前提を満たす公開データまたは操作がある。条件: 状態遷移・画面試験。期待結果: 未作成理由を「対象外」「短尺」「資料不足」「全編確認不足」「音声取得不可」「確認待ち」から一意に表示できる。。

要求源: Issue #1 V8-時刻-003, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-004: 動画長が30秒未満の動画は、YouTube章の最小条件を満たせないため「短尺」として未作成にしなければならない

diopside v8の時刻は、動画長が30秒未満の動画は、YouTube章の最小条件を満たせないため「短尺」として未作成にしなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-004-1` 前提: V8-時刻-004の前提を満たす公開データまたは操作がある。条件: 境界値試験。期待結果: 29秒は未作成、30秒以上は他条件を満たす場合だけ作成候補になる。。

要求源: Issue #1 V8-時刻-004, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-005: 作成者が概要欄等に有効な時刻一覧を公開している場合は、それを最優先の候補として保持し、無断で全置換してはならない

diopside v8の時刻は、作成者が概要欄等に有効な時刻一覧を公開している場合は、それを最優先の候補として保持し、無断で全置換してはならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-005-1` 前提: V8-時刻-005の前提を満たす公開データまたは操作がある。条件: 形式検証・差分確認。期待結果: 0秒開始、3件以上、10秒以上の間隔、動画長未満、非空名を満たす一覧について、採用、補正、統合、却下の差分と理由を人が確認できる。。

要求源: Issue #1 V8-時刻-005, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-006: 新規生成の根拠は、作成者の時刻一覧、公開の日本語原文字幕、公開の日本語字幕、全編を覆う無償のローカル音声認識または運用者提供の文字起こしの順に使用しなければなら

diopside v8の時刻は、新規生成の根拠は、作成者の時刻一覧、公開の日本語原文字幕、公開の日本語字幕、全編を覆う無償のローカル音声認識または運用者提供の文字起こしの順に使用しなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-006-1` 前提: V8-時刻-006の前提を満たす公開データまたは操作がある。条件: 入力経路試験・費用確認。期待結果: 有料音声認識APIを必須とせず、使用した根拠の種類と範囲を追跡できる。。

要求源: Issue #1 V8-時刻-006, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-007: 作成者の有効な時刻一覧をそのまま採用する場合を除き、新規生成は動画の0秒から動画末尾までを処理対象にした字幕または文字起こしを確認してから行わなければならない

diopside v8の時刻は、作成者の有効な時刻一覧をそのまま採用する場合を除き、新規生成は動画の0秒から動画末尾までを処理対象にした字幕または文字起こしを確認してから行わなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-007-1` 前提: V8-時刻-007の前提を満たす公開データまたは操作がある。条件: 全編網羅試験。期待結果: 処理対象外の時間区間が1秒でも残る候補を承認しない。無音や待機で文字がない区間も処理済み範囲として記録する。。

要求源: Issue #1 V8-時刻-007, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-008: 全編根拠を用意できない場合は、既知のコメント時刻周辺だけを調べて残りを推測してはならない

diopside v8の時刻は、全編根拠を用意できない場合は、既知のコメント時刻周辺だけを調べて残りを推測してはならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-008-1` 前提: V8-時刻-008の前提を満たす公開データまたは操作がある。条件: 否定試験。期待結果: 部分的な字幕、部分音声認識、コメントだけの入力は「全編確認不足」になる。。

要求源: Issue #1 V8-時刻-008, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-009: コメント、返信、チャット、反応量の山は境界候補の補助にだけ使用し、単独では最終境界または章名の根拠にしてはならない

diopside v8の時刻は、コメント、返信、チャット、反応量の山は境界候補の補助にだけ使用し、単独では最終境界または章名の根拠にしてはならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-009-1` 前提: V8-時刻-009の前提を満たす公開データまたは操作がある。条件: 根拠種別試験。期待結果: コメントだけ、チャットだけ、反応量だけの境界を検証で拒否する。。

要求源: Issue #1 V8-時刻-009, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-010: タイムスタンプ境界は内容の開始・転換・終了に置き、固定間隔または固定章数で作ってはならない

diopside v8の時刻は、タイムスタンプ境界は内容の開始・転換・終了に置き、固定間隔または固定章数で作ってはならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-010-1` 前提: V8-時刻-010の前提を満たす公開データまたは操作がある。条件: 固定例による意味論監査。期待結果: 同じ内容の途中を時間だけで分割した候補と、異なる内容を章数上限のため統合した候補を拒否する。。

要求源: Issue #1 V8-時刻-010, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-011: ジャンルごとの境界と公開名は、本節の基準表に従わなければならない

diopside v8の時刻は、ジャンルごとの境界と公開名は、本節の基準表に従わなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-011-1` 前提: V8-時刻-011の前提を満たす公開データまたは操作がある。条件: ジャンル別受入試験。期待結果: 各ジャンルの固定評価動画で、必須の継続区間を落とさず、避ける内容を公開名に含めない。。

要求源: Issue #1 V8-時刻-011, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-012: 各タイムスタンプは一意な識別子、開始秒、公開用の短い日本語名、確度、根拠参照を持たなければならない

diopside v8の時刻は、各タイムスタンプは一意な識別子、開始秒、公開用の短い日本語名、確度、根拠参照を持たなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-012-1` 前提: V8-時刻-012の前提を満たす公開データまたは操作がある。条件: 構造試験。期待結果: 必須項目の空値、開始秒の小数、同一識別子を拒否する。。

要求源: Issue #1 V8-時刻-012, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-013: 最初のタイムスタンプは0秒でなければならない

diopside v8の時刻は、最初のタイムスタンプは0秒でなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-013-1` 前提: V8-時刻-013の前提を満たす公開データまたは操作がある。条件: 境界値試験。期待結果: 先頭が0秒以外の一覧を拒否する。。

要求源: Issue #1 V8-時刻-013, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-014: 作成済みのタイムスタンプは3件以上でなければならない

diopside v8の時刻は、作成済みのタイムスタンプは3件以上でなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-014-1` 前提: V8-時刻-014の前提を満たす公開データまたは操作がある。条件: 基数試験。期待結果: 0件から2件は未作成として扱い、作成済みにしない。。

要求源: Issue #1 V8-時刻-014, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-015: 開始秒は整数、重複なし、厳密な昇順とし、隣接する開始秒の差を10秒以上にしなければならない

diopside v8の時刻は、開始秒は整数、重複なし、厳密な昇順とし、隣接する開始秒の差を10秒以上にしなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-015-1` 前提: V8-時刻-015の前提を満たす公開データまたは操作がある。条件: 順序・境界値試験。期待結果: 同一時刻、逆順、9秒差を拒否し、10秒差を許可する。。

要求源: Issue #1 V8-時刻-015, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-016: 各開始秒は0以上かつ動画長未満でなければならない

diopside v8の時刻は、各開始秒は0以上かつ動画長未満でなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-016-1` 前提: V8-時刻-016の前提を満たす公開データまたは操作がある。条件: 範囲試験。期待結果: 負数と動画長以上を拒否し、動画長の1秒前までを許可する。。

要求源: Issue #1 V8-時刻-016, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-017: 各章の終了秒は次の章の開始秒、最終章の終了秒は動画長として導出し、動画全体を重複なく連続して覆わなければならない

diopside v8の時刻は、各章の終了秒は次の章の開始秒、最終章の終了秒は動画長として導出し、動画全体を重複なく連続して覆わなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-017-1` 前提: V8-時刻-017の前提を満たす公開データまたは操作がある。条件: 区間連続性試験。期待結果: 0秒から動画長までの空白と重複が0秒である。。

要求源: Issue #1 V8-時刻-017, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-018: 0秒の公開名は、待機時間ではなく最初の有用な移動区間の内容を示さなければならない

diopside v8の時刻は、0秒の公開名は、待機時間ではなく最初の有用な移動区間の内容を示さなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-018-1` 前提: V8-時刻-018の前提を満たす公開データまたは操作がある。条件: 冒頭固定例試験。期待結果: 発話開始が遅い動画でも「待機」「無音」だけの章を作らず、最初の内容を示す。。

要求源: Issue #1 V8-時刻-018, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-019: 内容のない冒頭待機、休止画面、末尾無音だけを独立した章にしてはならない

diopside v8の時刻は、内容のない冒頭待機、休止画面、末尾無音だけを独立した章にしてはならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-019-1` 前提: V8-時刻-019の前提を満たす公開データまたは操作がある。条件: 否定試験。期待結果: 非内容区間だけの章が0件である。。

要求源: Issue #1 V8-時刻-019, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-020: 隣接する章が同じ移動目的を持つ場合は統合し、継続する話題・試合・曲・場面を探す助けにならない単発のリアクションや出来事を独立章にしてはならない

diopside v8の時刻は、隣接する章が同じ移動目的を持つ場合は統合し、継続する話題・試合・曲・場面を探す助けにならない単発のリアクションや出来事を独立章にしてはならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-020-1` 前提: V8-時刻-020の前提を満たす公開データまたは操作がある。条件: 過分割試験。期待結果: 固定評価動画で同一話題の連続分割と名場面だけの章を意味論監査で拒否する。。

要求源: Issue #1 V8-時刻-020, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-021: 公開用の章名は、該当区間の根拠から直接確認できる内容だけを表さなければならない

diopside v8の時刻は、公開用の章名は、該当区間の根拠から直接確認できる内容だけを表さなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-021-1` 前提: V8-時刻-021の前提を満たす公開データまたは操作がある。条件: 事実確認。期待結果: 根拠にない人物、作品、結果、出来事を含む章名を拒否する。。

要求源: Issue #1 V8-時刻-021, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-022: ゲーム、TRPG、同時視聴、朗読・声劇の公開用章名は、犯人、秘密、正体、判定結果、結末、最終遭遇等のネタバレを避けなければならない

diopside v8の時刻は、ゲーム、TRPG、同時視聴、朗読・声劇の公開用章名は、犯人、秘密、正体、判定結果、結末、最終遭遇等のネタバレを避けなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-022-1` 前提: V8-時刻-022の前提を満たす公開データまたは操作がある。条件: ネタバレ試験・人手確認。期待結果: 内部確認用の具体的内容と公開用の中立名を分離し、禁止例を公開名に含めない。。

要求源: Issue #1 V8-時刻-022, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-023: 公開用章名は1文字以上60文字以下の自然な日本語を基本とし、公式固有名詞は出典表記を保たなければならない

diopside v8の時刻は、公開用章名は1文字以上60文字以下の自然な日本語を基本とし、公式固有名詞は出典表記を保たなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-023-1` 前提: V8-時刻-023の前提を満たす公開データまたは操作がある。条件: 文字数・文言試験。期待結果: 空名、61文字以上、内容のない連番だけの名前を拒否する。。

要求源: Issue #1 V8-時刻-023, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-024: 公開可能なタイムスタンプの確度は「高」または「中」だけとし、「低」および確認待ちを公開してはならない

diopside v8の時刻は、公開可能なタイムスタンプの確度は「高」または「中」だけとし、「低」および確認待ちを公開してはならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-024-1` 前提: V8-時刻-024の前提を満たす公開データまたは操作がある。条件: 許可値試験。期待結果: 許可値外の確度が公開正本に0件である。。

要求源: Issue #1 V8-時刻-024, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-025: 0秒を除くすべての境界は、作成者の時刻一覧または境界前後の字幕・文字起こしへ解決できる根拠参照を持たなければならない

diopside v8の時刻は、0秒を除くすべての境界は、作成者の時刻一覧または境界前後の字幕・文字起こしへ解決できる根拠参照を持たなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-025-1` 前提: V8-時刻-025の前提を満たす公開データまたは操作がある。条件: 参照整合性試験。期待結果: 存在しない参照と根拠なし境界を拒否する。。

要求源: Issue #1 V8-時刻-025, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-026: 根拠が競合する境界、音声認識が不明瞭な境界、時刻が一意に定まらない境界は確定せず、確認待ち理由を残さなければならない

diopside v8の時刻は、根拠が競合する境界、音声認識が不明瞭な境界、時刻が一意に定まらない境界は確定せず、確認待ち理由を残さなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-026-1` 前提: V8-時刻-026の前提を満たす公開データまたは操作がある。条件: 曖昧入力試験。期待結果: 曖昧な境界が「中」以上として自動昇格しない。。

要求源: Issue #1 V8-時刻-026, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-027: 候補の事実確認では、適用経路が作成者一覧の採用または全編根拠による生成のいずれかであること、根拠参照、境界前後、章名の裏付け、根拠競合を確認しなければならない

diopside v8の時刻は、候補の事実確認では、適用経路が作成者一覧の採用または全編根拠による生成のいずれかであること、根拠参照、境界前後、章名の裏付け、根拠競合を確認しなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-027-1` 前提: V8-時刻-027の前提を満たす公開データまたは操作がある。条件: 独立レビュー確認。期待結果: 事実確認結果が対象候補の内容ハッシュを持ち、重大指摘0件で合格する。。

要求源: Issue #1 V8-時刻-027, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-028: 候補の編集確認では、移動価値、過分割、分割不足、名称統一、ネタバレを事実確認とは別に確認しなければならない

diopside v8の時刻は、候補の編集確認では、移動価値、過分割、分割不足、名称統一、ネタバレを事実確認とは別に確認しなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-028-1` 前提: V8-時刻-028の前提を満たす公開データまたは操作がある。条件: 入力記録・独立レビュー確認。期待結果: 編集確認者へ事実確認結果を渡さず、同じ候補ハッシュに対して重大指摘0件で合格する。。

要求源: Issue #1 V8-時刻-028, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-029: 事実確認と編集確認の両方が同じ候補版へ合格した場合だけ、人の最終確認へ進めなければならない

diopside v8の時刻は、事実確認と編集確認の両方が同じ候補版へ合格した場合だけ、人の最終確認へ進めなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-029-1` 前提: V8-時刻-029の前提を満たす公開データまたは操作がある。条件: 版・状態遷移試験。期待結果: 候補修正後は旧確認を無効にし、両方を再実施する。。

要求源: Issue #1 V8-時刻-029, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-030: 決定的検証は、0秒開始、3件以上、整数、昇順、10秒以上、動画長内、全区間網羅、非空名、許可確度、根拠参照、未解決重大指摘なしをすべて確認しなければならない

diopside v8の時刻は、決定的検証は、0秒開始、3件以上、整数、昇順、10秒以上、動画長内、全区間網羅、非空名、許可確度、根拠参照、未解決重大指摘なしをすべて確認しなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-030-1` 前提: V8-時刻-030の前提を満たす公開データまたは操作がある。条件: 不正データ総当たり試験。期待結果: いずれか1件の不合格で作成済みへの遷移とプルリクエスト作成を止める。。

要求源: Issue #1 V8-時刻-030, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-031: 動画詳細の各タイムスタンプは、対象動画の同じ開始秒をYouTubeで開く確認リンクを持たなければならない

diopside v8の時刻は、動画詳細の各タイムスタンプは、対象動画の同じ開始秒をYouTubeで開く確認リンクを持たなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-031-1` 前提: V8-時刻-031の前提を満たす公開データまたは操作がある。条件: リンク契約試験。期待結果: 動画識別子と開始秒が一致するURLを生成する。。

要求源: Issue #1 V8-時刻-031, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-032: タイムスタンプの章名をタイトル文字検索へ混入してはならない

diopside v8の時刻は、タイムスタンプの章名をタイトル文字検索へ混入してはならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-032-1` 前提: V8-時刻-032の前提を満たす公開データまたは操作がある。条件: 検索除外試験。期待結果: 章名にだけ存在する語で文字検索しても動画が一致しない。。

要求源: Issue #1 V8-時刻-032, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-033: 公開用データには承認済みの時刻、公開名、確度、必要最小限の生成来歴だけを含め、生の字幕、文字起こし、コメント、チャットを含めてはならない

diopside v8の時刻は、公開用データには承認済みの時刻、公開名、確度、必要最小限の生成来歴だけを含め、生の字幕、文字起こし、コメント、チャットを含めてはならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-033-1` 前提: V8-時刻-033の前提を満たす公開データまたは操作がある。条件: 公開境界試験。期待結果: 公開禁止項目が0件で、公開データだけから元の発言全文を復元できない。。

要求源: Issue #1 V8-時刻-033, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-034: 既存の承認済みタイムスタンプを更新する場合は、追加、削除、移動、改名の差分と理由を人へ提示しなければならない

diopside v8の時刻は、既存の承認済みタイムスタンプを更新する場合は、追加、削除、移動、改名の差分と理由を人へ提示しなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-034-1` 前提: V8-時刻-034の前提を満たす公開データまたは操作がある。条件: 差分契約試験。期待結果: 全置換や大量削除を構造化差分で確認でき、理由のない変更を拒否する。。

要求源: Issue #1 V8-時刻-034, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-035: タイムスタンプ生成来歴から、動画、入力指紋、根拠の種類と範囲、生成規則版、生成日時、確認結果、確認プルリクエストを追跡できなければならない

diopside v8の時刻は、タイムスタンプ生成来歴から、動画、入力指紋、根拠の種類と範囲、生成規則版、生成日時、確認結果、確認プルリクエストを追跡できなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-035-1` 前提: V8-時刻-035の前提を満たす公開データまたは操作がある。条件: 追跡性・冪等性試験。期待結果: 同じ入力指紋の重複候補を作らず、入力変更時は再確認対象になる。。

要求源: Issue #1 V8-時刻-035, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-036: 初回公開前に、ゲーム8件、企画6件、雑談5件、ASMR3件、歌2件、朗読・声劇2件、同時視聴2件、TRPG2件の固定30動画で品質を確認しなければならない

diopside v8の時刻は、初回公開前に、ゲーム8件、企画6件、雑談5件、ASMR3件、歌2件、朗読・声劇2件、同時視聴2件、TRPG2件の固定30動画で品質を確認しなければならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-036-1` 前提: V8-時刻-036の前提を満たす公開データまたは操作がある。条件: 固定評価データによる受入試験。期待結果: 本人・外部、字幕あり・なし、作成者時刻あり・なしを含み、全件が決定的検証、事実確認、編集確認に合格する。。

要求源: Issue #1 V8-時刻-036, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-TIME-037: 公開画面は各タイムスタンプの由来を「作成者による時刻一覧」「作成者一覧を基にdiopsideで調整」「diopsideで作成した時刻一覧」のいずれかとして区別し

diopside v8の時刻は、公開画面は各タイムスタンプの由来を「作成者による時刻一覧」「作成者一覧を基にdiopsideで調整」「diopsideで作成した時刻一覧」のいずれかとして区別し、YouTube公式情報と誤認させてはならない。を**satisfy**。

根拠: 見どころ偏重ではなく、動画全体を安全に移動できる目次を提供するため。

分類: `product` / `functional`

受入条件:
- `AC-V8-TIME-037-1` 前提: V8-時刻-037の前提を満たす公開データまたは操作がある。条件: 文言・画面試験。期待結果: 由来不明の作成済み一覧が0件で、内部の英字コードではなく日本語で表示する。。

要求源: Issue #1 V8-時刻-037, user:2026-08-03
検証証跡: src/domain/validation.test.ts, tests/pilot-timestamps.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/manual-content-update.md; 実装=src/domain/content.ts,scripts/diff-timestamps.ts; テスト=src/domain/validation.test.ts,tests/pilot-timestamps.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-COST-001: サービス運用に起因する請求額は、既存のChatGPT／Codex契約を除いて毎月0円でなければならない

diopside v8の費用は、サービス運用に起因する請求額は、既存のChatGPT／Codex契約を除いて毎月0円でなければならない。を**satisfy**。

根拠: 既存のChatGPT／Codex契約以外の運用請求を発生させず、個人運用を持続可能にするため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-COST-001-1` 前提: V8-費用-001の前提を満たす公開データまたは操作がある。条件: 月次請求確認。期待結果: GitHub、配信、データ取得、保存、検索、監視、ドメイン、外部APIの月次請求額がすべて0円である。既存端末、電気、通信回線は算定外とする。。

要求源: Issue #1 V8-費用-001, user:2026-08-03
検証証跡: tests/repository-policy.test.ts
トレース: 設計=docs/decisions/ADR-0001-zero-cost-static-pages.md,docs/operations/cost-check.md; 実装=operations/cost-policy.json,scripts/verify-repository-policy.ts; テスト=tests/repository-policy.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-COST-002: 公開基盤は、公開リポジトリで利用できるGitHub Pagesと既定の `github.io` 配下のURLに限定しなければならない

diopside v8の費用は、公開基盤は、公開リポジトリで利用できるGitHub Pagesと既定の `github.io` 配下のURLに限定しなければならない。を**satisfy**。

根拠: 既存のChatGPT／Codex契約以外の運用請求を発生させず、個人運用を持続可能にするため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-COST-002-1` 前提: V8-費用-002の前提を満たす公開データまたは操作がある。条件: リポジトリ・Pages設定確認。期待結果: リポジトリは公開設定で、独自ドメインと有料プランを必要としない。。

要求源: Issue #1 V8-費用-002, user:2026-08-03
検証証跡: tests/repository-policy.test.ts
トレース: 設計=docs/decisions/ADR-0001-zero-cost-static-pages.md,docs/operations/cost-check.md; 実装=operations/cost-policy.json,scripts/verify-repository-policy.ts; テスト=tests/repository-policy.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-COST-003: AWSその他の有料クラウド資源をv8の閲覧・検索・生成・公開に使用してはならない

diopside v8の費用は、AWSその他の有料クラウド資源をv8の閲覧・検索・生成・公開に使用してはならない。を**satisfy**。

根拠: 既存のChatGPT／Codex契約以外の運用請求を発生させず、個人運用を持続可能にするため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-COST-003-1` 前提: V8-費用-003の前提を満たす公開データまたは操作がある。条件: 構成確認。期待結果: クラウド認証情報がなくても全手順を実行でき、有料資源の構成定義が存在しない。。

要求源: Issue #1 V8-費用-003, user:2026-08-03
検証証跡: tests/repository-policy.test.ts
トレース: 設計=docs/decisions/ADR-0001-zero-cost-static-pages.md,docs/operations/cost-check.md; 実装=operations/cost-policy.json,scripts/verify-repository-policy.ts; テスト=tests/repository-policy.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-COST-004: 有料または従量課金の検索、データベース、アクセス解析、監視、生成、配信サービスへ依存してはならない

diopside v8の費用は、有料または従量課金の検索、データベース、アクセス解析、監視、生成、配信サービスへ依存してはならない。を**satisfy**。

根拠: 既存のChatGPT／Codex契約以外の運用請求を発生させず、個人運用を持続可能にするため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-COST-004-1` 前提: V8-費用-004の前提を満たす公開データまたは操作がある。条件: 依存関係・通信確認。期待結果: 外部依存一覧に課金が発生し得る実行時サービスが0件である。。

要求源: Issue #1 V8-費用-004, user:2026-08-03
検証証跡: tests/repository-policy.test.ts
トレース: 設計=docs/decisions/ADR-0001-zero-cost-static-pages.md,docs/operations/cost-check.md; 実装=operations/cost-policy.json,scripts/verify-repository-policy.ts; テスト=tests/repository-policy.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-COST-005: 外部サービスの料金または無償条件が変わり請求が発生し得る場合は、課金して継続せず、該当処理を停止しなければならない

diopside v8の費用は、外部サービスの料金または無償条件が変わり請求が発生し得る場合は、課金して継続せず、該当処理を停止しなければならない。を**satisfy**。

根拠: 既存のChatGPT／Codex契約以外の運用請求を発生させず、個人運用を持続可能にするため。

分類: `project` / `nonfunctional`

受入条件:
- `AC-V8-COST-005-1` 前提: V8-費用-005の前提を満たす公開データまたは操作がある。条件: 運用手順確認。期待結果: 費用0円を確認できない状態では公開更新を行わず、人へ判断を求める。。

要求源: Issue #1 V8-費用-005, user:2026-08-03
検証証跡: tests/repository-policy.test.ts
トレース: 設計=docs/decisions/ADR-0001-zero-cost-static-pages.md,docs/operations/cost-check.md; 実装=operations/cost-policy.json,scripts/verify-repository-policy.ts; テスト=tests/repository-policy.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-QUALITY-001: 検索、絞り込み、履歴、お気に入り、ワードクラウド描画はブラウザ内で処理しなければならない

diopside v8の品質は、検索、絞り込み、履歴、お気に入り、ワードクラウド描画はブラウザ内で処理しなければならない。を**satisfy**。

根拠: 主要な利用環境で、速く、理解しやすく、支援技術でも利用できる状態を保証するため。

分類: `product` / `nonfunctional`

受入条件:
- `AC-V8-QUALITY-001-1` 前提: V8-品質-001の前提を満たす公開データまたは操作がある。条件: 通信監査。期待結果: 閲覧中の動的バックエンドAPI呼出しが0件である。。

要求源: Issue #1 V8-品質-001, user:2026-08-03
検証証跡: src, tests, e2e
トレース: 設計=docs/design/generated/system.gen.md; 実装=src,scripts; テスト=src,tests,e2e; 参照資料=Issue #1,dev-standard default profile

## V8-QUALITY-002: 公開画面はスマートフォンを主要環境とし、検索からYouTubeを開くまでを初見利用者が1分以内に完了できなければならない

diopside v8の品質は、公開画面はスマートフォンを主要環境とし、検索からYouTubeを開くまでを初見利用者が1分以内に完了できなければならない。を**satisfy**。

根拠: 主要な利用環境で、速く、理解しやすく、支援技術でも利用できる状態を保証するため。

分類: `product` / `nonfunctional`

受入条件:
- `AC-V8-QUALITY-002-1` 前提: V8-品質-002の前提を満たす公開データまたは操作がある。条件: 利用者試験。期待結果: 375画素幅の代表5課題中4課題以上を60秒以内に完了する。。

要求源: Issue #1 V8-品質-002, user:2026-08-03
検証証跡: src, tests, e2e
トレース: 設計=docs/design/generated/system.gen.md; 実装=src,scripts; テスト=src,tests,e2e; 参照資料=Issue #1,dev-standard default profile

## V8-QUALITY-003: 操作対象は44画素以上、キーボード操作可能、フォーカス表示あり、状態変化を読み上げ可能でなければならない

diopside v8の品質は、操作対象は44画素以上、キーボード操作可能、フォーカス表示あり、状態変化を読み上げ可能でなければならない。を**satisfy**。

根拠: 主要な利用環境で、速く、理解しやすく、支援技術でも利用できる状態を保証するため。

分類: `product` / `nonfunctional`

受入条件:
- `AC-V8-QUALITY-003-1` 前提: V8-品質-003の前提を満たす公開データまたは操作がある。条件: 自動試験・手動確認。期待結果: モバイル・デスクトップのアクセシビリティ試験に合格する。。

要求源: Issue #1 V8-品質-003, user:2026-08-03
検証証跡: src, tests, e2e
トレース: 設計=docs/design/generated/system.gen.md; 実装=src,scripts; テスト=src,tests,e2e; 参照資料=Issue #1,dev-standard default profile

## V8-QUALITY-004: 画面の見出し、ボタン、説明、状態、エラー、絞り込み名は自然な日本語でなければならない

diopside v8の品質は、画面の見出し、ボタン、説明、状態、エラー、絞り込み名は自然な日本語でなければならない。を**satisfy**。

根拠: 主要な利用環境で、速く、理解しやすく、支援技術でも利用できる状態を保証するため。

分類: `product` / `nonfunctional`

受入条件:
- `AC-V8-QUALITY-004-1` 前提: V8-品質-004の前提を満たす公開データまたは操作がある。条件: 文言一覧の機械確認・人手確認。期待結果: 英語だけの画面文言が0件で、サービス名・公式固有名詞・出典タイトル・URL・識別子以外の不要な英字が0件である。。

要求源: Issue #1 V8-品質-004, user:2026-08-03
検証証跡: src, tests, e2e
トレース: 設計=docs/design/generated/system.gen.md; 実装=src,scripts; テスト=src,tests,e2e; 参照資料=Issue #1,dev-standard default profile

## V8-QUALITY-005: 公開データの取得失敗、構造不適合、公開版不一致、正常な0件を区別して日本語で表示しなければならない

diopside v8の品質は、公開データの取得失敗、構造不適合、公開版不一致、正常な0件を区別して日本語で表示しなければならない。を**satisfy**。

根拠: 主要な利用環境で、速く、理解しやすく、支援技術でも利用できる状態を保証するため。

分類: `product` / `nonfunctional`

受入条件:
- `AC-V8-QUALITY-005-1` 前提: V8-品質-005の前提を満たす公開データまたは操作がある。条件: 障害注入試験。期待結果: 各障害の固定データが別の状態と復旧案を表示する。。

要求源: Issue #1 V8-品質-005, user:2026-08-03
検証証跡: src, tests, e2e
トレース: 設計=docs/design/generated/system.gen.md; 実装=src,scripts; テスト=src,tests,e2e; 参照資料=Issue #1,dev-standard default profile

## V8-SAFETY-001: 動画タイトル、説明、字幕、コメント、チャット、Issue本文、プルリクエスト本文の外部入力を、命令ではなく信頼できない資料として扱わなければならない

diopside v8の安全は、動画タイトル、説明、字幕、コメント、チャット、Issue本文、プルリクエスト本文の外部入力を、命令ではなく信頼できない資料として扱わなければならない。を**satisfy**。

根拠: 信頼できない外部入力、秘密情報、公開禁止資料が公開物へ混入することを防ぐため。

分類: `product` / `nonfunctional`

受入条件:
- `AC-V8-SAFETY-001-1` 前提: V8-安全-001の前提を満たす公開データまたは操作がある。条件: 攻撃入力試験。期待結果: 外部入力中の指示がスキル、変更範囲、ツール操作、公開判断を変更しない。。

要求源: Issue #1 V8-安全-001, user:2026-08-03
検証証跡: tests/content-validation.test.ts, tests/repository-policy.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/privacy-and-safety.md; 実装=scripts/validate-content.ts,scripts/verify-repository-policy.ts; テスト=tests/content-validation.test.ts,tests/repository-policy.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SAFETY-002: 生の字幕、生のコメント、生のチャット、投稿者識別子をGit履歴またはPagesへ保存してはならない

diopside v8の安全は、生の字幕、生のコメント、生のチャット、投稿者識別子をGit履歴またはPagesへ保存してはならない。を**satisfy**。

根拠: 信頼できない外部入力、秘密情報、公開禁止資料が公開物へ混入することを防ぐため。

分類: `product` / `nonfunctional`

受入条件:
- `AC-V8-SAFETY-002-1` 前提: V8-安全-002の前提を満たす公開データまたは操作がある。条件: 公開境界試験。期待結果: 合成した漏えいデータを検査が拒否し、公開成果物に該当項目が0件である。。

要求源: Issue #1 V8-安全-002, user:2026-08-03
検証証跡: tests/content-validation.test.ts, tests/repository-policy.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/privacy-and-safety.md; 実装=scripts/validate-content.ts,scripts/verify-repository-policy.ts; テスト=tests/content-validation.test.ts,tests/repository-policy.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SAFETY-003: 秘密情報をリポジトリ、プルリクエスト、確認報告、Pagesへ含めてはならない

diopside v8の安全は、秘密情報をリポジトリ、プルリクエスト、確認報告、Pagesへ含めてはならない。を**satisfy**。

根拠: 信頼できない外部入力、秘密情報、公開禁止資料が公開物へ混入することを防ぐため。

分類: `product` / `nonfunctional`

受入条件:
- `AC-V8-SAFETY-003-1` 前提: V8-安全-003の前提を満たす公開データまたは操作がある。条件: 秘密情報検査。期待結果: 合成した秘密情報を検査が拒否し、OpenAI APIキーその他の運用秘密を必要としない。。

要求源: Issue #1 V8-安全-003, user:2026-08-03
検証証跡: tests/content-validation.test.ts, tests/repository-policy.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/privacy-and-safety.md; 実装=scripts/validate-content.ts,scripts/verify-repository-policy.ts; テスト=tests/content-validation.test.ts,tests/repository-policy.test.ts; 参照資料=Issue #1,dev-standard default profile

## V8-SAFETY-004: 削除、非公開化、対象外化が確認された動画を次の公開版から除外し、再追加を防止しなければならない

diopside v8の安全は、削除、非公開化、対象外化が確認された動画を次の公開版から除外し、再追加を防止しなければならない。を**satisfy**。

根拠: 信頼できない外部入力、秘密情報、公開禁止資料が公開物へ混入することを防ぐため。

分類: `product` / `nonfunctional`

受入条件:
- `AC-V8-SAFETY-004-1` 前提: V8-安全-004の前提を満たす公開データまたは操作がある。条件: 削除・再追加試験。期待結果: 除外記録のある動画は再検出後も公開候補にならない。。

要求源: Issue #1 V8-安全-004, user:2026-08-03
検証証跡: tests/content-validation.test.ts, tests/repository-policy.test.ts
トレース: 設計=docs/design/generated/system.gen.md,docs/operations/privacy-and-safety.md; 実装=scripts/validate-content.ts,scripts/verify-repository-policy.ts; テスト=tests/content-validation.test.ts,tests/repository-policy.test.ts; 参照資料=Issue #1,dev-standard default profile
