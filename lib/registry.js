// QLN — L2 tool index (memory cache + SQLite persistence)
// Tool CRUD, batch registration, embedding precomputation, usage tracking
const { createToolEntry, buildSearchText } = require('./schema');

/**
 * Tool registry — in-memory cache (Map) + SQLite persistence.
 * Designed for up to 1000 tools.
 */
class Registry {
    /**
     * @param {import('./store').Store} store - SQLite store
     * @param {import('./embedding').Embedding} [embedding] - Embedding engine (optional)
     */
    constructor(store, embedding = null) {
        this._store = store;
        this._embedding = embedding;
        /** @type {Map<string, object>} name → tool entry */
        this._cache = new Map();
    }

    /** Load all entries from SQLite into memory cache */
    load() {
        this._cache.clear();
        const rows = this._store.loadAll();
        for (const row of rows) {
            this._cache.set(row.name, this._rowToEntry(row));
        }
    }

    // ── CRUD ──

    /**
     * Register a tool (update if exists, preserve existing stats).
     * @param {object} raw - Raw tool data
     * @returns {object} Normalized tool entry
     */
    register(raw) {
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

    /**
     * Batch register tools.
     * @param {object[]} tools
     * @returns {number} Number of registered tools
     */
    registerBatch(tools) {
        let count = 0;
        for (const raw of tools) {
            try { this.register(raw); count++; }
            catch { /* skip invalid */ }
        }
        return count;
    }

    /**
     * Remove a tool.
     * @param {string} name
     * @returns {boolean}
     */
    remove(name) {
        const had = this._cache.has(name);
        this._cache.delete(name);
        if (had) this._store.remove(name);
        return had;
    }

    /**
     * Purge all tools by source (for re-sync).
     * @param {string} source
     * @returns {number} Number deleted
     */
    purgeBySource(source) {
        let deleted = 0;
        for (const [name, entry] of this._cache) {
            if (entry.source === source) {
                this._cache.delete(name);
                deleted++;
            }
        }
        this._store.purgeBySource(source);
        return deleted;
    }

    /** @param {string} name @returns {object|null} */
    get(name) { return this._cache.get(name) || null; }

    /** @returns {object[]} */
    getAll() { return Array.from(this._cache.values()); }

    /** @returns {number} */
    get size() { return this._cache.size; }

    // ── Embeddings ──

    /**
     * Precompute embeddings for tools without one.
     * @returns {Promise<{embedded: number, skipped: number, failed: number}>}
     */
    async precomputeEmbeddings() {
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

    /**
     * Record tool usage.
     * @param {string} name
     * @param {boolean} success
     */
    recordUsage(name, success = true) {
        const entry = this._cache.get(name);
        if (!entry) return;
        entry.usageCount++;
        const alpha = 0.1;
        entry.successRate = entry.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
        entry.updatedAt = new Date().toISOString();
        this._store.upsert(entry);
    }

    // ── Stats ──

    /** @returns {object} */
    stats() {
        const bySource = {};
        const byCategory = {};
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
    _rowToEntry(row) {
        return {
            name: row.name,
            description: row.description || '',
            source: row.source || 'unknown',
            category: row.category || 'misc',
            pluginName: row.plugin_name || '',
            inputSchema: _parseJson(row.input_schema, null),
            triggers: _parseJson(row.triggers, []),
            tags: _parseJson(row.tags, []),
            searchText: row.search_text || '',
            embedding: _parseJson(row.embedding, null),
            usageCount: row.usage_count || 0,
            successRate: row.success_rate ?? 1.0,
            registeredAt: row.registered_at,
            updatedAt: row.updated_at,
        };
    }
}

function _parseJson(str, fallback) {
    if (!str || str === '') return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = { Registry };
