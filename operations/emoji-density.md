# 保存済みチャットからの絵文字密度再集計

人が指定した有限のローカル素材集合を、`scripts/reanalyze-emoji-density.ts`で再解析する。素材ディレクトリは読み取りだけに使う。生チャットや投稿者識別子を出力へ保存しない。

```sh
node --experimental-strip-types scripts/reanalyze-emoji-density.ts \
  --data-root /home/t-tsuji/work/data/diopside \
  --output .tmp/emoji-density-20260905 \
  --updated-at 2026-09-05T00:00:00Z \
  --apply
```

`--apply`なしでは匿名集計と`report.json`だけを出力する。指定時は既存正本に登録された動画だけを検証して`content/videos/`へ反映し、content manifestの件数を更新する。未登録動画は匿名集計だけを出力し、新たに公開対象へ追加しない。commit・push・公開はこのコマンドでは行わない。

入力はprocess manifestの元チャットを優先し、利用できなければacquired/chat内の保存候補を試す。複数の取得snapshotは結合しない。gzipにも対応する。整形済みの本文だけからカスタム絵文字を推定しない。動画尺は既存正本、保存済みmetadataの秒数またはISO 8601 durationから得る。

集計規則2.0.0は次のとおり。

- 追加された投稿本文のカスタム絵文字を1出現ずつ数える。同一投稿IDの再出現、置換表示、バッジ、通常のUnicode絵文字は除外する。
- 投稿の表示時刻を優先し、なければリプレイの再生位置を使う。開始前・終了後・時刻不明は独立した回数とする。
- 再生時間内は60秒の半開区間 `[開始, 終了)` に分け、ゼロ件の区間も保持する。末尾は動画尺で切り詰める。
- `timeline.bins`は区間順の配列で、各要素は`[itemsのindex, 出現回数]`の疎な配列。index昇順、重複なし。時間内合計と除外3区分の合計を総使用回数と一致させる。
- 公開画像URLは絵文字画像のYouTube CDNに限定する。本文、元の絵文字ID、投稿ID、投稿者情報は保持しない。入力指紋も公開JSONから除く。

`report.json`の`applied`は正本反映、`analyzed`は匿名集計のみ、`unavailable`は素材または動画尺なし、`failed`は解析・検証・反映失敗を示す。0件を正常に集計できた動画も明示的な集計結果を持つ。

中断・入力形式の回復後は同じ引数に`--resume`を追加する。前回の動画ID snapshotと更新日時を維持し、完了済みの結果を保持して未完了のみ再試行する。新しい素材も含めた全件再解析は別の出力ディレクトリと更新日時で開始する。並行して同じ出力ディレクトリへ実行しない。

反映後は`npm run validate:content`、対象単体試験、`npm run build`、`e2e/detail.spec.ts`の絵文字表示試験を確認する。`docs/`を直接修正しない。公開承認とmergeは所有者が行う。
