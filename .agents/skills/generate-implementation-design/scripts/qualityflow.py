#!/usr/bin/env python3
"""Execute the as-built quality contracts declared by FAST-016 through FAST-023."""

from __future__ import annotations

import argparse
import ast
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import tokenize
from pathlib import Path
from typing import Any, Iterable

SCRIPT_ROOT = Path(__file__).resolve().parent
DEFAULT_THRESHOLDS = SCRIPT_ROOT.parent / "assets" / "as-built-thresholds.json"
DEFAULT_STANDARD = SCRIPT_ROOT.parents[3] / "docs" / "standards" / "AS-BUILT-DESIGN.md"
SUPPRESSION = re.compile(r"ignore\[([A-Z][A-Z0-9-]+)\]\s*(.*)$")
UNIT_MARKERS = ("# 1. 初期化", "# 2. テストの実行", "# 3. アサーション")
GWT_MARKERS = ("# Given", "# When", "# Then")


class QualityError(RuntimeError):
    """Represent an invalid input or a blocking as-built contract failure."""


def load_designflow() -> Any:
    """Load the sibling generator without requiring package installation."""

    path = SCRIPT_ROOT / "designflow.py"
    spec = importlib.util.spec_from_file_location("dev_standard_designflow", path)
    if spec is None or spec.loader is None:
        raise QualityError(f"cannot load designflow: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path: Path) -> dict[str, Any]:
    """Read a JSON object and normalize parse failures."""

    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise QualityError(f"cannot read JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise QualityError(f"JSON root must be an object: {path}")
    return value


def parse_python(path: Path) -> ast.Module:
    """Parse Python source with a stable diagnostic."""

    try:
        return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (OSError, SyntaxError) as exc:
        raise QualityError(f"cannot parse Python {path}: {exc}") from exc


def call_name(call: ast.Call) -> str:
    """Return a dotted call name for static contract matching."""

    parts: list[str] = []
    node: ast.AST = call.func
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


def literal(node: ast.AST | None, default: Any = None) -> Any:
    """Return a Python literal and reject executable expressions."""

    if node is None:
        return default
    try:
        return ast.literal_eval(node)
    except (ValueError, TypeError):
        return default


def append_summary(title: str, lines: Iterable[str], *, enabled: bool) -> None:
    """Append concise results to the GitHub Actions job summary when requested."""

    if not enabled:
        return
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if not target:
        return
    with Path(target).open("a", encoding="utf-8") as stream:
        stream.write(f"## {title}\n\n")
        for line in lines:
            stream.write(f"- {line}\n")
        stream.write("\n")


def write_json(path: Path, value: Any) -> None:
    """Write generated machine output atomically."""

    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        stream.write(payload)
        temporary = Path(stream.name)
    os.replace(temporary, path)


def api_consistency(source_root: Path, openapi_path: Path) -> list[str]:
    """Check handler registration, design metadata, and success/error samples."""

    designflow = load_designflow()
    routers = sorted(source_root.rglob("router.py"))
    operations = [item for path in routers for item in designflow.router_operations(path)]
    openapi = designflow.load_structured(openapi_path)
    declared: dict[tuple[str, str], dict[str, Any]] = {}
    for path, item in openapi.get("paths", {}).items():
        for method, operation in item.items():
            if method.lower() in designflow.HTTP_METHODS and isinstance(operation, dict):
                declared[(method.upper(), path)] = operation
    samples = designflow.load_api_samples(source_root)
    failures: list[str] = []
    observed: set[tuple[str, str]] = set()
    for handler in operations:
        key = (handler["method"], handler["path"])
        operation = declared.get(key)
        if operation is None:
            failures.append(f"handler not registered in OpenAPI: {key[0]} {key[1]}")
            continue
        observed.add(key)
        operation_id = str(operation.get("operationId") or handler["operation_id"])
        metadata = {**handler.get("metadata", {}), **{name: value for name, value in operation.items() if name.startswith("x-")}}
        for name in ("x-api-number", "x-permission", "x-business-summary"):
            if not metadata.get(name):
                failures.append(f"{operation_id}: metadata missing: {name}")
        if f"{operation_id}:success" not in samples:
            failures.append(f"{operation_id}: success sample missing")
        for error in handler["errors"]:
            if f"{operation_id}:{error['id']}" not in samples:
                failures.append(f"{operation_id}: error sample missing: {error['id']}")
    for method, path in sorted(set(declared) - observed):
        failures.append(f"OpenAPI operation has no handler: {method} {path}")
    return failures


def asserted_sample_keys(test_root: Path) -> set[str]:
    """Collect literal sample keys used inside assert statements."""

    keys: set[str] = set()
    for path in sorted(test_root.rglob("test*.py")):
        tree = parse_python(path)
        for assertion in (node for node in ast.walk(tree) if isinstance(node, ast.Assert)):
            for node in ast.walk(assertion.test):
                if not isinstance(node, ast.Subscript):
                    continue
                owner = node.value
                if isinstance(owner, ast.Name) and owner.id == "API_SAMPLES":
                    key = literal(node.slice)
                    if isinstance(key, str):
                        keys.add(key)
    return keys


def sample_consistency(source_root: Path, test_root: Path) -> list[str]:
    """Check that every design sample participates in a response assertion."""

    samples = load_designflow().load_api_samples(source_root)
    asserted = asserted_sample_keys(test_root)
    return [f"sample is not asserted by a test: {key}" for key in sorted(set(samples) - asserted)]


def function_calls(function: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ast.Call]:
    """Return calls contained in one test function."""

    return [node for node in ast.walk(function) if isinstance(node, ast.Call)]


def declaration(call: ast.Call, name: str) -> str | None:
    """Read a literal ID from a named decorator or call."""

    if call_name(call).split(".")[-1] != name or not call.args:
        return None
    value = literal(call.args[0])
    return value if isinstance(value, str) else None


def crud_e2e_consistency(source_root: Path, sql_root: Path, e2e_root: Path) -> list[str]:
    """Check write APIs and error cases against explicit E2E state assertions."""

    designflow = load_designflow()
    routers = sorted(source_root.rglob("router.py"))
    operations = [item for path in routers for item in designflow.router_operations(path)]
    queries, _ = designflow.parse_sql(sql_root)
    success: dict[str, set[str]] = {}
    errors: dict[str, set[str]] = {}
    allowed_reasons: dict[str, list[str]] = {}
    for path in sorted(e2e_root.rglob("test*.py")):
        tree = parse_python(path)
        for function in (node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_")):
            calls = function_calls(function)
            operation_ids = {value for call in [*function.decorator_list, *calls] if isinstance(call, ast.Call) and (value := declaration(call, "operation"))}
            case_ids = {value for call in [*function.decorator_list, *calls] if isinstance(call, ast.Call) and (value := declaration(call, "covers"))}
            names = {call_name(call).split(".")[-1] for call in calls}
            for operation_id in operation_ids:
                success.setdefault(operation_id, set()).update(names)
            for case_id in case_ids:
                errors.setdefault(case_id, set()).update(names)
                for call in calls:
                    if call_name(call).split(".")[-1] == "assert_allowed_state_change":
                        reason = literal(call.args[0]) if call.args else None
                        if isinstance(reason, str) and reason.strip():
                            allowed_reasons.setdefault(case_id, []).append(reason)
    failures: list[str] = []
    for operation in operations:
        operation_id = str(operation["operation_id"])
        writes = any(query["letter"] in {"C", "U", "D"} for query in designflow.operation_queries(operation, queries, len(operations)))
        if writes and not success.get(operation_id, set()).intersection({"assert_db_state", "assert_external_state"}):
            failures.append(f"{operation_id}: write API lacks a success-state assertion")
        for error in operation["errors"]:
            calls = errors.get(error["id"], set())
            if not calls:
                failures.append(f"{operation_id}: error case lacks covers declaration: {error['id']}")
            elif not calls.intersection({"assert_state_unchanged", "assert_allowed_state_change"}):
                failures.append(f"{operation_id}: error case lacks a state assertion: {error['id']}")
            elif "assert_allowed_state_change" in calls and not allowed_reasons.get(error["id"]):
                failures.append(f"{operation_id}: allowed state change lacks a reason: {error['id']}")
    return failures


def coverage_result(path: Path, thresholds_path: Path) -> dict[str, Any]:
    """Evaluate statement and branch coverage against the declared advisory targets."""

    document = read_json(path)
    totals = document.get("totals")
    if not isinstance(totals, dict):
        raise QualityError("coverage JSON has no totals object")
    statements = int(totals.get("num_statements", 0))
    covered_statements = int(totals.get("covered_lines", 0))
    branches = int(totals.get("num_branches", 0))
    covered_branches = int(totals.get("covered_branches", 0))
    if statements <= 0 or branches <= 0:
        raise QualityError("statement and branch coverage must both be measurable")
    statement_percent = covered_statements * 100 / statements
    branch_percent = covered_branches * 100 / branches
    targets = read_json(thresholds_path)["coverage"]
    return {
        "check_id": "FAST-019",
        "enforcement": targets["enforcement"],
        "statement_percent": round(statement_percent, 2),
        "branch_percent": round(branch_percent, 2),
        "statement_target": targets["statement_percent"],
        "branch_target": targets["branch_percent"],
        "status": "pass" if statement_percent >= targets["statement_percent"] and branch_percent >= targets["branch_percent"] else "advisory",
    }


def test_structure(root: Path, mode: str) -> list[str]:
    """Evaluate test docstrings, one-case functions, and AAA/GWT source markers."""

    failures: list[str] = []
    markers = UNIT_MARKERS if mode == "unit" else GWT_MARKERS
    for path in sorted(root.rglob("test*.py")):
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        tree = parse_python(path)
        for function in (node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_")):
            label = f"{path}:{function.name}"
            if not ast.get_docstring(function):
                failures.append(f"{label}: docstring missing")
            body = "\n".join(lines[function.lineno - 1 : function.end_lineno or function.lineno])
            positions = [body.find(marker) for marker in markers]
            if any(position < 0 for position in positions) or positions != sorted(positions):
                failures.append(f"{label}: {'AAA' if mode == 'unit' else 'GWT'} markers missing or out of order")
            if any(isinstance(node, (ast.For, ast.While, ast.comprehension)) for node in ast.walk(function)):
                failures.append(f"{label}: one-case function contains iteration")
            if any(isinstance(decorator, ast.Call) and call_name(decorator).endswith("parametrize") for decorator in function.decorator_list):
                failures.append(f"{label}: parametrization hides multiple cases")
    return failures


def implementation_structure(root: Path) -> list[str]:
    """Evaluate analyzable endpoint, layer, SQL, and generator-tool conventions."""

    failures: list[str] = []
    for router in sorted(root.rglob("router.py")):
        sibling = router.with_name("functions.py")
        if not sibling.is_file():
            failures.append(f"{router}: sibling functions.py missing")
        tree = parse_python(router)
        for function in (node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))):
            names = {call_name(call).lower() for call in ast.walk(function) if isinstance(call, ast.Call)}
            prohibited = sorted(name for name in names if name == "print" or name.startswith(("boto3.", "requests.", "httpx.")))
            if prohibited:
                failures.append(f"{router}:{function.name}: direct infrastructure call: {', '.join(prohibited)}")
    for functions in sorted(root.rglob("functions.py")):
        tree = parse_python(functions)
        for function in (node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))):
            if not ast.get_docstring(function):
                failures.append(f"{functions}:{function.name}: responsibility docstring missing")
    for sql in sorted(root.rglob("*.sql")):
        text = sql.read_text(encoding="utf-8")
        statements = [item for item in load_designflow().sqlglot.parse(text) if item is not None]
        if len(statements) != 1:
            failures.append(f"{sql}: expected one SQL statement")
        if not text.lstrip().startswith("--"):
            failures.append(f"{sql}: natural-language summary comment missing")
    return failures


