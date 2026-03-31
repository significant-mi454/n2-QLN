// QLN — Shared type definitions for all modules

/** Normalized tool entry stored in registry + SQLite */
export interface ToolEntry {
  name: string;
  description: string;
  source: string;
  category: string;
  provider: string;
  inputSchema: Record<string, unknown> | null;
  triggers: string[];
  tags: string[];
  examples: string[];
  endpoint: string;
  searchText: string;
  /** 3-10 word capability phrase for BM25 search boosting */
  boostKeywords: string;
  usageCount: number;
  successRate: number;
  /** Consecutive failure count for circuit breaker */
  consecutiveFailures: number;
  lastUsedAt: string | null;
  embedding: number[] | null;
  registeredAt: string;
  updatedAt: string;
}

/** Raw tool data before normalization (partial fields accepted) */
export interface RawToolEntry {
  name: string;
  description?: string;
  source?: string;
  category?: string;
  provider?: string;
  pluginName?: string;
  inputSchema?: Record<string, unknown> | null;
  triggers?: string[];
  tags?: string[];
  examples?: string[];
  endpoint?: string;
  /** 3-10 word capability phrase for BM25 search boosting */
  boostKeywords?: string;
  usageCount?: number;
  successRate?: number;
  lastUsedAt?: string | null;
  embedding?: number[] | null;
  registeredAt?: string;
}

/** QLN configuration (config.js + config.local.js merged) */
export interface QLNConfig {
  dataDir: string;
  embedding: {
    enabled: boolean;
    model: string;
    endpoint: string;
  };
  executor: {
    httpEndpoint: string | null;
    timeout: number;
  };
  providers: {
    enabled: boolean;
    dir: string;
  };
  search: {
    defaultTopK: number;
    threshold: number;
    /** Per-source score multiplier (default: 1.0 for all) */
    sourceWeights: Record<string, number>;
  };
}

/** Search result returned by Router */
export interface SearchResult {
  name: string;
  score: number;
  stages: {
    trigger: number;
    keyword: number;
    semantic: number;
    usage: number;
    success: number;
    recencyFactor: number;
  };
  description: string;
  source: string;
  category: string;
  inputSchema: Record<string, unknown> | null;
  explorer?: boolean;
}

/** Timing info from Router search */
export interface SearchTiming {
  stage1: number;
  stage2: number;
  stage3: number;
  merge: number;
  total: number;
}

/** Validation error from validator */
export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/** Provider manifest JSON structure */
export interface ProviderManifest {
  provider: string;
  version?: string;
  description?: string;
  endpoint?: string;
  tools: Array<{
    name: string;
    description: string;
    category?: string;
    inputSchema?: Record<string, unknown>;
    triggers?: string[];
    tags?: string[];
    examples?: string[];
    endpoint?: string;
    boostKeywords?: string;
  }>;
}

/** Tool execution result */
export interface ExecResult {
  result: unknown;
  source: 'local' | 'http';
  elapsed: number;
  /** Whether this result came from a fallback tool */
  fallback?: boolean;
  /** Original tool name if fallback was used */
  originalTool?: string;
}

/** Circuit breaker configuration */
export interface CircuitBreakerConfig {
  /** Consecutive failures before tripping (default: 3) */
  failureThreshold: number;
  /** Milliseconds before attempting recovery (default: 60000) */
  recoveryTimeout: number;
}

/** Circuit breaker states */
export type CircuitState = 'closed' | 'open' | 'half-open';

/** MCP tool response content */
export interface McpToolResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** SQLite row from tools table (snake_case columns) */
export interface ToolRow {
  name: string;
  description: string;
  source: string;
  category: string;
  provider: string;
  plugin_name?: string;
  input_schema: string;
  triggers: string;
  tags: string;
  examples: string;
  endpoint: string;
  search_text: string;
  embedding: string;
  usage_count: number;
  success_rate: number;
  last_used_at: string | null;
  registered_at: string;
  updated_at: string;
}

/** sql.js Database interface (minimal) */
export interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  export(): Uint8Array;
  close(): void;
}

/** sql.js static module interface */
export interface SqlJsStatic {
  Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
}

/** Stage score accumulator used internally by Router */
export interface StageScores {
  stage1: number;
  stage2: number;
  stage3: number;
}

/** Registry stats */
export interface RegistryStats {
  total: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
  withEmbedding: number;
  embeddingCoverage: string;
}

/** VectorIndex build result */
export interface VectorBuildResult {
  indexed: number;
  categories: number;
  dimension: number;
}

/** VectorIndex stats */
export interface VectorStats {
  built: boolean;
  tools: number;
  dimension: number;
  categories: number;
  categoryList: string[];
  memoryKB: number;
}

/** Router stats */
export interface RouterStats {
  registrySize: number;
  vectorIndex: VectorStats;
  embeddingAvailable: boolean;
  bm25: {
    idfTerms: number;
    avgDocLen: number;
    k1: number;
    b: number;
  };
}

/** Provider load result */
export interface ProviderLoadResult {
  loaded: number;
  skipped: number;
  failed: number;
  details: Array<{
    file: string;
    status: 'loaded' | 'skipped' | 'failed';
    reason?: string;
    provider?: string;
    toolCount?: number;
  }>;
}

/** Embedding precompute result */
export interface EmbeddingPrecomputeResult {
  embedded: number;
  skipped: number;
  failed: number;
}

/** Tool handler function signature */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
