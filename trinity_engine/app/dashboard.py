from __future__ import annotations

import json

import pandas as pd
import streamlit as st

from trinity_engine.engine import analyze_path, analyze_source

st.set_page_config(page_title="AI Code Quality Trinity", page_icon="🧠", layout="wide")

st.title("🧠 AI Code Quality Trinity")
st.caption("Unified analysis for performance, energy, and security smells.")

mode = st.radio("Input Mode", options=["Path", "Paste Code"], horizontal=True)

use_llm = st.checkbox("Enable Groq suggestions", value=False)
include_dynamic = st.checkbox("Enable dynamic profiling (executes code)", value=False)
run_external = st.checkbox("Use bandit + semgrep (if installed)", value=True)

if mode == "Path":
    target = st.text_input("Python file/folder path", value=".")
else:
    target = st.text_area("Paste Python code", height=320)

run = st.button("Run Trinity Analysis", type="primary")

if run:
    with st.spinner("Analyzing..."):
        try:
            if mode == "Path":
                result = analyze_path(
                    target,
                    use_llm=use_llm,
                    include_dynamic_profile=include_dynamic,
                    run_external_tools=run_external,
                )
            else:
                result = analyze_source(
                    target,
                    filename="inline.py",
                    use_llm=use_llm,
                )
        except Exception as exc:
            st.error(f"Analysis failed: {exc}")
            st.stop()

    payload = result.to_dict()
    score = payload.get("score", {})
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Overall", score.get("overall"))
    c2.metric("Performance", score.get("performance"))
    c3.metric("Energy", score.get("energy"))
    c4.metric("Security", score.get("security"))

    st.markdown(f"**Grade:** `{score.get('grade')}`")
    st.markdown(f"**Execution Time:** `{payload.get('execution_time_seconds')}s`")

    issues = payload.get("issues", [])
    st.subheader(f"Issues ({len(issues)})")
    if issues:
        df = pd.DataFrame(issues)
        display_cols = ["severity", "category", "rule", "file", "line", "description", "source", "impact"]
        st.dataframe(df[display_cols], use_container_width=True)
    else:
        st.success("No issues detected.")

    correlations = payload.get("correlations", [])
    if correlations:
        st.subheader("Correlated Hotspots")
        st.dataframe(pd.DataFrame(correlations), use_container_width=True)

    suggestions = payload.get("suggestions", [])
    if suggestions:
        st.subheader("AI Suggestions")
        for suggestion in suggestions:
            st.markdown(
                f"**{suggestion['issue_rule']}** - `{suggestion['issue_file']}:{suggestion['issue_line']}`"
            )
            st.write(suggestion["explanation"])
            st.code(suggestion["fixed_code"], language="python")
            st.caption(suggestion["improvement_summary"])

    warnings = payload.get("warnings", [])
    if warnings:
        st.subheader("Warnings")
        for warning in warnings:
            st.warning(warning)

    st.subheader("JSON Output")
    st.code(json.dumps(payload, indent=2), language="json")
