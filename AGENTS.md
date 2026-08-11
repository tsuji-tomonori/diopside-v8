<!-- dev-standard:begin -->
# 開発ルールの統合用参照

以下のうち必要な規則を対象repositoryの`AGENTS.md`へ統合する。対象固有のbuild、test、ownership、security、commit規約を維持し、file全体を上書きしない。

- 自然言語のfeature、fix、refactor、design concernを`chat-first-development`の起動条件として扱う。
- `right-size-execution`で`direct`、`assured`、`regulated`を選ぶ。
- 通常のdirect / assuredでは恒久的な`work/<id>/`を作らない。
- 再開用一時状態が必要な場合だけgitignoreされた`.devflow/run/`を使う。
- 永続要件が変わる場合だけ`maintain-canonical-requirements`で`requirements.json`へadd / update / retireを適用する。
- 実装から生成できるas-built設計を手書き文書として二重管理しない。
- selected checkだけを`governance/reviews/<change-id>.yaml`へ保存する。
- 未選択項目をN/Aとして保存しない。
- Commit Commentへ目的、変更内容、要件影響、設計影響、review path、検証契約、互換性・残存リスクを記載する。
- Change Manifest、Requirement Impact Result、Design Impact Resultを独立fileとして作らない。
- 単体test、build、lint、type、security scan、coverage、deploy resultはGitHub Actions等の外部サービスを正本とし、生ログをrepositoryへ複製しない。
- `Invariant`はtrigger該当時にPass必須、`Risk-selected`は選択時だけblocking、`Advisory`は修正・Issue・residual riskへ収束、`Periodic`は定期監査で扱う。
- checkは変更開始前、実装中、PR前、Merge前、Deploy後、定期監査の適切な時点で実行する。
- authentication、authorization、PII、data loss、不可逆production、法令・契約統制、高額操作の場合だけregulated workflowを使用する。
- regulatedの場合だけ`govern-development-request`、`author-lifecycle-docs`、`authorize-autonomous-execution`、work item、hash chain、phase gateを追加する。
- 可逆な実装方法、tool、trace path、test file、reviewerの変更だけで再承認を求めない。
- 明示権限なしにproduction deploy、削除、公開、高額操作、mergeを行わない。
- 検証失敗、新依存、契約影響、証拠不足がある場合だけ実行範囲・検証・review・computeを拡張する。
- 決定的成功後はCommit Comment、review result、PR/CI確認以外の探索を止める。
<!-- dev-standard:end -->

# diopside v8 固有ルール

- Issue #1由来の142件と、それ以後の所有者指示を反映した`spec/requirements/requirements.json`を正本として扱い、受入条件を弱めない。
- TypeScript strictを維持し、公開画面・検索・端末内保存は静的なブラウザ内処理だけで完結させる。
- 動画更新は人がChatGPT／Codex画面から開始する。1回の明示要求で有限の適格タイムスタンプ対象集合を固定し、動画ごとの追加チャット承認を挟まず、全対象を1動画1PRのレビュー可能状態または理由付きの処理不能状態まで進める。1件の失敗を理由に他の対象を止めない。
- ChatGPT Workのタイムスタンプ一括処理は`run-timestamp-work-harness`を入口にし、台帳snapshotのPython確認、公開素材の一時取得、独立`codex exec`判断、決定的検証、1動画draft PRのcommit・push、競合検知付き台帳更新と再読確認までを同じ有限batchで完了する。mergeと公開は人が行う。
- ChatGPT Workを2〜20セッションで分散実行する場合、各workerは1動画だけを扱い、動画IDの大文字小文字を保持したremote branchへの非force pushを原子的claimにする。競合したworkerは次候補へ進み、claim直後に処理中draft PRを作る。branchのforce push・削除・stale claimの自動奪取を行わない。
- ActionsからAI/APIを呼ばず、予定実行、従量課金API、独自Pages deploy Actions、自動マージを追加しない。検証済みのmainマージ後に限り、正本から静的成果物を決定生成してmainへcommitし、既存のbranch方式Pages buildを要求できる。
- 通常の動画追加は1動画1PRとし、タグ体系、スキル、検証、画面、Pages設定の変更を同梱しない。各PRを人がマージする操作を、その動画の公開承認とする。
- 生の字幕、コメント、チャット、投稿者識別子、秘密情報をGitまたは公開成果物へ保存しない。
- 静的成果物は正本から決定的に生成し、`docs/` と `docs/design/generated/` を直接編集しない。
- GitHub Pagesはbranch方式 `main/docs` とし、独自ドメインや有料実行時サービスを使わない。
