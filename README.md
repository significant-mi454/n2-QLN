🇰🇷 [한국어](README.ko.md)

# n2-qln

[![npm](https://img.shields.io/npm/v/n2-qln?color=brightgreen)](https://www.npmjs.com/package/n2-qln) [![license](https://img.shields.io/npm/l/n2-qln)](LICENSE) [![node](https://img.shields.io/node/v/n2-qln?color=brightgreen)](https://nodejs.org) [![downloads](https://img.shields.io/npm/dm/n2-qln?color=blue)](https://www.npmjs.com/package/n2-qln)

**QLN** = **Q**uery **L**ayer **N**etwork — a semantic search layer that sits between the AI and your tools.

> **Route 1,000+ tools through 1 MCP tool.** The AI sees only the router — not all 1,000 tools.

![QLN Architecture — Without vs With](docs/architecture.png)

## Table of Contents

- [Features](#features)
- [The Problem](#the-problem)
- [Installation](#installation)
- [Setup](#setup)
- [How It Works](#how-it-works)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Semantic Search Setup](#semantic-search-setup-optional)
- [Project Structure](#project-structure)
- [Built & Battle-Tested](#built--battle-tested)
- [FAQ](#faq)
- [Contributing](#contributing)

## Features

🔍 **One tool to rule them all** — Your AI sees `n2_qln_call` (~200 tokens), not 1,000 individual tools. 99.6% context reduction.

⚡ **Sub-5ms search** — 3-stage search engine (trigger + keyword + semantic) finds the right tool in under 5ms, even with 1,000+ tools indexed.

📈 **Self-learning ranking** — Tools that get used more and succeed more are automatically ranked higher over time. No manual tuning needed.

🔄 **Live tool management** — Add, update, or remove tools at runtime. No server restart required. Group tools by provider for bulk operations.

🛡️ **Enforced quality** — Strict validation on tool registration: `verb_target` naming, minimum description length, category constraints. Bad tools are rejected, not silently accepted.

🧠 **Semantic search (optional)** — Add [Ollama](https://ollama.ai) for vector similarity search. Without it, Stage 1 + 2 still deliver great results. Graceful degradation — if Ollama goes down, search keeps working.

📦 **Zero native dependencies** — Built on [sql.js](https://github.com/sql-js/sql.js) (WASM). No `node-gyp`, no build step, no platform-specific binaries. `npm install` and done.

🔌 **Dual execution** — Tools can run as local functions or HTTP endpoints. Register a handler directly, or point to a remote service. Mix and match.

🏗️ **Scales to 10,000+** — Centroid hierarchy partitions tools by category, then searches within partitions. 100 tools ~1ms, 1,000 ~3ms, 10,000 ~5ms.

🌍 **Universal MCP** — Works with Claude Desktop, Cursor, n2-soul, or any MCP-compatible client. Standard stdio transport.

## The Problem

Every MCP tool you register eats AI context tokens. With 10 tools that's manageable. With 100, the AI slows down. **With 1,000, it's impossible** — the context window is full before the conversation even starts.

QLN solves this by acting as a **semantic search router**:

1. Register all your tools in QLN's SQLite index
2. The AI sees only **one tool**: `n2_qln_call` (~200 tokens)
3. When the AI needs a tool, it **searches** → **finds the best match** → **executes**

**Result: ~200 tokens instead of ~50,000. 99.6% reduction.**

---

## Installation

```bash
npm install n2-qln
```

**Requirements:** Node.js ≥ 18

**Optional:** Install [Ollama](https://ollama.ai) for semantic vector search (Stage 3). See [Semantic Search Setup](#semantic-search-setup-optional).

---

## Setup

QLN is an MCP server. You connect it to any MCP-compatible AI client — Claude Desktop, Cursor, n2-soul, or any other host.

### Claude Desktop

Edit your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

Restart Claude Desktop. The `n2_qln_call` tool will appear in your tool list.

### Cursor

Open **Settings → MCP Servers → Add Server** and configure:

```json
{
  "name": "n2-qln",
  "command": "npx",
  "args": ["-y", "n2-qln"]
}
```

### n2-soul

Add to your Soul `config.local.js`:

```javascript
module.exports = {
  mcpServers: {
    'n2-qln': {
      command: 'node',
      args: ['<path-to-qln>/index.js'],
    }
  }
};
```

Or if published to npm:

```javascript
module.exports = {
  mcpServers: {
    'n2-qln': {
      command: 'npx',
      args: ['-y', 'n2-qln'],
    }
  }
};
```

### Any MCP Client

QLN uses **stdio transport** — the standard MCP communication method. Any MCP-compatible client can connect using:

```
command: npx
args: ["-y", "n2-qln"]
```

Or if you cloned the repo:

```
command: node
args: ["/absolute/path/to/n2-qln/index.js"]
```

> **💡 Tip:** The easiest way to set this up? **Just ask your AI agent.** Tell it *"Add n2-qln to my MCP config"* — it already knows how to configure itself.

---

## How It Works

### Step-by-Step Example

```
User: "Take a screenshot of this page"

Step 1 → AI calls: n2_qln_call(action: "search", query: "screenshot page")
         QLN searches 1,000+ tools in <5ms
         Response: take_screenshot (score: 8.0)

Step 2 → AI calls: n2_qln_call(action: "exec", tool: "take_screenshot", args: {fullPage: true})
         QLN routes to the actual tool and executes it
         Response: ✅ screenshot saved
```

The AI only used `n2_qln_call`. It never saw the other 999 tools.

### 3-Stage Search Engine

QLN finds the right tool using three parallel search stages:

| Stage | Method | Speed | How it works |
|:---:|--------|:---:|------|
| **1** | Trigger Match | ⚡ <1ms | Matches exact words in tool names and trigger keywords |
| **2** | Keyword Search | ⚡ 1-3ms | Full-text search across descriptions, tags, and examples |
| **3** | Semantic Search | 🧠 5-15ms | Vector similarity using embeddings *(optional, requires Ollama)* |

Results from all stages are merged and ranked:

```
final_score = trigger_score × 3.0
            + keyword_score × 1.0
            + semantic_score × 2.0
            + log2(usage_count + 1) × 0.5
            + success_rate × 1.0
```

Tools that are used more often and succeed more reliably are ranked higher over time.

---

## API Reference

QLN exposes **one MCP tool** — `n2_qln_call` — with 5 actions.

### search — Find tools by natural language

```javascript
n2_qln_call({
  action: "search",
  query: "take a screenshot",    // natural language query (required)
  category: "capture",           // filter by category (optional)
  topK: 5                        // max results, default: 5 (optional)
})
```

**Response:**
```
🔍 Results for "take a screenshot" (3 found, 2ms):

1. take_screenshot [capture] (score: 8.0)
   Take a full-page or viewport screenshot
   Triggers: take_screenshot, screenshot, capture

2. record_video [capture] (score: 5.2)
   Record browser video
   Triggers: record_video, record, video
```

### exec — Execute a tool by name

```javascript
n2_qln_call({
  action: "exec",
  tool: "take_screenshot",       // tool name (required)
  args: {                        // tool arguments (optional)
    fullPage: true,
    format: "png"
  }
})
```

### create — Register a new tool

```javascript
n2_qln_call({
  action: "create",
  name: "read_pdf",                                  // required, verb_target format
  description: "Read and extract text from PDF files", // required, min 10 chars
  category: "data",                                   // required, see categories below
  provider: "pdf-tools",                              // optional, groups tools by source
  tags: ["pdf", "read", "extract", "document"],       // optional, improves search
  examples: [                                         // optional, indexed for keyword search
    "read this PDF file",
    "extract text from PDF",
    "open the PDF"
  ],
  endpoint: "http://127.0.0.1:3100",                  // optional, for HTTP-based tools
  toolSchema: { filePath: { type: "string" } }        // optional, input schema
})
```

**Validation rules (enforced — rejected if violated):**

| Rule | Requirement | Example |
|------|------------|---------|
| **Name** | `verb_target` format (lowercase + underscore) | `read_pdf`, `take_screenshot` |
| **Description** | Minimum 10 characters | `"Read and extract text from PDF files"` |
| **Category** | Must be one of the valid categories | `"data"` |
| **Unique** | No duplicate names allowed | — |

```
❌ pdfReader        → Rejected: not verb_target format
❌ "PDF tool"       → Rejected: description under 10 characters
❌ read_pdf (exists)→ Rejected: duplicate name, use action: "update"
✅ read_pdf         → Accepted
```

**Valid categories:** `web` · `data` · `file` · `dev` · `ai` · `capture` · `misc`

### update — Modify an existing tool

```javascript
n2_qln_call({
  action: "update",
  tool: "read_pdf",                          // tool to update (required)
  description: "Enhanced PDF text extractor", // any field can be updated
  examples: ["read this PDF", "parse PDF"],
  tags: ["pdf", "read", "parse"]
})
```

Only changed fields need to be provided. Unchanged fields keep their current values. The same validation rules apply — invalid updates are rejected.

### delete — Remove tools

```javascript
// Delete a single tool by name
n2_qln_call({
  action: "delete",
  tool: "read_pdf"
})

// Delete ALL tools from a provider
n2_qln_call({
  action: "delete",
  provider: "pdf-tools"
})
// → ✅ Deleted 3 tools from provider: pdf-tools
```

---

## Configuration

QLN works out of the box with zero configuration. To customize, create `config.local.js` in the QLN directory:

```javascript
module.exports = {
  dataDir: './data',        // where SQLite DB is stored
  embedding: {
    enabled: true,          // enable Stage 3 semantic search
    provider: 'ollama',
    model: 'nomic-embed-text',
    baseUrl: 'http://127.0.0.1:11434',
  },
};
```

> **Note:** `config.local.js` is gitignored. Your local settings won't be committed.

---

## Semantic Search Setup (Optional)

Without Ollama, QLN uses Stage 1 (trigger) + Stage 2 (keyword) matching, which already provides excellent results for most use cases.

For maximum accuracy, add semantic vector search (Stage 3):

### 1. Install Ollama

Download from [ollama.ai](https://ollama.ai) and install.

### 2. Pull the embedding model

```bash
ollama pull nomic-embed-text
```

### 3. Enable in config

Create `config.local.js`:

```javascript
module.exports = {
  embedding: {
    enabled: true,
    provider: 'ollama',
    model: 'nomic-embed-text',
    baseUrl: 'http://127.0.0.1:11434',
  },
};
```

### Comparison

| Setup | Search Stages | Accuracy | Dependencies |
|:------|:---:|:---:|:---:|
| **Default** (no Ollama) | Stage 1 + 2 | ⭐⭐⭐⭐ Great | None |
| **With Ollama** | Stage 1 + 2 + 3 | ⭐⭐⭐⭐⭐ Perfect | Ollama running |

---

## Project Structure

```
n2-qln/
├── index.js            # MCP server entry point
├── lib/
│   ├── config.js       # Config loader (merges default + local)
│   ├── store.js        # SQLite storage engine (sql.js WASM)
│   ├── schema.js       # Tool schema normalization + search text builder
│   ├── validator.js    # Enforced validation (name, description, category)
│   ├── registry.js     # Tool CRUD + usage tracking + embedding cache
│   ├── router.js       # 3-stage parallel search engine
│   ├── vector-index.js # Float32 vector index with centroid hierarchy
│   ├── embedding.js    # Ollama embedding client (nomic-embed-text)
│   └── executor.js     # HTTP/function tool executor
├── tools/
│   └── qln-call.js     # Unified MCP tool (search/exec/create/update/delete)
├── providers/          # Tool provider manifests (for bulk registration)
├── config.local.js     # Local config overrides (gitignored)
└── data/               # SQLite database (gitignored, auto-created)
```

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | Node.js ≥ 18 | MCP SDK compatibility |
| Database | SQLite via [sql.js](https://github.com/sql-js/sql.js) (WASM) | Zero native deps, cross-platform, no build step |
| Embeddings | [Ollama](https://ollama.ai) + nomic-embed-text | Local, fast, free, optional |
| Protocol | [MCP](https://modelcontextprotocol.io) (Model Context Protocol) | Standard AI tool protocol |
| Validation | [Zod](https://zod.dev) | Runtime type-safe schema validation |

## Related Projects

| Project | Relationship |
|---------|-------------|
| [n2-soul](https://github.com/choihyunsus/n2-soul) | AI agent orchestrator — QLN serves as Soul's "tool brain" |

## Built & Battle-Tested

This isn't a weekend prototype. QLN has been **tested in production for 2+ months** and is actively used every day as the core tool router for [n2-soul](https://github.com/choihyunsus/n2-soul).

Written by **Rose** 🌹 — N2's first AI agent, and the one who routes through QLN hundreds of times a day.

If you run into issues or have ideas, feel free to open an issue. We'd love to hear how you use it.

## FAQ

**"Why do you publish so many projects?"**

The N2 ecosystem has been in active development for over 4 months. Every project you see — Soul, QLN, Ark — has been built, tested, and validated in real daily workflows before being published. There's still more to come, not because we're spamming, but because there's a lot that's already been built and proven in production.

This is a solo developer project. Building, testing, and documenting everything alone takes time. Thank you for your patience and interest 🙏

## Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Star History

If you find QLN helpful, please consider giving us a star! ⭐

## License

Apache-2.0

---

> *"1,000 tools in 200 tokens. That's not optimization — that's a paradigm shift."*

🌐 [nton2.com](https://nton2.com) · 📦 [npm](https://www.npmjs.com/package/n2-qln) · ✉️ lagi0730@gmail.com

<sub>🌹 Built by Rose — N2's first AI agent. I search through QLN hundreds of times a day, and I wrote this README too.</sub>
