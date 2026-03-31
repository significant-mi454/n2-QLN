// QLN — L1 Router (3-Stage parallel search engine)
// Query → Stage1(Trigger) + Stage2(BM25 Keyword) + Stage3(Semantic) → Merge → Top-K
import { buildSearchText } from './schema';
import type { Registry } from './registry';
import type { VectorIndex } from './vector-index';
import type { Embedding } from './embedding';
import type { SearchResult, SearchTiming, StageScores, RouterStats } from '../types';

/**
 * 3-Stage search engine.
 *
 * Score formula:
 *   final = (trigger×3.0 + bm25_keyword×1.0 + semantic×2.0
 *         + log2(usageCount+1)×0.5 + successRate×1.0) × sourceWeight
 */
export class Router {
  private _registry: Registry;
  private _vectorIndex: VectorIndex;
  private _embedding: Embedding | null;

  // BM25 parameters (standard Okapi BM25 defaults)
  private _k1: number = 1.2;
  private _b: number = 0.75;

  // IDF cache (rebuilt when tools change)
  private _idfCache: Map<string, number> = new Map();
  private _avgDocLen: number = 0;
  private _idfDirty: boolean = true;
  // Source weights (per-source score multiplier)
  private _sourceWeights: Record<string, number>;

  constructor(
    registry: Registry,
    vectorIndex: VectorIndex,
    embedding: Embedding | null = null,
    sourceWeights: Record<string, number> = {},
  ) {
    this._registry = registry;
    this._vectorIndex = vectorIndex;
    this._embedding = embedding;
    this._sourceWeights = sourceWeights;
  }

