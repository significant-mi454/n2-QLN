// QLN MCP tool — n2_qln_call (unified tool: search/exec/create/update/delete)
// Single entry point for all QLN operations. ~200 tokens in AI context.
const { validateToolEntry, validateUpdateEntry, formatValidationErrors } = require('../lib/validator');

/**
 * Register the unified n2_qln_call MCP tool.
 * @param {object} server - MCP server
 * @param {object} z - Zod validator
 * @param {import('../lib/router').Router} router - L1 search engine
 * @param {import('../lib/executor').Executor} executor - L3 tool executor
 * @param {import('../lib/registry').Registry} registry - L2 tool index
 */
function registerQlnCall(server, z, router, executor, registry) {
    server.tool(
        'n2_qln_call',
        {
            title: 'QLN Call',
            description:
                'Query Layer Network — unified tool dispatcher. ' +
                'Search 1000+ tools, execute them, or manage the index. ' +
                'Actions: search, exec, create, update, delete.',
            inputSchema: {
                action: z.enum(['search', 'exec', 'create', 'update', 'delete'])
                    .describe('Action: search | exec | create | update | delete'),
                // search
                query: z.string().optional()
                    .describe('[search] Natural language query (e.g. "take a screenshot")'),
                topK: z.number().optional()
                    .describe('[search] Number of results (default: 5, max: 20)'),
                // exec
                tool: z.string().optional()
                    .describe('[exec/update/delete] Tool name'),
                args: z.record(z.unknown()).optional()
                    .describe('[exec] Tool arguments (JSON object)'),
                // create / update
                name: z.string().optional()
                    .describe('[create/update] Tool name (unique identifier)'),
                description: z.string().optional()
                    .describe('[create/update] Tool description (used for search matching)'),
                source: z.string().optional()
                    .describe('[create/update] Source: mcp, plugin, local (default: local)'),
                category: z.string().optional()
                    .describe('[create/update] Category: web, data, file, dev, ai, capture, misc'),
                toolSchema: z.record(z.unknown()).optional()
                    .describe('[create/update] JSON Schema for tool input'),
                tags: z.array(z.string()).optional()
                    .describe('[create/update] Additional search tags'),
                provider: z.string().optional()
                    .describe('[create/update] Provider name (e.g. "n2-browser", "pdf-tools")'),
                examples: z.array(z.string()).optional()
                    .describe('[create/update] Usage examples (e.g. ["read this PDF file", "extract text from PDF"])'),
                endpoint: z.string().optional()
                    .describe('[create/update] Execution HTTP endpoint'),
            },
        },
        async (params) => {
            switch (params.action) {
                case 'search': return _handleSearch(router, params);
                case 'exec':   return _handleExec(executor, registry, params);
                case 'create': return _handleCreate(registry, router, params);
                case 'update': return _handleUpdate(registry, router, params);
                case 'delete': return _handleDelete(registry, router, params);
                default:
                    return _error(`Unknown action: ${params.action}`);
            }
        }
    );
}

// ── Action Handlers ──

/** Search tools by natural language query */
async function _handleSearch(router, { query, topK }) {
    if (!query) return _error('Missing required param: query');
    try {
        const k = Math.min(topK || 5, 20);
        const { results, timing } = await router.route(query, { topK: k });

        if (results.length === 0) {
            return _text(`No tools found for: "${query}" (${timing.total}ms)`);
        }

        const lines = results.map((r, i) => {
            const schemaHint = r.inputSchema
                ? ` | args: ${JSON.stringify(Object.keys(r.inputSchema.properties || r.inputSchema || {}))}`
                : '';
            return `${i + 1}. **${r.name}** (${r.score}) [${r.source}/${r.category}]${schemaHint}\n   ${r.description || '(no description)'}`;
        });

        const top = results[0];
        const hint = `\n→ Execute: n2_qln_call(action: "exec", tool: "${top.name}", args: {})`;

        return _text(
            `Route "${query}" (${timing.total}ms, stages: T${timing.stage1}+K${timing.stage2}+S${timing.stage3}ms):\n\n` +
            `${lines.join('\n\n')}${hint}`
        );
    } catch (err) {
        return _error(`Search failed: ${err.message}`);
    }
}

