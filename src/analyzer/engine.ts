import type {
  AnalysisResult,
  SmellIssue,
  TrinityScore,
  AISuggestion,
  SmellSeverity,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = (i: number) => `issue-${i}`;
const lines = (code: string) => code.split('\n');

function snippetAt(code: string, line: number): string {
  const ls = lines(code);
  const start = Math.max(0, line - 2);
  const end = Math.min(ls.length, line + 1);
  return ls.slice(start, end).join('\n');
}

function grade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ─── Backend Bridge (FastAPI Trinity Engine) ────────────────────────────────

const BACKEND_API_BASE =
  (import.meta as any).env?.VITE_TRINITY_API_URL?.replace(/\/$/, '') ||
  'http://127.0.0.1:8000';

interface BackendIssue {
  file: string;
  line: number;
  category: string;
  severity: string;
  rule: string;
  description: string;
  suggestion: string;
  snippet?: string;
  impact?: number;
}

interface BackendSuggestion {
  issue_rule: string;
  issue_line: number;
  model: string;
  explanation: string;
  fixed_code: string;
  improvement_summary: string;
}

interface BackendPayload {
  metrics?: {
    loc?: number;
    cyclomatic_complexity?: number;
    max_loop_depth?: number;
    io_call_count?: number;
    recursion_count?: number;
    function_count?: number;
    import_count?: number;
    max_nesting_depth?: number;
    energy_proxy_score?: number;
  };
  score?: {
    overall?: number;
    performance?: number;
    energy?: number;
    security?: number;
    grade?: 'A' | 'B' | 'C' | 'D' | 'F';
  };
  issues?: BackendIssue[];
  suggestions?: BackendSuggestion[];
  execution_time_seconds?: number;
  warnings?: string[];
}

interface BackendAnalysisResponse {
  result: AnalysisResult | null;
  warning?: string;
}

function normalizeSeverity(severity: string): SmellSeverity {
  const v = severity?.toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low' || v === 'info') {
    return v;
  }
  return 'medium';
}

function normalizeCategory(category: string): 'performance' | 'energy' | 'security' {
  const v = category?.toLowerCase();
  if (v === 'performance' || v === 'energy' || v === 'security') {
    return v;
  }
  return 'performance';
}

function backendIssueKey(rule: string, line: number): string {
  return `${rule}:${line}`;
}

