# as-built設計check選択

`docs/standards/AS-BUILT-DESIGN.md`のcontractを定義・変更する場合と、repositoryが同標準を具体的なscopeへ採用する場合を分けて判定する。未採用repositoryの無関係な変更へ一律適用しない。

- 標準の要件正本、標準文書、check catalog、generator contract、配布定義、traceを変更する場合は`as_built_standard_change: true`にする。
- repositoryが標準をartifact・code scopeへ採用する、または適用scopeを拡張する場合は`as_built_adoption: true`にし、schema v2 review YAMLへscopeとexclusionsを記録する。
- 両方に該当する変更だけ両flagをtrueにする。
- AWS CDK固有contractを変更または採用する場合は`docs/standards/AWS-CDK-AS-BUILT-DESIGN.md`も参照し、標準contractと現在のsupport statusを混同しない。

| Artifact / change | 選択するcheck | Class | 選択条件 |
|---|---|---|---|
| as-built標準contract | `FAST-024` | Risk-selected | `as_built_standard_change: true`。要件正本、標準、catalog、generator / distribution contract、Rule・check・test traceの整合を確認する。 |
| 宣言済みgenerator入力または生成物 | `FAST-006` | Invariant | `generated_change: true`。同一生成logicのgenerate/check、決定論性、差分pathを確認する。標準変更と独立して判定する。 |
| API handler、OpenAPI、設計metadata、error sample | `FAST-016` | Risk-selected | `public_api_change: true`で三点整合が影響を受ける。 |
| API sampleまたはresponse assertion | `FAST-017` | Risk-selected | `public_api_change: true`で設計掲載sampleが変わる。 |
| SQL CRUD、E2E state assertion、error coverage | `FAST-018` | Risk-selected | `sql_change: true`または`e2e_change: true`でCRUD/E2E対応が変わる。 |
| CDK source、context、環境設定、stack構成 | `IMP-009`, `FAST-012` | Risk-selected | `iac_change: true`。synth、template差分、replacement、IAM、network、policyを確認する。 |
| generated CDK designまたは入力 | `FAST-006` | Invariant | `generated_change: true`。`docs/design/generated/cdk/`のgenerate/checkとbyte一致を確認する。 |
| as-built規約の採用・scope拡張 | `FAST-019` | Advisory | `as_built_adoption: true`。C0 95% / C1 90%を測定し、採用時はblockingにしない。 |
| as-built規約の採用・scope拡張 | `FAST-020` | Advisory | `as_built_adoption: true`。AAA/GWT、docstring、1 case 1関数を評価する。 |
| as-built規約の採用・scope拡張 | `FAST-021` | Advisory | `as_built_adoption: true`。解析可能なlayout、layer、SQL、log、tool規約を評価する。 |
| 定量閾値またはlinter delegation設定 | `FAST-022` | Risk-selected | `quality_threshold_change: true`。標準値、machine-readable設定、委譲設定を一致させる。標準変更と独立して判定する。 |
| 品質結果とtest evidence | `FAST-023` | Advisory | `as_built_adoption: true`。選択した品質結果を外部workflowまたはreport viewへ集約し、repositoryへの複製を避ける。 |
| suppression inventory | `AUD-008` | Periodic | `monthly_cycle: true`。抑制理由、重複、失効、孤児を監査する。 |

標準変更だけでは`FAST-019`〜`FAST-021`、`FAST-023`を選択しない。採用時は`impact_details.as_built_adoption.scope`を1件以上記録し、除外がない場合も`exclusions: []`を明示する。

公開API変更は`assured`であり、`FAST-009`と必要な`FAST-016`/`FAST-017`を選ぶ。公開APIであることだけを承認理由にしない。

MUST / SHOULDは採用済みscope内の規範強度、Invariant / Risk-selected / Advisory / Periodicはrolloutとmerge制御のenforcement stateであり、別軸である。MUST対応checkをAdvisoryから開始しても規範をSHOULDへ弱めたことにはならない。

CDKのsynthへ影響する変更も`assured`とする。deploy、resource削除、production変更、課金操作等のauthority boundaryだけを承認対象とし、synth、test、設計生成、PR作成は承認待ちで停止しない。

Advisoryをblockingへ昇格する場合は`retrospect-and-improve`に従い、escaped defectまたは反復cost、適用trigger、評価結果、予想cost、rollback、再評価日を記録する。
