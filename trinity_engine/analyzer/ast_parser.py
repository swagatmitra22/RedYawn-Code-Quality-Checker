from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Set, Tuple

from trinity_engine.models import ParsedMetrics

IO_CALL_PREFIXES = (
    "open",
    "pathlib.Path.open",
    "os.read",
    "os.write",
    "json.load",
    "json.dump",
    "pickle.load",
    "pickle.loads",
    "pickle.dump",
    "sqlite3.connect",
    "cursor.execute",
)

NETWORK_CALL_PREFIXES = (
    "requests.",
    "urllib.",
    "httpx.",
    "aiohttp.",
    "socket.",
)

ALLOCATION_CALLS = {
    "list",
    "dict",
    "set",
    "tuple",
    "bytearray",
}

CONTROL_FLOW_NODES = (
    ast.If,
    ast.For,
    ast.AsyncFor,
    ast.While,
    ast.Try,
    ast.With,
    ast.AsyncWith,
    ast.Match,
)


def _call_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _call_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    if isinstance(node, ast.Call):
        return _call_name(node.func)
    return ""


def _compute_loc(code: str) -> int:
    loc = 0
    for line in code.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            loc += 1
    return loc


def _line_snippet(lines: Sequence[str], lineno: int, window: int = 1) -> str:
    start = max(0, lineno - 1 - window)
    end = min(len(lines), lineno + window)
    return "\n".join(lines[start:end])


@dataclass
class ParseContext:
    file_path: str
    code: str
    tree: ast.AST
    lines: List[str]
    metrics: ParsedMetrics
    function_ranges: Dict[str, Tuple[int, int]] = field(default_factory=dict)
    function_complexity: Dict[str, int] = field(default_factory=dict)
    recursive_functions: Set[str] = field(default_factory=set)
    loop_lines: List[int] = field(default_factory=list)
    nested_loop_lines: List[int] = field(default_factory=list)
    while_true_lines: List[int] = field(default_factory=list)
    io_in_loop_lines: List[int] = field(default_factory=list)
    network_in_loop_lines: List[int] = field(default_factory=list)
    allocation_in_loop_lines: List[int] = field(default_factory=list)
    len_in_loop_lines: List[int] = field(default_factory=list)
    string_concat_in_loop_lines: List[int] = field(default_factory=list)

    def snippet_at(self, lineno: int, window: int = 1) -> str:
        return _line_snippet(self.lines, lineno, window)