function mapBackendToFrontend(
  payload: BackendPayload,
  filename: string,
  language: string,
  locHint: number
): AnalysisResult {
  const rawIssues = payload.issues ?? [];

  const mappedIssues: SmellIssue[] = rawIssues.map((issue, i) => {
    const category = normalizeCategory(issue.category);
    const impact = Math.max(0, Math.min(100, issue.impact ?? 0));

    return {
      id: uid(i),
      category,
      severity: normalizeSeverity(issue.severity),
      rule: issue.rule || `RULE-${i}`,
      description: issue.description || 'Issue detected by backend engine',
      line: issue.line || 1,
      snippet: issue.snippet || '',
      suggestion: issue.suggestion || 'Review this issue and apply a targeted fix.',
      perfImpact: category === 'performance' ? impact : undefined,
      energyImpact: category === 'energy' ? impact : undefined,
      securityImpact: category === 'security' ? impact : undefined,
    };
  });

  const suggestionBucket = new Map<string, BackendSuggestion[]>();
  for (const s of payload.suggestions ?? []) {
    const key = backendIssueKey(s.issue_rule, s.issue_line);
    const current = suggestionBucket.get(key) ?? [];
    current.push(s);
    suggestionBucket.set(key, current);
  }

  const mappedSuggestions: AISuggestion[] = [];
  for (const issue of mappedIssues) {
    const key = backendIssueKey(issue.rule, issue.line);
    const bucket = suggestionBucket.get(key);
    if (!bucket?.length) continue;
    const next = bucket.shift();
    if (!next) continue;
    mappedSuggestions.push({
      issueId: issue.id,
      model: next.model || 'Groq',
      explanation: next.explanation || issue.suggestion,
      fixedCode: next.fixed_code || `# ${issue.suggestion}`,
      improvementSummary:
        next.improvement_summary || `Applied fix guidance for ${issue.rule}.`,
    });
  }

  const metrics = payload.metrics ?? {};
  const score = payload.score ?? {};

  return {
    filename,
    language,
    loc: metrics.loc ?? locHint,
    analysisTime: payload.execution_time_seconds ?? 0,
    trinity: {
      overall: Math.round(score.overall ?? 0),
      performance: Math.round(score.performance ?? 0),
      energy: Math.round(score.energy ?? 0),
      security: Math.round(score.security ?? 0),
      grade: score.grade ?? grade(Math.round(score.overall ?? 0)),
    },
    issues: mappedIssues,
    metrics: {
      cyclomaticComplexity: Math.round(metrics.cyclomatic_complexity ?? 1),
      loopDepth: Math.round(metrics.max_loop_depth ?? 0),
      ioCallCount: Math.round(metrics.io_call_count ?? 0),
      recursionCount: Math.round(metrics.recursion_count ?? 0),
      functionCount: Math.round(metrics.function_count ?? 0),
      importCount: Math.round(metrics.import_count ?? 0),
      nestingDepth: Math.round(metrics.max_nesting_depth ?? 0),
      energyProxyScore: Math.round(metrics.energy_proxy_score ?? 0),
      securityFindings: mappedIssues.filter((i) => i.category === 'security').length,
    },
    suggestions: mappedSuggestions,
    warnings: payload.warnings ?? [],
  };
}

