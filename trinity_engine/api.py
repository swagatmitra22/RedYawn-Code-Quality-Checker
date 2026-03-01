from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from trinity_engine.engine import analyze_path, analyze_source

load_dotenv()

app = FastAPI(title="AI Code Quality Trinity API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    path: Optional[str] = Field(default=None, description="Filesystem path to a Python file/folder.")
    code: Optional[str] = Field(default=None, description="Inline Python source.")
    filename: str = Field(default="inline.py")
    use_llm: bool = Field(default=False)
    include_dynamic_profile: bool = Field(default=False)
    run_external_tools: bool = Field(default=True)
    max_suggestions: int = Field(default=5, ge=0, le=20)


@app.get("/health")
def health() -> dict:
    llm_key_present = bool(os.getenv("GROQ_API_KEY"))
    llm_model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    llm_client_installed = True
    try:
        import requests  # noqa: F401
    except Exception:
        llm_client_installed = False
    return {
        "status": "ok",
        "llm": {
            "provider": "groq",
            "api_key_present": llm_key_present,
            "model": llm_model,
            "client_installed": llm_client_installed,
        },
    }


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    if bool(req.path) == bool(req.code):
        raise HTTPException(status_code=400, detail="Provide exactly one of: path or code.")

    try:
        if req.path:
            result = analyze_path(
                req.path,
                use_llm=req.use_llm,
                include_dynamic_profile=req.include_dynamic_profile,
                run_external_tools=req.run_external_tools,
                max_suggestions=req.max_suggestions,
            )
        else:
            result = analyze_source(
                req.code or "",
                filename=req.filename,
                use_llm=req.use_llm,
                max_suggestions=req.max_suggestions,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}") from exc

    return result.to_dict()