/** Execute a tool by name */
async function _handleExec(executor, registry, { tool: toolName, args }) {
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
    } catch (err) {
        registry.recordUsage(toolName, false);
        return { content: [{ type: 'text', text: `❌ [${toolName}] failed: ${err.message}` }], isError: true };
    }
}

/** Create (register) a new tool — with enforced validation */
async function _handleCreate(registry, router, params) {
    // Step 1: Forced validation (validator.rs pattern)
    const validation = validateToolEntry(params, registry);
    if (!validation.valid) {
        return { content: [{ type: 'text', text: formatValidationErrors(validation.errors) }], isError: true };
    }

    try {
        // Step 2: Register with auto-enrichment
        const entry = registry.register({
            name: params.name,
            description: params.description,
            source: params.source || 'local',
            category: params.category || undefined,
            provider: params.provider || '',
            inputSchema: params.toolSchema,
            tags: params.tags,
            examples: params.examples || [],
            endpoint: params.endpoint || '',
        });

        // Step 3: Rebuild vector index
        const indexResult = router.buildIndex();

        // Step 4: Return with warnings if any
        const warnings = validation.errors.filter(e => e.severity === 'warning');
        const warnMsg = warnings.length > 0
            ? `\n${formatValidationErrors(warnings)}`
            : '';

        return _text(
            `✅ Created: ${entry.name} [${entry.source}/${entry.category}]\n` +
            `Provider: ${entry.provider || '(none)'}\n` +
            `Triggers: ${entry.triggers.join(', ')}\n` +
            `Examples: ${entry.examples.length}\n` +
            `Index: ${indexResult.indexed} tools, ${indexResult.categories} categories${warnMsg}`
        );
    } catch (err) {
        return _error(`Create failed: ${err.message}`);
    }
}

/** Update an existing tool — with validation */
async function _handleUpdate(registry, router, params) {
    const toolName = params.tool || params.name;
    if (!toolName) return _error('Missing required param: tool (or name)');

    const existing = registry.get(toolName);
    if (!existing) return _error(`Tool not found: ${toolName}`);

    // Validate changed fields
    const validation = validateUpdateEntry(params, existing);
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
            `Index: ${indexResult.indexed} tools, ${indexResult.categories} categories`
        );
    } catch (err) {
        return _error(`Update failed: ${err.message}`);
    }
}

/** Delete tool(s) — by name or by provider */
async function _handleDelete(registry, router, params) {
    const toolName = params.tool || params.name;

    // Provider-level delete: remove all tools of a provider
    if (params.provider && !toolName) {
        const count = registry.removeByProvider(params.provider);
        if (count === 0) return _error(`No tools found for provider: ${params.provider}`);
        const indexResult = router.buildIndex();
        return _text(
            `✅ Deleted ${count} tools from provider: ${params.provider}\n` +
            `Index: ${indexResult.indexed} tools, ${indexResult.categories} categories`
        );
    }

    // Single tool delete
    if (!toolName) return _error('Missing required param: tool (or name). For bulk delete, use provider param.');

    const removed = registry.remove(toolName);
    if (!removed) return _error(`Tool not found: ${toolName}`);

    const indexResult = router.buildIndex();
    return _text(
        `✅ Deleted: ${toolName}\n` +
        `Index: ${indexResult.indexed} tools, ${indexResult.categories} categories`
    );
}

// ── Response Helpers ──

function _text(text) {
    return { content: [{ type: 'text', text }] };
}

function _error(message) {
    return { content: [{ type: 'text', text: `⚠️ ${message}` }], isError: true };
}

module.exports = { registerQlnCall };
