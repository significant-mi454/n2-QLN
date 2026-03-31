// QLN — Embedding engine (Ollama nomic-embed-text)
// Vector embedding generation for semantic search (Stage 3)
import http from 'http';

interface EmbeddingConfig {
  model?: string;
  endpoint?: string;
}

/**
 * Ollama-based local embedding engine.
 * Graceful degradation when unavailable — Stage 1+2 still work.
 */
export class Embedding {
  private model: string;
  private endpoint: string;
  public dimensions: number | null;
  private _available: boolean | null;

  constructor(config: EmbeddingConfig = {}) {
    this.model = config.model || 'nomic-embed-text';
    this.endpoint = config.endpoint || 'http://127.0.0.1:11434';
    this.dimensions = null;
    this._available = null;
  }

  /** Check Ollama availability (cached). */
  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available;
    try {
      const vec = await this.embed('test');
      this._available = vec.length > 0;
      this.dimensions = vec.length;
      return this._available;
    } catch {
      this._available = false;
      return false;
    }
  }

  /** Generate vector embedding from text. */
  async embed(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) return [];
    const input = text.length > 2000 ? text.slice(0, 2000) : text;

    for (const apiPath of ['/api/embeddings', '/api/embed']) {
      try {
        const body = apiPath === '/api/embeddings'
          ? { model: this.model, prompt: input }
          : { model: this.model, input: input };
        const result = await this._post(apiPath, body) as Record<string, unknown>;

        if (result.embedding && Array.isArray(result.embedding)) {
          this.dimensions = result.embedding.length;
          return result.embedding as number[];
        }
        if (result.embeddings && Array.isArray(result.embeddings) && (result.embeddings as number[][])[0]) {
          this.dimensions = (result.embeddings as number[][])[0].length;
          return (result.embeddings as number[][])[0];
        }
      } catch { continue; }
    }
    return [];
  }

  /** Batch embedding generation. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  /** Cosine similarity between two vectors. */
  cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /** @internal HTTP POST to Ollama API */
  private _post(apiPath: string, body: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint);
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 11434,
        path: apiPath,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      };
      const req = http.request(options, (res: http.IncomingMessage) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Ollama ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error(`Invalid JSON: ${data.slice(0, 100)}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(JSON.stringify(body));
      req.end();
    });
  }
}
