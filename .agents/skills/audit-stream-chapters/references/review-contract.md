# Review contract

Both review files contain `schemaVersion`, `videoId`, `candidateHash`, `reviewerRunId`, `status`, `majorIssues`, `reviewedAt`, `checks`, and `findings`.

Fact checks are `evidenceRoute`, `evidenceReferences`, `boundaryContext`, `labelSupport`, and `evidenceConflicts`.
Every check is a pass flag. In particular, `evidenceConflicts: true` means the
reviewer confirmed that the evidence contains no unresolved conflict; `false`
means a conflict remains.

Editorial checks are `navigationValue`, `overSegmentation`, `underSegmentation`, `labelConsistency`, and `spoilerSafety`; the file also contains `factCheckResultWasHidden: true`.

Passing requires status `合格`, `majorIssues: 0`, every check `true`, no major finding, the current candidate hash, and a reviewer run ID distinct from the composer and other reviewer. A reviewer writes findings only and never edits the draft.

After any draft change, discard both review results and run new independent reviews.
If `status`, `majorIssues`, the check flags, and major findings contradict one
another, discard only the inconsistent review and rerun it in a fresh independent
context against the unchanged candidate. Do not recompose solely to repair a
review artifact contract error.
