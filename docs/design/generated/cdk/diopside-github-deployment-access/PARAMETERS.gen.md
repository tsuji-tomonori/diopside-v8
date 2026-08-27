<!-- AUTO-GENERATED. DO NOT EDIT DIRECTLY.
Generate: `python .agents/skills/generate-implementation-design/scripts/designflow.py cdk --template <template.yaml> --out <output>`
Check: `python .agents/skills/generate-implementation-design/scripts/designflow.py cdk --template <template.yaml> --out <output> --check`
-->

# CloudFormation parameters

| Name | Type | Default | Allowed values | Description |
|---|---|---|---|---|
| `GitHubOidcSubject` | `String` | repo:tsuji-tomonori/diopside-v8:environment:private-backfill-infra | repo:tsuji-tomonori/diopside-v8:environment:private-backfill-infra | Exact GitHub Actions OIDC subject for the protected private-backfill-infra environment |
| `TargetDeploymentRegion` | `String` | ap-northeast-1 | ap-northeast-1 | Region containing the CDK bootstrap roles used by the private backfill deploy |