async function tryBackendAnalysis(
  code: string,
  filename: string,
  language: string,
  onStage: (stage: string, detail?: string) => void
): Promise<BackendAnalysisResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    // Backend may have GROQ_API_KEY in its environment; request LLM suggestions by default.
    const shouldUseLlm = true;
    const request = fetch(`${BACKEND_API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        code,
        filename,
        use_llm: shouldUseLlm,
        run_external_tools: true,
        include_dynamic_profile: false,
        max_suggestions: 3,
      }),
    });

    const stageFlow = ['performance', 'energy', 'security', 'scoring'] as const;
    for (const stage of stageFlow) {
      onStage(stage);
      await new Promise((r) => setTimeout(r, 150));
    }
    if (shouldUseLlm) onStage('llm');

    const res = await request;
    if (!res.ok) {
      let detail = `Backend API returned ${res.status}`;
      try {
        const errPayload = await res.json();
        if (errPayload?.detail) detail = String(errPayload.detail);
      } catch {
        // no-op
      }
      return { result: null, warning: detail };
    }
    const payload = (await res.json()) as BackendPayload;
    const locHint = lines(code).filter((l) => l.trim()).length;
    return { result: mapBackendToFrontend(payload, filename, language, locHint) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backend API is unreachable';
    return { result: null, warning: message };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── AST-like Pattern Matching on raw text ────────────────────────────────────

interface ParsedMetrics {
  cyclomaticComplexity: number;
  loopDepth: number;
  ioCallCount: number;
  recursionCount: number;
  functionCount: number;
  importCount: number;
  nestingDepth: number;
  energyProxyScore: number;
  securityFindings: number;
}

function parseCode(code: string, _language: string): ParsedMetrics {
  const ls = lines(code);

  const decisionKeywords = /\b(if|elif|else|for|while|case|catch|except|&&|\|\||\?)\b/g;
  const cyclomaticComplexity = Math.min(
    50,
    1 + (code.match(decisionKeywords) || []).length
  );

  let currentDepth = 0;
  let maxDepth = 0;
  for (const line of ls) {
    const trimmed = line.trim();
    if (/^(for|while)\b/.test(trimmed) || /\bfor\s*\(/.test(trimmed)) {
      currentDepth++;
      if (currentDepth > maxDepth) maxDepth = currentDepth;
    }
    if (trimmed === '' || /^(return|break|continue)/.test(trimmed)) {
      // heuristic reset
    }
  }
  const loopDepth = maxDepth || (code.match(/\bfor\b|\bwhile\b/g) || []).length;

  const ioPatterns = /open\(|read\(|write\(|readline|readlines|json\.load|pickle\.load|csv\.|sqlite|\.execute\(|fetch\(|axios\.|http\.|requests\./g;
  const ioCallCount = (code.match(ioPatterns) || []).length;

  const fnNames = [...code.matchAll(/def\s+(\w+)|function\s+(\w+)|fun\s+(\w+)/g)].map(
    (m) => m[1] || m[2] || m[3]
  );
  let recursionCount = 0;
  for (const name of fnNames) {
    const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
    const callCount = (code.match(pattern) || []).length;
    if (callCount > 1) recursionCount++;
  }

  const functionCount = fnNames.length;
  const importCount = (code.match(/^import\s|^from\s.*import|^#include|^require\(/gm) || []).length;

  let maxIndent = 0;
  for (const line of ls) {
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent > maxIndent) maxIndent = indent;
  }
  const nestingDepth = Math.floor(maxIndent / 4);

  const memPatterns = (code.match(/\bnew\s+\w+|\[\]|\{\}|malloc|calloc|List\(|ArrayList|Vector/g) || []).length;
  const pollingPatterns = (code.match(/while\s+True|while\s*\(true\)|while\s*1\b/gi) || []).length;
  const energyProxyScore = Math.min(
    100,
    loopDepth * 8 + ioCallCount * 5 + memPatterns * 3 + pollingPatterns * 15 + recursionCount * 7
  );

  const secPatterns = [
    /eval\s*\(/g,
    /exec\s*\(/g,
    /os\.system\s*\(/g,
    /subprocess\.call\s*\(/g,
    /password\s*=\s*["']/gi,
    /secret\s*=\s*["']/gi,
    /api_key\s*=\s*["']/gi,
    /token\s*=\s*["']/gi,
    /md5\s*\(/gi,
    /sha1\s*\(/gi,
    /random\.random\(\)/g,
    /pickle\.loads/g,
    /yaml\.load\s*\([^,)]+\)/g,
    /\bSQL\b.*\+/gi,
    /\%s.*cursor|cursor.*\%s/gi,
    /open\s*\(.*\+/g,
  ];
  let securityFindings = 0;
  for (const p of secPatterns) {
    securityFindings += (code.match(p) || []).length;
  }

  return {
    cyclomaticComplexity,
    loopDepth,
    ioCallCount,
    recursionCount,
    functionCount,
    importCount,
    nestingDepth,
    energyProxyScore,
    securityFindings,
  };
}

// ─── Performance Smell Rules ──────────────────────────────────────────────────

function detectPerformanceSmells(code: string): SmellIssue[] {
  const issues: SmellIssue[] = [];
  const ls = lines(code);
  let idx = 0;

  ls.forEach((line, i) => {
    const trimmed = line.trim();

    if (/^\s*(for|while)\b/.test(line)) {
      let inner = false;
      for (let j = i + 1; j < Math.min(i + 10, ls.length); j++) {
        if (/^\s+(for|while)\b/.test(ls[j])) { inner = true; break; }
      }
      if (inner) {
        issues.push({
          id: uid(idx++),
          category: 'performance',
          severity: 'high',
          rule: 'PERF-001',
          description: 'Nested loop detected — potential O(n²) complexity',
          line: i + 1,
          snippet: snippetAt(code, i + 1),
          suggestion: 'Consider flattening nested loops or using hash maps/sets for O(n) lookup.',
          perfImpact: 75,
        });
      }
    }

    if (/\+\s*=\s*["']|["']\s*\+/.test(line) && /for |while /.test(code.slice(0, code.indexOf(line)))) {
      issues.push({
        id: uid(idx++),
        category: 'performance',
        severity: 'medium',
        rule: 'PERF-002',
        description: 'String concatenation in loop — use join() or StringBuilder',
        line: i + 1,
        snippet: snippetAt(code, i + 1),
        suggestion: 'Accumulate strings in a list and use "".join(parts) for O(n) vs O(n²) behavior.',
        perfImpact: 55,
      });
    }

    if (/def |function |fun /.test(trimmed)) {
      let fnEnd = i;
      let depth = 0;
      for (let j = i; j < ls.length; j++) {
        if (/[{(:]/.test(ls[j])) depth++;
        if (/[})]/.test(ls[j])) depth--;
        if (depth <= 0 && j > i) { fnEnd = j; break; }
      }
      if (fnEnd - i > 50) {
        issues.push({
          id: uid(idx++),
          category: 'performance',
          severity: 'medium',
          rule: 'PERF-003',
          description: `Large method detected (~${fnEnd - i} lines) — violates Single Responsibility Principle`,
          line: i + 1,
          snippet: snippetAt(code, i + 1),
          suggestion: 'Break this function into smaller, focused functions for better caching and branch prediction.',
          perfImpact: 40,
        });
      }
    }

    if (/(read|write|open|fetch|requests\.)/.test(trimmed)) {
      const prevLines = ls.slice(Math.max(0, i - 5), i).join(' ');
      if (/for |while /.test(prevLines)) {
        issues.push({
          id: uid(idx++),
          category: 'performance',
          severity: 'high',
          rule: 'PERF-004',
          description: 'Blocking I/O inside loop — severe throughput bottleneck',
          line: i + 1,
          snippet: snippetAt(code, i + 1),
          suggestion: 'Move I/O outside the loop or use async/await with asyncio / coroutines.',
          perfImpact: 80,
        });
      }
    }

    if (/\.len\(\)|\.length\b|len\(/.test(trimmed)) {
      const prevLines = ls.slice(Math.max(0, i - 3), i).join(' ');
      if (/for |while /.test(prevLines)) {
        issues.push({
          id: uid(idx++),
          category: 'performance',
          severity: 'low',
          rule: 'PERF-005',
          description: 'Length/size computed inside loop body — cache outside loop',
          line: i + 1,
          snippet: snippetAt(code, i + 1),
          suggestion: 'Compute len(collection) once before the loop and store in a variable.',
          perfImpact: 20,
        });
      }
    }

    if (/\bglobal\b/.test(trimmed)) {
      issues.push({
        id: uid(idx++),
        category: 'performance',
        severity: 'low',
        rule: 'PERF-006',
        description: 'Global variable mutation detected — slower than local variables',
        line: i + 1,
        snippet: snippetAt(code, i + 1),
        suggestion: 'Pass variables as function parameters instead of using global state.',
        perfImpact: 15,
      });
    }

    if (/list\(map\(lambda/.test(trimmed)) {
      issues.push({
        id: uid(idx++),
        category: 'performance',
        severity: 'info',
        rule: 'PERF-007',
        description: 'list(map(lambda...)) is slower than list comprehension',
        line: i + 1,
        snippet: snippetAt(code, i + 1),
        suggestion: 'Replace list(map(lambda x: expr, iterable)) with [expr for x in iterable].',
        perfImpact: 10,
      });
    }
  });

  return issues;
}

// ─── Energy Smell Rules ───────────────────────────────────────────────────────

function detectEnergySmells(code: string): SmellIssue[] {
  const issues: SmellIssue[] = [];
  const ls = lines(code);
  let idx = 1000;

  ls.forEach((line, i) => {
    const trimmed = line.trim();

    if (/while\s+True|while\s*\(true\)|while\s*1\b/i.test(trimmed)) {
      const hasSleep = ls.slice(i, Math.min(i + 10, ls.length)).some(l => /sleep|time\.sleep|Thread\.sleep/i.test(l));
      issues.push({
        id: uid(idx++),
        category: 'energy',
        severity: hasSleep ? 'medium' : 'critical',
        rule: 'ENRG-001',
        description: hasSleep
          ? 'Polling loop with sleep — consider event-driven architecture'
          : 'Busy-wait / spin-lock detected — 100% CPU usage with no work',
        line: i + 1,
        snippet: snippetAt(code, i + 1),
        suggestion: hasSleep
          ? 'Replace polling with event listeners, callbacks, or asyncio.wait_for().'
          : 'Add time.sleep() or replace with event-driven design to reduce CPU burn.',
        energyImpact: hasSleep ? 50 : 95,
      });
    }

    if (/\.write\(|\.flush\(/.test(trimmed)) {
      const prevLines = ls.slice(Math.max(0, i - 5), i).join(' ');
      if (/for |while /.test(prevLines)) {
        issues.push({
          id: uid(idx++),
          category: 'energy',
          severity: 'high',
          rule: 'ENRG-002',
          description: 'Frequent disk write inside loop — high I/O energy cost',
          line: i + 1,
          snippet: snippetAt(code, i + 1),
          suggestion: 'Buffer writes and flush once after loop. Use BufferedWriter or batch inserts.',
          energyImpact: 70,
        });
      }
    }

    if (/\[\]|\{\}|new \w+\(|List\(|ArrayList|dict\(\)|set\(/.test(trimmed)) {
      const prevLines = ls.slice(Math.max(0, i - 5), i).join(' ');
      if (/for |while /.test(prevLines)) {
        issues.push({
          id: uid(idx++),
          category: 'energy',
          severity: 'medium',
          rule: 'ENRG-003',
          description: 'Object allocation inside loop — increased GC pressure and memory energy',
          line: i + 1,
          snippet: snippetAt(code, i + 1),
          suggestion: 'Pre-allocate and reuse objects outside the loop. Use object pools for heavy objects.',
          energyImpact: 45,
        });
      }
    }

    if (/requests\.|fetch\(|http\.|urllib/.test(trimmed)) {
      const prevLines = ls.slice(Math.max(0, i - 5), i).join(' ');
      if (/for |while /.test(prevLines)) {
        issues.push({
          id: uid(idx++),
          category: 'energy',
          severity: 'high',
          rule: 'ENRG-004',
          description: 'Network call inside loop — redundant energy for connection setup',
          line: i + 1,
          snippet: snippetAt(code, i + 1),
          suggestion: 'Batch API requests, use connection pooling, or cache results. Consider GraphQL batching.',
          energyImpact: 65,
        });
      }
    }

    if (/\blist\b.*\bin\b/.test(trimmed) && !/comprehension/.test(trimmed)) {
      issues.push({
        id: uid(idx++),
        category: 'energy',
        severity: 'low',
        rule: 'ENRG-005',
        description: 'Linear search on list (x in list) — O(n) energy per lookup',
        line: i + 1,
        snippet: snippetAt(code, i + 1),
        suggestion: 'Convert list to set for O(1) membership testing: if x in my_set.',
        energyImpact: 30,
      });
    }

    if (/import\s+numpy|import\s+pandas|import\s+tensorflow|import\s+torch/.test(trimmed)) {
      issues.push({
        id: uid(idx++),
        category: 'energy',
        severity: 'info',
        rule: 'ENRG-006',
        description: 'Heavy library imported — verify it is used; startup energy cost is significant',
        line: i + 1,
        snippet: snippetAt(code, i + 1),
        suggestion: 'Use lazy imports or import only what you need: from numpy import array.',
        energyImpact: 15,
      });
    }
  });

  return issues;
}

// ─── Security Smell Rules ─────────────────────────────────────────────────────

function detectSecuritySmells(code: string): SmellIssue[] {
  const issues: SmellIssue[] = [];
  const ls = lines(code);
  let idx = 2000;

  const rules: Array<{
    pattern: RegExp;
    rule: string;
    description: string;
    suggestion: string;
    severity: SmellSeverity;
    securityImpact: number;
  }> = [
    {
      pattern: /eval\s*\(/,
      rule: 'SEC-001',
      description: 'eval() usage — arbitrary code execution risk (CWE-95)',
      suggestion: 'Replace eval() with ast.literal_eval() for data or JSON.parse() for JSON.',
      severity: 'critical',
      securityImpact: 95,
    },
    {
      pattern: /exec\s*\(/,
      rule: 'SEC-002',
      description: 'exec() usage — remote code execution vector (CWE-78)',
      suggestion: 'Avoid exec(). Use importlib or subprocess with allowlists instead.',
      severity: 'critical',
      securityImpact: 90,
    },
    {
      pattern: /os\.system\s*\(|subprocess\.call\s*\(/,
      rule: 'SEC-003',
      description: 'Shell command injection risk — unsanitized input to shell (CWE-78)',
      suggestion: 'Use subprocess.run() with shell=False and a list of arguments.',
      severity: 'high',
      securityImpact: 80,
    },
    {
      pattern: /(password|passwd|pwd|secret|api_key|token|auth)\s*=\s*["'][^"']{3,}/i,
      rule: 'SEC-004',
      description: 'Hardcoded secret detected — credential exposure risk (CWE-798)',
      suggestion: 'Move secrets to environment variables or a vault: os.getenv("API_KEY").',
      severity: 'critical',
      securityImpact: 92,
    },
    {
      pattern: /md5\s*\(|hashlib\.md5|MessageDigest\.getInstance\s*\(\s*["']MD5/i,
      rule: 'SEC-005',
      description: 'Weak hash algorithm MD5 — broken for security use (CWE-327)',
      suggestion: 'Use SHA-256 or bcrypt/argon2 for password hashing.',
      severity: 'high',
      securityImpact: 72,
    },
    {
      pattern: /sha1\s*\(|hashlib\.sha1/i,
      rule: 'SEC-006',
      description: 'SHA-1 is deprecated for security — collision attacks known (CWE-327)',
      suggestion: 'Upgrade to SHA-256 or SHA-3 for integrity checks.',
      severity: 'high',
      securityImpact: 65,
    },
    {
      pattern: /pickle\.loads|pickle\.load\s*\(/,
      rule: 'SEC-007',
      description: 'Unsafe deserialization via pickle — arbitrary code execution (CWE-502)',
      suggestion: 'Use JSON or MessagePack instead of pickle for untrusted data.',
      severity: 'critical',
      securityImpact: 88,
    },
    {
      pattern: /yaml\.load\s*\([^,)]+\)/,
      rule: 'SEC-008',
      description: 'yaml.load() without Loader — can execute arbitrary Python (CWE-502)',
      suggestion: 'Use yaml.safe_load() instead of yaml.load().',
      severity: 'high',
      securityImpact: 75,
    },
    {
      pattern: /random\.random\(\)|Math\.random\(\)/,
      rule: 'SEC-009',
      description: 'Weak PRNG for potential security context — predictable values (CWE-338)',
      suggestion: 'Use secrets.token_hex() or os.urandom() for cryptographic randomness.',
      severity: 'medium',
      securityImpact: 50,
    },
    {
      pattern: /f["'].*SELECT.*\{|"SELECT.*"\s*\+|'SELECT.*'\s*\+/i,
      rule: 'SEC-010',
      description: 'Potential SQL injection — string-formatted query (CWE-89)',
      suggestion: 'Use parameterized queries: cursor.execute("SELECT * FROM t WHERE id=?", (id,))',
      severity: 'critical',
      securityImpact: 93,
    },
    {
      pattern: /DEBUG\s*=\s*True|debug\s*=\s*true/i,
      rule: 'SEC-011',
      description: 'Debug mode enabled — leaks stack traces and internal data in production',
      suggestion: 'Set DEBUG=False for production. Use environment variables to toggle.',
      severity: 'medium',
      securityImpact: 45,
    },
    {
      pattern: /verify\s*=\s*False|ssl_verify\s*=\s*False|rejectUnauthorized:\s*false/i,
      rule: 'SEC-012',
      description: 'SSL verification disabled — MITM attack vector (CWE-295)',
      suggestion: 'Enable SSL verification. If using self-signed certs, provide the CA bundle.',
      severity: 'high',
      securityImpact: 78,
    },
  ];

  ls.forEach((line, i) => {
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        issues.push({
          id: uid(idx++),
          category: 'security',
          severity: rule.severity,
          rule: rule.rule,
          description: rule.description,
          line: i + 1,
          snippet: snippetAt(code, i + 1),
          suggestion: rule.suggestion,
          securityImpact: rule.securityImpact,
        });
      }
    }
  });

  return issues;
}

// ─── Trinity Score Calculation ────────────────────────────────────────────────

function calculateTrinityScore(
  issues: SmellIssue[],
  metrics: ParsedMetrics,
  _loc: number
): TrinityScore {
  const perfIssues = issues.filter((i) => i.category === 'performance');
  const energyIssues = issues.filter((i) => i.category === 'energy');
  const secIssues = issues.filter((i) => i.category === 'security');

  const severityWeight: Record<string, number> = {
    critical: 25,
    high: 15,
    medium: 8,
    low: 3,
    info: 1,
  };

  const calcPenalty = (issueList: SmellIssue[]) =>
    issueList.reduce((sum, i) => sum + (severityWeight[i.severity] ?? 0), 0);

  const maxPenalty = 100;

  const perfScore = Math.max(0, 100 - Math.min(maxPenalty, calcPenalty(perfIssues) + metrics.cyclomaticComplexity * 0.8));
  const energyScore = Math.max(0, 100 - Math.min(maxPenalty, calcPenalty(energyIssues) + metrics.energyProxyScore * 0.5));
  const secScore = Math.max(0, 100 - Math.min(maxPenalty, calcPenalty(secIssues) * 1.2));

  const overall = Math.round(0.35 * perfScore + 0.35 * energyScore + 0.30 * secScore);

  return {
    overall,
    performance: Math.round(perfScore),
    energy: Math.round(energyScore),
    security: Math.round(secScore),
    grade: grade(overall),
  };
}

// ─── Rule-Based Fallback Suggestions ─────────────────────────────────────────

export function generateFallbackSuggestions(issues: SmellIssue[]): AISuggestion[] {
  const prioritized = [...issues]
    .sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (order[a.severity] ?? 5) - (order[b.severity] ?? 5);
    })
    .slice(0, 5);

  return prioritized.map((issue) => {
    const fixMap: Record<string, { fixed: string; summary: string }> = {
      'PERF-001': {
        fixed: `# Optimized: replaced nested loop with dict lookup
lookup = {item.key: item for item in collection_b}
for item in collection_a:
    if item.key in lookup:
        process(item, lookup[item.key])`,
        summary: 'Reduced time complexity from O(n²) to O(n) using hash map join.',
      },
      'PERF-002': {
        fixed: `# Optimized: use list + join
parts = []
for item in collection:
    parts.append(process(item))
result = "".join(parts)`,
        summary: 'Eliminated O(n²) string copies by accumulating in list and joining once.',
      },
      'PERF-004': {
        fixed: `# Optimized: batch I/O outside loop
data = read_all_at_once()
for item in data:
    process(item)`,
        summary: 'Moved I/O outside loop, reducing syscall overhead by ~90%.',
      },
      'ENRG-001': {
        fixed: `# Optimized: event-driven instead of polling
import asyncio
async def handler():
    async for event in event_stream():
        await process(event)`,
        summary: 'Replaced busy-wait with event-driven coroutine, reducing idle CPU to ~0%.',
      },
      'ENRG-002': {
        fixed: `# Optimized: buffered batch write
buffer = []
for item in data:
    buffer.append(format(item))
with open(path, 'w') as f:
    f.writelines(buffer)`,
        summary: 'Batched disk writes reduced I/O syscalls by 99%, significantly cutting energy.',
      },
      'ENRG-004': {
        fixed: `# Optimized: batch API calls
import asyncio, aiohttp
async def fetch_all(urls):
    async with aiohttp.ClientSession() as session:
        return await asyncio.gather(*[session.get(u) for u in urls])`,
        summary: 'Concurrent async requests replaced serial loop, cutting total time by ~80%.',
      },
      'SEC-001': {
        fixed: `import ast
# Safe alternative to eval()
def safe_parse(expr: str):
    return ast.literal_eval(expr)`,
        summary: 'Replaced dangerous eval() with ast.literal_eval() — only parses Python literals.',
      },
      'SEC-004': {
        fixed: `import os
# Secrets from environment — never hardcode
API_KEY = os.getenv("API_KEY")
if not API_KEY:
    raise EnvironmentError("API_KEY not set")`,
        summary: 'Moved hardcoded secret to environment variable, eliminating credential exposure.',
      },
      'SEC-007': {
        fixed: `import json
# Safe serialization — no arbitrary code execution
def load_data(raw: str):
    return json.loads(raw)`,
        summary: 'Replaced pickle with JSON, eliminating arbitrary code execution risk.',
      },
      'SEC-010': {
        fixed: `# Parameterized query — immune to SQL injection
cursor.execute(
    "SELECT * FROM users WHERE id = ? AND role = ?",
    (user_id, role)
)`,
        summary: 'Parameterized query prevents SQL injection regardless of input content.',
      },
    };

    const fix = fixMap[issue.rule] ?? {
      fixed: `# Fix for ${issue.rule}\n# ${issue.suggestion}`,
      summary: `Applied best practice fix for ${issue.rule}: ${issue.suggestion}`,
    };

    return {
      issueId: issue.id,
      model: 'Rule-Based Engine',
      explanation: issue.suggestion,
      fixedCode: fix.fixed,
      improvementSummary: fix.summary,
    };
  });
}

