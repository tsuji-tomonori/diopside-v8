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
- 編集確認: 各ゲスト名で移動先が分かり、白雪巴の紹介と本人登場の開始が分かるか確認する。対象人物を確認できない一般的な「次のゲスト」への置換を合格にしない。根拠不足は具体的な再確認理由を残す。
