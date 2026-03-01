from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Literal

Severity = Literal["critical", "high", "medium", "low", "info"]
Category = Literal["performance", "energy", "security"]


@dataclass
class Issue:
    file: str
    line: int
    category: Category
    severity: Severity
    rule: str
    description: str
    suggestion: str
    snippet: str = ""
    impact: int = 0
    confidence: float = 0.75
    source: str = "internal"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CorrelationCluster:
    file: str
    lines: List[int]
    categories: List[Category]
    issue_rules: List[str]
    summary: str
    combined_impact: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ParsedMetrics:
    loc: int = 0
    function_count: int = 0
    class_count: int = 0
    import_count: int = 0
    call_count: int = 0
    loop_count: int = 0
    max_loop_depth: int = 0
    max_nesting_depth: int = 0
    recursion_count: int = 0
    io_call_count: int = 0
    network_call_count: int = 0
    allocation_in_loop_count: int = 0
    string_concat_in_loop_count: int = 0
    len_in_loop_count: int = 0
    decision_points: int = 0
    cyclomatic_complexity: int = 1
    energy_proxy_score: float = 0.0
    dynamic_runtime_seconds: float | None = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TrinityScore:
    overall: int
    performance: int
    energy: int
    security: int
    grade: Literal["A", "B", "C", "D", "F"]
    weighted_breakdown: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class AISuggestion:
    issue_rule: str
    issue_file: str
    issue_line: int
    model: str
    explanation: str
    fixed_code: str
    improvement_summary: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class AnalysisResult:
    target: str
    language: str
    metrics: ParsedMetrics
    issues: List[Issue] = field(default_factory=list)
    score: TrinityScore | None = None
    correlations: List[CorrelationCluster] = field(default_factory=list)
    suggestions: List[AISuggestion] = field(default_factory=list)
    execution_time_seconds: float = 0.0
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "target": self.target,
            "language": self.language,
            "metrics": self.metrics.to_dict(),
            "issues": [issue.to_dict() for issue in self.issues],
            "score": self.score.to_dict() if self.score else None,
            "correlations": [cluster.to_dict() for cluster in self.correlations],
            "suggestions": [s.to_dict() for s in self.suggestions],
            "execution_time_seconds": self.execution_time_seconds,
            "warnings": self.warnings,
        }
