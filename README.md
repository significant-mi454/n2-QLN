# n2-qln

**QLN** = **Q**uery **L**ayer **N**etwork — a semantic search layer that sits between the AI and your tools.

> **Route 1,000+ tools through 1 MCP tool.** The AI sees only the router — not all 1,000 tools.

```
Without QLN                        With QLN
┌──────────────────┐               ┌──────────────────┐
│   AI Context     │               │   AI Context     │
│                  │               │                  │
│  📦 tool_1       │               │  🧠 n2_qln_call  │  ← only 1 tool (~200 tokens)
│  📦 tool_2       │               └────────┬─────────┘
│  📦 tool_3       │                        │ "take a screenshot"
│  📦 ...          │               ┌────────▼─────────┐
│  📦 tool_1000    │               │  SQLite Index     │  ← 1,000+ tools indexed
│                  │               │  Semantic Search  │
│  ~50,000 tokens  │               └────────┬─────────┘
└──────────────────┘                        │ best match
                                   ┌────────▼─────────┐
                                   │  take_screenshot  │  ← execute only what's needed
                                   └──────────────────┘
```

## Why?

Every MCP tool you register eats AI context tokens. 10 tools? Fine. 100? Slow. **1,000? Impossible.**

QLN solves this by acting as a **semantic search router**. Register all your tools in QLN's SQLite index, and the AI only ever sees one tool: `n2_qln_call`. When it needs something, it searches, finds the best match, and executes — all through that single tool.

**Result: ~200 tokens instead of ~50,000.** That's a **99.6% reduction.**

## Quick Start

### 1. Install

```bash
npm install n2-qln
```

### 2. Add to your MCP config

```json
{
  "mcpServers": {
    "n2-qln": {
      "command": "npx",
      "args": ["-y", "n2-qln"]
    }
  }
}
```

That's it. Your AI agent now has access to `n2_qln_call`.

### 3. Use it

Your AI gets **one tool** with **5 actions**:

```
🔍 search  — Find tools by natural language
⚡ exec    — Execute a tool by name
➕ create  — Register a new tool
✏️ update  — Modify an existing tool
🗑️ delete  — Remove a tool (single or by provider)
```

**Example flow** (from the AI's perspective):

```
User: "Take a screenshot of this page"

Step 1 → AI calls: n2_qln_call(action: "search", query: "screenshot page")
         Response: take_screenshot (score: 8.0, 1ms)

Step 2 → AI calls: n2_qln_call(action: "exec", tool: "take_screenshot", args: {fullPage: true})
         Response: ✅ screenshot saved
```

The AI never needed to know about the other 999 tools.

## How Search Works

QLN uses a **3-stage parallel search** to find the best tool:

| Stage | Method | Speed | What it does |
|:---:|--------|:---:|------|
| **1** | Trigger Match | ⚡ <1ms | Exact word matching against tool names and triggers |
| **2** | Keyword Match | ⚡ 1-3ms | Full-text search against descriptions, tags, examples |
| **3** | Semantic Search | 🧠 5-15ms | Vector similarity using embeddings (optional) |

Results are merged with weighted scoring:

```
final_score = trigger × 3.0 + keyword × 1.0 + semantic × 2.0
            + log2(usage + 1) × 0.5 + success_rate × 1.0
```

> **Stage 3 is optional.** Without [Ollama](https://ollama.ai), QLN still works great with Stage 1 + 2. Install Ollama with `nomic-embed-text` for maximum accuracy.

## Registering Tools

### Naming Rules (Enforced)

QLN enforces strict rules when creating tools. **These are not suggestions — violations are rejected.**

| Rule | Requirement | Example |
|------|------------|---------|
| **Name format** | `verb_target` (lowercase, underscore) | `read_pdf`, `take_screenshot` |
| **Description** | Minimum 10 characters | `"Read and extract text from PDF files"` |
| **Category** | One of: `web`, `data`, `file`, `dev`, `ai`, `capture`, `misc` | `"data"` |
| **No duplicates** | Unique name required | — |

```
❌ pdfReader        → Rejected (not verb_target format)
❌ "PDF tool"       → Rejected (description too short)
✅ read_pdf         → Accepted
✅ take_screenshot  → Accepted
```

### Create a tool

```javascript
// AI calls:
n2_qln_call({
  action: "create",
  name: "read_pdf",
  description: "Read and extract text content from a PDF file",
  category: "data",
  provider: "pdf-tools",
  tags: ["pdf", "read", "extract", "document"],
  examples: ["read this PDF file", "read this PDF", "extract text from PDF"]
})

// → ✅ Created: read_pdf [local/data]
//   Provider: pdf-tools
//   Triggers: read_pdf, read, pdf, extract, document
```

> **Tip:** The `examples` field supercharges search. Add phrases users might actually say — they're indexed for keyword matching.

### Update a tool

```javascript
n2_qln_call({
  action: "update",
  tool: "read_pdf",
  examples: ["read this PDF file", "read this PDF", "summarize this PDF"]
})
// Same validation rules apply to updates
```

### Delete tools

```javascript
// Delete a single tool
n2_qln_call({ action: "delete", tool: "read_pdf" })

// Delete all tools from a provider
n2_qln_call({ action: "delete", provider: "pdf-tools" })
// → ✅ Deleted 3 tools from provider: pdf-tools
```

## Architecture

```
n2-qln/
├── index.js            # MCP server entry point
├── lib/
│   ├── config.js       # Config loader
│   ├── store.js        # SQLite storage (sql.js, in-memory + file persist)
│   ├── schema.js       # Tool schema normalization + search text builder
│   ├── validator.js    # Enforced validation (name format, description, category)
│   ├── registry.js     # Tool CRUD + usage tracking + embedding cache
│   ├── router.js       # 3-Stage parallel search engine
│   ├── vector-index.js # Float32 vector index with centroid hierarchy
│   ├── embedding.js    # Ollama embedding engine (nomic-embed-text)
│   └── executor.js     # HTTP/function tool executor
├── tools/
│   └── qln-call.js     # Unified MCP tool (search/exec/create/update/delete)
└── providers/          # Tool provider manifests (for bulk registration)
```

## Configuration

Create `config.local.js` in the QLN directory to override defaults:

```javascript
module.exports = {
  dataDir: './data',          // SQLite storage location
  embedding: {
    enabled: true,            // Enable semantic search (Stage 3)
    provider: 'ollama',
    model: 'nomic-embed-text',
    baseUrl: 'http://127.0.0.1:11434',
  },
};
```

## Without Ollama vs With Ollama

| Setup | Search Capability | Accuracy |
|:------|:---:|:---:|
| **No Ollama** (default) | Stage 1 (trigger) + Stage 2 (keyword) | ⭐⭐⭐⭐ Great |
| **With Ollama** | Stage 1 + 2 + Stage 3 (semantic vectors) | ⭐⭐⭐⭐⭐ Perfect |

QLN is designed to work well without any external dependencies. Ollama is a bonus, not a requirement.

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | Node.js ≥18 | MCP SDK compatibility |
| Database | SQLite via sql.js (WASM) | Zero native dependencies, cross-platform |
| Embeddings | Ollama + nomic-embed-text | Local, fast, free, optional |
| Protocol | MCP (Model Context Protocol) | Standard AI tool protocol |
| Validation | Zod | Runtime schema validation |

## Related Projects

| Project | Relationship |
|---------|-------------|
| [n2-soul](https://github.com/choihyunsus/n2-soul) | AI agent orchestrator — QLN serves as Soul's "tool brain" |

## License

MIT
