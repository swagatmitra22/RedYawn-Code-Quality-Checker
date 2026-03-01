import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { AnalysisStage } from '../types';

const STAGES: Array<{ key: AnalysisStage; label: string; icon: string; desc: string }> = [
  { key: 'parsing', label: 'AST Parser', icon: '🔵', desc: 'Building syntax tree...' },
  { key: 'performance', label: 'Performance Analyzer', icon: '⚡', desc: 'Detecting smell patterns...' },
  { key: 'energy', label: 'Energy Estimator', icon: '🔋', desc: 'Computing energy proxy score...' },
  { key: 'security', label: 'Security Scanner', icon: '🛡️', desc: 'Running SAST rules...' },
  { key: 'scoring', label: 'Trinity Scoring', icon: '📊', desc: 'Calculating unified scores...' },
  { key: 'llm', label: 'AI Suggestion Engine', icon: '🤖', desc: 'Generating fixes via Groq LLM...' },
];

const STAGE_ORDER: AnalysisStage[] = ['parsing', 'performance', 'energy', 'security', 'scoring', 'llm', 'done'];

interface Props {
  stage: AnalysisStage;
  llmProgress?: string; // e.g. "2/5"
}

export const AnalysisPipeline: React.FC<Props> = ({ stage, llmProgress }) => {
  const currentIdx = STAGE_ORDER.indexOf(stage);

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-6">
        <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
          Analysis Pipeline Running
        </h3>
      </div>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-slate-700" />
        <div className="space-y-1">
          {STAGES.map((s) => {
            const stageIdx = STAGE_ORDER.indexOf(s.key);
            const isDone = stageIdx < currentIdx || stage === 'done';
            const isActive = stageIdx === currentIdx;

            return (
              <div
                key={s.key}
                className={`flex items-start gap-4 pl-2 py-2.5 rounded-xl transition-all duration-300 ${
                  isActive ? 'bg-violet-500/10' : ''
                }`}
              >
                <div className="relative z-10 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all duration-300"
                  style={{
                    borderColor: isDone ? '#10b981' : isActive ? '#8b5cf6' : '#334155',
                    backgroundColor: isDone ? '#10b98133' : isActive ? '#8b5cf633' : 'transparent',
                  }}
                >
                  {isDone ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : isActive ? (
                    <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{s.icon}</span>
                    <span
                      className={`text-sm font-medium ${
                        isDone ? 'text-emerald-400' : isActive ? 'text-violet-300' : 'text-slate-500'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {isActive && (
                    <p className="text-xs text-slate-400 mt-0.5 ml-6">
                      {s.key === 'llm' && llmProgress
                        ? `Generating fix ${llmProgress}...`
                        : s.desc}
                    </p>
                  )}
                </div>
                {isDone && (
                  <span className="text-xs text-emerald-500 font-medium">Done</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