  /**
   * Route natural language query to tools.
   */
  async route(query: string, options: { topK?: number; threshold?: number } = {}): Promise<{ results: SearchResult[]; timing: SearchTiming }> {
    const topK = options.topK || 5;
    const threshold = options.threshold || 0.1;
    const scores = new Map<string, StageScores>();
    const timing: SearchTiming = { stage1: 0, stage2: 0, stage3: 0, merge: 0, total: 0 };
    const t0 = Date.now();

    // Rebuild IDF if registry changed
    if (this._idfDirty) this._buildIDF();

    // Stage 1: Trigger exact match (fastest)
    const t1 = Date.now();
    this._stage1TriggerMatch(query, scores);
    timing.stage1 = Date.now() - t1;

    // Stage 2: BM25 keyword search
    const t2 = Date.now();
    this._stage2BM25(query, scores);
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
  private _stage1TriggerMatch(query: string, scores: Map<string, StageScores>): void {
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

  /** Stage 2: BM25 keyword search. Weight: 1.0 */
  private _stage2BM25(query: string, scores: Map<string, StageScores>): void {
    const queryTerms = this._tokenize(query);
    if (queryTerms.length === 0) return;

    for (const tool of this._registry.getAll()) {
      const text = (tool.searchText || buildSearchText(tool)).toLowerCase();
      const bm25 = this._bm25Score(queryTerms, text);
      if (bm25 > 0) {
        this._getOrCreate(scores, tool.name).stage2 = bm25 * 1.0;
      }
    }
  }

  /** Calculate BM25 score for a query against a document. */
  private _bm25Score(queryTerms: string[], docText: string): number {
    const docTerms = docText.split(/[\s_\-./]+/).filter(w => w.length > 1);
    const docLen = docTerms.length;
    if (docLen === 0) return 0;

    // Build term frequency map for this document
    const tf = new Map<string, number>();
    for (const term of docTerms) {
      tf.set(term, (tf.get(term) || 0) + 1);
    }

    let score = 0;
    for (const term of queryTerms) {
      const idf = this._idfCache.get(term) || 0;
      const freq = tf.get(term) || 0;
      if (freq === 0) continue;

      // BM25 formula: IDF × (f × (k1+1)) / (f + k1 × (1 - b + b × |d|/avgDL))
      const numerator = freq * (this._k1 + 1);
      const denominator = freq + this._k1 * (1 - this._b + this._b * (docLen / this._avgDocLen));
      score += idf * (numerator / denominator);
    }

    return score;
  }

  /**
   * Build IDF cache from all registered tools.
   * IDF(term) = ln((N - n(t) + 0.5) / (n(t) + 0.5) + 1)
   */
  private _buildIDF(): void {
    const tools = this._registry.getAll();
    const N = tools.length;
    if (N === 0) {
      this._idfDirty = false;
      return;
    }

    const docFreq = new Map<string, number>();
    let totalLen = 0;

    for (const tool of tools) {
      const text = (tool.searchText || buildSearchText(tool)).toLowerCase();
      const terms = text.split(/[\s_\-./]+/).filter(w => w.length > 1);
      totalLen += terms.length;

      const uniqueTerms = new Set(terms);
      for (const term of uniqueTerms) {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      }
    }

    this._avgDocLen = totalLen / N;

    this._idfCache.clear();
    for (const [term, df] of docFreq) {
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      this._idfCache.set(term, idf);
    }

    this._idfDirty = false;
  }

  /** Tokenize query string into search terms. */
  private _tokenize(query: string): string[] {
    return query.toLowerCase().split(/[\s_\-./]+/).filter(w => w.length > 2);
  }

  /** Stage 3: Semantic vector search. Weight: 2.0 */
  private async _stage3SemanticSearch(query: string, scores: Map<string, StageScores>): Promise<void> {
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
  private _mergeAndRank(scores: Map<string, StageScores>, topK: number, threshold: number): SearchResult[] {
    const results: SearchResult[] = [];
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
      const rawScore = (s.stage1 || 0) + (s.stage2 || 0) + (s.stage3 || 0)
        + usageBonus + successBonus;

      // Apply source weight multiplier (default: 1.0)
      const sourceWeight = this._sourceWeights[tool.source] ?? 1.0;
      const finalScore = rawScore * sourceWeight;
      if (finalScore >= threshold) {
        results.push({
          name,
          score: Math.round(finalScore * 100) / 100,
          stages: {
            trigger: s.stage1 || 0, keyword: s.stage2 || 0, semantic: s.stage3 || 0,
            usage: Math.round(usageBonus * 100) / 100,
            success: Math.round(successBonus * 100) / 100,
            recencyFactor: Math.round(recencyFactor * 1000) / 1000,
          },
          description: tool.description, source: tool.source,
          category: tool.category, inputSchema: tool.inputSchema,
        });
      }
    }
    results.sort((a, b) => b.score - a.score);
    const ranked = results.slice(0, topK);
    this._injectExplorer(ranked);
    return ranked;
  }

  /** 5% Explorer: append least-used tool as bonus slot (never replaces regular results) */
  private _injectExplorer(ranked: SearchResult[]): void {
    if (ranked.length < 2 || Math.random() >= 0.05) return;
    const resultNames = new Set(ranked.map(r => r.name));
    const allTools = this._registry.getAll()
      .filter(t => !resultNames.has(t.name))
      .sort((a, b) => (a.usageCount || 0) - (b.usageCount || 0));
    if (allTools.length > 0) {
      const explorer = allTools[0];
      ranked.push({
        name: explorer.name, score: 0,
        stages: { trigger: 0, keyword: 0, semantic: 0, usage: 0, success: 0, recencyFactor: 0 },
        description: explorer.description, source: explorer.source,
        category: explorer.category, inputSchema: explorer.inputSchema,
        explorer: true,
      });
    }
  }

  /** Build vector index and refresh IDF cache */
  buildIndex(): { indexed: number; categories: number; dimension: number } {
    this._idfDirty = true;
    return this._vectorIndex.build(this._registry.getAll());
  }

  /** Mark IDF cache as dirty (call after tool registration changes) */
  invalidateIDF(): void {
    this._idfDirty = true;
  }

  private _getOrCreate(scores: Map<string, StageScores>, name: string): StageScores {
    if (!scores.has(name)) scores.set(name, { stage1: 0, stage2: 0, stage3: 0 });
    return scores.get(name)!;
  }

  stats(): RouterStats {
    return {
      registrySize: this._registry.size,
      vectorIndex: this._vectorIndex.stats(),
      embeddingAvailable: !!this._embedding,
      bm25: {
        idfTerms: this._idfCache.size,
        avgDocLen: Math.round(this._avgDocLen * 10) / 10,
        k1: this._k1,
        b: this._b,
      },
    };
  }
}
