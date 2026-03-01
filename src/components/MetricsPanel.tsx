import React from 'react';
import type { AnalysisResult } from '../types';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

interface Props {
  result: AnalysisResult;
}

export const MetricsPanel: React.FC<Props> = ({ result }) => {
  const { metrics, issues, trinity } = result;

  // Pie: issue distribution by category
  const pieData = [
    { name: 'Performance', value: issues.filter((i) => i.category === 'performance').length, color: '#8b5cf6' },
    { name: 'Energy', value: issues.filter((i) => i.category === 'energy').length, color: '#10b981' },
    { name: 'Security', value: issues.filter((i) => i.category === 'security').length, color: '#ef4444' },
  ].filter((d) => d.value > 0);

  // Radar: code quality dimensions
  const radarData = [
    { subject: 'Performance', score: trinity.performance },
    { subject: 'Energy', score: trinity.energy },
    { subject: 'Security', score: trinity.security },
    { subject: 'Simplicity', score: Math.max(0, 100 - metrics.cyclomaticComplexity * 2) },
    { subject: 'Efficiency', score: Math.max(0, 100 - metrics.loopDepth * 12) },
    { subject: 'I/O Health', score: Math.max(0, 100 - metrics.ioCallCount * 8) },
  ];

  // Bar: severity breakdown
  const severityData = ['critical', 'high', 'medium', 'low', 'info'].map((s) => ({
    name: s.charAt(0).toUpperCase() + s.slice(1),
    count: issues.filter((i) => i.severity === s).length,
    fill: s === 'critical' ? '#ef4444' : s === 'high' ? '#f97316' : s === 'medium' ? '#eab308' : s === 'low' ? '#3b82f6' : '#64748b',
  }));

  const metricItems = [
    { label: 'Lines of Code', value: result.loc, icon: '📄' },
    { label: 'Cyclomatic Complexity', value: metrics.cyclomaticComplexity, icon: '🔀' },
    { label: 'Max Loop Depth', value: metrics.loopDepth, icon: '🔄' },
    { label: 'I/O Call Count', value: metrics.ioCallCount, icon: '💾' },
    { label: 'Recursion Detected', value: metrics.recursionCount, icon: '♻️' },
    { label: 'Function Count', value: metrics.functionCount, icon: '🔧' },
    { label: 'Max Nesting Depth', value: metrics.nestingDepth, icon: '📦' },
    { label: 'Energy Proxy Score', value: metrics.energyProxyScore, icon: '⚡' },
  ];

  return (
    <div className="space-y-6">
      {/* Raw Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metricItems.map((m) => (
          <div key={m.label} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
            <div className="text-xl mb-1">{m.icon}</div>
            <div className="text-2xl font-bold text-white">{m.value}</div>
            <div className="text-xs text-slate-400 mt-0.5 leading-tight">{m.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Radar Chart */}
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4">
          <h4 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
            Quality Radar
          </h4>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#334155" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />
              <Radar
                name="Score"
                dataKey="score"
                stroke="#8b5cf6"
                fill="#8b5cf6"
                fillOpacity={0.25}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie Chart */}
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4">
          <h4 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
            Issue Distribution
          </h4>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#fff' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {pieData.map((d) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs text-slate-400">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name} ({d.value})
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
              No issues detected 🎉
            </div>
          )}
        </div>

        {/* Severity Bar */}
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 md:col-span-2 xl:col-span-1">
          <h4 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
            Severity Breakdown
          </h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={severityData} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {severityData.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