class _TrinityVisitor(ast.NodeVisitor):
    def __init__(self, file_path: str, code: str) -> None:
        self.code = code
        self.lines = code.splitlines()
        self.ctx = ParseContext(
            file_path=file_path,
            code=code,
            tree=ast.parse(code, filename=file_path),
            lines=self.lines,
            metrics=ParsedMetrics(loc=_compute_loc(code)),
        )
        self._function_stack: List[str] = []
        self._loop_depth = 0
        self._nesting_depth = 0
        self._decision_stack: List[int] = []

    def build(self) -> ParseContext:
        self.visit(self.ctx.tree)
        self.ctx.metrics.cyclomatic_complexity = 1 + self.ctx.metrics.decision_points
        self.ctx.metrics.max_loop_depth = max(self.ctx.metrics.max_loop_depth, 0)
        self.ctx.metrics.max_nesting_depth = max(self.ctx.metrics.max_nesting_depth, 0)
        self.ctx.metrics.recursion_count = len(self.ctx.recursive_functions)
        return self.ctx

    def _in_loop(self) -> bool:
        return self._loop_depth > 0

    def _push_nesting(self) -> None:
        self._nesting_depth += 1
        self.ctx.metrics.max_nesting_depth = max(
            self.ctx.metrics.max_nesting_depth, self._nesting_depth
        )

    def _pop_nesting(self) -> None:
        self._nesting_depth = max(0, self._nesting_depth - 1)

    def _record_decision(self) -> None:
        self.ctx.metrics.decision_points += 1
        if self._function_stack:
            fn = self._function_stack[-1]
            self.ctx.function_complexity[fn] = self.ctx.function_complexity.get(fn, 1) + 1

    def visit_Import(self, node: ast.Import) -> None:
        self.ctx.metrics.import_count += 1
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        self.ctx.metrics.import_count += 1
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.ctx.metrics.class_count += 1
        self._push_nesting()
        self.generic_visit(node)
        self._pop_nesting()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.ctx.metrics.function_count += 1
        start = getattr(node, "lineno", 0)
        end = getattr(node, "end_lineno", start)
        self.ctx.function_ranges[node.name] = (start, end)
        self.ctx.function_complexity.setdefault(node.name, 1)
        self._function_stack.append(node.name)
        self._push_nesting()
        self.generic_visit(node)
        self._pop_nesting()
        self._function_stack.pop()

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.visit_FunctionDef(node)  # pragma: no cover - same logic path

    def visit_For(self, node: ast.For) -> None:
        self.ctx.metrics.loop_count += 1
        self.ctx.loop_lines.append(node.lineno)
        self._record_decision()
        self._loop_depth += 1
        self.ctx.metrics.max_loop_depth = max(
            self.ctx.metrics.max_loop_depth, self._loop_depth
        )
        if self._loop_depth >= 2:
            self.ctx.nested_loop_lines.append(node.lineno)
        self._push_nesting()
        self.generic_visit(node)
        self._pop_nesting()
        self._loop_depth -= 1

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self.visit_For(node)  # pragma: no cover - same logic path

    def visit_While(self, node: ast.While) -> None:
        self.ctx.metrics.loop_count += 1
        self.ctx.loop_lines.append(node.lineno)
        self._record_decision()
        if isinstance(node.test, ast.Constant) and node.test.value is True:
            self.ctx.while_true_lines.append(node.lineno)
        self._loop_depth += 1
        self.ctx.metrics.max_loop_depth = max(
            self.ctx.metrics.max_loop_depth, self._loop_depth
        )
        if self._loop_depth >= 2:
            self.ctx.nested_loop_lines.append(node.lineno)
        self._push_nesting()
        self.generic_visit(node)
        self._pop_nesting()
        self._loop_depth -= 1

    def visit_If(self, node: ast.If) -> None:
        self._record_decision()
        self._push_nesting()
        self.generic_visit(node)
        self._pop_nesting()

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        if len(node.values) > 1:
            self._record_decision()
        self.generic_visit(node)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        self._record_decision()
        self.generic_visit(node)

    def visit_Try(self, node: ast.Try) -> None:
        self._record_decision()
        self._push_nesting()
        self.generic_visit(node)
        self._pop_nesting()

    def visit_Call(self, node: ast.Call) -> None:
        self.ctx.metrics.call_count += 1
        call = _call_name(node.func)

        if self._function_stack and call == self._function_stack[-1]:
            self.ctx.recursive_functions.add(call)

        if any(call.startswith(prefix) for prefix in IO_CALL_PREFIXES):
            self.ctx.metrics.io_call_count += 1
            if self._in_loop():
                self.ctx.io_in_loop_lines.append(node.lineno)

        if any(call.startswith(prefix) for prefix in NETWORK_CALL_PREFIXES):
            self.ctx.metrics.network_call_count += 1
            if self._in_loop():
                self.ctx.network_in_loop_lines.append(node.lineno)

        if call in ALLOCATION_CALLS and self._in_loop():
            self.ctx.metrics.allocation_in_loop_count += 1
            self.ctx.allocation_in_loop_lines.append(node.lineno)

        if call == "len" and self._in_loop():
            self.ctx.metrics.len_in_loop_count += 1
            self.ctx.len_in_loop_lines.append(node.lineno)

        self.generic_visit(node)

    def visit_ListComp(self, node: ast.ListComp) -> None:
        if self._in_loop():
            self.ctx.metrics.allocation_in_loop_count += 1
            self.ctx.allocation_in_loop_lines.append(node.lineno)
        self.generic_visit(node)

    def visit_SetComp(self, node: ast.SetComp) -> None:
        self.visit_ListComp(node)  # pragma: no cover - same logic path

    def visit_DictComp(self, node: ast.DictComp) -> None:
        self.visit_ListComp(node)  # pragma: no cover - same logic path

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        if self._in_loop() and isinstance(node.op, ast.Add):
            self.ctx.metrics.string_concat_in_loop_count += 1
            self.ctx.string_concat_in_loop_lines.append(node.lineno)
        self.generic_visit(node)


def parse_source(code: str, file_path: str = "<memory>") -> ParseContext:
    visitor = _TrinityVisitor(file_path=file_path, code=code)
    return visitor.build()


def parse_file(path: str | Path) -> ParseContext:
    path_obj = Path(path)
    code = path_obj.read_text(encoding="utf-8")
    return parse_source(code, str(path_obj))


def python_files_from_target(target: str | Path) -> List[Path]:
    target_path = Path(target)
    if target_path.is_file():
        return [target_path] if target_path.suffix == ".py" else []
    files = sorted(p for p in target_path.rglob("*.py") if p.is_file())
    return files
