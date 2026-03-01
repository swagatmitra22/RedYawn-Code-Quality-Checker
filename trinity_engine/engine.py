from __future__ import annotations

import time
from pathlib import Path
from typing import List, Sequence

from trinity_engine.analyzer import energy, performance, scoring, security
from trinity_engine.analyzer.ast_parser import (
    ParseContext,
    parse_file,
    parse_source,
    python_files_from_target,
)
from trinity_engine.models import AISuggestion, AnalysisResult, Issue, ParsedMetrics


def _dedupe_issues(issues: Sequence[Issue]) -> List[Issue]:
    seen = set()
    deduped: List[Issue] = []
    for issue in issues:
        key = (issue.file, issue.line, issue.rule, issue.category, issue.source)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(issue)
    return deduped


def _dedupe_strings(items: Sequence[str]) -> List[str]:
    seen = set()
    deduped: List[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    return deduped


def _aggregate_metrics(contexts: Sequence[ParseContext]) -> ParsedMetrics:
    agg = ParsedMetrics()
    if not contexts:
        return agg

    for ctx in contexts:
        m = ctx.metrics
        agg.loc += m.loc
        agg.function_count += m.function_count
        agg.class_count += m.class_count
        agg.import_count += m.import_count
        agg.call_count += m.call_count
        agg.loop_count += m.loop_count
        agg.max_loop_depth = max(agg.max_loop_depth, m.max_loop_depth)
        agg.max_nesting_depth = max(agg.max_nesting_depth, m.max_nesting_depth)
        agg.recursion_count += m.recursion_count
        agg.io_call_count += m.io_call_count
        agg.network_call_count += m.network_call_count
        agg.allocation_in_loop_count += m.allocation_in_loop_count
        agg.string_concat_in_loop_count += m.string_concat_in_loop_count
        agg.len_in_loop_count += m.len_in_loop_count
        agg.decision_points += m.decision_points
        agg.cyclomatic_complexity += m.cyclomatic_complexity
        agg.energy_proxy_score += m.energy_proxy_score

    agg.cyclomatic_complexity = max(1, agg.cyclomatic_complexity - (len(contexts) - 1))
    agg.energy_proxy_score = round(agg.energy_proxy_score / len(contexts), 2)

    runtime_values = [
        ctx.metrics.dynamic_runtime_seconds
        for ctx in contexts
        if ctx.metrics.dynamic_runtime_seconds is not None
    ]
    if runtime_values:
        agg.dynamic_runtime_seconds = round(sum(runtime_values), 3)
    return agg


def analyze_source(
    code: str,
    filename: str = "<memory>.py",
    *,
    use_llm: bool = False,
    max_suggestions: int = 5,
) -> AnalysisResult:
    started = time.perf_counter()
    warnings: List[str] = []

    ctx = parse_source(code, filename)
    contexts = [ctx]

    perf_issues, perf_warnings = performance.analyze(contexts)
    energy_issues, energy_warnings = energy.analyze(contexts, include_dynamic_profile=False)
    security_issues, security_warnings = security.analyze(
        contexts, target=filename, run_external_tools=False
    )

    warnings.extend(perf_warnings)
    warnings.extend(energy_warnings)
    warnings.extend(security_warnings)

    ranked_issues = scoring.rank_issues(
        _dedupe_issues(perf_issues + energy_issues + security_issues)
    )
    metrics = _aggregate_metrics(contexts)
    trinity_score = scoring.compute_trinity_score(ranked_issues, metrics)
    correlations = scoring.correlate_issues(ranked_issues)

    suggestions: List[AISuggestion] = []
    if ranked_issues:
        from trinity_engine.llm.suggestion_engine import (
            generate_rule_suggestions,
            generate_suggestions,
        )

        if use_llm:
            suggestions, llm_warnings = generate_suggestions(
                ranked_issues, max_items=max_suggestions
            )
            warnings.extend(llm_warnings)
        else:
            suggestions = generate_rule_suggestions(ranked_issues, max_items=max_suggestions)

    elapsed = round(time.perf_counter() - started, 3)
    return AnalysisResult(
        target=filename,
        language="Python",
        metrics=metrics,
        issues=ranked_issues,
        score=trinity_score,
        correlations=correlations,
        suggestions=suggestions,
        execution_time_seconds=elapsed,
        warnings=_dedupe_strings(warnings),
    )


def analyze_path(
    target: str,
    *,
    use_llm: bool = False,
    include_dynamic_profile: bool = False,
    run_external_tools: bool = True,
    max_suggestions: int = 5,
) -> AnalysisResult:
    started = time.perf_counter()
    warnings: List[str] = []
    contexts: List[ParseContext] = []

    files = python_files_from_target(target)
    if not files:
        raise ValueError(f"No Python files found at target: {target}")

    for path in files:
        try:
            contexts.append(parse_file(path))
        except SyntaxError as exc:
            warnings.append(f"SyntaxError in {path}: {exc}")
        except UnicodeDecodeError:
            warnings.append(f"Could not decode {path} as UTF-8; skipping file.")
        except Exception as exc:
            warnings.append(f"Failed to parse {path}: {exc}")

    if not contexts:
        raise ValueError("No parseable Python files were found.")

    perf_issues, perf_warnings = performance.analyze(contexts)
    energy_issues, energy_warnings = energy.analyze(
        contexts, include_dynamic_profile=include_dynamic_profile
    )
    security_issues, security_warnings = security.analyze(
        contexts, target=target, run_external_tools=run_external_tools
    )

    warnings.extend(perf_warnings)
    warnings.extend(energy_warnings)
    warnings.extend(security_warnings)

    all_issues = _dedupe_issues(perf_issues + energy_issues + security_issues)
    ranked_issues = scoring.rank_issues(all_issues)
    metrics = _aggregate_metrics(contexts)
    trinity_score = scoring.compute_trinity_score(ranked_issues, metrics)
    correlations = scoring.correlate_issues(ranked_issues)

    suggestions: List[AISuggestion] = []
    if ranked_issues:
        from trinity_engine.llm.suggestion_engine import (
            generate_rule_suggestions,
            generate_suggestions,
        )

        if use_llm:
            suggestions, llm_warnings = generate_suggestions(
                ranked_issues,
                max_items=max_suggestions,
            )
            warnings.extend(llm_warnings)
        else:
            suggestions = generate_rule_suggestions(ranked_issues, max_items=max_suggestions)

    elapsed = round(time.perf_counter() - started, 3)
    return AnalysisResult(
        target=str(Path(target)),
        language="Python",
        metrics=metrics,
        issues=ranked_issues,
        score=trinity_score,
        correlations=correlations,
        suggestions=suggestions,
        execution_time_seconds=elapsed,
        warnings=_dedupe_strings(warnings),
    )
