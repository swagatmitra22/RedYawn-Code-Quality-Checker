export type SmellSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type SmellCategory = 'performance' | 'energy' | 'security';

export interface SmellIssue {
  id: string;
  category: SmellCategory;
  severity: SmellSeverity;
  rule: string;
  description: string;
  line: number;
  column?: number;
  snippet: string;
  suggestion: string;
  energyImpact?: number;
  perfImpact?: number;
  securityImpact?: number;
}

export interface TrinityScore {
  overall: number;
  performance: number;
  energy: number;
  security: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface AnalysisResult {
  filename: string;
  language: string;
  loc: number;
  analysisTime: number;
  trinity: TrinityScore;
  issues: SmellIssue[];
  metrics: {
    cyclomaticComplexity: number;
    loopDepth: number;
    ioCallCount: number;
    recursionCount: number;
    functionCount: number;
    importCount: number;
    nestingDepth: number;
    energyProxyScore: number;
    securityFindings: number;
  };
  suggestions: AISuggestion[];
  warnings: string[];
}

export interface AISuggestion {
  issueId: string;
  model: string;
  explanation: string;
  fixedCode: string;
  improvementSummary: string;
}

export type AnalysisStage =
  | 'idle'
  | 'parsing'
  | 'performance'
  | 'energy'
  | 'security'
  | 'scoring'
  | 'llm'
  | 'done';
