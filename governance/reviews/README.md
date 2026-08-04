# レビュー結果

このディレクトリには、変更ごとに選択されたcheck結果だけを保存します。check ID、class、timing、trigger、合格条件の正本は`governance/checks/catalog.yaml`です。

## ファイル

```text
governance/reviews/<change-id>.yaml
```

新規ファイルは`review-result.template.yaml`から作成し、`review-result.schema.json`へ適合させます。`change-id`はPR番号に依存させません。

## 保存する情報

- `direct`、`assured`、`regulated`のprofile
- reviewを含むcommitを示す`source_ref: self`
- catalog versionとdigest
- 完了したtimingとimpact flags
- selected checkのID、class、result、到達可能な証拠
- N/A、Advisory、残存リスクの短い根拠

as-built関連では`as_built_standard_change`と`as_built_adoption`を分けます。前者は`FAST-024`、後者は`impact_details.as_built_adoption`の`scope`と`exclusions`を使用します。

未選択check、全catalogのN/A、test件数、coverage全文、build・scan・CIの生ログは保存しません。自動実行結果の正本はGitHub Actions等の外部サービスです。

## 結果

- `pass`: checkを直接裏付ける証拠がある
- `fail`: blocking checkは修正し、Advisoryは修正・Issue・残存リスクのいずれかへ収束する
- `na`: selectorで選択後、具体的事実により適用外と判明した場合だけ使用する

## 検証

```bash
python governance/reviews/validate.py --root . --commit HEAD
```

validatorはCommit Commentが指すactive reviewについて、schema、catalog、必須check、blocking fail、Advisory、証拠参照を確認します。

過去の`CHG-*.yaml`は変更時点の証跡なので、現在のtreeやcatalogへ合わせて書き換えません。このREADME、schema、template、validatorは現行契約として更新します。インストーラーは過去の`CHG-*.yaml`を導入先へコピーしません。
