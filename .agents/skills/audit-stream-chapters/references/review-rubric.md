# Review rubric

Reject when any condition holds:

- Full transcript/local-ASR coverage is not proven and no valid creator list is adopted unchanged.
- A nonzero boundary lacks resolvable creator-list or transcript/ASR evidence.
- A label asserts content absent from its evidence.
- A comment, chat burst, reaction, or highlight is presented as a navigation chapter.
- A sustained topic, match, segment, scene, song, break, or aftertalk is missing.
- Adjacent chapters serve the same navigation purpose.
- A fixed interval or fixed chapter count determined a boundary.
- Non-content lead-in or trailing silence is a standalone chapter.
- A public label exposes a plot, identity, outcome, secret, death, or final encounter.
- The list fails 0-second start, at least three items, integer unique ascending starts, 10-second spacing, duration bounds, Japanese label, allowed confidence, or unresolved-major-issue gates.

Findings use `code`, `severity`, `timestampId` or `startSeconds`, `message`, `evidenceRefs`, and `resolution`. Reviewers report; they do not repair.

## ゲスト交代・順次紹介企画

- 事実確認: 各紹介名を該当区間の根拠へ解決し、紹介・投稿読上げと本人の通話登場を混同していないか確認する。匿名投稿の人物を推定しない。
- 編集確認: 確認できるゲスト名と白雪巴の紹介・本人登場を明記する。未確認名を省略し、根拠のある投稿内容・役割・声真似対象で移動先を区別する対応は許容する。「次のゲスト」だけでは移動目的が分からない場合は具体化を求める。公開匿名は維持する。
- 名前だけの未確認を動画全体の不合格理由にしない。時刻も未支持なら、根拠のある隣接区間への統合または境界削除で解消し、持続する内容の欠落を作っていないか確認する。疑義・対象区間・採用した対応がPRコメントまたはCommit Commentへ引き継がれることを確認する。名前省略は全編根拠・各境界の支持・同一candidate hashへの独立した事実／編集確認を免除しない。
- 氏名確認を入口数秒だけで打ち切らず、同じ通話の後続発話と退出までの連続性を確認する。局所の発話者・相手・第三者を区別し、後からの呼称を一律に無効としない。前後編共通の名簿、過去の出演への回想、別枠への誘導を実際の入室へ変換しない。
- 配信者が認めた匿名参加は公開名の欠落とみなさない。匿名方針とキャラクター等の公開識別情報を根拠へ解決する。公開匿名と字幕欠損などによる名前の未確認を区別して記録し、いずれも人物を推定・補完しない。
