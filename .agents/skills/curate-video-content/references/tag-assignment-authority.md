# タグ付与規則の正本と監査

タグ規則は役割ごとに次の場所を正本とする。別の文書や日次シートへ意味を複製せず、参照先を明示する。

| 役割 | 正本 | 内容 |
| --- | --- | --- |
| 利用者向け要件 | `spec/requirements/requirements.json` | 該当タグを省略しないこと、基数、公開品質 |
| タグの意味 | `content/taxonomy/tag-taxonomy.json` | 不変Tag ID、表示名、包含基準、除外基準 |
| 機械候補と固定例 | `spec/sources/tag-assignment-audit-v1.json` | blocking候補、要確認候補、必須・除外の回帰例 |
| 作業手順 | `.agents/skills/curate-video-content/SKILL.md` | 根拠順、1動画1PR、承認と検証 |
| 日次の結果 | タグ監査Google Sheet | 期待、実績、候補、理由。正本規則そのものは保持しない |

## 新衣装お披露目

`tag-context-occasion-2c2388f2000e` の最終的な意味判断はtaxonomyの包含・除外基準に従う。公開タイトルが機械監査のblocking信号に一致する場合は、タグ付与または除外根拠の修正なしに承認しない。あらすじ・時刻一覧だけが一致する場合は、誤陽性を避けて要確認候補とし、動画固有の公開根拠で判断する。

水着衣装や3D共通衣装も、配信者・出演者の新たな衣装を実際に見せるなら新衣装に含める。ゲーム内キャラクターの水着、通常の3Dモデル初披露、Live2D 2.0/3.0やにじ3Dの機能更新、実披露を含まない告知・予告は含めない。

監査結果は `npm run audit:tag-assignments -- --output <一時JSON>` で生成し、各行の `expected`、`actual`、`candidate`、`reason` を日次シートへ対応させる。

## ゲスト交代・順次紹介企画

別チャンネルでゲスト・人物・投稿を順番に紹介する形式は、taxonomyの出演者規則に従いチャンネル主だけを人物／グループへ登録する。通常の同時参加コラボと区別し、タイトルの「企画」や「紹介」だけで決めない。チャンネル主は `content/people/channel-person-mappings.json` と公開メタデータで照合する。紹介対象・投稿者・別時間のゲストを、タイムスタンプに名前があることだけでコラボ相手へ戻さない。

動画別の確認結果と公開根拠は `spec/sources/sequential-guest-appearances-v1.json` に記録し、`npm run audit:collaboration-tags` で主催者欠落・他人物／ユニット再混入を検査する。登場時刻は人物タグとは独立に維持する。
