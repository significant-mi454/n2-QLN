# QLN Core Library (`src/lib/`)

TypeScript source modules for the Query Layer Network engine.

| Module | Role |
|--------|------|
| `schema.ts` | Tool normalization + trigger extraction |
| `embedding.ts` | Ollama embedding engine (Stage 3) |
| `store.ts` | SQLite persistence (sql.js WASM) |
| `config.ts` | Config loader (default + local merge) |
| `validator.ts` | Registration validation (validator.rs pattern) |
| `registry.ts` | In-memory cache + CRUD + embedding precompute |
| `vector-index.ts` | Float32Array centroid hierarchy search |
| `router.ts` | 3-Stage BM25/semantic search engine |
| `executor.ts` | HTTP proxy + local handler execution |
| `provider-loader.ts` | Provider manifest auto-indexing |
