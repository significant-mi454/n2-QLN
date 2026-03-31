// QLN — L2 tool index (memory cache + SQLite persistence)
// Tool CRUD, batch registration, embedding precomputation, usage tracking
import { createToolEntry, buildSearchText } from './schema';
import type { Store } from './store';
import type { Embedding } from './embedding';
import type { ToolEntry, RawToolEntry, RegistryStats, EmbeddingPrecomputeResult } from '../types';

/**
 * Tool registry — in-memory cache (Map) + SQLite persistence.
 * Designed for up to 1000 tools.
 */
export class Registry {
  private _store: Store;
  private _embedding: Embedding | null;
  private _cache: Map<string, ToolEntry>;

  constructor(store: Store, embedding: Embedding | null = null) {
    this._store = store;
    this._embedding = embedding;
    this._cache = new Map();
  }

  /** Load all entries from SQLite into memory cache */
  load(): void {
    this._cache.clear();
    const rows = this._store.loadAll();
    for (const row of rows) {
      this._cache.set(row.name as string, this._rowToEntry(row));
    }
  }

  // ── CRUD ──

  /**
   * Register a tool (update if exists, preserve existing stats).
   */
  register(raw: RawToolEntry): ToolEntry {
    const entry = createToolEntry(raw);
    const existing = this._cache.get(entry.name);
    if (existing) {
      entry.usageCount = existing.usageCount || entry.usageCount;
      entry.successRate = existing.successRate ?? entry.successRate;
      if (existing.embedding && !entry.embedding) {
        entry.embedding = existing.embedding;
      }
    }
    entry.searchText = buildSearchText(entry);
    this._cache.set(entry.name, entry);
    this._store.upsert(entry);
    return entry;
  }

  /** Batch register tools. */
  registerBatch(tools: RawToolEntry[]): number {
    let count = 0;
    for (const raw of tools) {
      try { this.register(raw); count++; }
      catch { /* skip invalid */ }
    }
    return count;
  }

  /** Remove a tool. */
  remove(name: string): boolean {
    const had = this._cache.has(name);
    this._cache.delete(name);
    if (had) this._store.remove(name);
    return had;
  }

  /** Purge all tools by source (for re-sync). */
  purgeBySource(source: string): number {
    const toDelete: string[] = [];
    for (const [name, entry] of this._cache) {
      if (entry.source === source) toDelete.push(name);
    }
    for (const name of toDelete) this._cache.delete(name);
    this._store.purgeBySource(source);
    return toDelete.length;
  }

  get(name: string): ToolEntry | null {
    return this._cache.get(name) || null;
  }

  getAll(): ToolEntry[] {
    return Array.from(this._cache.values());
  }

  get size(): number {
    return this._cache.size;
  }

  /** Remove all tools by provider name. */
  removeByProvider(providerName: string): number {
    const toRemove: string[] = [];
    for (const [name, entry] of this._cache) {
      if (entry.provider === providerName) toRemove.push(name);
    }
    for (const name of toRemove) {
      this.remove(name);
    }
    return toRemove.length;
  }

  // ── Embeddings ──

  /** Precompute embeddings for tools without one. */
  async precomputeEmbeddings(): Promise<EmbeddingPrecomputeResult> {
    if (!this._embedding) return { embedded: 0, skipped: 0, failed: 0 };
    const available = await this._embedding.isAvailable();
    if (!available) return { embedded: 0, skipped: 0, failed: 0 };

    let embedded = 0, skipped = 0, failed = 0;
    for (const [, entry] of this._cache) {
      if (entry.embedding) { skipped++; continue; }
      try {
        const text = entry.searchText || buildSearchText(entry);
        const vec = await this._embedding.embed(text);
        if (vec.length > 0) {
          entry.embedding = vec;
          this._store.upsert(entry);
          embedded++;
        } else { failed++; }
      } catch { failed++; }
    }
    return { embedded, skipped, failed };
  }

  // ── Usage tracking ──

  /** Record tool usage + circuit breaker state. */
  recordUsage(name: string, success: boolean = true): void {
    const entry = this._cache.get(name);
    if (!entry) return;
    entry.usageCount++;
    entry.lastUsedAt = new Date().toISOString();
    const alpha = 0.1;
    entry.successRate = entry.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
    // Circuit breaker tracking
    if (success) {
      entry.consecutiveFailures = 0;
    } else {
      entry.consecutiveFailures = (entry.consecutiveFailures || 0) + 1;
    }
    entry.updatedAt = new Date().toISOString();
    this._store.upsert(entry);
  }

  // ── Stats ──

  stats(): RegistryStats {
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let withEmbedding = 0;
    for (const entry of this._cache.values()) {
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
      if (entry.embedding) withEmbedding++;
    }
    return {
      total: this._cache.size,
      bySource,
      byCategory,
      withEmbedding,
      embeddingCoverage: this._cache.size > 0
        ? Math.round((withEmbedding / this._cache.size) * 100) + '%' : '0%',
    };
  }

  // ── Internal ──

  /** Convert SQLite row to tool entry */
  private _rowToEntry(row: Record<string, unknown>): ToolEntry {
    return {
      name: (row.name as string) || '',
      description: (row.description as string) || '',
      source: (row.source as string) || 'unknown',
      category: (row.category as string) || 'misc',
      provider: (row.provider as string) || (row.plugin_name as string) || '',
      inputSchema: _parseJson(row.input_schema as string, null),
      triggers: _parseJson(row.triggers as string, []),
      tags: _parseJson(row.tags as string, []),
      examples: _parseJson(row.examples as string, []),
      endpoint: (row.endpoint as string) || '',
      searchText: (row.search_text as string) || '',
      boostKeywords: (row.boost_keywords as string) || '',
      embedding: _parseJson(row.embedding as string, null),
      usageCount: (row.usage_count as number) || 0,
      successRate: (row.success_rate as number) ?? 1.0,
      consecutiveFailures: (row.consecutive_failures as number) || 0,
      lastUsedAt: (row.last_used_at as string) || null,
      registeredAt: (row.registered_at as string) || '',
      updatedAt: (row.updated_at as string) || '',
    };
  }
}

function _parseJson<T>(str: string | null | undefined, fallback: T): T {
  if (!str || str === '') return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}
