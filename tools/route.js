// QLN MCP tool — qln_route (natural language → tool search)
// Core tool exposed to AI context. Search 1000 tools via natural language.

/**
 * Register qln_route MCP tool.
 * @param {object} server - MCP server
 * @param {object} z - Zod validator
 * @param {import('../lib/router').Router} router - QLN router
 */
function registerRouteTool(server, z, router) {
    server.registerTool(
        'qln_route',
        {
            title: 'QLN Route',
            description: 'Search for the best matching tool by natural language query. Returns top-K results with scores and schemas. Use this to find tools before calling qln_exec.',
            inputSchema: {
                query: z.string().describe('Natural language query (e.g. "take a screenshot", "extract links from page")'),
                topK: z.number().optional().describe('Number of results to return (default: 5, max: 20)'),
            },
        },
        async ({ query, topK }) => {
            try {
                const k = Math.min(topK || 5, 20);
                const { results, timing } = await router.route(query, { topK: k });

                if (results.length === 0) {
                    return { content: [{ type: 'text', text: `No tools found for: "${query}" (${timing.total}ms)` }] };
                }

                const top = results[0];
                const lines = results.map((r, i) => {
                    const schemaHint = r.inputSchema
                        ? ` | args: ${JSON.stringify(Object.keys(r.inputSchema.properties || r.inputSchema || {}))}`
                        : '';
                    return `${i + 1}. **${r.name}** (${r.score}) [${r.source}/${r.category}]${schemaHint}\n   ${r.description || '(no description)'}`;
                });

                const hint = `\n→ Execute: qln_exec(tool: "${top.name}", args: {})`;

                return {
                    content: [{
                        type: 'text',
                        text: `Route "${query}" (${timing.total}ms, stages: T${timing.stage1}+K${timing.stage2}+S${timing.stage3}ms):\n\n${lines.join('\n\n')}${hint}`,
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text', text: `Route error: ${err.message}` }] };
            }
        }
    );
}

module.exports = { registerRouteTool };
