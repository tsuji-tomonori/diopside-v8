# 計測契約

成功率と品質を制約条件とし、推定、Estimate overhead、実績、Expand、停止後活動を記録します。

必須指標:

- input_tokens / output_tokens
- wall_clock_seconds / time_to_first_valid_patch_seconds
- tool_calls / search_calls / metadata_probe_cost / estimate_overhead
- unique_files_read / read_bytes / read_ranges / duplicate_read_bytes
- subagent_calls / model_escalations / expansion_count
- verification_result / escaped_defect / post_success_activity

token telemetryがない場合もbyte、range、tool callをproxyとして残します。成功コマンドはexit code、要約、digestだけ、失敗ログは最初の因果的エラーと周辺行だけを保持します。

ACRRは正確な`C_min` oracleを定義できるbenchmarkでのみ計算します。実案件では各生指標、成功、重大欠陥、overrunを併記します。

導入は`telemetry → shadow → soft-routing → assurance-enforcement → calibrated → limited-blocking`の順です。shadow期間はschema破損とassurance floor違反だけをblockingにします。
