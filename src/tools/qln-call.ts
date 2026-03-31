// QLN MCP tool — n2_qln_call (unified tool: search/exec/create/update/delete/discover)
// Single entry point for all QLN operations. ~200 tokens in AI context.
import { validateToolEntry, validateUpdateEntry, formatValidationErrors, type ValidatableParams } from '../lib/validator';
import type { Router } from '../lib/router';
import type { Executor } from '../lib/executor';
import type { Registry } from '../lib/registry';
import type { McpDiscovery, McpServerConfig } from '../lib/mcp-discovery';
import type { McpToolResponse } from '../types';
import {
  text as _text, error as _error,
  CONFIDENCE_THRESHOLD, MAX_FALLBACK, MAX_RESULT_LENGTH,
  formatBreakdown, formatTopList,
  formatAutoSuccess, formatAutoAllFailed, formatAutoLowConfidence,
} from './qln-helpers';

/** Zod-like validator interface (minimal) */
interface ZodLike {
  enum(values: readonly string[]): { describe(d: string): unknown };
  string(): { optional(): { describe(d: string): unknown } };
  number(): { optional(): { describe(d: string): unknown } };
  record(v: unknown): { optional(): { describe(d: string): unknown } };
  array(v: unknown): { optional(): { describe(d: string): unknown } };
  unknown(): unknown;
}

/** MCP server interface (minimal — uses any to match SDK's complex overloads) */
interface McpServerLike {
  tool(...args: unknown[]): unknown;
}

/** QlnCall input params */
interface QlnCallParams {
  action: 'search' | 'exec' | 'auto' | 'stats' | 'create' | 'update' | 'delete' | 'inject' | 'discover';
  query?: string;
  topK?: number;
  tool?: string;
  args?: Record<string, unknown>;
  name?: string;
  description?: string;
  source?: string;
  category?: string;
  toolSchema?: Record<string, unknown>;
  tags?: string[];
  provider?: string;
  examples?: string[];
  endpoint?: string;
  /** [inject] Array of tools for bulk registration */
  tools?: Array<Record<string, unknown>>;
  /** [discover] MCP server configurations to scan */
  servers?: McpServerConfig[];
  /** [discover] Single server config shorthand */
  command?: string;
  [key: string]: unknown;
}

/** Build Zod schema for n2_qln_call input */
function _buildSchema(z: ZodLike): Record<string, unknown> {
  return {
    action: z.enum(['search', 'exec', 'auto', 'stats', 'create', 'update', 'delete', 'inject', 'discover'])
      .describe('Action: search | exec | auto | stats | create | update | delete | inject | discover'),
    query: z.string().optional().describe('[search] Natural language query'),
    topK: z.number().optional().describe('[search] Number of results (default: 5, max: 20)'),
    tool: z.string().optional().describe('[exec/update/delete] Tool name'),
    args: z.record(z.unknown()).optional().describe('[exec] Tool arguments (JSON object)'),
    name: z.string().optional().describe('[create/update] Tool name (unique identifier)'),
    description: z.string().optional().describe('[create/update] Tool description'),
    source: z.string().optional().describe('[create/update] Source: mcp, plugin, local'),
    category: z.string().optional().describe('[create/update] Category: web, data, file, dev, ai, capture, misc'),
    toolSchema: z.record(z.unknown()).optional().describe('[create/update] JSON Schema for tool input'),
    tags: z.array(z.string()).optional().describe('[create/update] Additional search tags'),
    provider: z.string().optional().describe('[create/update] Provider name'),
    examples: z.array(z.string()).optional().describe('[create/update] Usage examples'),
    endpoint: z.string().optional().describe('[create/update] Execution HTTP endpoint'),
    tools: z.array(z.record(z.unknown())).optional().describe('[inject] Array of tool objects for bulk registration'),
    servers: z.array(z.record(z.unknown())).optional().describe('[discover] MCP server configs: [{name, command, args}]'),
    command: z.string().optional().describe('[discover] Single server command shorthand'),
  };
}

/**
 * Register the unified n2_qln_call MCP tool.
 */
