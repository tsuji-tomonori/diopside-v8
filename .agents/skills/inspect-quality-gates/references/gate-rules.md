# Gate rules

Gate order is fixed by `governance/policy.json`. Each gate digest includes required document hashes and all checklist results assigned to that phase.

Never accept:

- remaining template placeholders;
- `undecided` applicability;
- N/A without rationale;
- Pass without reachable evidence;
- applicable checks without reviewer and timestamp;
- Fail without Issue ID and valid exception;
- approval for a different digest;
- an AI-generated identity as a human approver.

Use `latest-<phase>.json` in the work item's `reports/` directory as a generated diagnosis, not as a substitute for underlying evidence.
