#!/usr/bin/env python3
"""Validate adaptive review results and the current Commit Comment contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

REQUIRED_SECTIONS = [
    "目的:",
    "変更内容:",
    "要件影響:",
    "設計影響:",
    "チェックリスト:",
    "検証契約:",
    "互換性・残存リスク:",
]
REQUIRED_TRAILERS = ["Requirements", "Design-Impact", "Review-Checklist"]
EVIDENCE_PATTERN = re.compile(r"^(path|test|commit|workflow):(.+)$")
CONVENTIONAL_SUBJECT_PATTERN = re.compile(
    r"^(?:\S+\s+)?(?P<type>[a-z]+)(?:\([^)]+\))?!?:"
)
ALWAYS_TRIGGERS = {"常時", "全変更"}
DERIVED_TRIGGERS = {
    "N/A使用時": "na_used",
    "Fail時": "fail_present",
    "advisory存在時": "advisory_present",
}
TRIGGER_FLAGS = {
    "外部書込み時": "external_write",
    "不可逆操作時": "irreversible_operation",
    "認証・認可変更時": "auth_change",
    "DB・永続データ変更時": "data_change",
    "公開API・イベント変更時": "public_api_change",
    "IaC変更時": "iac_change",
    "依存更新時": "dependency_change",
    "コード変更時": "code_change",
    "型付きコード変更時": "typed_code_change",
    "振る舞い変更時": "behavior_change",
    "不具合修正時": "bug_fix",
    "生成対象変更時": "generated_change",
    "公開API変更時": "public_api_change",
    "SQL変更時": "sql_change",
    "SQLまたはE2E変更時": ("sql_change", "e2e_change"),
    "migration時": "migration",
    "UI変更時": "ui_change",
    "対話UI変更時": "interactive_ui_change",
    "運用影響時": "operational_impact",
    "要件影響あり": "requirements_impact",
    "公開契約変更時": "public_contract_change",
    "critical変更時": "critical_change",
    "重要UI変更時": "important_ui_change",
    "長期判断時": "long_term_decision",
    "squash時": "squash",
    "外部副作用時": "external_side_effect",
    "production deploy時": "production_deploy",
    "重大異常時": "major_incident",
    "月次またはリリース単位": "periodic_cycle",
    "月次": "monthly_cycle",
    "再確認期限時": "recheck_due",
    "as-built標準変更時": "as_built_standard_change",
    "as-built規約適用時": "as_built_adoption",
    "定量閾値変更時": "quality_threshold_change",
}


class ContractError(RuntimeError):
    pass


def load_yaml(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ContractError(f"{path}: root must be a mapping")
    return value


def load_catalog(path: Path) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    catalog = load_yaml(path)
    items = catalog.get("items")
    if not isinstance(items, list):
        raise ContractError(f"{path}: items must be a list")
    by_id: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise ContractError(f"{path}: every item requires an id")
        item_id = item["id"]
        if item_id in by_id:
            raise ContractError(f"{path}: duplicate check id {item_id}")
        for field in ["class", "timing", "trigger", "check", "acceptance", "enforcement"]:
            if not item.get(field):
                raise ContractError(f"{path}: {item_id} missing {field}")
        if item["trigger"] not in ALWAYS_TRIGGERS | DERIVED_TRIGGERS.keys() | TRIGGER_FLAGS.keys():
            raise ContractError(f"{path}: {item_id} has unsupported trigger {item['trigger']}")
        by_id[item_id] = item
    if catalog.get("item_count") != len(items):
        raise ContractError(f"{path}: item_count does not match items")
    return catalog, by_id


def digest_file(path: Path) -> str:
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


def git_text(root: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=root, text=True, capture_output=True, check=False)
    if result.returncode:
        raise ContractError((result.stdout + result.stderr).strip())
    return result.stdout.strip()


def safe_repo_path(root: Path, text: str) -> Path:
    path = (root / text).resolve(strict=False)
    if path != root and root not in path.parents:
        raise ContractError(f"path escapes repository: {text}")
    return path


def validate_evidence(root: Path, evidence: str, source_commit: str) -> None:
    match = EVIDENCE_PATTERN.fullmatch(evidence)
    if not match:
        raise ContractError(f"invalid evidence reference: {evidence}")
    kind, target = match.groups()
    if kind in {"path", "test"}:
        target_path = target.split("::", 1)[0]
        if not safe_repo_path(root, target_path).is_file():
            raise ContractError(f"evidence path does not exist: {evidence}")
    elif kind == "commit":
        commit = source_commit if target == "self" else target
        git_text(root, "cat-file", "-e", f"{commit}^{{commit}}")
    elif kind == "workflow":
        workflow_name, separator, step_name = target.partition("#")
        workflows = list((root / ".github" / "workflows").glob("*.yml"))
        workflows.extend((root / ".github" / "workflows").glob("*.yaml"))
        workflow = next((load_yaml(path) for path in workflows if load_yaml(path).get("name") == workflow_name), None)
        if workflow is None:
            raise ContractError(f"workflow evidence does not exist: {workflow_name}")
        if separator:
            steps = {
                str(step.get("name", ""))
                for job in workflow.get("jobs", {}).values()
                for step in job.get("steps", [])
                if isinstance(step, dict)
            }
            if step_name not in steps:
                raise ContractError(f"workflow step evidence does not exist: {target}")


def required_check_ids(review: dict[str, Any], checks: dict[str, dict[str, Any]]) -> set[str]:
    completed_timings = set(review["completed_timings"])
    flags = review["impact_flags"]
    selected = review["selected_checks"]
    derived = {
        "na_used": any(item["result"] == "na" for item in selected),
        "fail_present": any(item["result"] == "fail" for item in selected),
        "advisory_present": bool(review["advisories"]),
    }
    required: set[str] = set()
    for item_id, item in checks.items():
        if item["timing"] not in completed_timings:
            continue
        trigger = item["trigger"]
        applies = trigger in ALWAYS_TRIGGERS
        if trigger in DERIVED_TRIGGERS:
            applies = derived[DERIVED_TRIGGERS[trigger]]
        elif trigger in TRIGGER_FLAGS:
            flag_names = TRIGGER_FLAGS[trigger]
            if isinstance(flag_names, str):
                flag_names = (flag_names,)
            applies = any(bool(flags.get(name, False)) for name in flag_names)
        if applies:
            required.add(item_id)
    return required


def validate_impact_details(path: Path, review: dict[str, Any]) -> None:
    """Keep schema-v1 evidence readable while enforcing structured adoption scope in v2."""
    if review["schema_version"] < 2:
        return
    adoption = review["impact_flags"]["as_built_adoption"]
    details = review["impact_details"]["as_built_adoption"]
    scope = details["scope"]
    exclusions = details["exclusions"]
    if adoption and not scope:
        raise ContractError(f"{path}: as_built_adoption requires a non-empty scope")
    if not adoption and (scope or exclusions):
        raise ContractError(f"{path}: adoption scope and exclusions require as_built_adoption: true")


def validate_review(
    root: Path,
    path: Path,
    schema: dict[str, Any],
    catalog: dict[str, Any],
    checks: dict[str, dict[str, Any]],
    source_commit: str,
) -> dict[str, Any]:
    review = load_yaml(path)
    schema_errors = sorted(Draft202012Validator(schema).iter_errors(review), key=lambda error: list(error.path))
    if schema_errors:
        messages = "; ".join(f"{'.'.join(map(str, error.path)) or '<root>'}: {error.message}" for error in schema_errors)
        raise ContractError(f"{path}: schema validation failed: {messages}")
    validate_impact_details(path, review)
    if review["catalog_version"] != catalog["catalog_version"]:
        raise ContractError(f"{path}: catalog_version is stale")
    catalog_path = root / "governance" / "checks" / "catalog.yaml"
    if review["catalog_digest"] != digest_file(catalog_path):
        raise ContractError(f"{path}: catalog_digest does not match the active catalog")

    selected = review["selected_checks"]
    selected_by_id: dict[str, dict[str, Any]] = {}
    for result in selected:
        item_id = result["id"]
        if item_id in selected_by_id:
            raise ContractError(f"{path}: duplicate selected check {item_id}")
        item = checks.get(item_id)
        if item is None:
            raise ContractError(f"{path}: unknown check id {item_id}")
        if result["class"] != item["class"]:
            raise ContractError(f"{path}: {item_id} class must be {item['class']}")
        if result["result"] == "fail" and item["enforcement"] in {"blocking", "blocking-when-selected"}:
            raise ContractError(f"{path}: blocking check {item_id} cannot remain fail")
        if result["result"] == "pass":
            for evidence in result["evidence"]:
                validate_evidence(root, evidence, source_commit)
        selected_by_id[item_id] = result

    missing = sorted(required_check_ids(review, checks) - selected_by_id.keys())
    if missing:
        raise ContractError(f"{path}: missing required checks: {', '.join(missing)}")

    advisory_by_id: dict[str, dict[str, Any]] = {}
    for advisory in review["advisories"]:
        item_id = advisory["id"]
        if item_id in advisory_by_id:
            raise ContractError(f"{path}: duplicate advisory disposition {item_id}")
        selected_item = selected_by_id.get(item_id)
        if selected_item is None or selected_item["class"] != "Advisory" or selected_item["result"] != "fail":
            raise ContractError(f"{path}: advisory {item_id} must address a selected Advisory fail")
        if advisory["disposition"] == "residual-risk" and advisory["risk"] not in review["residual_risks"]:
            raise ContractError(f"{path}: advisory {item_id} risk is absent from residual_risks")
        advisory_by_id[item_id] = advisory
    for item_id, result in selected_by_id.items():
        if result["class"] == "Advisory" and result["result"] == "fail" and item_id not in advisory_by_id:
            raise ContractError(f"{path}: Advisory fail {item_id} has no disposition")
    return review


def parse_trailers(message: str) -> dict[str, str]:
    trailers: dict[str, str] = {}
    for line in message.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        if key in REQUIRED_TRAILERS:
            trailers[key] = value.strip()
    return trailers


def conventional_commit_type(subject: str) -> str | None:
    """Return the Conventional Commit type, accepting the optional Gitmoji prefix."""
    match = CONVENTIONAL_SUBJECT_PATTERN.match(subject)
    return match.group("type") if match else None


def validate_commit_type_flags(subject: str, review: dict[str, Any]) -> None:
    """Prevent a Conventional Commit `fix` from bypassing the regression-test check."""
    if conventional_commit_type(subject) == "fix" and not review["impact_flags"]["bug_fix"]:
        raise ContractError("fix commit requires impact_flags.bug_fix: true")


def validate_commit(root: Path, commit_ref: str) -> Path:
    message = git_text(root, "show", "-s", "--format=%B", commit_ref)
    for section in REQUIRED_SECTIONS:
        if not re.search(rf"(?m)^{re.escape(section)}$", message):
            raise ContractError(f"{commit_ref}: Commit Comment missing section {section}")
    trailers = parse_trailers(message)
    for trailer in REQUIRED_TRAILERS:
        if not trailers.get(trailer):
            raise ContractError(f"{commit_ref}: Commit Comment missing trailer {trailer}")
    review_path = safe_repo_path(root, trailers["Review-Checklist"])
    if not review_path.is_file() or review_path.suffix not in {".yaml", ".yml"}:
        raise ContractError(f"{commit_ref}: Review-Checklist does not reference an existing YAML file")
    return review_path


def validate_review_file(
    root: Path,
    review_path: Path,
    source_commit: str,
    *,
    require_squash: bool = False,
) -> dict[str, Any]:
    catalog, checks = load_catalog(root / "governance" / "checks" / "catalog.yaml")
    schema = json.loads((root / "governance" / "reviews" / "review-result.schema.json").read_text(encoding="utf-8"))
    path = safe_repo_path(root, review_path.as_posix())
    reviews_root = (root / "governance" / "reviews").resolve()
    if path.parent != reviews_root or not path.name.startswith("CHG-") or path.suffix not in {".yaml", ".yml"}:
        raise ContractError("release review must point under governance/reviews/CHG-*.yaml")
    resolved_commit = git_text(root, "rev-parse", f"{source_commit}^{{commit}}")
    relative_review = path.relative_to(root).as_posix()
    git_text(root, "cat-file", "-e", f"{resolved_commit}:{relative_review}")
    committed_blob = git_text(root, "rev-parse", f"{resolved_commit}:{relative_review}")
    working_blob = git_text(root, "hash-object", relative_review)
    if working_blob != committed_blob:
        raise ContractError(
            f"{path}: working-tree review differs from the review blob at source commit {resolved_commit}"
        )
    review = validate_review(root, path, schema, catalog, checks, resolved_commit)
    if require_squash and not review["impact_flags"]["squash"]:
        raise ContractError(f"{path}: release review requires impact_flags.squash: true")
    return review


def validate_repository(root: Path, commit_ref: str) -> None:
    active_review = validate_commit(root, commit_ref)
    reviews_root = (root / "governance" / "reviews").resolve()
    if active_review.parent != reviews_root or not active_review.name.startswith("CHG-"):
        raise ContractError(f"{commit_ref}: Review-Checklist must point under governance/reviews/CHG-*.yaml")
    resolved_commit = git_text(root, "rev-parse", f"{commit_ref}^{{commit}}")
    relative_review = active_review.relative_to(root).as_posix()
    source_commit = git_text(root, "log", "-1", "--format=%H", resolved_commit, "--", relative_review)
    if source_commit != resolved_commit:
        raise ContractError(f"{active_review}: active review must be updated by {commit_ref}")
    message = git_text(root, "show", "-s", "--format=%B", resolved_commit)
    review = validate_review_file(
        root,
        active_review,
        source_commit,
        require_squash=bool(re.search(r"(?m)^Release-Type:\s*(?:regular|hotfix)\s*$", message)),
    )
    subject = message.splitlines()[0] if message else ""
    validate_commit_type_flags(subject, review)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--commit")
    selection.add_argument("--review", type=Path)
    parser.add_argument("--source-commit", default="HEAD")
    parser.add_argument("--require-squash", action="store_true")
    args = parser.parse_args()
    try:
        root = args.root.resolve()
        if args.review is not None:
            validate_review_file(
                root,
                args.review,
                args.source_commit,
                require_squash=args.require_squash,
            )
        else:
            if args.require_squash:
                raise ContractError("--require-squash requires --review")
            validate_repository(root, args.commit or "HEAD")
    except (ContractError, json.JSONDecodeError, yaml.YAMLError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print("review contract validation OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
