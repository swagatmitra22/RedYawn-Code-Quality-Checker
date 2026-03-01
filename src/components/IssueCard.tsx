import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Zap, Shield, Gauge, Cpu, Lightbulb } from 'lucide-react';
import type { SmellIssue, AISuggestion } from '../types';

const SEVERITY_STYLES: Record<string, { badge: string; border: string; dot: string }> = {
  critical: {
    badge: 'bg-red-500/20 text-red-400 border border-red-500/30',
    border: 'border-l-red-500',
    dot: 'bg-red-500',
  },
  high: {
    badge: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
    border: 'border-l-orange-500',
    dot: 'bg-orange-500',
  },
  medium: {
    badge: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    border: 'border-l-yellow-500',
    dot: 'bg-yellow-500',
  },
  low: {
    badge: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    border: 'border-l-blue-400',
    dot: 'bg-blue-400',
  },
  info: {
    badge: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
    border: 'border-l-slate-500',
    dot: 'bg-slate-500',
  },
};

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  performance: <Gauge className="w-4 h-4 text-violet-400" />,
  energy: <Zap className="w-4 h-4 text-emerald-400" />,
  security: <Shield className="w-4 h-4 text-red-400" />,
};

const CATEGORY_COLOR: Record<string, string> = {
  performance: 'text-violet-400',
  energy: 'text-emerald-400',
  security: 'text-red-400',
};

interface IssueCardProps {
  issue: SmellIssue;
  suggestion?: AISuggestion;
  index: number;
}

export const IssueCard: React.FC<IssueCardProps> = ({ issue, suggestion, index }) => {
  const [expanded, setExpanded] = useState(false);
  const styles = SEVERITY_STYLES[issue.severity];
  const impact = issue.perfImpact ?? issue.energyImpact ?? issue.securityImpact ?? 0;

  return (
    <div
      className={`bg-slate-800/60 border border-slate-700/50 border-l-4 ${styles.border} rounded-xl overflow-hidden transition-all duration-200`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-slate-700/30 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-shrink-0 mt-0.5">
          <div className={`w-2 h-2 rounded-full mt-1.5 ${styles.dot}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="flex items-center gap-1.5 font-mono text-xs text-slate-500">
              {CATEGORY_ICON[issue.category]}
              <span className={CATEGORY_COLOR[issue.category]}>{issue.rule}</span>
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles.badge}`}>
              {issue.severity.toUpperCase()}
            </span>
            <span className="text-xs text-slate-500">Line {issue.line}</span>
            {impact > 0 && (
              <span className="text-xs text-slate-500 ml-auto flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                Impact: <span className="text-slate-300">{impact}</span>
              </span>
            )}
          </div>
          <p className="text-sm text-slate-200 font-medium leading-snug">{issue.description}</p>
        </div>
        <div className="flex-shrink-0 text-slate-500">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-700/50 pt-4">
          {/* Code Snippet */}
          <div>
            <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider font-semibold">
              Detected Snippet
            </p>
            <pre className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed border border-slate-700/50">
              {issue.snippet}
            </pre>
          </div>

          {/* Suggestion */}
          <div className="flex gap-2">
            <Lightbulb className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-slate-500 mb-1 uppercase tracking-wider font-semibold">
                Recommendation
              </p>
              <p className="text-sm text-slate-300">{issue.suggestion}</p>
            </div>
          </div>

          {/* AI Fix */}
          {suggestion && (
            <div className="bg-slate-900/80 rounded-xl border border-violet-500/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center">
                  <span className="text-xs">🤖</span>
                </div>
                <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider">
                  AI Fix — {suggestion.model}
                </p>
              </div>
              <pre className="bg-slate-950 rounded-lg p-3 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed mb-3 border border-emerald-500/10">
                {suggestion.fixedCode}
              </pre>
              <p className="text-xs text-slate-400">
                <span className="text-emerald-400 font-medium">✓ </span>
                {suggestion.improvementSummary}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
