// QLN — Response formatting helpers for qln-call handlers
// Extracted to keep qln-call.ts under 500 lines (Sindri B3 compliance)
import type { McpToolResponse } from '../types';

// ── Constants ──

/** Max result text length before truncation */
export const MAX_RESULT_LENGTH = 4000;

/** Confidence threshold for auto-execution */
export const CONFIDENCE_THRESHOLD = 2.0;

/** Max fallback candidates in auto mode */
export const MAX_FALLBACK = 3;

// ── Response Helpers ──

export function text(msg: string): McpToolResponse {
  return { content: [{ type: 'text', text: msg }] };
}

export function error(message: string): McpToolResponse {
  return { content: [{ type: 'text', text: `⚠️ ${message}` }], isError: true };
}

// ── Stats Formatters ──

/** Format ranked list of tools by a numeric field */
export function formatTopList(
  items: Array<{ name: string; value: number; detail: string }>,
  emptyMsg: string,
): string {
  if (items.length === 0) return `  ${emptyMsg}`;
  return items.map((t, i) => `  ${i + 1}. ${t.name} — ${t.value} ${t.detail}`).join('\n');
}

/** Format key-value breakdown (source/category counts) */
export function formatBreakdown(entries: Record<string, number>): string {
  return Object.entries(entries)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `  ${key}: ${count}`)
    .join('\n') || '  (none)';
}

// ── Auto Result Formatters ──

/** Format successful auto-execution result */
export function formatAutoSuccess(
  query: string,
  candidate: { name: string; score: number },
  timing: { total: number },
  execResult: { result: unknown; source: string; elapsed: number },
  runnersUp: Array<{ name: string; score: number }>,
  fallbackAttempts: Array<{ name: string; error: string }>,
): McpToolResponse {
  const resultStr = typeof execResult.result === 'string'
    ? execResult.result
    : JSON.stringify(execResult.result, null, 2);
  const truncated = resultStr.length > MAX_RESULT_LENGTH
    ? resultStr.substring(0, MAX_RESULT_LENGTH) + '\n... (truncated)'
    : resultStr;

  const altHint = runnersUp.length > 0
    ? `\n\nAlternatives: ${runnersUp.map(r => `${r.name}(${r.score})`).join(', ')}`
    : '';

  const fallbackHint = fallbackAttempts.length > 0
    ? `\n⚡ Fallback: ${fallbackAttempts.map(f => `${f.name}(${f.error})`).join(' → ')} → **${candidate.name}**`
    : '';

  return text(
    `[auto] "${query}" → **${candidate.name}** (score: ${candidate.score}, ` +
    `${timing.total}ms search + ${execResult.elapsed}ms exec, ${execResult.source})${fallbackHint}\n\n` +
    `${truncated}${altHint}`,
  );
}

/** Format all-candidates-failed result */
export function formatAutoAllFailed(
  query: string,
  failedAttempts: Array<{ name: string; error: string }>,
  remaining: Array<{ name: string; score: number; description: string }>,
): McpToolResponse {
  const failedSummary = failedAttempts
    .map((f, i) => `${i + 1}. ${f.name}: ${f.error}`)
    .join('\n');
  const remainingLines = remaining
    .map((r, i) => `${i + 1}. **${r.name}** (${r.score}) — ${r.description || '(no description)'}`)
    .join('\n');

  return {
    content: [{
      type: 'text',
      text: `[auto] All ${failedAttempts.length} candidates failed for "${query}":\n${failedSummary}\n\n` +
        (remainingLines ? `Other options:\n${remainingLines}\n\n` : '') +
        `→ Try: n2_qln_call(action: "search", query: "${query}")`,
    }],
    isError: true,
  };
}

/** Format low-confidence search-only result */
export function formatAutoLowConfidence(
  query: string,
  results: Array<{ name: string; score: number; source: string; category: string; description?: string; inputSchema?: unknown }>,
  timing: { total: number },
): McpToolResponse {
  const lines = results.map((r, i) => {
    const schemaHint = r.inputSchema
      ? ` | args: ${JSON.stringify(Object.keys((r.inputSchema as Record<string, unknown>)?.['properties'] as Record<string, unknown> ?? r.inputSchema ?? {}))}`
      : '';
    return `${i + 1}. **${r.name}** (${r.score}) [${r.source}/${r.category}]${schemaHint}\n   ${r.description || '(no description)'}`;
  });

  return text(
    `[auto] Low confidence — returning search results instead (top: ${results[0]?.score}, threshold: ${CONFIDENCE_THRESHOLD})\n\n` +
    `Route "${query}" (${timing.total}ms):\n\n${lines.join('\n\n')}\n\n` +
    `→ Execute manually: n2_qln_call(action: "exec", tool: "${results[0]?.name}", args: {})`,
  );
}
