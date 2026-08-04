---
name: generate-implementation-design
description: Generate deterministic as-built design and execute its static quality contracts for FastAPI or AWS CDK implementation artifacts. Use for API, SQL, DDL, E2E, tool, CloudFormation, drift, sample, coverage, or suppression checks.
---

# Generate Implementation Design

Generate detailed design from implementation contracts while keeping canonical requirements above both.

## Authority order

1. `spec/requirements/requirements.json` defines intended behavior.
2. Implementation artifacts define implemented structure and interfaces.
3. Generated detailed design describes those artifacts and includes their digests.
4. A mismatch is a defect; never edit generated docs to hide it.
5. Outputs are managed bundles below `docs/design/generated/`; Markdown uses `.gen.md`, machine data uses `.gen.json`, and every output carries a direct-edit prohibition.
6. Refuse an output path outside the generated root, a symlinked path, or replacement of a directory without this generator's complete ownership manifest.

## FastAPI contract

- Organize each operation so `router.py` shows orchestration and `functions.py` contains concrete processing.
- Keep route bodies as a readable sequence of calls. Return the final call directly; do not assign a response only to return the variable.
- Generate sequence diagrams from route AST call order.
- Generate API/IF catalogs and API details from the application-produced OpenAPI document, handler metadata, error branches, and `API_SAMPLES`, not duplicated prose.
- Keep executable SQL in `.sql` files. Parse it with SQLGlot AST; generate query objects and a CRUD matrix from parsed statements. Reject unparseable SQL rather than guessing with regular expressions.
- Optionally add authoritative DDL, E2E tests, tool sources, and external evidence references with `--ddl-root`, `--e2e-root`, `--tool-root`, and `--evidence`.
- Read `references/fastapi-contract.md` before creating or restructuring a FastAPI project.
- Prepare the repository-local dependencies from this skill's `requirements.txt` when YAML or SQL parsing support is absent. Do not ask the user to install them.

Run:

`scripts/designflow.py fastapi --source-root <src> --openapi <openapi.json> --sql-root <sql> --out docs/design/generated/fastapi`

Use `--check` in CI after generation.

Run `scripts/qualityflow.py` for the selected contract: `api` (FAST-016), `samples` (FAST-017), `crud-e2e` (FAST-018), `coverage` (FAST-019), `test-structure` (FAST-020), `implementation` (FAST-021), `thresholds` (FAST-022), `report` (FAST-023), or `suppressions` (AUD-008). Advisory commands report findings without blocking unless `--enforce` is explicit; blocking contracts return nonzero on a failed fixture.

## AWS CDK contract

- Synthesize CDK before documentation. The deployment-level input is each generated CloudFormation YAML/JSON template.
- Generate resource inventory and parameter details from `Resources` and `Parameters`.
- Record template path and SHA-256. A different synthesized template requires regenerated design.
- Read `references/cdk-contract.md` before creating or restructuring a CDK project.

Run:

`scripts/designflow.py cdk --template <template.yaml> --out docs/design/generated/cdk/<stack>`

## Gate

Generated design is complete only when generation succeeds, a second run is byte-identical, `--check` passes, requirement IDs trace to operations/resources/tests, and `$verify-against-engineering-standards` passes. Implementation-derived documentation does not prove that the implementation satisfies the requirement.
