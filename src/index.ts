#!/usr/bin/env node
// QLN — Query Layer Network MCP server entry point
// Semantic tool dispatcher: route 1000 tools through 1 router
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import path from 'path';

// Core modules
import { loadConfig } from './lib/config';
import { Store } from './lib/store';
import { Embedding } from './lib/embedding';
import { Registry } from './lib/registry';
import { VectorIndex } from './lib/vector-index';
import { Router } from './lib/router';
import { Executor } from './lib/executor';
import { loadProviders, watchProviders } from './lib/provider-loader';
import { McpDiscovery } from './lib/mcp-discovery';

// MCP Tool (unified)
import { registerQlnCall } from './tools/qln-call';

/** Load provider manifests into registry */
function initProviders(config: ReturnType<typeof loadConfig>, registry: Registry): void {
  if (config.providers?.enabled === false) return;
  const provDir = config.providers?.dir || path.join(__dirname, '..', 'providers');
  const provResult = loadProviders(provDir, registry);
  if (provResult.loaded > 0) {
    console.error(`[QLN] Providers: ${provResult.loaded} tools from ${provResult.details.filter(d => d.status === 'loaded').length} files`);
  }
  if (provResult.failed > 0) {
    console.error(`[QLN] Provider warnings: ${provResult.failed} files failed to load`);
  }
}

/** Schedule async embedding precompute (non-blocking) */
function scheduleEmbeddings(embedding: Embedding | null, registry: Registry, router: Router): void {
  if (!embedding) return;
  setImmediate(async () => {
    try {
      await registry.precomputeEmbeddings();
      router.buildIndex();
    } catch { /* Ollama not available — Stage 1+2 still work */ }
  });
}

async function main(): Promise<void> {
  const config = loadConfig();

  // 1. Core engine initialization
  const store = new Store(config.dataDir);
  await store.init();

  const embedding = config.embedding?.enabled
    ? new Embedding(config.embedding)
    : null;

  const registry = new Registry(store, embedding);
  registry.load();

  // 1.5. Provider auto-indexing
  initProviders(config, registry);

  const vectorIndex = new VectorIndex();
  const router = new Router(registry, vectorIndex, embedding, config.search?.sourceWeights || {});
  const executor = new Executor(config.executor || {});
  const discovery = new McpDiscovery(registry, router);

  // 2. Precompute embeddings (async, non-blocking)
  scheduleEmbeddings(embedding, registry, router);

  // 3. Create MCP server + register tool
  const pkg = require('../package.json') as { version: string };
  const server = new McpServer({ name: 'n2-qln', version: pkg.version });
  registerQlnCall(server, z, router, executor, registry, discovery);

  // 4. Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 5. Hot Reload: watch providers dir for changes
  if (config.providers?.enabled !== false) {
    const provDir = config.providers?.dir || path.join(__dirname, '..', 'providers');
    watchProviders(provDir, registry, () => {
      router.buildIndex();
    });
  }
}

main().catch((err: Error) => {
  console.error(`[QLN] Fatal: ${err.message}`);
  process.exit(1);
});