export function registerQlnCall(
  server: McpServerLike,
  z: ZodLike,
  router: Router,
  executor: Executor,
  registry: Registry,
  discovery?: McpDiscovery | null,
): void {
  const DESCRIPTION = 'Query Layer Network — unified tool dispatcher. Search 1000+ tools, execute them, or manage the index. Actions: search, exec, auto (search+exec), stats, create, update, delete, inject, discover (scan MCP servers).';

  server.tool('n2_qln_call', DESCRIPTION, _buildSchema(z),
    async (rawParams: Record<string, unknown>): Promise<McpToolResponse> => {
      const params = rawParams as unknown as QlnCallParams;
      try {
        switch (params.action) {
          case 'search':   return await _handleSearch(router, registry, params);
          case 'exec':     return await _handleExec(executor, registry, params);
          case 'auto':     return await _handleAuto(router, executor, registry, params);
          case 'stats':    return _handleStats(router, registry, executor);
          case 'create':   return await _handleCreate(registry, router, params);
          case 'update':   return await _handleUpdate(registry, router, params);
          case 'delete':   return await _handleDelete(registry, router, params);
          case 'inject':   return _handleInject(registry, router, params);
          case 'discover': return await _handleDiscover(discovery, params);
          default:
            return _error(`Unknown action: ${params.action}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return _error(`QLN internal error: ${msg}. Try the action again or use raw tool calls as fallback.`);
      }
    },
  );
}

// ── Action Handlers ──

/** Stats: registry + router + usage dashboard + circuit breaker */
function _handleStats(router: Router, registry: Registry, executor: Executor): McpToolResponse {
  const regStats = registry.stats();
  const routerStats = router.stats();
  const allTools = registry.getAll();

  const topUsed = allTools.filter(t => t.usageCount > 0)
    .sort((a, b) => b.usageCount - a.usageCount).slice(0, 10)
    .map(t => ({ name: t.name, value: t.usageCount, detail: `calls (${Math.round(t.successRate * 100)}% success)` }));

  const recentUsed = allTools.filter(t => t.lastUsedAt)
    .sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || '')).slice(0, 5)
    .map(t => `  ${t.name} — ${t.lastUsedAt}`).join('\n');

  const tripped = executor.getTrippedCircuits();
  const circuitLines = tripped.length > 0
    ? tripped.map(c => `  ⚡ ${c.name}: ${c.state} (${c.failures} failures)`).join('\n')
    : '  (all circuits healthy)';

  const unstable = allTools.filter(t => t.consecutiveFailures >= 2)
    .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures).slice(0, 5)
    .map(t => `  ⚠️ ${t.name}: ${t.consecutiveFailures} consecutive failures`).join('\n');

  return _text(
    `📊 QLN Stats\n\n` +
    `Tools: ${regStats.total} | Embedding: ${regStats.embeddingCoverage}\n` +
    `BM25: ${routerStats.bm25.idfTerms} terms, avgDocLen ${routerStats.bm25.avgDocLen}\n` +
    `Vector: ${routerStats.vectorIndex.tools} indexed, ${routerStats.vectorIndex.dimension}d, ${routerStats.vectorIndex.memoryKB}KB\n\n` +
    `By source:\n${formatBreakdown(regStats.bySource)}\n\n` +
    `By category:\n${formatBreakdown(regStats.byCategory)}\n\n` +
    `Top used:\n${formatTopList(topUsed, '(no usage data)')}\n\n` +
    `Recently used:\n${recentUsed || '  (none)'}\n\n` +
    `Circuit Breaker:\n${circuitLines}\n` +
    (unstable ? `\nUnstable tools:\n${unstable}` : ''),
  );
}

/** Auto: search → pick top → exec → fallback chain. */
async function _handleAuto(
  router: Router, executor: Executor, registry: Registry,
  { query, args, topK }: QlnCallParams,
): Promise<McpToolResponse> {
  if (!query) return _error('Missing required param: query');

  const k = Math.min(topK || 5, 20);
  const { results, timing } = await router.route(query, { topK: k });

  if (results.length === 0) {
    const stats = registry.stats();
    const cats = Object.entries(stats.byCategory).map(([c, n]) => `${c}(${n})`).join(', ');
    return _text(`[auto] No tools found for: "${query}" (${timing.total}ms)\n\nCategories [${stats.total}]: ${cats || 'none'}\n→ Try a different keyword.`);
  }

  if (results[0].score < CONFIDENCE_THRESHOLD) {
    return formatAutoLowConfidence(query, results, timing);
  }

  return await _execWithFallback(executor, registry, query, results, timing, args || {});
}

/** @internal Execute top candidates with fallback chain. */
async function _execWithFallback(
  executor: Executor, registry: Registry, query: string,
  results: Array<{ name: string; score: number; description?: string }>,
  timing: { total: number }, execArgs: Record<string, unknown>,
): Promise<McpToolResponse> {
  const candidates = results.filter(r => r.score >= CONFIDENCE_THRESHOLD).slice(0, MAX_FALLBACK);
  const failedAttempts: Array<{ name: string; error: string }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const execResult = await executor.exec(candidate.name, execArgs);
      registry.recordUsage(candidate.name, true);
      const runnersUp = results.slice(i + 1, i + 4);
      return formatAutoSuccess(query, candidate, timing, execResult, runnersUp, failedAttempts);
    } catch (err: unknown) {
      registry.recordUsage(candidate.name, false);
      const msg = err instanceof Error ? err.message : String(err);
      failedAttempts.push({ name: candidate.name, error: msg.slice(0, 50) });
    }
  }

  const remaining = results.slice(candidates.length, candidates.length + 3)
    .map(r => ({ name: r.name, score: (r as { score: number }).score, description: r.description || '' }));
  return formatAutoAllFailed(query, failedAttempts, remaining);
}

/** Search tools by natural language query */
async function _handleSearch(
  router: Router,
  registry: Registry,
  { query, topK }: QlnCallParams,
): Promise<McpToolResponse> {
  if (!query) return _error('Missing required param: query');
  try {
    const k = Math.min(topK || 5, 20);
    const { results, timing } = await router.route(query, { topK: k });

    if (results.length === 0) {
      const stats = registry.stats();
      const categories = Object.entries(stats.byCategory)
        .map(([cat, count]) => `${cat}(${count})`)
        .join(', ');
      return _text(
        `No tools found for: "${query}" (${timing.total}ms)\n\n` +
        `Available categories [${stats.total} tools]: ${categories || 'none'}\n` +
        `→ Try a different keyword, or check available categories above.`,
      );
    }

    const lines = results.map((r, i) => {
      const schemaHint = r.inputSchema
        ? ` | args: ${JSON.stringify(Object.keys((r.inputSchema as Record<string, unknown>)?.['properties'] as Record<string, unknown> ?? r.inputSchema ?? {}))}`
        : '';
      return `${i + 1}. **${r.name}** (${r.score}) [${r.source}/${r.category}]${schemaHint}\n   ${r.description || '(no description)'}`;
    });

    const top = results[0];
    const hint = `\n→ Execute: n2_qln_call(action: "exec", tool: "${top.name}", args: {})`;

    return _text(
      `Route "${query}" (${timing.total}ms, stages: T${timing.stage1}+K${timing.stage2}+S${timing.stage3}ms):\n\n` +
      `${lines.join('\n\n')}${hint}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return _error(`Search failed: ${msg}`);
  }
}

/** Execute a tool by name */
async function _handleExec(
  executor: Executor,
  registry: Registry,
  { tool: toolName, args }: QlnCallParams,
): Promise<McpToolResponse> {
  if (!toolName) return _error('Missing required param: tool');
  try {
    const { result, source, elapsed } = await executor.exec(toolName, args || {});
    registry.recordUsage(toolName, true);

    const resultStr = typeof result === 'string'
      ? result
      : JSON.stringify(result, null, 2);

    const truncated = resultStr.length > 4000
      ? resultStr.substring(0, 4000) + '\n... (truncated)'
      : resultStr;

    return _text(`✅ [${toolName}] (${source}, ${elapsed}ms):\n${truncated}`);
  } catch (err: unknown) {
    registry.recordUsage(toolName, false);
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `❌ [${toolName}] failed: ${msg}` }], isError: true };
  }
}

/** Create (register) a new tool — with enforced validation */
async function _handleCreate(
  registry: Registry,
  router: Router,
  params: QlnCallParams,
): Promise<McpToolResponse> {
  const validation = validateToolEntry(params, registry);
  if (!validation.valid) {
    return { content: [{ type: 'text', text: formatValidationErrors(validation.errors) }], isError: true };
  }

  try {
    const entry = registry.register({
      name: params.name!,
      description: params.description,
      source: params.source || 'local',
      category: params.category || undefined,
      provider: params.provider || '',
      inputSchema: params.toolSchema,
      tags: params.tags,
      examples: params.examples || [],
      endpoint: params.endpoint || '',
    });

    const indexResult = router.buildIndex();

    const warnings = validation.errors.filter(e => e.severity === 'warning');
    const warnMsg = warnings.length > 0
      ? `\n${formatValidationErrors(warnings)}`
      : '';

    return _text(
      `✅ Created: ${entry.name} [${entry.source}/${entry.category}]\n` +
      `Provider: ${entry.provider || '(none)'}\n` +
      `Triggers: ${entry.triggers.join(', ')}\n` +
      `Examples: ${entry.examples.length}\n` +
      `Index: ${indexResult.indexed} tools, ${indexResult.categories} categories${warnMsg}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return _error(`Create failed: ${msg}`);
  }
}

/** Update an existing tool — with validation */
async function _handleUpdate(
  registry: Registry,
  router: Router,
  params: QlnCallParams,
): Promise<McpToolResponse> {
  const toolName = params.tool || params.name;
  if (!toolName) return _error('Missing required param: tool (or name)');

  const existing = registry.get(toolName);
  if (!existing) return _error(`Tool not found: ${toolName}`);

  const validation = validateUpdateEntry(params, existing as unknown as ValidatableParams);
  if (!validation.valid) {
    return { content: [{ type: 'text', text: formatValidationErrors(validation.errors) }], isError: true };
  }

  try {
    const entry = registry.register({
      name: toolName,
      description: params.description || existing.description,
      source: params.source || existing.source,
      category: params.category || existing.category,
      provider: params.provider || existing.provider,
      inputSchema: params.toolSchema || existing.inputSchema,
      tags: params.tags || existing.tags,
      examples: params.examples || existing.examples,
      endpoint: params.endpoint || existing.endpoint,
    });

    const indexResult = router.buildIndex();
    return _text(
      `✅ Updated: ${entry.name} [${entry.source}/${entry.category}]\n` +
      `Provider: ${entry.provider || '(none)'}\n` +
      `Triggers: ${entry.triggers.join(', ')}\n` +
      `Index: ${indexResult.indexed} tools, ${indexResult.categories} categories`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return _error(`Update failed: ${msg}`);
  }
}

/** Delete tool(s) — by name or by provider */
async function _handleDelete(
  registry: Registry,
  router: Router,
  params: QlnCallParams,
): Promise<McpToolResponse> {
  const toolName = params.tool || params.name;

  // Provider-level delete
  if (params.provider && !toolName) {
    const count = registry.removeByProvider(params.provider);
    if (count === 0) return _error(`No tools found for provider: ${params.provider}`);
    const indexResult = router.buildIndex();
    return _text(
      `✅ Deleted ${count} tools from provider: ${params.provider}\n` +
      `Index: ${indexResult.indexed} tools, ${indexResult.categories} categories`,
    );
  }

  // Single tool delete
  if (!toolName) return _error('Missing required param: tool (or name). For bulk delete, use provider param.');

  const removed = registry.remove(toolName);
  if (!removed) return _error(`Tool not found: ${toolName}`);

  const indexResult = router.buildIndex();
  return _text(
    `✅ Deleted: ${toolName}\n` +
    `Index: ${indexResult.indexed} tools, ${indexResult.categories} categories`,
  );
}

/** Inject: bulk register tools from array (e.g. MCP server boot) */
function _handleInject(
  registry: Registry,
  router: Router,
  { tools, source, provider }: QlnCallParams,
): McpToolResponse {
  if (!tools || !Array.isArray(tools) || tools.length === 0) {
    return _error('Missing required param: tools (array of tool objects with at least "name" and "description")');
  }

  let registered = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const raw of tools) {
    try {
      if (!raw.name || typeof raw.name !== 'string') {
        skipped++;
        errors.push(`Skipped: missing name`);
        continue;
      }
      registry.register({
        name: raw.name as string,
        description: (raw.description as string) || '',
        source: (raw.source as string) || source || 'local',
        category: (raw.category as string) || undefined,
        provider: (raw.provider as string) || provider || '',
        inputSchema: (raw.inputSchema as Record<string, unknown>) || null,
        tags: (raw.tags as string[]) || [],
        examples: (raw.examples as string[]) || [],
        endpoint: (raw.endpoint as string) || '',
      });
      registered++;
    } catch (err: unknown) {
      skipped++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${raw.name || '?'}: ${msg}`);
    }
  }

  const indexResult = router.buildIndex();

  const errorMsg = errors.length > 0
    ? `\n\nWarnings (${errors.length}):\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n... and ${errors.length - 5} more` : ''}`
    : '';

  return _text(
    `✅ Injected: ${registered}/${tools.length} tools` +
    `${skipped > 0 ? ` (${skipped} skipped)` : ''}\n` +
    `Source: ${source || 'local'} | Provider: ${provider || '(none)'}\n` +
    `Index: ${indexResult.indexed} tools, ${indexResult.categories} categories${errorMsg}`,
  );
}

// ── MCP Auto-Discovery ──

/** Discover: scan MCP servers and auto-index their tools */
async function _handleDiscover(
  discovery: McpDiscovery | null | undefined,
  { servers, name, command, args }: QlnCallParams,
): Promise<McpToolResponse> {
  if (!discovery) {
    return _error('MCP Auto-Discovery not initialized. Pass McpDiscovery instance to registerQlnCall().');
  }

  const serverConfigs = _buildDiscoverConfigs(servers, name, command, args);
  if (!serverConfigs) {
    return _error('Missing params for discover. Provide:\n  servers: [{name, command, args}]\n  or: name + command + args');
  }

  for (const cfg of serverConfigs) {
    if (!cfg.name || !cfg.command) return _error(`Invalid config: name and command required. Got: ${JSON.stringify(cfg)}`);
    if (!cfg.args) cfg.args = [];
  }

  const result = await discovery.discoverAll(serverConfigs);
  return _formatDiscoverResult(result);
}

/** @internal Parse discover params into server configs. */
function _buildDiscoverConfigs(
  servers: McpServerConfig[] | undefined,
  name: string | undefined, command: string | undefined, args: Record<string, unknown> | undefined,
): McpServerConfig[] | null {
  if (servers && Array.isArray(servers)) return servers as McpServerConfig[];
  if (command) {
    return [{ name: (name as string) || 'default', command, args: (args ? Object.values(args).map(String) : []) as string[] }];
  }
  return null;
}

/** @internal Format discovery results for MCP response. */
function _formatDiscoverResult(result: { servers: Array<{ server: string; status: string; toolCount: number; tools: string[]; error?: string; elapsed: number }>; registered: number; elapsed: number }): McpToolResponse {
  const lines = result.servers.map(s => {
    if (s.status === 'success') {
      const list = s.tools.length <= 10 ? s.tools.join(', ') : s.tools.slice(0, 10).join(', ') + ` ... +${s.tools.length - 10} more`;
      return `  ✅ ${s.server}: ${s.toolCount} tools (${s.elapsed}ms)\n     ${list}`;
    }
    return `  ❌ ${s.server}: ${s.status} — ${s.error || 'unknown'} (${s.elapsed}ms)`;
  }).join('\n');

  return _text(`🔍 MCP Auto-Discovery Complete\n\nServers: ${result.servers.length} | Tools: ${result.registered} (${result.elapsed}ms)\n\n${lines}\n\n→ Search: n2_qln_call(action: "search", query: "...")`);
}
