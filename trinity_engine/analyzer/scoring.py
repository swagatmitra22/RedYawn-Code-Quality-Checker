from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Sequence, Tuple

from trinity_engine.models import CorrelationCluster, Issue, ParsedMetrics, TrinityScore

SEVERITY_PENALTY = {
    "critical": 25.0,
    "high": 15.0,
    "medium": 8.0,
    "low": 3.0,
    "info": 1.0,
}

PRIORITY_MULTIPLIER = {
    "critical": 5.0,
    "high": 3.5,
    "medium": 2.0,
    "low": 1.0,
    "info": 0.5,
}


def _grade(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 60:
        return "C"
    if score >= 40:
        return "D"
    return "F"


def _category_score(
    category: str, issues: Sequence[Issue], metrics: ParsedMetrics, base_penalty: float = 0.0
) -> int:
    relevant = [issue for issue in issues if issue.category == category]
    penalty = base_penalty

    for issue in relevant:
        sev_penalty = SEVERITY_PENALTY.get(issue.severity, 8.0)
        impact_penalty = (issue.impact / 100.0) * 12.0
        confidence_factor = max(0.5, min(1.0, issue.confidence))
        penalty += (sev_penalty + impact_penalty) * confidence_factor

    score = max(0, 100 - min(100, int(round(penalty))))
    return int(score)


def compute_trinity_score(
    issues: Sequence[Issue],
    aggregated_metrics: ParsedMetrics,
    perf_weight: float = 0.35,
    energy_weight: float = 0.35,
    sec_weight: float = 0.30,
) -> TrinityScore:
    perf_base = (aggregated_metrics.cyclomatic_complexity / 4.0) + (
        aggregated_metrics.max_loop_depth * 2.0
    )
    energy_base = aggregated_metrics.energy_proxy_score * 0.2
    sec_base = 0.0

    perf_score = _category_score("performance", issues, aggregated_metrics, perf_base)
    energy_score = _category_score("energy", issues, aggregated_metrics, energy_base)
    sec_score = _category_score("security", issues, aggregated_metrics, sec_base)

    overall = int(
        round(perf_weight * perf_score + energy_weight * energy_score + sec_weight * sec_score)
    )
    weighted_breakdown = {
        "performance_weighted": round(perf_weight * perf_score, 2),
        "energy_weighted": round(energy_weight * energy_score, 2),
        "security_weighted": round(sec_weight * sec_score, 2),
        "weights": {
            "performance": perf_weight,
            "energy": energy_weight,
            "security": sec_weight,
        },
    }
    return TrinityScore(
        overall=overall,
        performance=perf_score,
        energy=energy_score,
        security=sec_score,
        grade=_grade(overall),  # type: ignore[arg-type]
        weighted_breakdown=weighted_breakdown,
    )


def rank_issues(issues: Sequence[Issue]) -> List[Issue]:
    def priority(issue: Issue) -> float:
        return (
            PRIORITY_MULTIPLIER.get(issue.severity, 2.0)
            * max(issue.impact, 1)
            * max(0.5, issue.confidence)
        )

    return sorted(issues, key=priority, reverse=True)


def correlate_issues(issues: Sequence[Issue]) -> List[CorrelationCluster]:
    by_file: Dict[str, List[Issue]] = defaultdict(list)
    for issue in issues:
        by_file[issue.file].append(issue)

    clusters: List[CorrelationCluster] = []
    seen_signatures = set()

    for file_path, file_issues in by_file.items():
        sorted_issues = sorted(file_issues, key=lambda i: i.line)
        n = len(sorted_issues)

        for i in range(n):
            anchor = sorted_issues[i]
            nearby = [anchor]
            j = i + 1
            while j < n and sorted_issues[j].line - anchor.line <= 2:
                nearby.append(sorted_issues[j])
                j += 1

            categories = sorted({item.category for item in nearby})
            if len(categories) < 2:
                continue

            lines = sorted({item.line for item in nearby})
            rules = sorted({item.rule for item in nearby})
            signature = (file_path, tuple(lines), tuple(rules))
            if signature in seen_signatures:
                continue
            seen_signatures.add(signature)

            combined_impact = min(100, sum(item.impact for item in nearby))
            summary = (
                f"Nearby issues indicate cross-category interaction "
                f"({', '.join(categories)}) around lines {lines[0]}-{lines[-1]}."
            )

            clusters.append(
                CorrelationCluster(
                    file=file_path,
                    lines=lines,
                    categories=categories,  # type: ignore[arg-type]
                    issue_rules=rules,
                    summary=summary,
                    combined_impact=combined_impact,
                )
            )

    return sorted(clusters, key=lambda c: c.combined_impact, reverse=True)
