#!/usr/bin/env python3
"""Generate drift-detectable detailed design from FastAPI and CloudFormation artifacts."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import shutil
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover - environment contract
    yaml = None
try:
    import sqlglot
    from sqlglot import exp
except ImportError:  # pragma: no cover - environment contract
    sqlglot = exp = None


class DesignError(RuntimeError):
    pass


HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
MANAGED_BY = "dev-standard-designflow"
MANIFEST_SCHEMA_VERSION = 2


class RuntimeCallOrder(ast.NodeVisitor):
    """Collect calls in Python evaluation order rather than AST breadth order."""

    def __init__(self) -> None:
        self.calls: list[ast.Call] = []

    def visit_Call(self, node: ast.Call) -> None:
        self.visit(node.func)
        for argument in node.args:
            self.visit(argument)
        for keyword in node.keywords:
            self.visit(keyword.value)
        self.calls.append(node)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def find_repository_root(start: Path | None = None) -> Path:
    """Return the repository root without relying on the installed Skill path."""

    current = (start or Path.cwd()).resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    raise DesignError("repository root not found; run inside a Git repository or pass --repo-root")


def validate_output_path(out: Path, repository_root: Path) -> tuple[Path, Path]:
    """Resolve a generated bundle path and reject every destructive escape."""

    repository_root = repository_root.resolve(strict=True)
    generated_root = repository_root / "docs" / "design" / "generated"
    for existing in (repository_root, repository_root / "docs", repository_root / "docs" / "design", generated_root):
        if existing.exists() and existing.is_symlink():
            raise DesignError(f"generated output ancestor must not be a symlink: {existing}")
    generated_root.mkdir(parents=True, exist_ok=True)
    generated_root = generated_root.resolve(strict=True)
    resolved = (repository_root / out).resolve(strict=False) if not out.is_absolute() else out.resolve(strict=False)
    if resolved == generated_root or generated_root not in resolved.parents:
        raise DesignError(f"output must be a bundle below {generated_root}: {out}")
    relative = resolved.relative_to(repository_root)
    cursor = repository_root
    for part in relative.parts:
        cursor /= part
        if cursor.exists() and cursor.is_symlink():
            raise DesignError(f"generated output path must not contain a symlink: {cursor}")
    if resolved.exists() and (not resolved.is_dir() or resolved.is_symlink()):
        raise DesignError(f"generated output must be a non-symlink directory: {resolved}")
    return resolved, generated_root


def validate_managed_bundle(out: Path) -> None:
    """Allow replacement only for a bundle previously owned by this generator."""

    manifest_path = out / "manifest.json"
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise DesignError(f"refusing to replace unmanaged directory: {out}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise DesignError(f"generated bundle manifest is invalid: {manifest_path}") from exc
    if manifest.get("managed_by") != MANAGED_BY or manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise DesignError(f"refusing to replace bundle with an unknown manifest: {out}")
    expected = {"manifest.json", *manifest.get("generated", [])}
    actual = {path.relative_to(out).as_posix() for path in out.rglob("*") if path.is_file()}
    if actual != expected:
        raise DesignError(f"managed bundle file set differs from manifest: {out}")


def display_call(call: ast.Call) -> str:
    parts: list[str] = []
    node: ast.AST = call.func
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts)) or "call"


def literal(node: ast.AST | None, default: Any = None) -> Any:
    """Return a literal value while refusing executable expressions."""

    if node is None:
        return default
    try:
        return ast.literal_eval(node)
    except (ValueError, TypeError):
        return default


def route_decorator(function: ast.FunctionDef | ast.AsyncFunctionDef) -> tuple[str, str, dict[str, Any]] | None:
    for decorator in function.decorator_list:
        if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
            continue
        method = decorator.func.attr.lower()
        if method in HTTP_METHODS and decorator.args and isinstance(decorator.args[0], ast.Constant):
            metadata: dict[str, Any] = {}
            for keyword in decorator.keywords:
                if keyword.arg is None:
                    continue
                value = literal(keyword.value)
                if keyword.arg == "openapi_extra" and isinstance(value, dict):
                    metadata.update(value)
                elif value is not None:
                    metadata[keyword.arg] = value
            return method.upper(), str(decorator.args[0].value), metadata
    return None


def error_cases(function: ast.FunctionDef | ast.AsyncFunctionDef) -> list[dict[str, Any]]:
    """Extract normalized error responses and derive stable IDs from explicit codes."""

    result: list[dict[str, Any]] = []
    for node in ast.walk(function):
        if not isinstance(node, ast.Call) or not display_call(node).endswith("error_response"):
            continue
        keywords = {keyword.arg: literal(keyword.value) for keyword in node.keywords if keyword.arg}
        code = keywords.get("case_id") or keywords.get("code") or (literal(node.args[0]) if node.args else None)
        if not isinstance(code, str) or not code.strip():
            raise DesignError(f"{function.name}: error_response requires a literal code or case_id")
        normalized = re.sub(r"[^a-z0-9]+", "-", code.lower()).strip("-")
        case_id = f"ERR-{function.name.replace('_', '-').upper()}-{normalized.upper()}"
        result.append(
            {
                "id": case_id,
                "code": code,
                "message_id": keywords.get("message_id") or "-",
                "status_code": keywords.get("status_code") or "-",
            }
        )
    ids = [item["id"] for item in result]
    if len(ids) != len(set(ids)):
        raise DesignError(f"{function.name}: duplicate normalized error case")
    return sorted(result, key=lambda item: item["id"])


def router_operations(path: Path) -> list[dict[str, Any]]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (OSError, SyntaxError) as exc:
        raise DesignError(f"cannot parse router {path}: {exc}") from exc
    operations: list[dict[str, Any]] = []
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        route = route_decorator(node)
        if route is None:
            continue
        returns = [child for child in ast.walk(node) if isinstance(child, ast.Return)]
        if not node.body or not isinstance(node.body[-1], ast.Return):
            raise DesignError(f"{path}:{node.name}: route must end in a direct return")
        returned = node.body[-1].value
        if isinstance(returned, ast.Await):
            returned = returned.value
        if not isinstance(returned, ast.Call):
            raise DesignError(f"{path}:{node.name}: final return must directly call the response producer")
        if any(isinstance(ret.value, ast.Name) for ret in returns):
            raise DesignError(f"{path}:{node.name}: returning a response variable is forbidden")
        # Walk only the function body. Walking the function node also visits route
        # decorators, which are registration metadata rather than runtime calls.
        collector = RuntimeCallOrder()
        for statement in node.body:
            collector.visit(statement)
        calls = collector.calls
        metadata = route[2]
        string_literals = [child.value for child in ast.walk(node) if isinstance(child, ast.Constant) and isinstance(child.value, str)]
        call_names = [display_call(call) for call in calls]
        sql_files = sorted({value for value in string_literals if value.lower().endswith(".sql")})
        external_clients = sorted(
            {
                name
                for name in call_names
                if any(token in name.lower().split(".") for token in {"client", "http", "external", "service"})
            }
        )
        operation_id = metadata.get("operation_id") or metadata.get("x-operation-id") or node.name
        operations.append(
            {
                "method": route[0],
                "path": route[1],
                "function": node.name,
                "operation_id": str(operation_id),
                "source": str(path),
                "docstring": (ast.get_docstring(node) or "-").splitlines()[0],
                "calls": call_names,
                "sql_files": sql_files,
                "external_clients": external_clients,
                "metadata": metadata,
                "errors": error_cases(node),
            }
        )
    return operations


def render_sequences(operations: list[dict[str, Any]]) -> str:
    lines = ["# FastAPI operation sequences"]
    for operation in operations:
        lines += ["", f"## {operation['method']} {operation['path']} — `{operation['function']}`", "", "```mermaid", "sequenceDiagram", "    participant Client", "    participant Router"]
        lines.append(f"    Client->>Router: {operation['method']} {operation['path']}")
        for index, call in enumerate(operation["calls"], 1):
            participant = "F" + str(index)
            lines.append(f"    participant {participant} as {call}")
            lines.append(f"    Router->>{participant}: call")
            lines.append(f"    {participant}-->>Router: result")
        lines += ["    Router-->>Client: response", "```"]
    return "\n".join(lines) + "\n"


def load_structured(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        return json.loads(text)
    if yaml is None:
        raise DesignError("PyYAML is required for YAML input")

    class Loader(yaml.SafeLoader):
        pass

    def unknown(loader: Any, tag_suffix: str, node: Any) -> Any:
        if isinstance(node, yaml.ScalarNode):
            return {"tag": tag_suffix, "value": loader.construct_scalar(node)}
        if isinstance(node, yaml.SequenceNode):
            return {"tag": tag_suffix, "value": loader.construct_sequence(node)}
        return {"tag": tag_suffix, "value": loader.construct_mapping(node)}

    Loader.add_multi_constructor("!", unknown)
    return yaml.load(text, Loader=Loader)


def ref_name(value: Any) -> str:
    if isinstance(value, dict) and "$ref" in value:
        return str(value["$ref"]).rsplit("/", 1)[-1]
    if isinstance(value, dict):
        return str(value.get("type") or value.get("content") or "inline")
    return "-"


def load_api_samples(source_root: Path) -> dict[str, Any]:
    """Load literal API_SAMPLES mappings without importing application code."""

    samples: dict[str, Any] = {}
    for path in sorted(source_root.rglob("samples.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (OSError, SyntaxError) as exc:
            raise DesignError(f"cannot parse samples {path}: {exc}") from exc
        for node in tree.body:
            if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                continue
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            value_node = node.value
            if any(isinstance(target, ast.Name) and target.id == "API_SAMPLES" for target in targets):
                value = literal(value_node)
                if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
                    raise DesignError(f"{path}: API_SAMPLES must be a literal string-keyed mapping")
                duplicates = set(samples).intersection(value)
                if duplicates:
                    raise DesignError(f"duplicate API sample keys: {sorted(duplicates)}")
                samples.update(value)
    return dict(sorted(samples.items()))


def operation_extensions(operation: dict[str, Any], handler: dict[str, Any] | None) -> dict[str, Any]:
    extensions = {key: value for key, value in operation.items() if key.startswith("x-")}
    if handler:
        extensions = {**handler.get("metadata", {}), **extensions}
    return extensions


def openapi_docs(document: dict[str, Any], handlers: list[dict[str, Any]] | None = None) -> tuple[str, str]:
    operations: list[tuple[str, str, dict[str, Any]]] = []
    seen: set[str] = set()
    for path, item in sorted(document.get("paths", {}).items()):
        for method, operation in sorted(item.items()):
            if method.lower() not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            operation_id = operation.get("operationId") or f"{method}-{path}"
            if operation_id in seen:
                raise DesignError(f"duplicate OpenAPI operationId: {operation_id}")
            seen.add(operation_id)
            operations.append((method.upper(), path, operation))
    handler_map = {str(item["operation_id"]): item for item in (handlers or [])}
    handler_route_map = {(item["method"], item["path"]): item for item in (handlers or [])}
    catalog = [
        "# API catalog",
        "",
        "| Method | Path | Operation ID | API number | Permission | Business summary | Requirement IDs |",
        "|---|---|---|---|---|---|---|",
    ]
    interfaces = ["# API interfaces"]
    for method, path, operation in operations:
        request = operation.get("requestBody", {}).get("content", {})
        request_types = [f"{media}:{ref_name(body.get('schema', {}))}" for media, body in sorted(request.items())]
        responses = []
        for status, response in sorted(operation.get("responses", {}).items()):
            schemas = [f"{media}:{ref_name(body.get('schema', {}))}" for media, body in sorted(response.get("content", {}).items())]
            responses.append(f"{status}={'/'.join(schemas) or response.get('description', '-')}" )
        interfaces += ["", f"## {method} {path}", "", f"- Request: {', '.join(request_types) or '-'}", f"- Responses: {', '.join(responses) or '-'}"]
    schemas = document.get("components", {}).get("schemas", {})
    observed_operation_ids: set[str] = set()
    for method, path, operation in operations:
        operation_id = str(operation.get("operationId") or f"{method.lower()}-{path}")
        observed_operation_ids.add(operation_id)
        handler = handler_map.get(operation_id) or handler_route_map.get((method, path))
        extensions = operation_extensions(operation, handler)
        requirements = operation.get("x-requirement-ids", [])
        catalog.append(
            f"| {method} | `{path}` | `{operation_id}` | {extensions.get('x-api-number', '-')} | "
            f"{extensions.get('x-permission', '-')} | {extensions.get('x-business-summary', operation.get('summary', '-'))} | "
            f"{', '.join(requirements) or '-'} |"
        )
    if handlers:
        matched_handlers = {
            str(handler["operation_id"])
            for method, path, operation in operations
            if (handler := handler_map.get(str(operation.get("operationId") or f"{method.lower()}-{path}")) or handler_route_map.get((method, path)))
        }
        missing = sorted(set(handler_map) - matched_handlers)
        if missing:
            raise DesignError(f"handler operations missing from OpenAPI: {missing}")
    interfaces += ["", "## Schemas", "", "| Name | Required fields | Properties |", "|---|---|---|"]
    for name, schema in sorted(schemas.items()):
        properties = [f"{key}:{value.get('type', ref_name(value))}" for key, value in sorted(schema.get("properties", {}).items())]
        interfaces.append(f"| `{name}` | {', '.join(schema.get('required', [])) or '-'} | {', '.join(properties) or '-'} |")
    return "\n".join(catalog) + "\n", "\n".join(interfaces) + "\n"


def render_api_details(operations: list[dict[str, Any]], samples: dict[str, Any]) -> str:
    lines = ["# API detailed design"]
    for operation in sorted(operations, key=lambda item: (item["path"], item["method"])):
        operation_id = operation["operation_id"]
        lines += ["", f"## {operation['method']} {operation['path']} — `{operation_id}`", ""]
        lines.append(f"- Responsibility: {operation['docstring']}")
        lines.append(f"- Samples: {', '.join(key for key in samples if key.startswith(operation_id + ':')) or '-'}")
        lines += ["", "### Processing steps", ""]
        for index, call in enumerate(operation["calls"], 1):
            lines.append(f"{index}. `{call}`")
        if not operation["calls"]:
            lines.append("1. Direct response")
        lines += ["", "### Error branches and messages", ""]
        if operation["errors"]:
            lines += ["| Case ID | Code | Status | Message ID |", "|---|---|---:|---|"]
            for error in operation["errors"]:
                lines.append(f"| `{error['id']}` | {error['code']} | {error['status_code']} | {error['message_id']} |")
        else:
            lines.append("- No normalized error branch is declared.")
        lines += ["", "### Unit-test perspectives", "", f"- Success response for `{operation_id}`"]
        for error in operation["errors"]:
            lines.append(f"- Error response `{error['id']}` and message `{error['message_id']}`")
    return "\n".join(lines) + "\n"


def error_case_definition(operations: list[dict[str, Any]]) -> str:
    cases = []
    for operation in sorted(operations, key=lambda item: item["operation_id"]):
        for error in operation["errors"]:
            cases.append({"operation_id": operation["operation_id"], **error})
    return json.dumps(
        {"schema_version": 1, "notice": "AUTO-GENERATED. DO NOT EDIT DIRECTLY.", "cases": cases},
        ensure_ascii=False,
        indent=2,
    ) + "\n"


def parse_sql(root: Path) -> tuple[list[dict[str, Any]], dict[str, set[str]]]:
    if sqlglot is None or exp is None:
        raise DesignError("SQLGlot is required for SQL AST analysis")
    queries: list[dict[str, Any]] = []
    matrix: dict[str, set[str]] = defaultdict(set)
    for path in sorted(root.rglob("*.sql")):
        try:
            statements = sqlglot.parse(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise DesignError(f"cannot parse SQL {path}: {exc}") from exc
        for index, statement in enumerate(statements, 1):
            tables = {table.name for table in statement.find_all(exp.Table)}
            target = None
            if isinstance(statement, (exp.Insert, exp.Update, exp.Delete)):
                target_table = statement.this if isinstance(statement.this, exp.Table) else statement.this.find(exp.Table)
                target = target_table.name if isinstance(target_table, exp.Table) else None
            operation = "SELECT"
            letter = "R"
            if isinstance(statement, exp.Insert):
                operation, letter = "INSERT", "C"
            elif isinstance(statement, exp.Update):
                operation, letter = "UPDATE", "U"
            elif isinstance(statement, exp.Delete):
                operation, letter = "DELETE", "D"
            write_columns: set[str] = set()
            if isinstance(statement, exp.Insert) and isinstance(statement.this, exp.Schema):
                write_columns.update(identifier.name for identifier in statement.this.expressions if isinstance(identifier, exp.Identifier))
            elif isinstance(statement, exp.Update):
                for assignment in statement.expressions:
                    if isinstance(assignment, exp.EQ) and isinstance(assignment.this, exp.Column):
                        write_columns.add(assignment.this.name)
            for table in tables:
                matrix[table].add(letter if table == target else "R")
            relative = path.relative_to(root).with_suffix("").as_posix().replace("/", "-")
            queries.append(
                {
                    "id": f"{relative}-{index}",
                    "file": path.relative_to(root).as_posix(),
                    "operation": operation,
                    "letter": letter,
                    "target": target or "-",
                    "tables": sorted(tables),
                    "write_columns": sorted(write_columns),
                }
            )
    return queries, matrix


def operation_queries(operation: dict[str, Any], queries: list[dict[str, Any]], operation_count: int) -> list[dict[str, Any]]:
    references = set(operation.get("sql_files", []))
    matched = [query for query in queries if query["file"] in references or Path(query["file"]).name in references]
    if not references and operation_count == 1:
        return queries
    return matched


def sql_docs(root: Path, operations: list[dict[str, Any]] | None = None) -> tuple[str, str]:
    queries, matrix = parse_sql(root)
    query_lines = ["# Query objects", "", "| Query | File | Operation | Target | Tables |", "|---|---|---|---|---|"]
    for query in queries:
        query_lines.append(f"| `{query['id']}` | `{query['file']}` | {query['operation']} | {query['target']} | {', '.join(query['tables']) or '-'} |")
    crud = ["# CRUD matrix", "", "| Table | C | R | U | D |", "|---|:---:|:---:|:---:|:---:|"]
    for table, letters in sorted(matrix.items()):
        crud.append("| " + table + " | " + " | ".join(letter if letter in letters else "-" for letter in "CRUD") + " |")
    operations = operations or []
    if operations:
        operation_ids = [str(operation["operation_id"]) for operation in operations]
        api_matrix: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
        for operation in operations:
            for query in operation_queries(operation, queries, len(operations)):
                for table in query["tables"]:
                    api_matrix[table][str(operation["operation_id"])].add(query["letter"] if table == query["target"] else "R")
        crud += ["", "## Table by API", "", "| Table | " + " | ".join(operation_ids) + " |", "|---|" + "|".join("---" for _ in operation_ids) + "|"]
        for table in sorted(api_matrix):
            crud.append("| " + table + " | " + " | ".join("".join(sorted(api_matrix[table].get(operation_id, set()), key="CRUD".index)) or "-" for operation_id in operation_ids) + " |")
        clients = sorted({client for operation in operations for client in operation["external_clients"]})
        crud += ["", "## External destination by API", "", "| External destination | " + " | ".join(operation_ids) + " |", "|---|" + "|".join("---" for _ in operation_ids) + "|"]
        for client in clients:
            crud.append("| `" + client + "` | " + " | ".join("X" if client in operation["external_clients"] else "-" for operation in operations) + " |")
        if not clients:
            crud.append("| - | " + " | ".join("-" for _ in operation_ids) + " |")
    return "\n".join(crud) + "\n", "\n".join(query_lines) + "\n"


def ddl_docs(ddl_root: Path, sql_root: Path, operations: list[dict[str, Any]]) -> str:
    """Generate tables, columns, constraints, ER links, and writing APIs from DDL/SQL ASTs."""

    if sqlglot is None or exp is None:
        raise DesignError("SQLGlot is required for DDL AST analysis")
    tables: dict[str, dict[str, Any]] = {}
    relations: set[tuple[str, str, str]] = set()
    for path in sorted(ddl_root.rglob("*.sql")):
        try:
            statements = sqlglot.parse(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise DesignError(f"cannot parse DDL {path}: {exc}") from exc
        for statement in statements:
            if not isinstance(statement, exp.Create) or str(statement.args.get("kind", "")).upper() != "TABLE" or not isinstance(statement.this, exp.Schema):
                continue
            schema = statement.this
            table_name = schema.this.name
            if table_name in tables:
                raise DesignError(f"duplicate CREATE TABLE authority: {table_name}")
            columns: list[dict[str, str]] = []
            constraints: list[str] = []
            for item in schema.expressions:
                if isinstance(item, exp.ColumnDef):
                    kinds = [type(constraint.args.get("kind")).__name__.removesuffix("ColumnConstraint") for constraint in item.args.get("constraints", [])]
                    columns.append({"name": item.this.name, "type": item.args.get("kind").sql(), "constraints": ", ".join(kinds) or "-"})
                else:
                    constraints.append(item.sql())
                    for foreign_key in item.find_all(exp.ForeignKey):
                        reference = foreign_key.args.get("reference")
                        referenced = reference.find(exp.Table) if reference is not None else None
                        local_columns = ",".join(identifier.name for identifier in foreign_key.expressions if isinstance(identifier, exp.Identifier))
                        if isinstance(referenced, exp.Table):
                            relations.add((table_name, local_columns or "-", referenced.name))
            tables[table_name] = {"columns": columns, "constraints": constraints, "source": path.relative_to(ddl_root).as_posix()}

    queries, _ = parse_sql(sql_root)
    writes: dict[tuple[str, str], set[str]] = defaultdict(set)
    for operation in operations:
        for query in operation_queries(operation, queries, len(operations)):
            if query["letter"] not in {"C", "U"} or query["target"] == "-":
                continue
            columns = query["write_columns"] or ["*"]
            for column in columns:
                writes[(query["target"], column)].add(str(operation["operation_id"]))

    lines = ["# Database design", "", "## Tables and columns", "", "| Table | Column | Type | Constraints | DDL source |", "|---|---|---|---|---|"]
    for table_name, table in sorted(tables.items()):
        for column in table["columns"]:
            lines.append(f"| `{table_name}` | `{column['name']}` | `{column['type']}` | {column['constraints']} | `{table['source']}` |")
        if not table["columns"]:
            lines.append(f"| `{table_name}` | - | - | - | `{table['source']}` |")
    lines += ["", "## Table constraints", "", "| Table | Constraint |", "|---|---|"]
    for table_name, table in sorted(tables.items()):
        if table["constraints"]:
            for constraint in table["constraints"]:
                lines.append(f"| `{table_name}` | `{constraint}` |")
        else:
            lines.append(f"| `{table_name}` | - |")
    lines += ["", "## ER relationships", "", "| From table | Columns | To table |", "|---|---|---|"]
    for source, columns, destination in sorted(relations):
        lines.append(f"| `{source}` | `{columns}` | `{destination}` |")
    if not relations:
        lines.append("| - | - | - |")
    lines += ["", "## Column-writing APIs", "", "| Table | Column | APIs |", "|---|---|---|"]
    for (table, column), api_ids in sorted(writes.items()):
        lines.append(f"| `{table}` | `{column}` | {', '.join(sorted(api_ids))} |")
    if not writes:
        lines.append("| - | - | - |")
    return "\n".join(lines) + "\n"


GWT_PATTERN = re.compile(r"^\s*#\s*(Given|When|Then)(?:\([^)]*\))?\s*[:：-]?\s*(.*)$", re.IGNORECASE)


def e2e_scenarios(root: Path) -> str:
    """Generate ordered Given/When/Then scenarios from test-code sections."""

    scenarios: list[dict[str, Any]] = []
    for path in sorted(root.rglob("test*.py")):
        text = path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(text, filename=str(path))
        except SyntaxError as exc:
            raise DesignError(f"cannot parse E2E test {path}: {exc}") from exc
        lines = text.splitlines()
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or not node.name.startswith("test_"):
                continue
            steps: list[tuple[str, str]] = []
            for line in lines[node.lineno - 1 : node.end_lineno or node.lineno]:
                match = GWT_PATTERN.match(line)
                if match:
                    steps.append((match.group(1).title(), match.group(2).strip() or "declared section"))
            if steps:
                if [kind for kind, _ in steps] != ["Given", "When", "Then"]:
                    raise DesignError(f"{path}:{node.name}: E2E sections must be exactly Given, When, Then")
                scenarios.append({"name": node.name, "source": path.relative_to(root).as_posix(), "docstring": (ast.get_docstring(node) or "-").splitlines()[0], "steps": steps})
    result = ["# E2E scenarios"]
    for scenario in scenarios:
        result += ["", f"## `{scenario['name']}`", "", f"- Source: `{scenario['source']}`", f"- Purpose: {scenario['docstring']}", ""]
        for kind, description in scenario["steps"]:
            result.append(f"1. **{kind}**: {description}")
    if not scenarios:
        result += ["", "No declared E2E scenario was found."]
    return "\n".join(result) + "\n"


def evidence_view(path: Path) -> str:
    """Format external test-result references without copying response bodies."""

    document = load_structured(path)
    runs = document.get("runs") if isinstance(document, dict) else None
    if not isinstance(runs, list):
        raise DesignError("test evidence JSON requires a runs array")
    allowed = {"id", "status", "api_response", "db_result", "mock_result"}
    lines = ["# Test evidence view", "", "| Run | Status | API response | DB result | Mock result |", "|---|---|---|---|---|"]
    for run in runs:
        if not isinstance(run, dict) or set(run) - allowed or not all(isinstance(run.get(key, "-"), str) for key in allowed):
            raise DesignError("test evidence entries may contain only string references, not result bodies")
        for key in ["api_response", "db_result", "mock_result"]:
            reference = run.get(key, "-")
            if reference != "-" and not reference.startswith(("https://", "http://", "artifact://", "run://")):
                raise DesignError(f"test evidence {key} must be an external URL or artifact/run reference")
        lines.append(f"| {run.get('id', '-')} | {run.get('status', '-')} | {run.get('api_response', '-')} | {run.get('db_result', '-')} | {run.get('mock_result', '-')} |")
    return "\n".join(lines) + "\n"


def tool_design(root: Path) -> str:
    """Generate CLI arguments, control flow, and function responsibility from Python AST/docstrings."""

    lines = ["# Generator tool design"]
    for path in sorted(root.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as exc:
            raise DesignError(f"cannot parse tool {path}: {exc}") from exc
        arguments: list[str] = []
        functions: list[tuple[str, str, list[str]]] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and display_call(node).endswith("add_argument") and node.args:
                argument = literal(node.args[0])
                if isinstance(argument, str):
                    arguments.append(argument)
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                docstring = ast.get_docstring(node)
                if docstring:
                    collector = RuntimeCallOrder()
                    for statement in node.body:
                        collector.visit(statement)
                    functions.append((node.name, docstring.splitlines()[0], [display_call(call) for call in collector.calls]))
        if not arguments and not functions:
            continue
        lines += ["", f"## `{path.relative_to(root).as_posix()}`", "", f"- CLI arguments: {', '.join(sorted(set(arguments))) or '-'}", "", "| Function | Responsibility | Calls |", "|---|---|---|"]
        for name, responsibility, calls in functions:
            lines.append(f"| `{name}` | {responsibility} | {', '.join(calls) or '-'} |")
    return "\n".join(lines) + "\n"


def cfn_docs(template: dict[str, Any]) -> tuple[str, str]:
    resources = ["# CloudFormation resources", "", "| Logical ID | Type | Condition | DependsOn |", "|---|---|---|---|"]
    for logical_id, resource in sorted(template.get("Resources", {}).items()):
        depends = resource.get("DependsOn", "-")
        if isinstance(depends, list):
            depends = ", ".join(depends)
        resources.append(f"| `{logical_id}` | `{resource.get('Type', '-')}` | {resource.get('Condition', '-')} | {depends} |")
    parameters = ["# CloudFormation parameters", "", "| Name | Type | Default | Allowed values | Description |", "|---|---|---|---|---|"]
    for name, parameter in sorted(template.get("Parameters", {}).items()):
        allowed = parameter.get("AllowedValues", "-")
        if isinstance(allowed, list):
            allowed = ", ".join(map(str, allowed))
        parameters.append(f"| `{name}` | `{parameter.get('Type', '-')}` | {parameter.get('Default', '-')} | {allowed} | {parameter.get('Description', '-')} |")
    return "\n".join(resources) + "\n", "\n".join(parameters) + "\n"


def command_templates(kind: str) -> tuple[str, str]:
    entry = "python .agents/skills/generate-implementation-design/scripts/designflow.py"
    if kind == "fastapi":
        arguments = (
            "fastapi --source-root <source-root> --openapi <openapi.json> "
            "--sql-root <sql-root> [--ddl-root <ddl-root>] [--e2e-root <e2e-root>] "
            "[--tool-root <tool-root>] [--evidence <external-evidence.json>] --out <output>"
        )
    elif kind == "cdk":
        arguments = "cdk --template <template.yaml> --out <output>"
    else:  # pragma: no cover - internal contract
        raise DesignError(f"unsupported generator kind: {kind}")
    generate = f"{entry} {arguments}"
    return generate, generate + " --check"


def generated_banner(kind: str) -> str:
    generate, check = command_templates(kind)
    return (
        "<!-- AUTO-GENERATED. DO NOT EDIT DIRECTLY.\n"
        f"Generate: `{generate}`\n"
        f"Check: `{check}`\n"
        "-->\n\n"
    )


def write_bundle(out: Path, files: dict[str, str], sources: list[tuple[str, Path]], kind: str) -> None:
    repository_root = find_repository_root()
    out, generated_root = validate_output_path(out, repository_root)
    if out.exists():
        validate_managed_bundle(out)
    temporary = Path(tempfile.mkdtemp(prefix=f".{out.name}.candidate-", dir=generated_root))
    backup: Path | None = None
    try:
        generate, check = command_templates(kind)
        manifest = {
            "managed_by": MANAGED_BY,
            "notice": "AUTO-GENERATED. DO NOT EDIT DIRECTLY.",
            "generate_command": generate,
            "check_command": check,
            "schema_version": MANIFEST_SCHEMA_VERSION,
            "sources": [{"path": label, "sha256": sha(path)} for label, path in sorted(set(sources))],
            "generated": sorted(files),
        }
        banner = generated_banner(kind)
        for name, content in files.items():
            if name.endswith(".gen.md"):
                payload = banner + content
            elif name.endswith(".gen.json"):
                try:
                    document = json.loads(content)
                except json.JSONDecodeError as exc:
                    raise DesignError(f"generated JSON is invalid: {name}") from exc
                if document.get("notice") != "AUTO-GENERATED. DO NOT EDIT DIRECTLY.":
                    raise DesignError(f"generated JSON requires a direct-edit notice: {name}")
                payload = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
            else:
                raise DesignError(f"generated file must end with .gen.md or .gen.json: {name}")
            (temporary / name).write_text(payload, encoding="utf-8", newline="\n")
        (temporary / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if out.exists():
            backup = Path(tempfile.mkdtemp(prefix=f".{out.name}.backup-", dir=generated_root))
            backup.rmdir()
            os.replace(out, backup)
        os.replace(temporary, out)
        if backup is not None:
            shutil.rmtree(backup)
            backup = None
    except Exception:
        if backup is not None and backup.exists() and not out.exists():
            os.replace(backup, out)
            backup = None
        raise
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
        if backup is not None and backup.exists():
            shutil.rmtree(backup)


def compare_bundle(expected: Path, actual: Path) -> None:
    expected_files = {path.relative_to(expected) for path in expected.rglob("*") if path.is_file()}
    actual_files = {path.relative_to(actual) for path in actual.rglob("*") if path.is_file()}
    if expected_files != actual_files:
        missing = sorted(map(str, expected_files - actual_files))
        unexpected = sorted(map(str, actual_files - expected_files))
        raise DesignError(f"generated file set drift: missing={missing} unexpected={unexpected}")
    changed = [str(relative) for relative in sorted(expected_files) if (expected / relative).read_bytes() != (actual / relative).read_bytes()]
    if changed:
        raise DesignError("generated design drift: " + ", ".join(changed))


def generate_fastapi(args: argparse.Namespace, out: Path) -> None:
    routers = sorted(args.source_root.rglob("router.py"))
    if not routers:
        raise DesignError("no router.py found")
    function_files = sorted({path.with_name("functions.py") for path in routers})
    missing = [path for path in function_files if not path.is_file()]
    if missing:
        raise DesignError("each router.py requires a sibling functions.py: " + ", ".join(map(str, missing)))
    operations = [operation for path in routers for operation in router_operations(path)]
    openapi = load_structured(args.openapi)
    samples = load_api_samples(args.source_root)
    api, interfaces = openapi_docs(openapi, operations)
    crud, queries = sql_docs(args.sql_root, operations)
    sql_files = sorted(args.sql_root.rglob("*.sql"))
    source_files = sorted(args.source_root.rglob("*.py"))
    sources = (
        [(f"source/{path.relative_to(args.source_root).as_posix()}", path) for path in source_files]
        + [(f"openapi/{args.openapi.name}", args.openapi)]
        + [(f"sql/{path.relative_to(args.sql_root).as_posix()}", path) for path in sql_files]
    )
    files = {
        "SEQUENCES.gen.md": render_sequences(operations),
        "API_CATALOG.gen.md": api,
        "API_DETAILS.gen.md": render_api_details(operations, samples),
        "INTERFACES.gen.md": interfaces,
        "CRUD.gen.md": crud,
        "QUERY_OBJECTS.gen.md": queries,
        "ERROR_CASES.gen.json": error_case_definition(operations),
    }
    if args.ddl_root:
        ddl_files = sorted(args.ddl_root.rglob("*.sql"))
        files["DB_DESIGN.gen.md"] = ddl_docs(args.ddl_root, args.sql_root, operations)
        sources += [(f"ddl/{path.relative_to(args.ddl_root).as_posix()}", path) for path in ddl_files]
    if args.e2e_root:
        e2e_files = sorted(args.e2e_root.rglob("test*.py"))
        files["E2E_SCENARIOS.gen.md"] = e2e_scenarios(args.e2e_root)
        sources += [(f"e2e/{path.relative_to(args.e2e_root).as_posix()}", path) for path in e2e_files]
    if args.tool_root:
        tool_files = sorted(args.tool_root.rglob("*.py"))
        files["TOOLS.gen.md"] = tool_design(args.tool_root)
        sources += [(f"tools/{path.relative_to(args.tool_root).as_posix()}", path) for path in tool_files]
    if args.evidence:
        files["TEST_EVIDENCE.gen.md"] = evidence_view(args.evidence)
        sources.append((f"external-evidence/{args.evidence.name}", args.evidence))
    write_bundle(out, files, sources, "fastapi")


def generate_cdk(args: argparse.Namespace, out: Path) -> None:
    resources, parameters = cfn_docs(load_structured(args.template))
    write_bundle(out, {"RESOURCES.gen.md": resources, "PARAMETERS.gen.md": parameters}, [(f"template/{args.template.name}", args.template)], "cdk")


def build_parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    sub = root.add_subparsers(dest="kind", required=True)
    fastapi = sub.add_parser("fastapi")
    fastapi.add_argument("--source-root", required=True, type=Path)
    fastapi.add_argument("--openapi", required=True, type=Path)
    fastapi.add_argument("--sql-root", required=True, type=Path)
    fastapi.add_argument("--ddl-root", type=Path)
    fastapi.add_argument("--e2e-root", type=Path)
    fastapi.add_argument("--tool-root", type=Path)
    fastapi.add_argument("--evidence", type=Path)
    fastapi.add_argument("--out", required=True, type=Path)
    fastapi.add_argument("--repo-root", type=Path)
    fastapi.add_argument("--check", action="store_true")
    cdk = sub.add_parser("cdk")
    cdk.add_argument("--template", required=True, type=Path)
    cdk.add_argument("--out", required=True, type=Path)
    cdk.add_argument("--repo-root", type=Path)
    cdk.add_argument("--check", action="store_true")
    return root


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        repository_root = (args.repo_root.resolve(strict=True) if args.repo_root else find_repository_root())
        original_cwd = Path.cwd()
        os.chdir(repository_root)
        if args.check:
            actual, generated_root = validate_output_path(args.out, repository_root)
            with tempfile.TemporaryDirectory(prefix=".designflow-check-", dir=generated_root) as directory:
                candidate = Path(directory) / actual.name
                (generate_fastapi if args.kind == "fastapi" else generate_cdk)(args, candidate)
                compare_bundle(candidate, actual)
            print(f"generated design current: {actual}")
        else:
            (generate_fastapi if args.kind == "fastapi" else generate_cdk)(args, args.out)
            print(f"generated design: {args.out}")
        os.chdir(original_cwd)
        return 0
    except (DesignError, OSError, json.JSONDecodeError) as exc:
        if "original_cwd" in locals():
            os.chdir(original_cwd)
        print(f"ERROR: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