EXPECTED_THRESHOLDS = {
    "coverage": {"statement_percent": 95, "branch_percent": 90, "enforcement": "advisory"},
    "application": {
        "complexity_per_function": 10,
        "control_nesting": 3,
        "function_logical_lines": 50,
        "router_logical_lines": 200,
        "file_logical_lines": 400,
        "arguments": 3,
        "returns_per_function": 4,
        "boolean_operators": 2,
        "ternary_nesting": 0,
    },
    "tool": {
        "complexity_per_function": 12,
        "control_nesting": 4,
        "function_logical_lines": 30,
        "file_logical_lines": 500,
        "arguments": 8,
        "returns_per_function": 5,
        "boolean_operators": 2,
        "ternary_nesting": 0,
    },
}


def threshold_consistency(path: Path) -> list[str]:
    """Compare machine thresholds and linter delegation with the standard contract."""

    document = read_json(path)
    failures = [f"threshold group differs from standard: {key}" for key, expected in EXPECTED_THRESHOLDS.items() if document.get(key) != expected]
    delegation = document.get("linter_delegation", {})
    for rule in ("LIMIT-DO-001", "LIMIT-DO-002", "RULE-DO-002"):
        if not isinstance(delegation, dict) or not delegation.get(rule):
            failures.append(f"linter delegation missing: {rule}")
    return failures


