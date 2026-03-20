// QLN MCP tools — qln_register / qln_stats (management)
// External tool registration + stats retrieval

/**
 * Register management MCP tools.
 * @param {object} server - MCP server
 * @param {object} z - Zod validator
 * @param {import('../lib/registry').Registry} registry
 * @param {import('../lib/router').Router} router
 */
function registerManageTools(server, z, registry, router) {

    // ── qln_register: Tool registration ──
    server.registerTool(
        'qln_register',
        {
            title: 'QLN Register Tool',
            description: 'Register a new tool in the QLN index. Provide name, description, and optionally category, source, inputSchema.',
            inputSchema: {
                name: z.string().describe('Tool name (unique identifier)'),
                description: z.string().describe('Tool description (used for search)'),
                source: z.string().optional().describe('Source: mcp, plugin, local (default: local)'),
                category: z.string().optional().describe('Category: web, data, file, dev, ai, capture, misc'),
                inputSchema: z.record(z.unknown()).optional().describe('JSON Schema for tool input'),
                tags: z.array(z.string()).optional().describe('Additional search tags'),
            },
        },
        async ({ name, description, source, category, inputSchema, tags }) => {
            try {
                const entry = registry.register({
                    name,
                    description,
                    source: source || 'local',
                    category: category || undefined,
                    inputSchema,
                    tags,
                });

                // Rebuild vector index (reflect new tool)
                const indexResult = router.buildIndex();

                return {
                    content: [{
                        type: 'text',
                        text: `✅ Registered: ${entry.name} [${entry.source}/${entry.category}]\n` +
                            `Triggers: ${entry.triggers.join(', ')}\n` +
                            `Index: ${indexResult.indexed} tools, ${indexResult.categories} categories`,
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text', text: `Register error: ${err.message}` }] };
            }
        }
    );

    // ── qln_stats: Stats retrieval ──
    server.registerTool(
        'qln_stats',
        {
            title: 'QLN Stats',
            description: 'Show QLN tool index statistics: total tools, categories, embedding coverage, vector index status.',
            inputSchema: {},
        },
        async () => {
            const regStats = registry.stats();
            const routerStats = router.stats();

            const lines = [
                `# QLN Stats`,
                ``,
                `## Registry`,
                `- Total: ${regStats.total} tools`,
                `- Embedding: ${regStats.embeddingCoverage}`,
                `- By source: ${JSON.stringify(regStats.bySource)}`,
                `- By category: ${JSON.stringify(regStats.byCategory)}`,
                ``,
                `## Vector Index`,
                `- Built: ${routerStats.vectorIndex.built}`,
                `- Indexed: ${routerStats.vectorIndex.tools} tools`,
                `- Dimension: ${routerStats.vectorIndex.dimension}`,
                `- Categories: ${routerStats.vectorIndex.categories}`,
                `- Memory: ${routerStats.vectorIndex.memoryKB}KB`,
            ];

            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
    );
}

module.exports = { registerManageTools };
