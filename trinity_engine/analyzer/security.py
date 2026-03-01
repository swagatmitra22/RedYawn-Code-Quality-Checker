from __future__ import annotations

import ast
import json
import re
import subprocess
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

from trinity_engine.analyzer.ast_parser import ParseContext
from trinity_engine.models import Issue

SECRET_NAME_RE = re.compile(r"(password|passwd|pwd|secret|token|api[_-]?key|auth)", re.I)


def _call_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _call_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return ""


def _severity_from_tool(value: str) -> str:
    mapping = {
        "CRITICAL": "critical",
        "HIGH": "high",
        "MEDIUM": "medium",
        "LOW": "low",
        "INFO": "info",
    }
    return mapping.get(value.upper(), "medium")


def _issue(
    *,
    ctx: ParseContext,
    line: int,
    severity: str,
    rule: str,
    description: str,
    suggestion: str,
    impact: int,
    confidence: float = 0.82,
    source: str = "internal",
) -> Issue:
    return Issue(
        file=ctx.file_path,
        line=line,
        category="security",
        severity=severity,  # type: ignore[arg-type]
        rule=rule,
        description=description,
        suggestion=suggestion,
        snippet=ctx.snippet_at(line, window=2),
        impact=impact,
        confidence=confidence,
        source=source,
    )


class _SecurityVisitor(ast.NodeVisitor):
    def __init__(self, ctx: ParseContext) -> None:
        self.ctx = ctx
        self.issues: List[Issue] = []

    def visit_Call(self, node: ast.Call) -> None:
        call = _call_name(node.func)

        if call == "eval":
            self.issues.append(
                _issue(
                    ctx=self.ctx,
                    line=node.lineno,
                    severity="critical",
                    rule="SEC-001",
                    description="Use of eval() allows arbitrary code execution.",
                    suggestion="Replace eval with safe parsers (ast.literal_eval/json.loads).",
                    impact=95,
                )
            )
        elif call == "exec":
            self.issues.append(
                _issue(
                    ctx=self.ctx,
                    line=node.lineno,
                    severity="critical",
                    rule="SEC-002",
                    description="Use of exec() enables remote code execution risks.",
                    suggestion="Avoid exec; use explicit parsing or controlled dispatch.",
                    impact=93,
                )
            )

        if call in {"os.system", "subprocess.call", "subprocess.Popen", "subprocess.run"}:
            shell_true = any(
                kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True
                for kw in node.keywords
            )
            severity = "critical" if shell_true else "high"
            self.issues.append(
                _issue(
                    ctx=self.ctx,
                    line=node.lineno,
                    severity=severity,
                    rule="SEC-003",
                    description="Shell command execution can allow command injection.",
                    suggestion="Use subprocess with shell=False and strict argument allowlists.",
                    impact=92 if shell_true else 80,
                )
            )

        if call in {"hashlib.md5", "md5"}:
            self.issues.append(
                _issue(
                    ctx=self.ctx,
                    line=node.lineno,
                    severity="high",
                    rule="SEC-004",
                    description="Weak crypto hash MD5 used in a security-sensitive context.",
                    suggestion="Use SHA-256 for integrity and argon2/bcrypt for passwords.",
                    impact=74,
                    confidence=0.77,
                )
            )
        if call in {"hashlib.sha1", "sha1"}:
            self.issues.append(
                _issue(
                    ctx=self.ctx,
                    line=node.lineno,
                    severity="high",
                    rule="SEC-005",
                    description="Deprecated SHA-1 hash detected.",
                    suggestion="Upgrade to SHA-256 or stronger.",
                    impact=68,
                    confidence=0.77,
                )
            )

        if call in {"pickle.load", "pickle.loads"}:
            self.issues.append(
                _issue(
                    ctx=self.ctx,
                    line=node.lineno,
                    severity="critical",
                    rule="SEC-006",
                    description="Unsafe pickle deserialization can execute arbitrary code.",
                    suggestion="Use JSON/messagepack for untrusted data.",
                    impact=90,
                )
            )
        if call == "yaml.load":
            uses_safe_loader = any(
                kw.arg == "Loader"
                and isinstance(kw.value, ast.Attribute)
                and kw.value.attr == "SafeLoader"
                for kw in node.keywords
            )
            if not uses_safe_loader:
                self.issues.append(
                    _issue(
                        ctx=self.ctx,
                        line=node.lineno,
                        severity="high",
                        rule="SEC-007",
                        description="yaml.load used without SafeLoader.",
                        suggestion="Use yaml.safe_load or explicitly set SafeLoader.",
                        impact=78,
                    )
                )

        if call.endswith(".execute") and node.args:
            query_arg = node.args[0]
            if isinstance(query_arg, (ast.BinOp, ast.JoinedStr)):
                self.issues.append(
                    _issue(
                        ctx=self.ctx,
                        line=node.lineno,
                        severity="critical",
                        rule="SEC-008",
                        description="Potential SQL injection via string-formatted query.",
                        suggestion="Use parameterized queries with placeholders and bound args.",
                        impact=94,
                    )
                )

        if call.startswith("requests.") and any(
            kw.arg == "verify" and isinstance(kw.value, ast.Constant) and kw.value.value is False
            for kw in node.keywords
        ):
            self.issues.append(
                _issue(
                    ctx=self.ctx,
                    line=node.lineno,
                    severity="high",
                    rule="SEC-009",
                    description="TLS verification disabled in HTTP request.",
                    suggestion="Enable certificate verification or provide trusted CA bundle.",
                    impact=82,
                )
            )

        self.generic_visit(node)

    def visit_Assign(self, node: ast.Assign) -> None:
        for target in node.targets:
            if isinstance(target, ast.Name) and SECRET_NAME_RE.search(target.id):
                if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                    if len(node.value.value) >= 8:
                        self.issues.append(
                            _issue(
                                ctx=self.ctx,
                                line=node.lineno,
                                severity="critical",
                                rule="SEC-010",
                                description="Hardcoded secret/credential detected in source.",
                                suggestion="Move secrets to env vars or secret manager.",
                                impact=91,
                            )
                        )
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        self.generic_visit(node)


