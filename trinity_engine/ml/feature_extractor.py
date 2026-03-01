from __future__ import annotations

from typing import Dict, Sequence

from trinity_engine.analyzer.ast_parser import ParseContext


FEATURE_ORDER = [
    "loc",
    "function_count",
    "class_count",
    "import_count",
    "call_count",
    "loop_count",
    "max_loop_depth",
    "max_nesting_depth",
    "recursion_count",
    "io_call_count",
    "network_call_count",
    "allocation_in_loop_count",
    "string_concat_in_loop_count",
    "len_in_loop_count",
    "decision_points",
    "cyclomatic_complexity",
    "energy_proxy_score",
]


def extract_features(ctx: ParseContext) -> Dict[str, float]:
    m = ctx.metrics
    return {
        "loc": float(m.loc),
        "function_count": float(m.function_count),
        "class_count": float(m.class_count),
        "import_count": float(m.import_count),
        "call_count": float(m.call_count),
        "loop_count": float(m.loop_count),
        "max_loop_depth": float(m.max_loop_depth),
        "max_nesting_depth": float(m.max_nesting_depth),
        "recursion_count": float(m.recursion_count),
        "io_call_count": float(m.io_call_count),
        "network_call_count": float(m.network_call_count),
        "allocation_in_loop_count": float(m.allocation_in_loop_count),
        "string_concat_in_loop_count": float(m.string_concat_in_loop_count),
        "len_in_loop_count": float(m.len_in_loop_count),
        "decision_points": float(m.decision_points),
        "cyclomatic_complexity": float(m.cyclomatic_complexity),
        "energy_proxy_score": float(m.energy_proxy_score),
    }


def feature_vector(features: Dict[str, float]) -> Sequence[float]:
    return [float(features.get(name, 0.0)) for name in FEATURE_ORDER]
