from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Sequence, Tuple

from trinity_engine.analyzer.ast_parser import ParseContext
from trinity_engine.models import Issue


def _load_radon_complexities(file_path: str, code: str) -> Tuple[Dict[str, int], List[str]]:
    warnings: List[str] = []
    try:
        from radon.complexity import cc_visit  # type: ignore
    except Exception:
        warnings.append("radon not installed; falling back to AST decision-point complexity.")
        return {}, warnings

    complexities: Dict[str, int] = {}
    try:
        blocks = cc_visit(code)
        for block in blocks:
            complexities[block.name] = int(block.complexity)
    except Exception as exc:
        warnings.append(f"radon failed for {file_path}: {exc}")
    return complexities, warnings


def _function_line_span(function_range: Tuple[int, int]) -> int:
    start, end = function_range
    return max(0, end - start + 1)


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
        category="performance",
        severity=severity,  # type: ignore[arg-type]
        rule=rule,
        description=description,
        suggestion=suggestion,
        snippet=ctx.snippet_at(line, window=2),
        impact=impact,
        confidence=confidence,
    )


def analyze(contexts: Sequence[ParseContext]) -> Tuple[List[Issue], List[str]]:
    issues: List[Issue] = []
    warnings: List[str] = []

    for ctx in contexts:
        radon_complexity, local_warnings = _load_radon_complexities(ctx.file_path, ctx.code)
        warnings.extend(local_warnings)

        if ctx.metrics.max_loop_depth >= 2:
            for line in sorted(set(ctx.nested_loop_lines)):
                issues.append(
                    _issue(
                        ctx=ctx,
                        line=line,
                        severity="high",
                        rule="PERF-001",
                        description="Nested loop detected; worst-case O(n^2)+ runtime risk.",
                        suggestion="Replace nested loops with indexed lookups (dict/set) or pre-grouping.",
                        impact=82,
                    )
                )

        for fn_name, line_range in ctx.function_ranges.items():
            complexity = radon_complexity.get(fn_name, ctx.function_complexity.get(fn_name, 1))
            span = _function_line_span(line_range)
            start_line = line_range[0]

            if complexity >= 20:
                issues.append(
                    _issue(
                        ctx=ctx,
                        line=start_line,
                        severity="high",
                        rule="PERF-002",
                        description=f"High cyclomatic complexity in `{fn_name}` ({complexity}).",
                        suggestion="Split branch-heavy logic into smaller functions and early-return guards.",
                        impact=70,
                    )
                )
            elif complexity >= 12:
                issues.append(
                    _issue(
                        ctx=ctx,
                        line=start_line,
                        severity="medium",
                        rule="PERF-002",
                        description=f"Moderate complexity in `{fn_name}` ({complexity}).",
                        suggestion="Refactor nested conditionals and isolate decision logic.",
                        impact=48,
                    )
                )

            if span >= 120:
                issues.append(
                    _issue(
                        ctx=ctx,
                        line=start_line,
                        severity="high",
                        rule="PERF-003",
                        description=f"Large method `{fn_name}` ({span} LOC) harms optimization and maintainability.",
                        suggestion="Break the method into cohesive units with single responsibility.",
                        impact=62,
                    )
                )
            elif span >= 70:
                issues.append(
                    _issue(
                        ctx=ctx,
                        line=start_line,
                        severity="medium",
                        rule="PERF-003",
                        description=f"Method `{fn_name}` is long ({span} LOC).",
                        suggestion="Extract helpers and remove mixed concerns from the method.",
                        impact=40,
                    )
                )

        for fn in sorted(ctx.recursive_functions):
            line = ctx.function_ranges.get(fn, (1, 1))[0]
            issues.append(
                _issue(
                    ctx=ctx,
                    line=line,
                    severity="medium",
                    rule="PERF-004",
                    description=f"Recursion detected in `{fn}`; risk of stack overhead and repeated work.",
                    suggestion="Use iterative dynamic programming or memoization where possible.",
                    impact=45,
                    confidence=0.7,
                )
            )

        for line in sorted(set(ctx.io_in_loop_lines)):
            issues.append(
                _issue(
                    ctx=ctx,
                    line=line,
                    severity="high",
                    rule="PERF-005",
                    description="Blocking file/database I/O inside loop can throttle throughput.",
                    suggestion="Batch reads/writes or move I/O outside hot loops.",
                    impact=78,
                )
            )

        for line in sorted(set(ctx.network_in_loop_lines)):
            issues.append(
                _issue(
                    ctx=ctx,
                    line=line,
                    severity="high",
                    rule="PERF-006",
                    description="Network call inside loop causes serial latency amplification.",
                    suggestion="Batch requests, parallelize I/O, and add caching.",
                    impact=80,
                )
            )

        for line in sorted(set(ctx.string_concat_in_loop_lines)):
            issues.append(
                _issue(
                    ctx=ctx,
                    line=line,
                    severity="medium",
                    rule="PERF-007",
                    description="String concatenation in loop can trigger repeated allocations.",
                    suggestion="Accumulate into list and use ''.join(parts) after the loop.",
                    impact=42,
                    confidence=0.68,
                )
            )

        for line in sorted(set(ctx.len_in_loop_lines)):
            issues.append(
                _issue(
                    ctx=ctx,
                    line=line,
                    severity="low",
                    rule="PERF-008",
                    description="Repeated len() call inside loop body.",
                    suggestion="Cache len(collection) before loop when collection is unchanged.",
                    impact=20,
                    confidence=0.66,
                )
            )

        if ctx.metrics.cyclomatic_complexity >= 40:
            issues.append(
                _issue(
                    ctx=ctx,
                    line=1,
                    severity="high",
                    rule="PERF-009",
                    description=(
                        f"File-level complexity is very high ({ctx.metrics.cyclomatic_complexity})."
                    ),
                    suggestion="Reduce branching and split modules by concern.",
                    impact=75,
                )
            )

    return issues, warnings
