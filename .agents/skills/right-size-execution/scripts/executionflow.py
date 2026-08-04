#!/usr/bin/env python3
"""多軸execution profileの推定・実行・拡張・停止を決定的に記録する。"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SKILL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SKILL_ROOT.parents[2]
POLICY_PATH = SKILL_ROOT / "assets" / "execution-policy.json"
PROFILE_SCHEMA_PATH = SKILL_ROOT / "assets" / "execution-profile.schema.json"
POLICY_SCHEMA_PATH = SKILL_ROOT / "assets" / "execution-policy.schema.json"
BENCHMARK_PATH = SKILL_ROOT / "assets" / "benchmark-cases.json"
CONSTRAINTS_PATH = SKILL_ROOT / "assets" / "behavior-constraints.json"
CATALOG_PATH = REPO_ROOT / "governance" / "checklist" / "catalog.json"

RISK_KEYWORDS = {
    "security": ["security", "セキュリティ", "脆弱性"],
    "authentication": ["authentication", "認証"],
    "authorization": ["authorization", "認可", "許可されていない"],
    "permissions": ["permission", "権限", "最小権限"],
    "data-loss": ["data loss", "データ損失", "データ削除"],
    "database-schema": ["database schema", "db schema", "DBスキーマ", "テーブル定義"],
    "migration": ["migration", "マイグレーション"],
    "public-api": ["public api", "公開API", "api contract"],
    "event-contract": ["event contract", "イベント契約"],
    "iac": ["iac", "cloudformation", "terraform", "cdk", "インフラ"],
    "network": ["network", "ネットワーク", "vpc"],
    "dependency": ["dependency", "依存ライブラリ", "間接依存", "依存関係"],
    "lockfile": ["lockfile", "lock file", "ロックファイル"],
    "durable-requirements": ["durable requirement", "永続要件", "正本要件"],
    "governance": ["governance", "ガバナンス", "実行基盤"],
    "checklist": ["checklist", "チェックリスト"],
    "generator": ["generator", "生成器"],
    "confidential": ["confidential", "機密"],
    "pii": ["pii", "個人情報", "個人データ"],
    "external-side-effect": ["external side effect", "外部副作用", "送信", "deploy", "デプロイ"],
    "irreversible": ["irreversible", "不可逆", "rollback困難", "ロールバック困難"],
    "production-operation": ["本番操作", "production operation"],
}

MECHANICAL_WORDS = ["mechanical", "機械的", "一括置換", "rename", "誤字", "文言"]
SEMANTIC_WORDS = ["architecture", "設計", "意味的", "リファクタリング", "矛盾", "認可", "認証", "契約", "migration"]


class ExecutionError(RuntimeError):
    pass


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def csv_values(value: str | None) -> list[str]:
    return sorted({item.strip() for item in (value or "").split(",") if item.strip()})


def load_policy(path: Path = POLICY_PATH) -> dict[str, Any]:
    policy = read_json(path)
    required = {
        "schema_version", "policy_revision", "selector_version", "rollout_phase",
        "max_metadata_probes", "scope_order", "assurance_order", "compute_order",
        "mode_order", "expansion_axes", "assurance_floors", "scope_profiles",
        "assurance_profiles", "compute_profiles", "budget_multipliers", "stagnation",
    }
    missing = required - set(policy)
    if missing or policy.get("schema_version") != 2:
        raise ExecutionError(f"execution policy invalid: missing={sorted(missing)}")
    return policy


def infer_risk_tags(request: str) -> list[str]:
    lowered = request.lower()
    return sorted(tag for tag, words in RISK_KEYWORDS.items() if any(word.lower() in lowered for word in words))


def infer_path_tags(paths: list[str]) -> tuple[list[str], list[str]]:
    artifacts: set[str] = set()
    risks: set[str] = set()
    for raw in paths:
        path = raw.lower()
        if "requirements" in path or path.startswith("spec/"):
            artifacts.add("requirements")
            risks.add("durable-requirements")
        if "governance" in path or "checklist" in path:
            artifacts.add("governance")
            risks.add("governance")
        if "migration" in path or path.endswith(".sql"):
            artifacts.add("database")
            risks.add("migration")
        if any(term in path for term in ["cdk", "terraform", "cloudformation", "infra/"]):
            artifacts.add("iac")
            risks.add("iac")
        if any(term in path for term in ["lock", "requirements.txt", "pyproject.toml"]):
            artifacts.add("dependency")
            risks.add("dependency")
        if any(term in path for term in ["auth", "permission", "policy"]):
            risks.add("authorization")
    return sorted(artifacts), sorted(risks)


def assurance_floor(tags: list[str], policy: dict[str, Any]) -> tuple[str, list[str]]:
    tag_set = set(tags)
    critical = sorted(tag_set.intersection(policy["assurance_floors"]["critical"]))
    if critical:
        return "critical", critical
    elevated = sorted(tag_set.intersection(policy["assurance_floors"]["elevated"]))
    if elevated:
        return "elevated", elevated
    return "standard", ["no elevated or critical risk feature"]


def determine_scope(expected_files: int, domains: list[str], changed_paths: list[str]) -> tuple[str, list[str]]:
    domain_count = len(set(domains))
    path_count = len(set(changed_paths))
    if expected_files > 8 or domain_count > 1 or path_count > 8:
        return "repository", [f"expected_files={expected_files}", f"domains={domain_count}", f"changed_paths={path_count}"]
    if expected_files == 1 and domain_count <= 1 and path_count <= 1:
        return "local", ["one expected file", "at most one domain", "at most one explicit path"]
    return "module", [f"bounded impact: expected_files={expected_files}", f"domains={domain_count}"]


def determine_compute(request: str, scope: str, tags: list[str], policy: dict[str, Any]) -> dict[str, Any]:
    lowered = request.lower()
    mechanical = any(word.lower() in lowered for word in MECHANICAL_WORDS)
    semantic = any(word.lower() in lowered for word in SEMANTIC_WORDS)
    if mechanical and not semantic:
        tier, evidence = "economy", ["mechanical transformation is explicit"]
    elif semantic and scope == "repository":
        tier, evidence = "capable", ["cross-repository semantic interaction is explicit"]
    elif semantic or set(tags).intersection({"security", "authentication", "authorization", "permissions", "migration", "public-api", "event-contract"}):
        tier, evidence = "standard", ["semantic policy or contract reasoning is required"]
    else:
        tier, evidence = "standard", ["no calibrated evidence supports economy or capable routing"]
    return {"model_tier": tier, "reasoning_effort": policy["compute_profiles"][tier]["reasoning_effort"], "evidence": evidence}


def determine_mode(scope: str, assurance: str, policy: dict[str, Any]) -> dict[str, Any]:
    minimum = policy["assurance_profiles"][assurance]["minimum_mode"]
    if minimum == "agent-with-review":
        return {"value": minimum, "evidence": ["critical assurance requires independent review"]}
    if minimum == "agent" or scope != "local":
        return {"value": "agent", "evidence": [f"{assurance} assurance or {scope} scope requires governed agent execution"]}
    return {"value": "direct-edit", "evidence": ["local standard change has no delegation requirement"]}


def confidence_features(expected_files: int, domains: list[str], artifacts: list[str], changed_paths: list[str], acceptance: list[str]) -> dict[str, Any]:
    evidence: list[str] = []
    if expected_files > 0:
        evidence.append("expected file count supplied")
    if domains:
        evidence.append("affected domain supplied")
    if artifacts:
        evidence.append("artifact type supplied")
    if changed_paths:
        evidence.append("changed path supplied")
    if acceptance:
        evidence.append("acceptance criteria supplied")
    band = "high" if len(evidence) >= 4 else ("medium" if len(evidence) >= 2 else "low")
    return {"band": band, "method": "deterministic-features-v1", "score": None, "evidence": evidence}


def scaled_budget(values: dict[str, int], multiplier: float) -> dict[str, int]:
    return {key: max(1 if value else 0, int(value * multiplier + 0.999)) for key, value in values.items()}


def required_verification(scope: str, assurance: str, acceptance: list[str], policy: dict[str, Any]) -> list[str]:
    checks = list(policy["scope_profiles"][scope]["functional_verification"])
    checks.extend(policy["assurance_profiles"][assurance]["verification"])
    if acceptance:
        checks.append("acceptance-criteria")
    return list(dict.fromkeys(checks))


def estimate_profile(
    request: str,
    *,
    expected_files: int,
    domains: list[str],
    artifact_tags: list[str],
    risk_tags: list[str],
    changed_paths: list[str] | None = None,
    acceptance_criteria: list[str] | None = None,
    metadata_probes: list[dict[str, Any]] | None = None,
    policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    policy = policy or load_policy()
    paths = sorted(set(changed_paths or []))
    acceptance = sorted(set(acceptance_criteria or []))
    probes = metadata_probes or []
    if len(probes) > int(policy["max_metadata_probes"]):
        raise ExecutionError("metadata probe exceeds policy maximum")
    path_artifacts, path_risks = infer_path_tags(paths)
    artifacts = sorted(set(artifact_tags) | set(path_artifacts))
    risks = sorted(set(risk_tags) | set(infer_risk_tags(request)) | set(path_risks))
    scope, scope_evidence = determine_scope(expected_files, domains, paths)
    assurance, floor_reasons = assurance_floor(risks, policy)
    compute = determine_compute(request, scope, risks, policy)
    mode = determine_mode(scope, assurance, policy)
    multiplier = float(policy["budget_multipliers"][assurance])
    now = utcnow()
    estimate = {
        "scope": {"value": scope, "evidence": scope_evidence},
        "assurance": {"value": assurance, "floor_reasons": floor_reasons},
        "compute": compute,
        "mode": mode,
        "confidence": confidence_features(expected_files, domains, artifacts, paths, acceptance),
        "budget_profile": f"{scope}-{assurance}-v1",
        "context_budget": scaled_budget(policy["scope_profiles"][scope]["context_budget"], multiplier),
        "tool_budget": scaled_budget(policy["scope_profiles"][scope]["tool_budget"], multiplier),
        "required_verification": required_verification(scope, assurance, acceptance, policy),
        "expected_files": expected_files,
        "expected_domains": sorted(set(domains)),
        "artifact_tags": artifacts,
        "risk_tags": risks,
        "changed_paths": paths,
        "acceptance_criteria": acceptance,
        "metadata_probes": probes,
    }
    return {
        "schema_version": 2,
        "policy_revision": int(policy["policy_revision"]),
        "selector_revision": policy["selector_version"],
        "rollout_phase": policy["rollout_phase"],
        "status": "estimated",
        "created_at": now,
        "updated_at": now,
        "estimate": estimate,
        "expansions": [],
        "observations": [],
        "selection": {},
        "actual": {
            "input_tokens": None,
            "output_tokens": None,
            "wall_clock_seconds": 0.0,
            "tool_calls": 0,
            "search_calls": 0,
            "unique_files_read": [],
            "read_bytes": 0,
            "read_ranges": 0,
            "duplicate_read_bytes": 0,
            "metadata_probe_cost": 0.0,
            "estimate_overhead": 0.0,
            "subagent_calls": 0,
            "model_escalations": 0,
            "expansion_count": 0,
            "time_to_first_valid_patch": None,
            "post_success_activity": 0,
            "verification_result": None,
            "escaped_defect": False,
            "success": False,
        },
        "stop": None,
    }


def validate_profile(state: dict[str, Any], policy: dict[str, Any] | None = None, *, allow_legacy: bool = True) -> list[str]:
    policy = policy or load_policy()
    if state.get("schema_version") == 1 and allow_legacy:
        return []
    errors: list[str] = []
    if state.get("schema_version") != 2:
        return ["unsupported execution profile schema_version"]
    required_top = {
        "schema_version", "policy_revision", "selector_revision", "rollout_phase", "status",
        "created_at", "updated_at", "estimate", "expansions", "observations", "selection", "actual", "stop",
    }
    missing_top = required_top - set(state)
    extra_top = set(state) - required_top
    if missing_top or extra_top:
        errors.append(f"profile fields invalid: missing={sorted(missing_top)} extra={sorted(extra_top)}")
    if state.get("policy_revision") != policy["policy_revision"]:
        errors.append("execution policy revision mismatch")
    estimate = state.get("estimate")
    if not isinstance(estimate, dict):
        return errors + ["estimate must be an object"]
    required_estimate = {
        "scope", "assurance", "compute", "mode", "confidence", "budget_profile",
        "context_budget", "tool_budget", "required_verification", "expected_files",
        "expected_domains", "artifact_tags", "risk_tags", "changed_paths",
        "acceptance_criteria", "metadata_probes",
    }
    missing_estimate = required_estimate - set(estimate)
    extra_estimate = set(estimate) - required_estimate
    if missing_estimate or extra_estimate:
        errors.append(f"estimate fields invalid: missing={sorted(missing_estimate)} extra={sorted(extra_estimate)}")
    for axis, allowed in [("scope", policy["scope_order"]), ("assurance", policy["assurance_order"]), ("mode", policy["mode_order"])]:
        value = (estimate.get(axis) or {}).get("value")
        if value not in allowed:
            errors.append(f"invalid {axis}")
    compute = estimate.get("compute") or {}
    if compute.get("model_tier") not in policy["compute_order"]:
        errors.append("invalid compute model tier")
    confidence = estimate.get("confidence") or {}
    if confidence.get("method") != "deterministic-features-v1" or confidence.get("score") is not None:
        errors.append("uncalibrated confidence score is forbidden")
    probes = estimate.get("metadata_probes")
    if not isinstance(probes, list) or len(probes) > policy["max_metadata_probes"]:
        errors.append("metadata probe limit exceeded")
    floor, _ = assurance_floor(estimate.get("risk_tags") or [], policy)
    actual_assurance = (estimate.get("assurance") or {}).get("value")
    if actual_assurance in policy["assurance_order"] and policy["assurance_order"].index(actual_assurance) < policy["assurance_order"].index(floor):
        errors.append(f"assurance floor violated: required={floor}")
    if not estimate.get("required_verification"):
        errors.append("required verification is empty")
    for axis in ["scope", "mode"]:
        evidence = (estimate.get(axis) or {}).get("evidence")
        if not isinstance(evidence, list) or not evidence:
            errors.append(f"{axis} evidence is empty")
    floor_reasons = (estimate.get("assurance") or {}).get("floor_reasons")
    if not isinstance(floor_reasons, list) or not floor_reasons:
        errors.append("assurance floor reasons are empty")
    if not isinstance(compute.get("evidence"), list) or not compute.get("evidence"):
        errors.append("compute evidence is empty")
    if not isinstance(state.get("expansions"), list) or not isinstance(state.get("observations"), list):
        errors.append("expansions and observations must be arrays")
    if not isinstance(state.get("actual"), dict):
        errors.append("actual must be an object")
    return errors


def refresh_derived(estimate: dict[str, Any], policy: dict[str, Any]) -> None:
    scope = estimate["scope"]["value"]
    assurance = estimate["assurance"]["value"]
    multiplier = float(policy["budget_multipliers"][assurance])
    estimate["budget_profile"] = f"{scope}-{assurance}-v1"
    estimate["context_budget"] = scaled_budget(policy["scope_profiles"][scope]["context_budget"], multiplier)
    estimate["tool_budget"] = scaled_budget(policy["scope_profiles"][scope]["tool_budget"], multiplier)
    estimate["required_verification"] = required_verification(scope, assurance, estimate.get("acceptance_criteria") or [], policy)


def budget_overruns(state: dict[str, Any]) -> dict[str, dict[str, float]]:
    if state.get("schema_version") == 1:
        return {}
    estimate, actual = state["estimate"], state["actual"]
    mapping = {
        "unique_files_read": (len(actual.get("unique_files_read") or []), estimate["context_budget"]["unique_files"]),
        "read_bytes": (actual.get("read_bytes", 0), estimate["context_budget"]["read_bytes"]),
        "read_ranges": (actual.get("read_ranges", 0), estimate["context_budget"]["read_ranges"]),
        "search_calls": (actual.get("search_calls", 0), estimate["tool_budget"]["search_calls"]),
        "tool_calls": (actual.get("tool_calls", 0), estimate["tool_budget"]["tool_calls"]),
        "subagent_calls": (actual.get("subagent_calls", 0), estimate["tool_budget"]["subagent_calls"]),
    }
    return {key: {"actual": float(a), "budget": float(b)} for key, (a, b) in mapping.items() if a > b}


def record_observation(state: dict[str, Any], metrics: dict[str, Any], *, kind: str, evidence: str) -> None:
    errors = validate_profile(state, allow_legacy=False)
    if errors:
        raise ExecutionError("; ".join(errors))
    actual = state["actual"]
    positive = False
    additive = [
        "wall_clock_seconds", "tool_calls", "search_calls", "read_bytes", "read_ranges",
        "duplicate_read_bytes", "metadata_probe_cost", "estimate_overhead", "subagent_calls",
    ]
    for key in additive:
        value = metrics.get(key)
        if value is not None:
            if float(value) < 0:
                raise ExecutionError(f"{key} must be non-negative")
            actual[key] = round(float(actual.get(key, 0)) + float(value), 3)
            positive = positive or float(value) > 0
    for key in ["input_tokens", "output_tokens", "time_to_first_valid_patch", "escaped_defect"]:
        if metrics.get(key) is not None:
            actual[key] = metrics[key]
    files = sorted(set(actual.get("unique_files_read") or []) | set(metrics.get("unique_files_read") or []))
    positive = positive or len(files) > len(actual.get("unique_files_read") or [])
    actual["unique_files_read"] = files
    observation = {"timestamp": utcnow(), "kind": kind, "evidence": evidence, "metrics": metrics}
    if state.get("status") == "success" and positive:
        observation["post_success_activity"] = True
        actual["post_success_activity"] += 1
    state["observations"].append(observation)
    if state["status"] == "estimated":
        state["status"] = "executing"
    state["updated_at"] = utcnow()


REASON_AXES = {
    "verification-failed": {"verification", "scope", "assurance"},
    "impact-surface-exceeded": {"scope"},
    "dependency-discovered": {"scope"},
    "contract-impact-discovered": {"scope", "assurance"},
    "assurance-floor-insufficient": {"assurance"},
    "requirements-conflict": {"scope", "assurance", "verification"},
    "evidence-insufficient": {"verification", "scope"},
    "compute-insufficient": {"compute"},
    "review-required": {"review"},
}


def expand_profile(state: dict[str, Any], *, axis: str, reason_code: str, evidence: str, actor: str) -> None:
    policy = load_policy()
    errors = validate_profile(state, policy, allow_legacy=False)
    if errors:
        raise ExecutionError("; ".join(errors))
    if state["status"] == "success":
        raise ExecutionError("cannot expand after decisive success")
    if axis not in policy["expansion_axes"] or axis not in REASON_AXES.get(reason_code, set()) or not evidence.strip():
        raise ExecutionError("expansion requires an allowed reason, matching axis, and concrete evidence")
    signature = digest({"axis": axis, "reason_code": reason_code, "evidence": evidence.strip()})
    if any(event.get("evidence_signature") == signature for event in state["expansions"]):
        raise ExecutionError("stagnation: duplicate expansion evidence")
    estimate = state["estimate"]
    before = deepcopy(estimate)
    if axis == "scope":
        order = policy["scope_order"]
        current = estimate["scope"]["value"]
        if current == order[-1]:
            raise ExecutionError("stagnation: scope cannot expand further")
        estimate["scope"] = {"value": order[order.index(current) + 1], "evidence": estimate["scope"]["evidence"] + [evidence]}
        refresh_derived(estimate, policy)
    elif axis == "assurance":
        order = policy["assurance_order"]
        current = estimate["assurance"]["value"]
        if current == order[-1]:
            raise ExecutionError("stagnation: assurance cannot expand further")
        estimate["assurance"] = {"value": order[order.index(current) + 1], "floor_reasons": estimate["assurance"]["floor_reasons"] + [evidence]}
        minimum_mode = policy["assurance_profiles"][estimate["assurance"]["value"]]["minimum_mode"]
        if policy["mode_order"].index(estimate["mode"]["value"]) < policy["mode_order"].index(minimum_mode):
            estimate["mode"] = {"value": minimum_mode, "evidence": estimate["mode"]["evidence"] + ["derived assurance minimum"]}
        refresh_derived(estimate, policy)
    elif axis == "verification":
        candidate = "defect-seeking-review"
        if candidate in estimate["required_verification"]:
            candidate = "additional-diagnostic"
        estimate["required_verification"].append(candidate)
    elif axis == "review":
        order = policy["mode_order"]
        current = estimate["mode"]["value"]
        if current == order[-1]:
            raise ExecutionError("stagnation: review mode cannot expand further")
        estimate["mode"] = {"value": order[order.index(current) + 1], "evidence": estimate["mode"]["evidence"] + [evidence]}
    elif axis == "compute":
        order = policy["compute_order"]
        current = estimate["compute"]["model_tier"]
        if current == order[-1]:
            raise ExecutionError("stagnation: compute cannot expand further")
        tier = order[order.index(current) + 1]
        estimate["compute"] = {"model_tier": tier, "reasoning_effort": policy["compute_profiles"][tier]["reasoning_effort"], "evidence": estimate["compute"]["evidence"] + [evidence]}
        state["actual"]["model_escalations"] += 1
    after_axis = {
        "scope": estimate["scope"], "assurance": estimate["assurance"],
        "verification": estimate["required_verification"], "review": estimate["mode"],
        "compute": estimate["compute"],
    }[axis]
    before_axis = {
        "scope": before["scope"], "assurance": before["assurance"],
        "verification": before["required_verification"], "review": before["mode"],
        "compute": before["compute"],
    }[axis]
    if digest(before_axis) == digest(after_axis):
        raise ExecutionError("stagnation: expansion did not change its axis")
    state["expansions"].append({
        "sequence": len(state["expansions"]) + 1,
        "timestamp": utcnow(),
        "axis": axis,
        "reason_code": reason_code,
        "evidence": evidence,
        "evidence_signature": signature,
        "actor": actor,
        "before_axis_digest": digest(before_axis),
        "after_axis_digest": digest(after_axis),
        "profile_digest": digest(estimate),
    })
    state["actual"]["expansion_count"] = len(state["expansions"])
    state["status"] = "executing"
    state["updated_at"] = utcnow()


def mark_verification(state: dict[str, Any], *, result: str, evidence: str, summary: str, completed_checks: list[str]) -> None:
    errors = validate_profile(state, allow_legacy=False)
    if errors:
        raise ExecutionError("; ".join(errors))
    if result not in {"pass", "fail"} or not evidence.strip() or not summary.strip():
        raise ExecutionError("verification needs pass/fail, evidence, and summary")
    completed = sorted(set(completed_checks))
    missing = sorted(set(state["estimate"]["required_verification"]) - set(completed))
    if result == "pass" and missing:
        raise ExecutionError("decisive success lacks required verification: " + ", ".join(missing))
    state["observations"].append({
        "timestamp": utcnow(), "kind": "verification", "result": result,
        "evidence": evidence, "summary": summary, "completed_checks": completed,
        "missing_checks": missing,
    })
    state["actual"]["verification_result"] = result
    if result == "pass":
        state["status"] = "success"
        state["actual"]["success"] = True
        state["stop"] = {"timestamp": utcnow(), "reason": "success-and-assurance-satisfied", "profile_digest": digest(state["estimate"])}
    else:
        state["status"] = "verification-failed"
        state["actual"]["success"] = False
    state["updated_at"] = utcnow()


def item_matches(item: dict[str, Any], state: dict[str, Any], profiles: set[str], phases: set[str]) -> bool:
    estimate = state["estimate"]
    if profiles and item.get("profile") not in profiles:
        return False
    if phases and item.get("phase") not in phases:
        return False
    assurance = estimate["assurance"]["value"]
    if assurance not in item.get("assurance_levels", ["standard", "elevated", "critical"]):
        return False
    artifacts = set(estimate.get("artifact_tags") or [])
    risks = set(estimate.get("risk_tags") or [])
    return bool(item.get("always_on") or artifacts.intersection(item.get("artifact_tags") or []) or risks.intersection(item.get("risk_tags") or []))


def select_catalog_items(catalog: dict[str, Any], state: dict[str, Any], *, profiles: list[str], phases: list[str], mandatory_ids: list[str] | None = None) -> dict[str, Any]:
    policy = load_policy()
    selected = sorted(item["id"] for item in catalog["items"] if item_matches(item, state, set(profiles), set(phases)))
    selected_set = set(selected)
    candidates = [item for item in catalog["items"] if (not profiles or item.get("profile") in profiles) and (not phases or item.get("phase") in phases)]
    excluded = sorted(item["id"] for item in candidates if item["id"] not in selected_set)
    mandatory = sorted(set(mandatory_ids or []))
    missing = sorted(set(mandatory) - selected_set)
    sample = sorted(excluded, key=lambda item_id: hashlib.sha256(f"{policy['selector_version']}:{item_id}".encode()).hexdigest())[:10]
    inputs = {
        "scope": state["estimate"]["scope"]["value"],
        "assurance": state["estimate"]["assurance"]["value"],
        "artifact_tags": state["estimate"].get("artifact_tags") or [],
        "risk_tags": state["estimate"].get("risk_tags") or [],
        "changed_paths": state["estimate"].get("changed_paths") or [],
        "profiles": sorted(set(profiles)),
        "phases": sorted(set(phases)),
        "catalog_digest": digest(catalog),
    }
    result = {
        "selector_version": policy["selector_version"],
        "inputs": inputs,
        "selected_ids": selected,
        "selected_count": len(selected),
        "excluded_count": len(excluded),
        "candidate_count": len(candidates),
        "selected_digest": digest(selected),
        "audit_sample_ids": sample,
        "mandatory_control_ids": mandatory,
        "mandatory_missed_ids": missing,
    }
    result["manifest_digest"] = digest(result)
    return result


def audit_profile(state: dict[str, Any]) -> dict[str, Any]:
    policy = load_policy()
    if state.get("schema_version") == 1:
        return {"schema_version": 2, "profile_digest": digest(state), "enforcement": "legacy-advisory", "errors": [], "warnings": ["legacy execution scope schema; migrate on next work item"], "overruns": {}}
    errors = validate_profile(state, policy, allow_legacy=False)
    warnings: list[str] = []
    overruns = budget_overruns(state)
    if overruns and not state.get("expansions"):
        warnings.append("soft budget overrun has no evidence-backed decision")
    if any(item.get("post_success_activity") for item in state.get("observations", [])):
        warnings.append("positive-cost activity continued after decisive success")
    if (state.get("selection") or {}).get("mandatory_missed_ids"):
        warnings.append("selector missed curated mandatory controls")
    signatures = [event.get("evidence_signature") for event in state.get("expansions", [])]
    if len(signatures) != len(set(signatures)):
        warnings.append("stagnation detected: duplicate expansion evidence")
    enforcement = policy["rollout_phase"]
    return {"schema_version": 2, "profile_digest": digest(state), "enforcement": enforcement, "errors": errors, "warnings": warnings, "overruns": overruns}


def efficiency_report(state: dict[str, Any]) -> dict[str, Any]:
    audit = audit_profile(state)
    ratios = {
        key: round((value["actual"] - value["budget"]) / value["budget"], 4) if value["budget"] else 1.0
        for key, value in audit["overruns"].items()
    }
    return {
        "schema_version": 2,
        "generated_at": utcnow(),
        "status": state["status"],
        "success": state["actual"].get("success", False),
        "estimate": state["estimate"],
        "actual": state["actual"],
        "expansions": state["expansions"],
        "execution_overrun_ratio": ratios,
        "audit": audit,
        "acrr": None,
        "acrr_note": "C_min oracleがない実案件ではACRRを算出しない",
    }


def run_benchmark(path: Path = BENCHMARK_PATH) -> dict[str, Any]:
    suite = read_json(path)
    catalog = read_json(CATALOG_PATH)
    results: list[dict[str, Any]] = []
    profiles: dict[str, dict[str, Any]] = {}
    selector_misses: list[str] = []
    for case in suite["cases"]:
        state = estimate_profile(
            case["request"], expected_files=case["expected_files"], domains=case["domains"],
            artifact_tags=case["artifact_tags"], risk_tags=case["risk_tags"],
            changed_paths=case.get("changed_paths", []), acceptance_criteria=case.get("acceptance_criteria", []),
        )
        profiles[case["id"]] = state
        actual = {
            "scope": state["estimate"]["scope"]["value"],
            "assurance": state["estimate"]["assurance"]["value"],
            "model_tier": state["estimate"]["compute"]["model_tier"],
            "mode": state["estimate"]["mode"]["value"],
        }
        passed = actual == case["expected"]
        if case.get("expansion"):
            spec = case["expansion"]
            expand_profile(state, axis=spec["axis"], reason_code=spec["reason_code"], evidence=spec["evidence"], actor="benchmark")
            passed = passed and state["estimate"][spec["axis"]]["value"] == spec["expected_value"]
        if case.get("mandatory_control_ids"):
            selection = select_catalog_items(catalog, state, profiles=["CORE"], phases=[], mandatory_ids=case["mandatory_control_ids"])
            selector_misses.extend(selection["mandatory_missed_ids"])
            passed = passed and not selection["mandatory_missed_ids"] and bool(selection["audit_sample_ids"])
        results.append({"id": case["id"], "expected": case["expected"], "actual": actual, "passed": passed})

    behavior: dict[str, bool] = {}
    local_critical = profiles["authorization-local-critical"]
    behavior["RSE-PROFILE-001"] = local_critical["estimate"]["scope"]["value"] == "local" and local_critical["estimate"]["assurance"]["value"] == "critical"
    behavior["RSE-CONFIDENCE-001"] = all(state["estimate"]["confidence"]["score"] is None for state in profiles.values())
    expansion_state = estimate_profile("module change", expected_files=2, domains=["core"], artifact_tags=["implementation"], risk_tags=[])
    expand_profile(expansion_state, axis="verification", reason_code="verification-failed", evidence="failure-A", actor="benchmark")
    expand_profile(expansion_state, axis="review", reason_code="review-required", evidence="failure-B", actor="benchmark")
    expand_profile(expansion_state, axis="compute", reason_code="compute-insufficient", evidence="failure-C", actor="benchmark")
    behavior["RSE-EXPAND-001"] = len(expansion_state["expansions"]) == 3
    stop_state = profiles["wording-local"]
    mark_verification(stop_state, result="pass", evidence="benchmark", summary="all checks", completed_checks=stop_state["estimate"]["required_verification"])
    try:
        expand_profile(stop_state, axis="scope", reason_code="dependency-discovered", evidence="late", actor="benchmark")
        behavior["RSE-STOP-001"] = False
    except ExecutionError:
        behavior["RSE-STOP-001"] = True
    behavior["RSE-SELECT-001"] = not selector_misses
    behavior["RSE-ROLLOUT-001"] = load_policy()["rollout_phase"] == "shadow" and audit_profile(local_critical)["enforcement"] == "shadow"
    paraphrase_groups: dict[str, set[str]] = {}
    for case in suite["cases"]:
        group = case.get("paraphrase_group")
        if group:
            paraphrase_groups.setdefault(group, set()).add(profiles[case["id"]]["estimate"]["assurance"]["value"])
    paraphrase_consistent = all(len(values) == 1 for values in paraphrase_groups.values())
    constraints = {item["id"] for item in read_json(CONSTRAINTS_PATH)["constraints"]}
    covered = sorted(key for key, passed in behavior.items() if passed)
    return {
        "schema_version": 2,
        "suite": str(path),
        "variants": suite.get("variants", []),
        "passed": all(item["passed"] for item in results) and constraints == set(covered) and paraphrase_consistent,
        "evaluation_stage": "shadow-deterministic-contract",
        "deployment_gate_ready": False,
        "variant_results": {
            "current": "baseline-not-yet-collected",
            "fixed-small": "baseline-not-yet-collected",
            "fixed-full": "baseline-not-yet-collected",
            "legacy-levels": "baseline-not-yet-collected",
            "multi-axis": "deterministic-contract-passed"
        },
        "case_count": len(results),
        "results": results,
        "selector_false_negative_count": len(set(selector_misses)),
        "behavior_constraint_count": len(constraints),
        "behavior_constraints_covered": covered,
        "behavior_coverage": round(len(covered) / len(constraints), 4) if constraints else 1.0,
        "paraphrase_assurance_consistent": paraphrase_consistent,
        "claim_boundary": "論文の削減率をdev-standardの目標値として使用しない",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="多軸execution profileの推定・台帳・監査")
    sub = parser.add_subparsers(dest="command", required=True)
    estimate = sub.add_parser("estimate")
    estimate.add_argument("--request", required=True)
    estimate.add_argument("--out", required=True)
    estimate.add_argument("--expected-files", type=int, default=0)
    estimate.add_argument("--domains", default="")
    estimate.add_argument("--artifact-tags", default="")
    estimate.add_argument("--risk-tags", default="")
    estimate.add_argument("--changed-path", action="append", default=[])
    estimate.add_argument("--acceptance-criterion", action="append", default=[])
    estimate.add_argument("--metadata-probe", action="append", default=[])
    expand = sub.add_parser("expand")
    expand.add_argument("--profile", required=True)
    expand.add_argument("--axis", required=True)
    expand.add_argument("--reason-code", required=True)
    expand.add_argument("--evidence", required=True)
    expand.add_argument("--actor", required=True)
    observe = sub.add_parser("observe")
    observe.add_argument("--profile", required=True)
    observe.add_argument("--kind", default="execute")
    observe.add_argument("--evidence", required=True)
    for name in ["tool-calls", "search-calls", "read-bytes", "read-ranges", "duplicate-read-bytes", "subagent-calls"]:
        observe.add_argument(f"--{name}", type=int, default=0)
    observe.add_argument("--wall-clock-seconds", type=float, default=0)
    observe.add_argument("--metadata-probe-cost", type=float, default=0)
    observe.add_argument("--estimate-overhead", type=float, default=0)
    observe.add_argument("--input-tokens", type=int)
    observe.add_argument("--output-tokens", type=int)
    observe.add_argument("--time-to-first-valid-patch", type=float)
    observe.add_argument("--unique-file-read", action="append", default=[])
    verify = sub.add_parser("verification")
    verify.add_argument("--profile", required=True)
    verify.add_argument("--result", choices=["pass", "fail"], required=True)
    verify.add_argument("--evidence", required=True)
    verify.add_argument("--summary", required=True)
    verify.add_argument("--completed-check", action="append", default=[])
    finalize = sub.add_parser("finalize")
    finalize.add_argument("--profile", required=True)
    finalize.add_argument("--out", required=True)
    audit = sub.add_parser("audit")
    audit.add_argument("--profile", required=True)
    audit.add_argument("--mode", choices=["soft", "strict"], default="soft")
    select = sub.add_parser("select-checks")
    select.add_argument("--profile", required=True)
    select.add_argument("--catalog", required=True)
    select.add_argument("--profiles", default="")
    select.add_argument("--phases", default="")
    select.add_argument("--mandatory-id", action="append", default=[])
    select.add_argument("--out", required=True)
    benchmark = sub.add_parser("benchmark")
    benchmark.add_argument("--suite", default=str(BENCHMARK_PATH))
    benchmark.add_argument("--out")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "estimate":
            probes = [{"evidence": value} for value in args.metadata_probe]
            state = estimate_profile(
                args.request, expected_files=args.expected_files, domains=csv_values(args.domains),
                artifact_tags=csv_values(args.artifact_tags), risk_tags=csv_values(args.risk_tags),
                changed_paths=args.changed_path, acceptance_criteria=args.acceptance_criterion,
                metadata_probes=probes,
            )
            write_json(Path(args.out), state)
            print(f"{state['estimate']['scope']['value']} + {state['estimate']['assurance']['value']} -> {args.out}")
        elif args.command == "expand":
            path = Path(args.profile)
            state = read_json(path)
            expand_profile(state, axis=args.axis, reason_code=args.reason_code, evidence=args.evidence, actor=args.actor)
            write_json(path, state)
            print(f"expanded {args.axis}: {len(state['expansions'])}")
        elif args.command == "observe":
            path = Path(args.profile)
            state = read_json(path)
            metrics = {
                "tool_calls": args.tool_calls, "search_calls": args.search_calls,
                "read_bytes": args.read_bytes, "read_ranges": args.read_ranges,
                "duplicate_read_bytes": args.duplicate_read_bytes, "subagent_calls": args.subagent_calls,
                "wall_clock_seconds": args.wall_clock_seconds, "metadata_probe_cost": args.metadata_probe_cost,
                "estimate_overhead": args.estimate_overhead, "input_tokens": args.input_tokens,
                "output_tokens": args.output_tokens, "time_to_first_valid_patch": args.time_to_first_valid_patch,
                "unique_files_read": args.unique_file_read,
            }
            record_observation(state, metrics, kind=args.kind, evidence=args.evidence)
            write_json(path, state)
            print(f"observed: {digest(metrics)[:12]}")
        elif args.command == "verification":
            path = Path(args.profile)
            state = read_json(path)
            mark_verification(state, result=args.result, evidence=args.evidence, summary=args.summary, completed_checks=args.completed_check)
            write_json(path, state)
            print(state["status"])
        elif args.command == "finalize":
            write_json(Path(args.out), efficiency_report(read_json(Path(args.profile))))
            print(args.out)
        elif args.command == "audit":
            report = audit_profile(read_json(Path(args.profile)))
            print(json.dumps(report, ensure_ascii=False, indent=2))
            if report["errors"] or (args.mode == "strict" and report["enforcement"] == "limited-blocking" and report["warnings"]):
                return 1
        elif args.command == "select-checks":
            path = Path(args.profile)
            state = read_json(path)
            selection = select_catalog_items(read_json(Path(args.catalog)), state, profiles=csv_values(args.profiles), phases=csv_values(args.phases), mandatory_ids=args.mandatory_id)
            state["selection"] = selection
            state["updated_at"] = utcnow()
            write_json(path, state)
            write_json(Path(args.out), selection)
            print(f"selected {selection['selected_count']}; mandatory misses {len(selection['mandatory_missed_ids'])}")
        elif args.command == "benchmark":
            report = run_benchmark(Path(args.suite))
            if args.out:
                write_json(Path(args.out), report)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if report["passed"] else 1
        return 0
    except (ExecutionError, OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        print(f"executionflow error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
