import React, { useState, useCallback } from 'react';
import {
  Play,
  Upload,
  Code2,
  Zap,
  Shield,
  Gauge,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  BarChart3,
  FileCode,
  Cpu,
  Activity,
  Filter,
} from 'lucide-react';
import type { AnalysisResult, AnalysisStage, SmellCategory } from './types';
import { analyzeCode } from './analyzer/engine';
import { CODE_SAMPLES } from './data/samples';
import { ScoreGauge } from './components/ScoreGauge';
import { IssueCard } from './components/IssueCard';
import { AnalysisPipeline } from './components/AnalysisPipeline';
import { MetricsPanel } from './components/MetricsPanel';

type TabId = 'issues' | 'metrics' | 'suggestions';

const GRADE_STYLES: Record<string, { bg: string; text: string; ring: string }> = {
  A: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', ring: 'ring-emerald-500/50' },
  B: { bg: 'bg-blue-500/20', text: 'text-blue-300', ring: 'ring-blue-500/50' },
  C: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', ring: 'ring-yellow-500/50' },
  D: { bg: 'bg-orange-500/20', text: 'text-orange-300', ring: 'ring-orange-500/50' },
  F: { bg: 'bg-red-500/20', text: 'text-red-300', ring: 'ring-red-500/50' },
};

