// QLN — L1 Router (3-Stage parallel search engine)
// Query → Stage1(Trigger) + Stage2(Keyword) + Stage3(Semantic) → Merge → Top-K
const { buildSearchText } = require('./schema');

/**
 * 3-Stage search engine.
 *
 * Score formula:
 *   final = trigger×3.0 + keyword×1.0 + semantic×2.0
 *         + log2(usageCount+1)×0.5 + successRate×1.0
 */
class Router {
    /**
     * @param {import('./registry').Registry} registry
     * @param {import('./vector-index').VectorIndex} vectorIndex
     * @param {import('./embedding').Embedding} [embedding]
     */
    constructor(registry, vectorIndex, embedding = null) {
        this._registry = registry;
        this._vectorIndex = vectorIndex;
        this._embedding = embedding;
    }

    /**
     * Route natural language query to tools.
     * @param {string} query - Natural language (e.g. "take a screenshot")
     * @param {{topK?: number, threshold?: number}} [options]
     * @returns {Promise<{results: object[], timing: object}>}
     */
    async route(query, options = {}) {
        const topK = options.topK || 5;
        const threshold = options.threshold || 0.1;
        const scores = new Map();
        const timing = { stage1: 0, stage2: 0, stage3: 0, merge: 0, total: 0 };
        const t0 = Date.now();

        // Stage 1: Trigger exact match (fastest)
        const t1 = Date.now();
        this._stage1TriggerMatch(query, scores);
        timing.stage1 = Date.now() - t1;

        // Stage 2: Keyword match (search_text LIKE)
        const t2 = Date.now();
        this._stage2KeywordMatch(query, scores);
        timing.stage2 = Date.now() - t2;

        // Stage 3: Semantic vector search (when embedding available)
        const t3 = Date.now();
        await this._stage3SemanticSearch(query, scores);
        timing.stage3 = Date.now() - t3;

        // Merge: Calculate final scores
        const t4 = Date.now();
        const results = this._mergeAndRank(scores, topK, threshold);
        timing.merge = Date.now() - t4;
        timing.total = Date.now() - t0;

        return { results, timing };
    }

    /** Stage 1: Trigger word exact match. Weight: 3.0 */
    _stage1TriggerMatch(query, scores) {
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
        for (const tool of this._registry.getAll()) {
            const triggers = tool.triggers || [];
            let hits = 0;
            for (const word of queryWords) {
                if (triggers.some(t => t === word || t.includes(word))) hits++;
            }
            if (hits > 0) {
                this._getOrCreate(scores, tool.name).stage1 = hits * 3.0;
            }
        }
    }

    /** Stage 2: search_text keyword match. Weight: 1.0 */
    _stage2KeywordMatch(query, scores) {
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        for (const tool of this._registry.getAll()) {
            const text = (tool.searchText || buildSearchText(tool)).toLowerCase();
            let matchCount = 0;
            for (const word of queryWords) {
                if (text.includes(word)) matchCount++;
            }
            if (matchCount > 0) {
                this._getOrCreate(scores, tool.name).stage2 =
                    (matchCount / Math.max(queryWords.length, 1)) * 1.0;
            }
        }
    }

    /** Stage 3: Semantic vector search. Weight: 2.0 */
    async _stage3SemanticSearch(query, scores) {
        if (!this._embedding || !this._vectorIndex) return;
        try {
            const available = await this._embedding.isAvailable();
            if (!available) return;
            const queryVec = await this._embedding.embed(query);
            if (!queryVec || queryVec.length === 0) return;
            const semanticResults = this._vectorIndex.search(queryVec, 20);
            for (const r of semanticResults) {
                this._getOrCreate(scores, r.name).stage3 = r.score * 2.0;
            }
        } catch { /* graceful degradation */ }
    }

    /** Merge all stage results + usage/success bonus + recency decay → ranking */
    _mergeAndRank(scores, topK, threshold) {
        const results = [];
        for (const [name, s] of scores) {
            const tool = this._registry.get(name);
            if (!tool) continue;

            // Recency Decay: usage bonus fades over 30-day half-life
            const daysSinceUse = tool.lastUsedAt
                ? (Date.now() - new Date(tool.lastUsedAt).getTime()) / 86400000
                : 0;
            const recencyFactor = tool.lastUsedAt ? Math.exp(-daysSinceUse / 30) : 1.0;
            const usageBonus = Math.log2((tool.usageCount || 0) + 1) * 0.5 * recencyFactor;

            const successBonus = (tool.successRate ?? 1.0) * 1.0;
            const finalScore = (s.stage1 || 0) + (s.stage2 || 0) + (s.stage3 || 0)
                + usageBonus + successBonus;
            if (finalScore >= threshold) {
                results.push({
                    name,
                    score: Math.round(finalScore * 100) / 100,
                    stages: {
                        trigger: s.stage1 || 0,
                        keyword: s.stage2 || 0,
                        semantic: s.stage3 || 0,
                        usage: Math.round(usageBonus * 100) / 100,
                        success: Math.round(successBonus * 100) / 100,
                        recencyFactor: Math.round(recencyFactor * 1000) / 1000,
                    },
                    description: tool.description,
                    source: tool.source,
                    category: tool.category,
                    inputSchema: tool.inputSchema,
                });
            }
        }
        results.sort((a, b) => b.score - a.score);
        const ranked = results.slice(0, topK);

        // 5% Explorer: inject least-used tool into last slot
        if (ranked.length >= topK && topK >= 2) {
            const resultNames = new Set(ranked.map(r => r.name));
            const allTools = this._registry.getAll()
                .filter(t => !resultNames.has(t.name))
                .sort((a, b) => (a.usageCount || 0) - (b.usageCount || 0));
            if (allTools.length > 0) {
                const explorer = allTools[0];
                ranked[ranked.length - 1] = {
                    name: explorer.name,
                    score: 0,
                    stages: { trigger: 0, keyword: 0, semantic: 0, usage: 0, success: 0, recencyFactor: 0 },
                    description: explorer.description,
                    source: explorer.source,
                    category: explorer.category,
                    inputSchema: explorer.inputSchema,
                    explorer: true,
                };
            }
        }

        return ranked;
    }

    /** Build vector index */
    buildIndex() {
        return this._vectorIndex.build(this._registry.getAll());
    }

    /** @private */
    _getOrCreate(scores, name) {
        if (!scores.has(name)) scores.set(name, { stage1: 0, stage2: 0, stage3: 0 });
        return scores.get(name);
    }

    /** @returns {object} */
    stats() {
        return {
            registrySize: this._registry.size,
            vectorIndex: this._vectorIndex.stats(),
            embeddingAvailable: !!this._embedding,
        };
    }
}

module.exports = { Router };