def standard_rule_ids(path: Path) -> set[str]:
    """Extract authoritative Rule IDs from the standard tables."""

    return set(re.findall(r"\| `([A-Z][A-Z0-9-]+)` \|", path.read_text(encoding="utf-8")))


def suppression_lines(path: Path) -> list[tuple[int, str]]:
    """Return comments from Python and literal lines from other text files."""

    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []
    if path.suffix != ".py":
        return list(enumerate(text.splitlines(), 1))
    try:
        tokens = tokenize.generate_tokens(io.StringIO(text).readline)
        return [(token.start[0], token.string) for token in tokens if token.type == tokenize.COMMENT]
    except (IndentationError, tokenize.TokenError) as exc:
        raise QualityError(f"cannot tokenize Python {path}: {exc}") from exc


def suppression_inventory(root: Path, standard: Path) -> tuple[list[dict[str, Any]], list[str]]:
    """Inventory reasoned suppressions and reject silent, orphan, or duplicate entries."""

    valid = standard_rule_ids(standard)
    inventory: list[dict[str, Any]] = []
    failures: list[str] = []
    seen: set[tuple[str, str]] = set()
    ignored = {".git", ".venv", ".devflow", "__pycache__"}
    for path in sorted(item for item in root.rglob("*") if item.is_file() and not ignored.intersection(item.parts)):
        for line_number, line in suppression_lines(path):
            match = SUPPRESSION.search(line)
            if not match:
                continue
            rule_id, reason = match.group(1), match.group(2).strip()
            key = (path.relative_to(root).as_posix(), rule_id)
            inventory.append({"path": key[0], "line": line_number, "rule_id": rule_id, "reason": reason})
            if not reason:
                failures.append(f"{key[0]}:{line_number}: suppression reason missing")
            if rule_id not in valid:
                failures.append(f"{key[0]}:{line_number}: orphan Rule ID: {rule_id}")
            if key in seen:
                failures.append(f"{key[0]}:{line_number}: duplicate suppression: {rule_id}")
            seen.add(key)
    return inventory, failures


