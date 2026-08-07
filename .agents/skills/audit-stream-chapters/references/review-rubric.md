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
