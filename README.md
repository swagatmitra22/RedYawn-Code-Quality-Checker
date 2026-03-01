# AI Code Quality Trinity Engine

This repository now includes a robust Python backend analyzer for:

- Performance smells
- Energy inefficiencies
- Security vulnerabilities
- Unified Trinity scoring
- Correlation of cross-category hotspots
- Optional Groq-based fix suggestions

## Quick Start

1. Install Python dependencies:

```bash
pip install -r requirements.txt
```

2. Run CLI analysis:

```bash
python main.py path/to/project --json-out report.json
```

3. Enable Groq suggestions:

```bash
echo GROQ_API_KEY=YOUR_KEY>>.env
echo GROQ_MODEL=llama-3.3-70b-versatile>>.env
python main.py path/to/project --use-llm
```

4. Start API server:

```bash
uvicorn trinity_engine.api:app --reload
```

Check backend + LLM readiness:

```bash
curl http://127.0.0.1:8000/health
```

5. Start Streamlit dashboard:

```bash
streamlit run trinity_engine/app/dashboard.py
```

## Frontend + Backend Integration

The React UI now tries backend analysis first via:

- `VITE_TRINITY_API_URL` (default: `http://127.0.0.1:8000`)

If the backend is unreachable, the UI falls back to its in-browser heuristic analyzer.

## CLI Options

- `--use-llm`: Enable Groq suggestions
  Uses `GROQ_API_KEY` from `.env`/environment.
- `--dynamic-profile`: Enable pyinstrument runtime profiling
- `--no-external-tools`: Disable `bandit` and `semgrep`
- `--json-out`: Save full report to JSON

## Notes

- Python is the current production-ready analysis target.
- External tools (`radon`, `bandit`, `semgrep`, `pyinstrument`) are auto-detected and degrade gracefully if missing.
- The existing Vite/React frontend remains in the repo; backend analysis is now provided by the Python engine.

## Groq Reliability

- Put `GROQ_API_KEY` in `.env` and restart `uvicorn` after any `.env` change.
- If you see rule-based fallback, inspect warnings in UI or JSON output.
- Common cause: free-tier quota/rate-limit (HTTP 429). In that case:
  - Wait for quota reset or reduce request frequency.
  - Lower `max_suggestions` in API calls.
  - Enable billing/paid quota in your Groq project if needed.
- Optional: set `GROQ_MODEL` in `.env` to override default model selection.
