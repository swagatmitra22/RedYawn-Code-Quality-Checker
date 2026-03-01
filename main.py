from __future__ import annotations

import argparse
import json
from pathlib import Path

from dotenv import load_dotenv

from trinity_engine.engine import analyze_path, analyze_source

load_dotenv()


def _print_summary(payload: dict) -> None:
    score = payload.get("score") or {}
    issues = payload.get("issues") or []
    warnings = payload.get("warnings") or []

    print(f"Target: {payload.get('target')}")
    print(f"Language: {payload.get('language')}")
    print(f"Execution time: {payload.get('execution_time_seconds')}s")
    print(
        "Trinity Score:"
        f" overall={score.get('overall')} grade={score.get('grade')}"
        f" perf={score.get('performance')}"
        f" energy={score.get('energy')}"
        f" security={score.get('security')}"
    )

    print(f"Issues: {len(issues)}")
    for issue in issues[:10]:
        print(
            f"  - [{issue['severity'].upper()}] {issue['rule']} "
            f"{issue['file']}:{issue['line']} -> {issue['description']}"
        )
    if len(issues) > 10:
        print(f"  ... {len(issues) - 10} more")

    if warnings:
        print("Warnings:")
        for warning in warnings:
            print(f"  - {warning}")


def main() -> None:
    parser = argparse.ArgumentParser(description="AI Code Quality Trinity analyzer.")
    parser.add_argument("target", help="Path to Python file/folder OR inline code when --source is set.")
    parser.add_argument(
        "--source",
        action="store_true",
        help="Treat target argument as inline source code string instead of a filesystem path.",
    )
    parser.add_argument(
        "--json-out",
        default="",
        help="Optional output JSON file path.",
    )
    parser.add_argument(
        "--use-llm",
        action="store_true",
        help="Enable Groq suggestions (reads GROQ_API_KEY from .env/environment).",
    )
    parser.add_argument(
        "--max-suggestions",
        type=int,
        default=5,
        help="Maximum number of AI suggestions.",
    )
    parser.add_argument(
        "--dynamic-profile",
        action="store_true",
        help="Enable pyinstrument dynamic profiling (executes target scripts).",
    )
    parser.add_argument(
        "--no-external-tools",
        action="store_true",
        help="Disable bandit/semgrep execution.",
    )
    args = parser.parse_args()

    if args.source:
        result = analyze_source(
            args.target,
            filename="<inline>.py",
            use_llm=args.use_llm,
            max_suggestions=args.max_suggestions,
        )
    else:
        result = analyze_path(
            args.target,
            use_llm=args.use_llm,
            include_dynamic_profile=args.dynamic_profile,
            run_external_tools=not args.no_external_tools,
            max_suggestions=args.max_suggestions,
        )

    payload = result.to_dict()
    _print_summary(payload)

    if args.json_out:
        out_path = Path(args.json_out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"Saved JSON report: {out_path}")


if __name__ == "__main__":
    main()
