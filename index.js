#!/usr/bin/env node
// QLN — Quantum Layer Network MCP server entry point
// Semantic tool dispatcher: route 1000 tools through 1 router
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

// Core
const { loadConfig } = require('./lib/config');
const { Store } = require('./lib/store');
const { Embedding } = require('./lib/embedding');
const { Registry } = require('./lib/registry');
const { VectorIndex } = require('./lib/vector-index');
const { Router } = require('./lib/router');
const { Executor } = require('./lib/executor');

// MCP Tools
const { registerRouteTool } = require('./tools/route');
const { registerExecTool } = require('./tools/exec');
const { registerManageTools } = require('./tools/manage');

async function main() {
    const config = loadConfig();

    // 1. Core engine initialization
    const store = new Store(config.dataDir);
    await store.init();

    const embedding = config.embedding?.enabled
        ? new Embedding(config.embedding)
        : null;

    const registry = new Registry(store, embedding);
    registry.load();

    const vectorIndex = new VectorIndex();
    const router = new Router(registry, vectorIndex, embedding);
    const executor = new Executor(config.executor || {});

    // 2. Precompute embeddings + build vector index (async, non-blocking)
    if (embedding) {
        setImmediate(async () => {
            try {
                await registry.precomputeEmbeddings();
                router.buildIndex();
            } catch { /* Ollama not available — Stage 1+2 still work */ }
        });
    }

    // 3. Create MCP server
    const server = new McpServer({
        name: 'n2-qln',
        version: '3.0.0',
    });

    // 4. Register MCP tools
    registerRouteTool(server, z, router);
    registerExecTool(server, z, executor, registry);
    registerManageTools(server, z, registry, router);

    // 5. Connect stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(err => {
    console.error(`[QLN] Fatal: ${err.message}`);
    process.exit(1);
});
