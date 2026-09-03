# ADR-0001: 費用0円の静的GitHub Pages構成

- 状態: 採用
- 決定日: 2026-08-03
- 根拠: Issue #1 `V8-COST-*`、`V8-OPS-012`～`014`、所有者指示 `V8-OPS-017`

## 決定

React／TypeScriptの画面と版付きJSONをビルド済み静的成果物として `main/docs` にコミットし、公開リポジトリのGitHub Pages branch方式で配信する。検索、絞り込み、ワードクラウド描画、履歴、お気に入りはブラウザ内で実行する。候補生成は運用者がChatGPT／Codex画面から開始し、正本だけを人がプルリクエストで確認する。mainの品質ゲート合格後に、Actionsが内容ハッシュのrelease IDと静的成果物を生成・検証し、差分がある場合だけ専用branchへcommitしてrelease PRを作成する。release PRを人がmainへマージしたcommitによる `main/docs` の更新が既存のbranch方式Pages buildを起動するため、main保護ルールのbypass、自動merge、Pages build APIは使わない。

## 理由

公開面では動的API、データベース、検索サービス、認証、AWSを不要にし、既存のChatGPT／Codex契約以外の月次請求を0円にできる。GitHub Pagesの配信先は、`main/docs` branch方式と整合する所有者承認済みの独自ドメイン（現在は `tme.page.diopside.net`）だけを許可する。正本、生成物、公開版をGit履歴で復元できる。内容ハッシュrelease IDで複数の索引・詳細・画面bundleを一世代として分離するため、Pages配信やブラウザキャッシュの更新途中でも異なる世代を混在させない。通常の正本PRでは生成差分を持たず、検証済み生成物だけのrelease PRへ分離するため、並行する動画更新同士のrelease ID競合も起きない。有限の非公開素材バックフィルは公開面に接続しない別ADR（ADR-0002）の対象である。

## 採用しない案

- AWS上の収集・API・DB・配信: 費用0円と保守範囲に反する。
- release IDを廃止して固定pathを上書きする案: 複数JSONや画面bundleの取得時期がずれた際に世代混在を検出できず、端末キャッシュも安全に切り替えられない。
- GitHub Actionsの予定生成・外部生成呼出し: 人が開始する承認境界に反する。`workflow_dispatch` による読取専用の検証・候補検出と、検証済みmainからの決定的なrelease生成だけを許可する。
- 独自のPages deploy Action: `main/docs` のbranch公開で足り、公開経路を増やす必要がない。
- main保護ルールをActionsからbypassする案: 書込workflow全体へ保護回避権限を与えるため採用しない。生成物だけのrelease PRを使う。
- release PRを自動mergeする案: 人による公開承認境界を失うため採用しない。
- release commit後にPages build APIも呼び出す案: 同一commitのbranch buildが二重起動し、一方が競合で失敗扱いになるため採用しない。

## 再検討条件

公開リポジトリのPagesまたは必要なCIに追加請求が生じる、静的データ量がPages制限を超える、または要件がログイン・サーバー同期を必須に変更する場合は、公開更新を停止して別ADRで再検討する。