// ─── Main Analysis Entry Point ────────────────────────────────────────────────

export async function analyzeCode(
  code: string,
  filename: string,
  language: string,
  onStage: (stage: string, detail?: string) => void
): Promise<AnalysisResult> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const startTime = performance.now();

  onStage('parsing');
  await delay(220);

  // Prefer robust backend analysis if local FastAPI service is available.
  const backend = await tryBackendAnalysis(
    code,
    filename,
    language,
    onStage
  );
  if (backend.result) {
    onStage('done');
    return backend.result;
  }

  // Fallback: in-browser heuristic analyzer.
  await delay(380);
  const metrics = parseCode(code, language);
  const loc = lines(code).filter((l) => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('//')).length;

  onStage('performance');
  await delay(700);
  const perfIssues = detectPerformanceSmells(code);

  onStage('energy');
  await delay(700);
  const energyIssues = detectEnergySmells(code);

  onStage('security');
  await delay(700);
  const secIssues = detectSecuritySmells(code);

  onStage('scoring');
  await delay(500);
  const allIssues = [...perfIssues, ...energyIssues, ...secIssues];
  const trinity = calculateTrinityScore(allIssues, metrics, loc);

  onStage('llm');
  await delay(900);
  const suggestions: AISuggestion[] = generateFallbackSuggestions(allIssues);

  onStage('done');

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

  return {
    filename,
    language,
    loc,
    analysisTime: parseFloat(elapsed),
    trinity,
    issues: allIssues,
    metrics: { ...metrics, securityFindings: secIssues.length },
    suggestions,
    warnings: [
      backend.warning
        ? `Backend unavailable: ${backend.warning}`
        : 'Backend unavailable; browser fallback analyzer used.',
    ],
  };
}