def print_findings(check_id: str, failures: list[str], *, advisory: bool, github_summary: bool) -> int:
    """Print one check outcome and map advisory findings to a successful exit."""

    status = "PASS" if not failures else ("ADVISORY" if advisory else "FAIL")
    print(f"{check_id}: {status}")
    for failure in failures:
        print(f"- {failure}")
    append_summary(check_id, [status, *failures], enabled=github_summary)
    return 0 if advisory or not failures else 1


def command_report(args: argparse.Namespace) -> int:
    """Aggregate selected quality results into one external CI summary."""

    coverage = coverage_result(args.coverage, args.thresholds)
    suppressions, suppression_failures = suppression_inventory(args.root, args.standard)
    unit_findings = test_structure(args.root / "tests", "unit") if (args.root / "tests").is_dir() else []
    implementation_findings = implementation_structure(args.root)
    result = {
        "schema_version": 1,
        "checks": [
            coverage,
            {"check_id": "FAST-020", "status": "pass" if not unit_findings else "advisory", "findings": unit_findings},
            {"check_id": "FAST-021", "status": "pass" if not implementation_findings else "advisory", "findings": implementation_findings},
            {"check_id": "AUD-008", "status": "pass" if not suppression_failures else "fail", "findings": suppression_failures, "inventory_count": len(suppressions)},
        ],
    }
    if args.json_out:
        write_json(args.json_out, result)
    summary_lines = [f"{item['check_id']}: {item['status']}" for item in result["checks"]]
    append_summary("As-built quality report", summary_lines, enabled=args.github_summary)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if suppression_failures else 0


