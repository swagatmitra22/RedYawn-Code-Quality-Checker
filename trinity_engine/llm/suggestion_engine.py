from __future__ import annotations

import json
import os
import time
from typing import List, Sequence, Tuple

from dotenv import load_dotenv
from trinity_engine.models import AISuggestion, Issue

load_dotenv()

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "llama-3.3-70b-versatile"
FALLBACK_MODELS = ("llama-3.3-70b-versatile", "llama-3.1-8b-instant")
MAX_RETRIES = 2
RETRY_SLEEP_SECONDS = (1.5, 3.0)


def _sanitize_json(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[len("```json") :].strip()
    if cleaned.startswith("```"):
        cleaned = cleaned[len("```") :].strip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].strip()
    return cleaned


def _extract_first_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escape = False

    for idx, ch in enumerate(text[start:], start=start):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue
        if ch == "{":
            depth += 1
            continue
        if ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]

    return None


def _parse_llm_json(text: str) -> dict:
    cleaned = _sanitize_json(text)
    candidates = [cleaned]
    extracted = _extract_first_json_object(cleaned)
    if extracted and extracted not in candidates:
        candidates.append(extracted)

    last_error = "invalid JSON response"
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
            last_error = "JSON root is not an object"
        except Exception as exc:
            last_error = str(exc)

    raise RuntimeError(f"Invalid JSON from Groq: {last_error}")


def _build_prompt(issue: Issue) -> str:
    return f"""
You are a senior code reviewer focused on performance, energy efficiency, and security.
Given the issue below, propose a robust production-ready fix.

Issue category: {issue.category}
Rule: {issue.rule}
Severity: {issue.severity}
File: {issue.file}
Line: {issue.line}
Description: {issue.description}
Recommendation: {issue.suggestion}
Code snippet:
```python
{issue.snippet}
```

Return strict JSON only:
{{
  "explanation": "2-3 concise sentences",
  "fixed_code": "3-20 lines of improved Python code",
  "improvement_summary": "One sentence with quantified/qualitative impact"
}}
""".strip()


def _is_retryable_error(message: str) -> bool:
    lowered = message.lower()
    keywords = (
        "429",
        "rate",
        "quota",
        "too many requests",
        "timeout",
        "deadline",
        "temporarily unavailable",
        "connection",
        "unavailable",
        "502",
        "503",
        "504",
        "500",
    )
    return any(keyword in lowered for keyword in keywords)


def _is_retryable_generation_error(message: str) -> bool:
    if _is_retryable_error(message):
        return True
    lowered = message.lower()
    json_keywords = (
        "invalid json",
        "expecting",
        "unterminated",
        "delimiter",
        "jsondecodeerror",
    )
    return any(keyword in lowered for keyword in json_keywords)


def _compact_error(message: str) -> str:
    lowered = message.lower()
    if "429" in lowered or "quota" in lowered or "rate" in lowered:
        return "Groq quota/rate limit exceeded (HTTP 429)."
    if "api key" in lowered or "credential" in lowered or "permission" in lowered:
        return "Groq API key is invalid or not authorized."
    if "timeout" in lowered or "deadline" in lowered:
        return "Groq request timed out."
    if "connection" in lowered or "network" in lowered:
        return "Network error while contacting Groq."
    return message.splitlines()[0][:220]


def _post_groq_completion(api_key: str, model: str, prompt: str) -> str:
    try:
        import requests  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "requests package is required for Groq suggestions. Install dependencies from requirements.txt."
        ) from exc

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a strict JSON API that returns only valid compact JSON. "
                    "Never include markdown."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 900,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    response = requests.post(
        GROQ_API_URL,
        headers=headers,
        json=payload,
        timeout=45,
    )

    if response.status_code >= 400:
        body = response.text.strip()
        body_preview = body[:400] if body else "no body"
        raise RuntimeError(f"HTTP {response.status_code}: {body_preview}")

    data = response.json()
    choices = data.get("choices", [])
    if not choices:
        raise RuntimeError("Groq response contained no choices.")
    message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Groq response content was empty.")
    return content


def generate_suggestions(
    prioritized_issues: Sequence[Issue],
    *,
    model_name: str = DEFAULT_MODEL,
    max_items: int = 5,
) -> Tuple[List[AISuggestion], List[str]]:
    warnings: List[str] = []
    issues = list(prioritized_issues[: max(0, max_items)])
    if not issues:
        return [], warnings

    key = os.getenv("GROQ_API_KEY")
    if not key:
        warnings.append(
            "AI fixes unavailable: GROQ_API_KEY is missing in backend environment."
        )
        return [], warnings

    try:
        import requests  # type: ignore  # noqa: F401
    except Exception:
        warnings.append(
            "AI fixes unavailable: Python package 'requests' is not installed."
        )
        return [], warnings

    model_candidates: List[str] = []
    preferred = os.getenv("GROQ_MODEL", model_name).strip()
    if preferred:
        model_candidates.append(preferred)
    for candidate in FALLBACK_MODELS:
        if candidate not in model_candidates:
            model_candidates.append(candidate)

    suggestions: List[AISuggestion] = []
    for issue in issues:
        prompt = _build_prompt(issue)
        suggestion: AISuggestion | None = None
        last_error: str | None = None

        for candidate in model_candidates:
            for attempt in range(MAX_RETRIES + 1):
                try:
                    text = _sanitize_json(_post_groq_completion(key, candidate, prompt))
                    payload = _parse_llm_json(text)
                    suggestion = AISuggestion(
                        issue_rule=issue.rule,
                        issue_file=issue.file,
                        issue_line=issue.line,
                        model=f"Groq ({candidate})",
                        explanation=str(payload.get("explanation", issue.description)),
                        fixed_code=str(payload.get("fixed_code", f"# {issue.suggestion}")),
                        improvement_summary=str(
                            payload.get(
                                "improvement_summary",
                                f"Applying {issue.rule} should reduce {issue.category} risk.",
                            )
                        ),
                    )
                    break
                except Exception as exc:
                    last_error = str(exc)
                    if attempt < MAX_RETRIES and _is_retryable_generation_error(last_error):
                        sleep_idx = min(attempt, len(RETRY_SLEEP_SECONDS) - 1)
                        time.sleep(RETRY_SLEEP_SECONDS[sleep_idx])
                        continue
                    break

            if suggestion:
                break

        if suggestion:
            suggestions.append(suggestion)
        else:
            if last_error:
                warnings.append(
                    f"Groq suggestion failed for {issue.rule} ({issue.file}:{issue.line}): "
                    f"{_compact_error(last_error)}"
                )

    return suggestions, warnings


def generate_rule_suggestions(
    prioritized_issues: Sequence[Issue],
    *,
    max_items: int = 5,
) -> List[AISuggestion]:
    # Legacy compatibility path for callers that explicitly disable LLM usage.
    # Rule-based fix synthesis has been intentionally disabled.
    _ = prioritized_issues[: max(0, max_items)]
    return []
