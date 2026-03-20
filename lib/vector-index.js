// QLN — Float32Array vector index (centroid hierarchy)
// Stage 3 semantic search only. ~3ms search at 1000 tools.

/**
 * Vector index — Float32Array matrix + category centroid partitioned search.
 *
 * Scaling:
 *   100 tools → ~1ms
 *   1,000 tools → ~3ms
 *   10,000 tools → ~5ms (centroid hierarchy)
 */
class VectorIndex {
    constructor() {
        /** @type {Float32Array|null} N tools × D dimensions */
        this._matrix = null;
        /** @type {string[]} Tool names (matrix row order) */
        this._names = [];
        /** @type {number} Embedding dimension */
        this._dim = 0;
        /** @type {number} Number of indexed tools */
        this._count = 0;
        /** @type {Map<string, Float32Array>} Category → centroid vector */
        this._centroids = new Map();
        /** @type {Map<string, number[]>} Category → matrix row indices */
        this._partitions = new Map();
        this._built = false;
    }

    /**
     * Build vector index from tool entries.
     * Only indexes tools with embeddings, computes per-category centroids.
     * @param {object[]} tools
     * @returns {{indexed: number, categories: number, dimension: number}}
     */
    build(tools) {
        const valid = tools.filter(t => t.embedding && Array.isArray(t.embedding) && t.embedding.length > 0);
        if (valid.length === 0) {
            this._built = false;
            return { indexed: 0, categories: 0, dimension: 0 };
        }

        this._dim = valid[0].embedding.length;
        this._count = valid.length;
        this._names = valid.map(t => t.name);

        // Pack into Float32Array matrix
        this._matrix = new Float32Array(this._count * this._dim);
        for (let i = 0; i < this._count; i++) {
            const vec = valid[i].embedding;
            for (let j = 0; j < this._dim; j++) {
                this._matrix[i * this._dim + j] = vec[j] || 0;
            }
        }

        // Build category partitions
        this._partitions.clear();
        this._centroids.clear();
        for (let i = 0; i < valid.length; i++) {
            const cat = valid[i].category || 'misc';
            if (!this._partitions.has(cat)) this._partitions.set(cat, []);
            this._partitions.get(cat).push(i);
        }

        // Compute centroids (category average vector)
        for (const [cat, indices] of this._partitions) {
            const centroid = new Float32Array(this._dim);
            for (const idx of indices) {
                const offset = idx * this._dim;
                for (let j = 0; j < this._dim; j++) {
                    centroid[j] += this._matrix[offset + j];
                }
            }
            const n = indices.length;
            for (let j = 0; j < this._dim; j++) centroid[j] /= n;
            this._centroids.set(cat, centroid);
        }

        this._built = true;
        return { indexed: this._count, categories: this._partitions.size, dimension: this._dim };
    }

    /**
     * Centroid hierarchy search — top-K categories → scan within partition.
     * @param {number[]} queryVec
     * @param {number} topK
     * @param {number} topCategories
     * @returns {{name: string, score: number}[]}
     */
    search(queryVec, topK = 10, topCategories = 4) {
        if (!this._built || !this._matrix || !queryVec || queryVec.length !== this._dim) return [];

        const qVec = new Float32Array(queryVec);

        // Step 1: Rank categories by centroid similarity
        const catScores = [];
        for (const [cat, centroid] of this._centroids) {
            catScores.push({ cat, score: this._cosineSim(qVec, centroid) });
        }
        catScores.sort((a, b) => b.score - a.score);
        const selectedCats = catScores.slice(0, topCategories).map(c => c.cat);

        // Step 2: Search individual tools within selected partitions
        const candidates = [];
        for (const cat of selectedCats) {
            for (const idx of (this._partitions.get(cat) || [])) {
                const toolVec = this._matrix.subarray(idx * this._dim, (idx + 1) * this._dim);
                candidates.push({ name: this._names[idx], score: this._cosineSim(qVec, toolVec) });
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates.slice(0, topK);
    }

    /** @returns {object} */
    stats() {
        return {
            built: this._built,
            tools: this._count,
            dimension: this._dim,
            categories: this._partitions.size,
            categoryList: Array.from(this._partitions.keys()),
            memoryKB: this._matrix ? Math.round(this._matrix.byteLength / 1024) : 0,
        };
    }

    /** Reset index */
    reset() {
        this._matrix = null;
        this._names = [];
        this._dim = 0;
        this._count = 0;
        this._centroids.clear();
        this._partitions.clear();
        this._built = false;
    }

    /** @private Cosine similarity */
    _cosineSim(a, b) {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }
}

module.exports = { VectorIndex };
