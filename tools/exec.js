// QLN MCP tool — qln_exec (tool execution)
// Execute tools found via qln_route. Local handler or HTTP proxy.

/**
 * Register qln_exec MCP tool.
 * @param {object} server - MCP server
 * @param {object} z - Zod validator
 * @param {import('../lib/executor').Executor} executor - QLN executor
 * @param {import('../lib/registry').Registry} registry - For usage tracking
 */
function registerExecTool(server, z, executor, registry) {
    server.registerTool(
        'qln_exec',
        {
            title: 'QLN Execute',
            description: 'Execute a tool by name with arguments. Use qln_route first to find the right tool. Example: tool="take_screenshot", args={fullPage: true}',
            inputSchema: {
                tool: z.string().describe('Tool name to execute'),
                args: z.record(z.unknown()).default({}).describe('Tool arguments (JSON object)'),
            },
        },
        async ({ tool: toolName, args }) => {
            try {
                const { result, source, elapsed } = await executor.exec(toolName, args || {});

                // Record usage
                registry.recordUsage(toolName, true);

                const resultStr = typeof result === 'string'
                    ? result
                    : JSON.stringify(result, null, 2);

                const truncated = resultStr.length > 4000
                    ? resultStr.substring(0, 4000) + '\n... (truncated)'
                    : resultStr;

                return {
                    content: [{
                        type: 'text',
                        text: `✅ [${toolName}] (${source}, ${elapsed}ms):\n${truncated}`,
                    }],
                };
            } catch (err) {
                // Record failure
                registry.recordUsage(toolName, false);

                return {
                    content: [{
                        type: 'text',
                        text: `❌ [${toolName}] failed: ${err.message}`,
                    }],
                    isError: true,
                };
            }
        }
    );
}

module.exports = { registerExecTool };
