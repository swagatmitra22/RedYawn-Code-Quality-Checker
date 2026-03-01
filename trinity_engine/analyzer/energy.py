from __future__ import annotations

import ast
import json
import subprocess
import sys
from typing import List, Sequence, Tuple

from trinity_engine.analyzer.ast_parser import ParseContext
from trinity_engine.models import Issue


def _issue(
    *,
    ctx: ParseContext,
    line: int,
    severity: str,
    rule: str,
    description: str,
    suggestion: str,
    impact: int,
    confidence: float = 0.8,
) -> Issue:
    return Issue(
        file=ctx.file_path,
        line=line,
        category="energy",
        severity=severity,  # type: ignore[arg-type]
        rule=rule,
        description=description,
        suggestion=suggestion,
        snippet=ctx.snippet_at(line, window=2),
        impact=impact,
        confidence=confidence,
    )


def estimate_proxy_score(ctx: ParseContext) -> float:
    m = ctx.metrics
    loop_component = m.loop_count * (1 + m.max_loop_depth) * 3.0
    io_component = m.io_call_count * 5.0
    mem_component = m.allocation_in_loop_count * 6.0 + m.string_concat_in_loop_count * 2.0
    cpu_component = (m.decision_points * 1.5) + (m.recursion_count * 8.0)
    network_component = m.network_call_count * 4.0

    raw = loop_component + io_component + mem_component + cpu_component + network_component
    return min(100.0, round(raw, 2))


def _has_sleep_near_line(ctx: ParseContext, line: int, window: int = 8) -> bool:
    start = max(0, line - 1)
    end = min(len(ctx.lines), start + window)
    text = "\n".join(ctx.lines[start:end]).lower()
    return "sleep(" in text or "time.sleep(" in text or "asyncio.sleep(" in text


class _LoopMembershipVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.loop_depth = 0
        self.list_membership_lines: List[int] = []

    def visit_For(self, node: ast.For) -> None:
        self.loop_depth += 1
        self.generic_visit(node)
        self.loop_depth -= 1

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self.visit_For(node)  # pragma: no cover

    def visit_While(self, node: ast.While) -> None:
        self.loop_depth += 1
        self.generic_visit(node)
        self.loop_depth -= 1

    def visit_Compare(self, node: ast.Compare) -> None:
        if self.loop_depth > 0 and node.ops and isinstance(node.ops[0], ast.In):
            comparator = node.comparators[0] if node.comparators else None
            if isinstance(comparator, ast.Name):
                self.list_membership_lines.append(node.lineno)
        self.generic_visit(node)


def _dynamic_profile(file_path: str, timeout_seconds: int = 20) -> Tuple[float | None, str | None]:
    cmd = [
        sys.executable,
        "-m",
        "pyinstrument",
        "--renderer=json",
        file_path,
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except FileNotFoundError:
        return None, "pyinstrument is not installed; skipping dynamic energy profiling."
    except subprocess.TimeoutExpired:
        return None, f"Dynamic profile timed out for {file_path}."
    except Exception as exc:
        return None, f"Dynamic profile failed for {file_path}: {exc}"

    if proc.returncode != 0:
        stderr = proc.stderr.strip()
        message = stderr.splitlines()[-1] if stderr else "unknown pyinstrument error"
        return None, f"Dynamic profile failed for {file_path}: {message}"

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None, f"Dynamic profile returned non-JSON output for {file_path}."

    duration = payload.get("duration")
    if isinstance(duration, (int, float)):
        return float(duration), None
    return None, f"Dynamic profile JSON had no duration for {file_path}."


def analyze(
    contexts: Sequence[ParseContext],
    include_dynamic_profile: bool = False,
) -> Tuple[List[Issue], List[str]]:
    issues: List[Issue] = []
    warnings: List[str] = []

    for ctx in contexts:
        ctx.metrics.energy_proxy_score = estimate_proxy_score(ctx)

        for line in sorted(set(ctx.while_true_lines)):
            has_sleep = _has_sleep_near_line(ctx, line)
            issues.append(
                _issue(
                    ctx=ctx,
                    line=line,
                    severity="medium" if has_sleep else "critical",
                    rule="ENRG-001",
                    description=(
                        "Polling loop with sleep found."
                        if has_sleep
                        else "Busy-wait loop found; this can pin CPU and waste energy."
                    ),
                    suggestion=(
                        "Prefer event-driven waits (queue/select/async await) over polling."
                        if has_sleep
                        else "Add blocking wait primitives or sleep/backoff; avoid spin loops."
                    ),
                    impact=60 if has_sleep else 95,
                )
            )

        if len(ctx.io_in_loop_lines) >= 1:
            severity = "high" if len(ctx.io_in_loop_lines) > 2 else "medium"
            for line in sorted(set(ctx.io_in_loop_lines)):
                issues.append(
                    _issue(
                        ctx=ctx,
                        line=line,
                        severity=severity,
                        rule="ENRG-002",
                        description="I/O operation inside loop increases disk/wait power usage.",
                        suggestion="Buffer writes and batch reads/writes outside the hot loop.",
                        impact=72 if severity == "high" else 54,
                    )
                )

        for line in sorted(set(ctx.allocation_in_loop_lines)):
            issues.append(
                _issue(
                    ctx=ctx,
                    line=line,
                    severity="medium",
                    rule="ENRG-003",
                    description="Object allocations inside loop can increase GC and memory energy.",
                    suggestion="Pre-allocate reusable structures or move allocations outside loop.",
                    impact=50,
                    confidence=0.72,
                )
            )

        for line in sorted(set(ctx.network_in_loop_lines)):
            issues.append(
                _issue(
                    ctx=ctx,
                    line=line,
                    severity="high",
                    rule="ENRG-004",
                    description="Network call inside loop increases radio/network energy overhead.",
                    suggestion="Batch requests, cache responses, and reuse connections/sessions.",
                    impact=74,
                )
            )

        visitor = _LoopMembershipVisitor()
        visitor.visit(ctx.tree)
        for line in sorted(set(visitor.list_membership_lines)):
            issues.append(
                _issue(
                    ctx=ctx,
                    line=line,
                    severity="low",
                    rule="ENRG-005",
                    description="Potential O(n) membership check inside loop.",
                    suggestion="Convert repeated membership target to a set for O(1) lookups.",
                    impact=28,
                    confidence=0.65,
                )
            )

        if include_dynamic_profile:
            runtime, warning = _dynamic_profile(ctx.file_path)
            if warning:
                warnings.append(warning)
            if runtime is not None:
                ctx.metrics.dynamic_runtime_seconds = runtime
                if runtime > 8.0:
                    issues.append(
                        _issue(
                            ctx=ctx,
                            line=1,
                            severity="medium",
                            rule="ENRG-006",
                            description=(
                                f"Dynamic profiling observed high runtime ({runtime:.2f}s)."
                            ),
                            suggestion="Investigate hot paths and reduce repeated loop or I/O work.",
                            impact=46,
                            confidence=0.62,
                        )
                    )

    return issues, warnings