def _run_bandit(target: str) -> Tuple[List[Issue], List[str]]:
    cmd = ["bandit", "-f", "json", "-r", target]
    warnings: List[str] = []
    issues: List[Issue] = []

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        return [], ["bandit is not installed; skipping bandit security scan."]
    except Exception as exc:
        return [], [f"bandit failed to execute: {exc}"]

    if proc.returncode not in (0, 1):  # 1 means findings were found
        msg = proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "unknown error"
        return [], [f"bandit execution failed: {msg}"]

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return [], ["bandit returned non-JSON output; skipping bandit findings."]

    for finding in payload.get("results", []):
        file_path = finding.get("filename", target)
        line = int(finding.get("line_number", 1))
        severity = _severity_from_tool(str(finding.get("issue_severity", "MEDIUM")))
        rule = str(finding.get("test_id", "BANDIT"))
        text = str(finding.get("issue_text", "Bandit finding"))
        issues.append(
            Issue(
                file=file_path,
                line=line,
                category="security",
                severity=severity,  # type: ignore[arg-type]
                rule=f"BDT-{rule}",
                description=text,
                suggestion="Review Bandit finding and apply least-privilege secure coding fixes.",
                snippet="",
                impact=55 if severity == "medium" else 75 if severity == "high" else 35,
                confidence=0.9,
                source="bandit",
            )
        )
    return issues, warnings


def _run_semgrep(target: str) -> Tuple[List[Issue], List[str]]:
    cmd = ["semgrep", "--config", "auto", "--json", target]
    warnings: List[str] = []
    issues: List[Issue] = []

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        return [], ["semgrep is not installed; skipping semgrep security scan."]
    except Exception as exc:
        return [], [f"semgrep failed to execute: {exc}"]

    if proc.returncode not in (0, 1):
        msg = proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "unknown error"
        return [], [f"semgrep execution failed: {msg}"]

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return [], ["semgrep returned non-JSON output; skipping semgrep findings."]

    for finding in payload.get("results", []):
        path = str(finding.get("path", target))
        start = finding.get("start", {}) or {}
        line = int(start.get("line", 1))
        extra = finding.get("extra", {}) or {}
        severity = _severity_from_tool(str(extra.get("severity", "MEDIUM")))
        rule = str(extra.get("check_id", "SEMGREP"))
        message = str(extra.get("message", "Semgrep finding"))
        issues.append(
            Issue(
                file=path,
                line=line,
                category="security",
                severity=severity,  # type: ignore[arg-type]
                rule=f"SGP-{rule}",
                description=message,
                suggestion="Review Semgrep finding and apply rule-specific secure coding fix.",
                snippet="",
                impact=58 if severity == "medium" else 78 if severity == "high" else 36,
                confidence=0.88,
                source="semgrep",
            )
        )
    return issues, warnings


def analyze(
    contexts: Sequence[ParseContext],
    target: str,
    run_external_tools: bool = True,
) -> Tuple[List[Issue], List[str]]:
    issues: List[Issue] = []
    warnings: List[str] = []

    for ctx in contexts:
        visitor = _SecurityVisitor(ctx)
        visitor.visit(ctx.tree)
        issues.extend(visitor.issues)

    if run_external_tools:
        bandit_issues, bandit_warnings = _run_bandit(target)
        semgrep_issues, semgrep_warnings = _run_semgrep(target)
        issues.extend(bandit_issues)
        issues.extend(semgrep_issues)
        warnings.extend(bandit_warnings)
        warnings.extend(semgrep_warnings)

    return issues, warnings
