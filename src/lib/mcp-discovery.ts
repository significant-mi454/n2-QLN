// QLN — MCP Auto-Discovery: scan connected MCP servers and auto-index their tools
// Killer feature: QLN becomes the universal MCP hub
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { inferCategory } from './schema';
import type { Registry } from './registry';
import type { Router } from './router';
import type { RawToolEntry } from '../types';

/** MCP server connection config */
export interface McpServerConfig {
  /** Unique name for this server */
  name: string;
  /** Command to launch the server (e.g., 'node', 'python') */
  command: string;
  /** Arguments for the command */
  args: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
}

/** Discovery result for a single server */
export interface DiscoveryResult {
  server: string;
  status: 'success' | 'failed' | 'timeout';
  toolCount: number;
  tools: string[];
  error?: string;
  elapsed: number;
}

/** Full auto-discovery result */
export interface AutoDiscoveryResult {
  total: number;
  registered: number;
  servers: DiscoveryResult[];
  elapsed: number;
}

/**
 * MCP Auto-Discovery engine.
 *
 * Connects to external MCP servers, lists their tools,
 * and registers them in the QLN index for semantic routing.
 *
 * Usage:
 *   const discovery = new McpDiscovery(registry, router);
 *   const result = await discovery.discoverAll(serverConfigs);
 */
export class McpDiscovery {
  private _registry: Registry;
  private _router: Router;
  private _timeout: number;
  /** Active MCP client connections (for live proxy execution) */
  private _clients: Map<string, Client>;

  constructor(registry: Registry, router: Router, timeout: number = 15000) {
    this._registry = registry;
    this._router = router;
    this._timeout = timeout;
    this._clients = new Map();
  }

  /**
   * Discover tools from all configured MCP servers.
   * Connects to each server, lists tools, registers in QLN.
   */
  async discoverAll(servers: McpServerConfig[]): Promise<AutoDiscoveryResult> {
    const t0 = Date.now();
    const results: DiscoveryResult[] = [];
    let totalRegistered = 0;

    for (const server of servers) {
      const result = await this._discoverServer(server);
      results.push(result);
      totalRegistered += result.toolCount;
    }

    // Rebuild index after all servers discovered
    if (totalRegistered > 0) {
      this._router.buildIndex();
    }

    return {
      total: results.reduce((sum, r) => sum + r.toolCount, 0),
      registered: totalRegistered,
      servers: results,
      elapsed: Date.now() - t0,
    };
  }

  /**
   * Discover tools from a single MCP server.
   */
  async discoverServer(config: McpServerConfig): Promise<DiscoveryResult> {
    const result = await this._discoverServer(config);
    if (result.toolCount > 0) {
      this._router.buildIndex();
    }
    return result;
  }

  /**
   * Get active client connection for live tool execution.
   */
  getClient(serverName: string): Client | null {
    return this._clients.get(serverName) || null;
  }

  /**
   * Disconnect all active clients.
   */
  async disconnectAll(): Promise<void> {
    for (const [name, client] of this._clients) {
      try {
        await client.close();
      } catch {
        console.error(`[QLN] Discovery: failed to disconnect ${name}`);
      }
    }
    this._clients.clear();
  }

  /**
   * Disconnect a single server.
   */
  async disconnect(serverName: string): Promise<boolean> {
    const client = this._clients.get(serverName);
    if (!client) return false;
    try {
      await client.close();
    } catch { /* ignore */ }
    this._clients.delete(serverName);
    // Purge tools from this server
    this._registry.purgeBySource(`mcp:${serverName}`);
    this._router.buildIndex();
    return true;
  }

  /** @internal Connect to a single MCP server and list its tools. */
  private async _discoverServer(config: McpServerConfig): Promise<DiscoveryResult> {
    const t0 = Date.now();
    const result: DiscoveryResult = {
      server: config.name, status: 'failed', toolCount: 0, tools: [], elapsed: 0,
    };

    let transport: StdioClientTransport | null = null;
    let timeoutId: NodeJS.Timeout | null = null;

    try {
      const { client, transport: t, timer } = await this._connectServer(config);
      transport = t;
      timeoutId = timer;

      const toolsResult = await client.listTools();
      const tools = toolsResult.tools || [];

      if (tools.length === 0) {
        result.status = 'success';
        result.elapsed = Date.now() - t0;
        await client.close();
        return result;
      }

      result.toolCount = this._indexTools(config.name, tools);
      this._clients.set(config.name, client);
      result.status = 'success';
      result.tools = tools.map(t => t.name);
      result.elapsed = Date.now() - t0;
      console.error(`[QLN] Discovery: ${config.name} → ${result.toolCount} tools (${result.elapsed}ms)`);
    } catch (err: unknown) {
      if (timeoutId) clearTimeout(timeoutId);
      try { if (transport) await transport.close(); } catch { /* ignore */ }
      const msg = err instanceof Error ? err.message : String(err);
      result.status = msg.includes('timeout') ? 'timeout' : 'failed';
      result.error = msg;
      result.elapsed = Date.now() - t0;
      console.error(`[QLN] Discovery: ${config.name} failed — ${msg}`);
    }

    return result;
  }

  /** @internal Create transport + client, connect with timeout. */
  private async _connectServer(config: McpServerConfig): Promise<{
    client: Client; transport: StdioClientTransport; timer: NodeJS.Timeout | null;
  }> {
    const transport = new StdioClientTransport({
      command: config.command, args: config.args,
      env: config.env
        ? Object.fromEntries(
            Object.entries({ ...process.env, ...config.env })
              .filter((pair): pair is [string, string] => pair[1] !== undefined),
          )
        : undefined,
      cwd: config.cwd,
    });

    const client = new Client(
      { name: `qln-discovery-${config.name}`, version: '1.0.0' },
      { capabilities: {} },
    );

    let timeoutId: NodeJS.Timeout | null = null;
    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Connection timeout (${this._timeout}ms)`)), this._timeout);
    });

    await Promise.race([connectPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    return { client, transport, timer: timeoutId };
  }

  /** @internal Purge old entries + register discovered tools. */
  private _indexTools(serverName: string, tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): number {
    this._registry.purgeBySource(`mcp:${serverName}`);

    const rawTools: RawToolEntry[] = tools.map(tool => ({
      name: `mcp__${serverName}__${tool.name}`,
      description: tool.description || '',
      source: `mcp:${serverName}`,
      category: inferCategory(tool.name, 'mcp'),
      provider: serverName,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? null,
      tags: [`mcp`, serverName, tool.name],
      boostKeywords: this._generateBoostKeywords(tool.name, tool.description || ''),
    }));

    return this._registry.registerBatch(rawTools);
  }

  /**
   * Generate boost keywords from tool name and description.
   * Extracts action verbs and key nouns for BM25 boosting.
   */
  private _generateBoostKeywords(name: string, description: string): string {
    // Split camelCase/snake_case tool name into words
    const nameWords = name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-.]/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2);

    // Extract first sentence of description
    const firstSentence = description.split(/[.!?]/)[0] || '';
    const descWords = firstSentence
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 5);

    // Combine unique words (max 10)
    const combined = [...new Set([...nameWords, ...descWords])].slice(0, 10);
    return combined.join(' ');
  }
}
