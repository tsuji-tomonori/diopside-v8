# Semantic articulation protocol

Use this internally for complex ambiguity, requirement intake, core extraction, and meaning-preserving compression. Do not expose chain-of-thought or candidate scoring.

## 1. Atomic meaning ledger

Split the input into units expressing one fact, request, prohibition, evaluation, constraint, relation, or explicit concern.

| Unit | Protect |
|---|---|
| Fact | actor, action, object, time, source |
| Request | desired output or action |
| Prohibition | forbidden result or operation |
| Constraint | audience, format, deadline, budget, permission, safety |
| Limiter | negation, condition, exception, comparison, degree |
| Precision | number, date, name, sequence, quotation |
| Epistemic status | verified, reported, inferred, possible, unknown |
| Affect or value | explicit feeling, impact, priority, concern |

Protect meaning before rewriting style.

## 2. Relation map

Map units to:

- Goal: desired state.
- Current state: what is true now.
- Obstacle: what blocks the goal.
- Constraint: what cannot be violated.
- Value: what should be preserved or avoided.
- Decision variable: the choice that changes the next step.
- Desired support: listening, articulation, selection, advice, drafting, or execution.

Connect units through cause, goal, evidence, example, exception, condition, contrast, concession, or reformulation. Leave an unresolved relation blank rather than inventing a psychological explanation.

## 3. Practical question under discussion

Distinguish:

- Topic: what the words mention.
- Literal request: what was explicitly asked.
- Practical question: what answer or action would make the turn useful.

Prefer the practical question that explains the most protected units with the fewest unsupported assumptions.

## 4. Intent candidates

Generate at most three internal candidates:

1. Literal intent: explicit request.
2. Plan intent: goal and obstacle behind it.
3. Interaction intent: role expected from the assistant.

Compare coverage, constraint fit, unsupported assumptions, path impact, error cost, and correctability. Use the least-assumptive candidate that explains the turn. If two candidates remain close and imply different actions, ask one contrastive question.

## 5. Core proposition

Accept a core only when it:

1. answers the practical question;
2. explains why the main details were mentioned; and
3. changes the response if changed.

“This is a communication problem” fails because it is a topic label, not an actionable relation.

## 6. Clarification decision

Clarify if the missing unit affects the deliverable, user-owned value, authority boundary, safety, legality, health, finances, privacy, external communication, deletion, publication, or hard-to-reverse work.

Proceed under an explicit default if the ambiguity is low risk, reversible, and cheap to correct.

Prefer one high-information question:

- contrastive: “Is the priority X or Y?”
- bounded: “Is this internal or customer-facing?”
- hypothesis check: “Is the problem the unstable requirement rather than the number of revisions?”

## 7. Meaning-preserving compression

Classify units:

- MUST: requests, prohibitions, constraints, limiters, precision, safety, attribution.
- CORE: goal, obstacle, value conflict, decision point.
- SUPPORT: evidence, reason, representative example.
- REDUNDANT: repeated meaning, ceremony, duplicated hedge, process narration.

Reduce in this order:

1. Remove REDUNDANT units.
2. Fuse units with the same actor, action, or conclusion.
3. Keep one representative example unless enumeration matters.
4. Replace abstract nouns with concrete actions where precision stays intact.
5. Replace unnecessary jargon; define necessary jargon once.
6. Split at cause, condition, contrast, or exception boundaries when density spikes.
7. Order CORE first, MUST second, SUPPORT last.

Do not delete relation markers such as “however,” “only if,” or “except.” They may carry the central meaning.

## 8. Semantic checksum

Check silently:

- Completeness: every MUST and necessary CORE unit remains recoverable.
- Faithfulness: every claim is supported by input or verified evidence.
- Limiters: negation, condition, exception, degree, uncertainty, and attribution remain intact.
- Relevance: the first paragraph answers the practical question.
- Nonduplication: every sentence adds a distinct unit or relation.
- Correctability: the user can identify and correct the tentative inference.