def build_parser() -> argparse.ArgumentParser:
    """Build the quality contract command line."""

    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    api = sub.add_parser("api")
    api.add_argument("--source-root", required=True, type=Path)
    api.add_argument("--openapi", required=True, type=Path)
    samples = sub.add_parser("samples")
    samples.add_argument("--source-root", required=True, type=Path)
    samples.add_argument("--test-root", required=True, type=Path)
    crud = sub.add_parser("crud-e2e")
    crud.add_argument("--source-root", required=True, type=Path)
    crud.add_argument("--sql-root", required=True, type=Path)
    crud.add_argument("--e2e-root", required=True, type=Path)
    coverage = sub.add_parser("coverage")
    coverage.add_argument("--input", required=True, type=Path)
    coverage.add_argument("--thresholds", type=Path, default=DEFAULT_THRESHOLDS)
    coverage.add_argument("--enforce", action="store_true")
    structure = sub.add_parser("test-structure")
    structure.add_argument("--root", required=True, type=Path)
    structure.add_argument("--mode", choices=["unit", "e2e"], required=True)
    structure.add_argument("--enforce", action="store_true")
    implementation = sub.add_parser("implementation")
    implementation.add_argument("--root", required=True, type=Path)
    implementation.add_argument("--enforce", action="store_true")
    thresholds = sub.add_parser("thresholds")
    thresholds.add_argument("--config", type=Path, default=DEFAULT_THRESHOLDS)
    suppressions = sub.add_parser("suppressions")
    suppressions.add_argument("--root", required=True, type=Path)
    suppressions.add_argument("--standard", type=Path, default=DEFAULT_STANDARD)
    suppressions.add_argument("--json-out", type=Path)
    report = sub.add_parser("report")
    report.add_argument("--root", required=True, type=Path)
    report.add_argument("--coverage", required=True, type=Path)
    report.add_argument("--thresholds", type=Path, default=DEFAULT_THRESHOLDS)
    report.add_argument("--standard", type=Path, default=DEFAULT_STANDARD)
    report.add_argument("--json-out", type=Path)
    for command in sub.choices.values():
        command.add_argument("--github-summary", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Execute one declared quality contract."""

    args = build_parser().parse_args(argv)
    try:
        if args.command == "api":
            return print_findings("FAST-016", api_consistency(args.source_root, args.openapi), advisory=False, github_summary=args.github_summary)
        if args.command == "samples":
            return print_findings("FAST-017", sample_consistency(args.source_root, args.test_root), advisory=False, github_summary=args.github_summary)
        if args.command == "crud-e2e":
            return print_findings("FAST-018", crud_e2e_consistency(args.source_root, args.sql_root, args.e2e_root), advisory=False, github_summary=args.github_summary)
        if args.command == "coverage":
            result = coverage_result(args.input, args.thresholds)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            append_summary("FAST-019", [f"{key}: {value}" for key, value in result.items()], enabled=args.github_summary)
            return 1 if args.enforce and result["status"] != "pass" else 0
        if args.command == "test-structure":
            return print_findings("FAST-020", test_structure(args.root, args.mode), advisory=not args.enforce, github_summary=args.github_summary)
        if args.command == "implementation":
            return print_findings("FAST-021", implementation_structure(args.root), advisory=not args.enforce, github_summary=args.github_summary)
        if args.command == "thresholds":
            return print_findings("FAST-022", threshold_consistency(args.config), advisory=False, github_summary=args.github_summary)
        if args.command == "suppressions":
            inventory, failures = suppression_inventory(args.root, args.standard)
            if args.json_out:
                write_json(args.json_out, {"schema_version": 1, "suppressions": inventory})
            return print_findings("AUD-008", failures, advisory=False, github_summary=args.github_summary)
        return command_report(args)
    except (QualityError, OSError, KeyError, TypeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