export default function App() {
  const [code, setCode] = useState(CODE_SAMPLES[0].code);
  const [filename, setFilename] = useState(CODE_SAMPLES[0].name + '.py');
  const [language, setLanguage] = useState(CODE_SAMPLES[0].language);
  const [stage, setStage] = useState<AnalysisStage>('idle');
  const [llmProgress, setLlmProgress] = useState<string>('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('issues');
  const [filterCategory, setFilterCategory] = useState<SmellCategory | 'all'>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [selectedSample, setSelectedSample] = useState(0);
  const [sampleDropdown, setSampleDropdown] = useState(false);

  const handleAnalyze = useCallback(async () => {
    setStage('parsing');
    setLlmProgress('');
    setResult(null);
    setActiveTab('issues');
    try {
      const res = await analyzeCode(
        code,
        filename,
        language,
        (s: string, detail?: string) => {
          setStage(s as AnalysisStage);
          if (s === 'llm' && detail) setLlmProgress(detail);
        }
      );
      setResult(res);
    } catch (e) {
      setStage('idle');
    }
  }, [code, filename, language]);

  const handleSampleSelect = (idx: number) => {
    const sample = CODE_SAMPLES[idx];
    setSelectedSample(idx);
    setCode(sample.code);
    setFilename(sample.name.replace(/\s+/g, '_') + '.py');
    setLanguage(sample.language);
    setSampleDropdown(false);
    setResult(null);
    setStage('idle');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCode(ev.target?.result as string);
      setFilename(file.name);
      setResult(null);
      setStage('idle');
    };
    reader.readAsText(file);
  };

  const isRunning = stage !== 'idle' && stage !== 'done';

  const filteredIssues = result?.issues.filter((issue) => {
    const catMatch = filterCategory === 'all' || issue.category === filterCategory;
    const sevMatch = filterSeverity === 'all' || issue.severity === filterSeverity;
    return catMatch && sevMatch;
  }) ?? [];

  const criticalCount = result?.issues.filter((i) => i.severity === 'critical').length ?? 0;
  const highCount = result?.issues.filter((i) => i.severity === 'high').length ?? 0;
  const llmWarning = result?.warnings.find((w) =>
    /groq|quota|rate|key|llm/i.test(w)
  );
  const backendWarning = result?.warnings.find((w) =>
    /backend|unreachable|api returned|connection|failed to fetch|network/i.test(w)
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-blue-500 to-emerald-500 flex items-center justify-center shadow-lg">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-none">
                AI Code Quality Trinity
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">Performance · Energy · Security</p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 ml-4">
            {[
              { icon: <Gauge className="w-3.5 h-3.5" />, label: 'Performance', color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
              { icon: <Zap className="w-3.5 h-3.5" />, label: 'Energy', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
              { icon: <Shield className="w-3.5 h-3.5" />, label: 'Security', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
            ].map((tag) => (
              <span
                key={tag.label}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${tag.color}`}
              >
                {tag.icon}
                {tag.label}
              </span>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            <Activity className="w-4 h-4" />
            <span className="hidden sm:inline">Free · Local · Open Source</span>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6">
          {/* LEFT: Code Editor Panel */}
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Sample Selector */}
              <div className="relative">
                <button
                  onClick={() => setSampleDropdown((d) => !d)}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm px-3 py-2 rounded-xl transition-colors"
                >
                  <FileCode className="w-4 h-4 text-slate-400" />
                  <span className="max-w-[140px] truncate">{CODE_SAMPLES[selectedSample].name}</span>
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                </button>
                {sampleDropdown && (
                  <div className="absolute top-full left-0 mt-2 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                    {CODE_SAMPLES.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleSampleSelect(i)}
                        className={`w-full text-left px-4 py-3 hover:bg-slate-700 transition-colors border-b border-slate-700/50 last:border-0 ${
                          i === selectedSample ? 'bg-violet-500/10' : ''
                        }`}
                      >
                        <div className="text-sm font-medium text-slate-200">{s.name}</div>
                        <div className="text-xs text-slate-400 mt-0.5 leading-tight">{s.description}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Upload */}
              <label className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm px-3 py-2 rounded-xl transition-colors cursor-pointer">
                <Upload className="w-4 h-4 text-slate-400" />
                <span>Upload File</span>
                <input type="file" accept=".py,.js,.ts,.java,.kt,.go" onChange={handleFileUpload} className="hidden" />
              </label>

              {/* Language */}
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-300 text-sm px-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              >
                {['Python', 'JavaScript', 'TypeScript', 'Java', 'Kotlin'].map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>

              <div className="ml-auto">
                <button
                  onClick={handleAnalyze}
                  disabled={isRunning || !code.trim()}
                  className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2 rounded-xl transition-all shadow-lg shadow-violet-500/20"
                >
                  <Play className="w-4 h-4" />
                  {isRunning ? 'Analyzing...' : 'Run Trinity Analysis'}
                </button>
              </div>
            </div>

            {/* Code Editor */}
            <div className="bg-slate-900 border border-slate-700/50 rounded-2xl overflow-hidden shadow-xl">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800/60 border-b border-slate-700/50">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/70" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <div className="w-3 h-3 rounded-full bg-green-500/70" />
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <Code2 className="w-4 h-4 text-slate-400" />
                  <span className="text-xs text-slate-400 font-mono">{filename}</span>
                </div>
                <span className="ml-auto text-xs text-slate-500">{language}</span>
              </div>
              <div className="flex">
                {/* Line numbers */}
                <div className="select-none text-right pr-4 pl-3 pt-4 pb-4 text-xs font-mono text-slate-600 bg-slate-900/50 border-r border-slate-800 min-w-[3rem]">
                  {code.split('\n').map((_, i) => (
                    <div key={i} className="leading-6">{i + 1}</div>
                  ))}
                </div>
                <textarea
                  value={code}
                  onChange={(e) => { setCode(e.target.value); setResult(null); setStage('idle'); }}
                  className="flex-1 bg-transparent text-sm font-mono text-slate-200 p-4 focus:outline-none resize-none leading-6 min-h-[480px]"
                  spellCheck={false}
                  placeholder="Paste your code here or select a sample above..."
                />
              </div>
            </div>
          </div>

          {/* RIGHT: Analysis Panel */}
          <div className="space-y-5">
            {/* Idle State */}
            {stage === 'idle' && !result && (
              <div className="bg-slate-800/40 border border-slate-700/30 rounded-2xl p-8 flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center border border-violet-500/20">
                  <Cpu className="w-8 h-8 text-violet-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">Ready to Analyze</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Select a code sample or paste your own code, then click{' '}
                    <span className="text-violet-400 font-medium">Run Trinity Analysis</span> to detect
                    performance, energy, and security smells.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3 w-full mt-2">
                  {[
                    { icon: <Gauge className="w-5 h-5 text-violet-400" />, label: 'Performance\nSmells', bg: 'bg-violet-500/10' },
                    { icon: <Zap className="w-5 h-5 text-emerald-400" />, label: 'Energy\nInefficiencies', bg: 'bg-emerald-500/10' },
                    { icon: <Shield className="w-5 h-5 text-red-400" />, label: 'Security\nVulnerabilities', bg: 'bg-red-500/10' },
                  ].map((item) => (
                    <div key={item.label} className={`${item.bg} rounded-xl p-3 flex flex-col items-center gap-2`}>
                      {item.icon}
                      <span className="text-xs text-slate-400 text-center whitespace-pre-line leading-tight">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pipeline running */}
            {isRunning && <AnalysisPipeline stage={stage} llmProgress={llmProgress} />}

            {/* Results */}
            {result && (
              <>
                {/* Trinity Score Card */}
                <div className="bg-gradient-to-br from-slate-800/80 to-slate-800/40 border border-slate-700/50 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                        Trinity Score
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">{result.filename} · {result.loc} LOC · {result.analysisTime}s</p>
                    </div>
                    <div className={`w-12 h-12 rounded-2xl ${GRADE_STYLES[result.trinity.grade].bg} ring-2 ${GRADE_STYLES[result.trinity.grade].ring} flex items-center justify-center`}>
                      <span className={`text-xl font-black ${GRADE_STYLES[result.trinity.grade].text}`}>
                        {result.trinity.grade}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-around">
                    <ScoreGauge
                      score={result.trinity.overall}
                      label="Overall Trinity"
                      size="lg"
                      color={result.trinity.overall >= 75 ? '#10b981' : result.trinity.overall >= 50 ? '#eab308' : '#ef4444'}
                      bgColor="#1e293b"
                    />
                    <div className="flex flex-col gap-4">
                      <ScoreGauge score={result.trinity.performance} label="Performance" size="sm" color="#8b5cf6" bgColor="#1e293b" />
                      <ScoreGauge score={result.trinity.energy} label="Energy" size="sm" color="#10b981" bgColor="#1e293b" />
                      <ScoreGauge score={result.trinity.security} label="Security" size="sm" color="#ef4444" bgColor="#1e293b" />
                    </div>
                  </div>

                  {/* Alert bar */}
                  {(criticalCount > 0 || highCount > 0) && (
                    <div className="mt-4 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                      <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                      <p className="text-xs text-red-300">
                        {criticalCount > 0 && <><span className="font-bold">{criticalCount} critical</span>{highCount > 0 ? ' & ' : ' '}</>}
                        {highCount > 0 && <><span className="font-bold">{highCount} high</span> severity </>}
                        issues require immediate attention.
                      </p>
                    </div>
                  )}
                  {criticalCount === 0 && highCount === 0 && result.issues.length === 0 && (
                    <div className="mt-4 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
                      <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <p className="text-xs text-emerald-300">No issues detected. Excellent code quality!</p>
                    </div>
                  )}

                  {(backendWarning || llmWarning) && (
                    <div className="mt-4 flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-200 leading-relaxed">
                        {backendWarning ?? llmWarning}
                      </p>
                    </div>
                  )}
                </div>

                {/* Issue Stats Row */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Performance', count: result.issues.filter(i => i.category === 'performance').length, color: 'text-violet-400', bg: 'bg-violet-500/10', icon: <Gauge className="w-4 h-4" /> },
                    { label: 'Energy', count: result.issues.filter(i => i.category === 'energy').length, color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: <Zap className="w-4 h-4" /> },
                    { label: 'Security', count: result.issues.filter(i => i.category === 'security').length, color: 'text-red-400', bg: 'bg-red-500/10', icon: <Shield className="w-4 h-4" /> },
                  ].map((stat) => (
                    <div key={stat.label} className={`${stat.bg} rounded-xl p-3 text-center`}>
                      <div className={`flex items-center justify-center gap-1 ${stat.color} mb-1`}>{stat.icon}</div>
                      <div className={`text-2xl font-bold ${stat.color}`}>{stat.count}</div>
                      <div className="text-xs text-slate-400">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Bottom: Full Results Area */}
        {result && (
          <div className="mt-8">
            {/* Tabs */}
            <div className="flex items-center gap-1 mb-6 bg-slate-800/60 border border-slate-700/50 rounded-2xl p-1 w-fit">
              {[
                { id: 'issues' as TabId, label: 'Issues', count: result.issues.length, icon: <AlertTriangle className="w-4 h-4" /> },
                { id: 'metrics' as TabId, label: 'Metrics & Charts', icon: <BarChart3 className="w-4 h-4" /> },
                { id: 'suggestions' as TabId, label: 'AI Fixes', count: result.suggestions.length, icon: <Cpu className="w-4 h-4" /> },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-white/20' : 'bg-slate-700'}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Issues Tab */}
            {activeTab === 'issues' && (
              <div>
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-3 mb-5">
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Filter className="w-4 h-4" />
                    <span>Filter:</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'performance', 'energy', 'security'] as const).map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setFilterCategory(cat)}
                        className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
                          filterCategory === cat
                            ? 'bg-violet-600 border-violet-500 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                        }`}
                      >
                        {cat === 'all' ? 'All Categories' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </button>
                    ))}
                  </div>
                  <div className="h-4 w-px bg-slate-700" />
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'critical', 'high', 'medium', 'low'] as const).map((sev) => (
                      <button
                        key={sev}
                        onClick={() => setFilterSeverity(sev)}
                        className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
                          filterSeverity === sev
                            ? 'bg-slate-600 border-slate-500 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                        }`}
                      >
                        {sev === 'all' ? 'All Severities' : sev.charAt(0).toUpperCase() + sev.slice(1)}
                      </button>
                    ))}
                  </div>
                  <span className="ml-auto text-xs text-slate-500">
                    Showing {filteredIssues.length} / {result.issues.length} issues
                  </span>
                </div>

                {filteredIssues.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {filteredIssues.map((issue, i) => (
                      <IssueCard
                        key={issue.id}
                        issue={issue}
                        suggestion={result.suggestions.find((s) => s.issueId === issue.id)}
                        index={i}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
                    <CheckCircle className="w-12 h-12 text-emerald-500/40" />
                    <p className="text-lg font-medium text-slate-400">No issues found</p>
                    <p className="text-sm">Try adjusting filters or paste different code.</p>
                  </div>
                )}
              </div>
            )}

            {/* Metrics Tab */}
            {activeTab === 'metrics' && <MetricsPanel result={result} />}

            {/* AI Suggestions Tab */}
            {activeTab === 'suggestions' && (
              <div className="space-y-6">
                {/* Engine banner */}
                {result.suggestions.length > 0 && (() => {
                  const isGroq = result.suggestions.some(s => /groq/i.test(s.model));
                  return (
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${
                      isGroq
                        ? 'bg-gradient-to-r from-violet-500/10 to-blue-500/10 border-violet-500/25'
                        : 'bg-slate-800/60 border-slate-700/40'
                    }`}>
                      <span className="text-xl">{isGroq ? '✨' : '⚙️'}</span>
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {isGroq ? 'Powered by Groq' : 'AI Fix Engine'}
                        </p>
                        <p className="text-xs text-slate-400">
                          {isGroq
                            ? `Real AI analysis — ${result.suggestions.length} issues analyzed by Groq models`
                            : `AI analysis active — ${result.suggestions.length} fixes generated`}
                        </p>
                      </div>
                      <span className="ml-auto text-xs px-2.5 py-1 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-medium">
                        AI Active
                      </span>
                    </div>
                  );
                })()}

                {result.suggestions.length > 0 ? (
                  result.suggestions.map((sug) => {
                    const issue = result.issues.find((i) => i.id === sug.issueId);
                    const isGroq = /groq/i.test(sug.model);
                    return (
                      <div
                        key={sug.issueId}
                        className="bg-slate-800/60 border border-slate-700/50 rounded-2xl overflow-hidden"
                      >
                        <div className={`flex items-center gap-3 px-5 py-4 border-b border-slate-700/50 bg-gradient-to-r ${
                          isGroq ? 'from-violet-500/8 to-blue-500/5' : 'from-slate-700/30 to-transparent'
                        }`}>
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm ${
                            isGroq ? 'bg-violet-500/20' : 'bg-slate-700/50'
                          }`}>
                            {isGroq ? '✨' : '⚙️'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-white">{issue?.rule}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                                isGroq
                                  ? 'text-violet-300 bg-violet-500/15 border-violet-500/30'
                                  : 'text-slate-400 bg-slate-700/50 border-slate-600'
                              }`}>
                                {sug.model}
                              </span>
                              <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                                issue?.category === 'security' ? 'text-red-400 bg-red-500/10' :
                                issue?.category === 'energy' ? 'text-emerald-400 bg-emerald-500/10' :
                                'text-violet-400 bg-violet-500/10'
                              }`}>
                                {issue?.category}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5 truncate">{issue?.description}</p>
                          </div>
                        </div>
                        <div className="p-5 space-y-4">
                          <div>
                            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
                              {isGroq ? '🤖 AI Explanation' : '📋 Recommendation'}
                            </p>
                            <p className="text-sm text-slate-300 leading-relaxed">{sug.explanation}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
                              {isGroq ? '✨ AI-Generated Fix' : '🔧 Suggested Fix'}
                            </p>
                            <pre className={`rounded-xl p-4 text-sm font-mono overflow-x-auto leading-relaxed border ${
                              isGroq
                                ? 'bg-slate-950 text-emerald-300 border-emerald-500/15'
                                : 'bg-slate-900 text-slate-300 border-slate-700/50'
                            }`}>
                              {sug.fixedCode}
                            </pre>
                          </div>
                          <div className={`flex items-start gap-2 rounded-xl px-4 py-3 border ${
                            isGroq
                              ? 'bg-emerald-500/10 border-emerald-500/20'
                              : 'bg-slate-700/30 border-slate-700/50'
                          }`}>
                            <CheckCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isGroq ? 'text-emerald-400' : 'text-slate-400'}`} />
                            <p className={`text-sm ${isGroq ? 'text-emerald-300' : 'text-slate-400'}`}>
                              {sug.improvementSummary}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
                    <Cpu className="w-12 h-12 text-violet-500/30" />
                    <p className="text-lg font-medium text-slate-400">No AI suggestions generated</p>
                    <p className="text-sm">{llmWarning ?? backendWarning ?? 'Run analysis on code with high/critical issues to get AI fixes.'}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-12 py-6">
        <div className="max-w-screen-2xl mx-auto px-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center">
              <Cpu className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-slate-300">AI Code Quality Trinity Engine</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-emerald-500 rounded-full" /> Free & Open Source</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-violet-500 rounded-full" /> Runs Locally</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-blue-500 rounded-full" /> Optional Groq API</span>
          </div>
          <div className="text-xs text-slate-600">
            Stack: AST Parser · radon · bandit · scikit-learn · Groq LLM
          </div>
        </div>
      </footer>
    </div>
  );
}
