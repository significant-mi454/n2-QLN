# QLN — Quantum Layer Network

> **"MCP의 FP2"** — 도구 1000개를 1개의 라우터로 압축하는 시맨틱 도구 디스패처

![QLN Architecture](docs/architecture.png)

### 3-Layer Compression

| Layer | Content | In AI Context? | Tokens |
|:---:|---------|:-:|:---:|
| **L1** | `n2_qln_call` + CRUD (Search/Create/Update/Delete) | ✅ Always | ~200 |
| **L2** | Categories (Web, Image, PDF, Video...) | ❌ Discovered via Search | 0 |
| **L3** | Actual tools (1000+) | ❌ Hidden | 0 |

> **AI sees only L1 → 99.6% token savings**

## 🧠 개요

### 한 줄 요약

> 도구가 아무리 많아도, **QLN 하나면 필요한 도구를 딱 찾아서 실행한다.**

### 문제

현재 MCP(Model Context Protocol) 생태계의 한계:

| 문제 | 설명 |
|------|------|
| **컨텍스트 폭발** | 도구 100개 등록 → AI의 컨텍스트 윈도우 낭비 |
| **선택 혼란** | 비슷한 도구 10개 중 뭘 골라야? AI가 헷갈림 |
| **확장 불가** | 도구 1000개 시대? → 현재 MCP 구조로는 불가능 |
| **중복 호출** | 매번 모든 도구 목록을 전달 → 토큰 낭비 |

### 해결

```
[기존 MCP]
AI ←→ 100개 도구 등록 (전부 컨텍스트에 올림)
→ 비효율적, 확장 불가

[QLN]
AI ←→ QLN 라우터 1개 (항상 메모리 상주)
         ↓ 시맨틱 검색
     도구 1000개 인덱스 (SQLite)
         ↓ 필요한 것만
     실제 도구 실행
→ 초효율, 무한 확장
```

---

## 🔑 핵심 컨셉

### "MCP의 FP2"

| FP2가 모델에 한 것 | QLN이 MCP에 하는 것 |
|:---:|:---:|
| 가중치 70억개 → 2비트 압축 | 도구 1000개 → 1 라우터 압축 |
| 16비트 → 2비트 = 8x 압축 | 1000 도구 → 1 라우터 = 1000x 압축 |
| 핵심 정보만 보존 | 필요한 도구만 검색 |

### 3-Layer 캐시 구조

```
Layer 1: 라우팅 엔진       → 항상 메모리 상주 (hot) 🔥
Layer 2: 도구 인덱스       → 항상 메모리 상주 (hot) 🔥
Layer 3: 실제 도구 실행    → 시맨틱 검색으로 찾기 (cold) ❄️

매 호출 흐름: L1 → L2 → L3
              ↑    ↑    ↑
            캐시  캐시  검색만!
```

| Layer | 역할 | 상태 | 비유 |
|:---:|------|:---:|------|
| **L1** | 라우팅 엔진 (자연어 → 의도 파악) | 상주 | LLM의 Embedding 레이어 |
| **L2** | 도구 인덱스 (카테고리 + 메타데이터) | 상주 | LLM의 Attention 캐시 |
| **L3** | 도구 실행 (실제 함수 호출) | 검색 | LLM의 FFN 레이어 (SSD에서 로드) |

### LLM 레이어 스트리밍과 동일 패턴

```
[LLM FP2 + SSD]
Layer 0-1: Embedding     → 항상 RAM (hot)
Layer 2-N: Transformer   → SSD에서 로드 (cold)

[QLN]
Layer 1-2: 라우터+인덱스 → 항상 메모리 (hot)
Layer 3:   도구 실행     → 시맨틱 검색 (cold)
```

---

## 🏗️ 아키텍처

### 전체 구조

```
┌─────────────────────────────────────────┐
│              AI Agent (Claude, GPT...)  │
│                    │                    │
│              MCP Protocol              │
│                    │                    │
│  ┌─────────────────▼───────────────┐   │
│  │          QLN Router (L1)        │   │  ← 항상 메모리 상주
│  │   자연어 의도 파악 + 분류       │   │
│  └─────────────────┬───────────────┘   │
│                    │                    │
│  ┌─────────────────▼───────────────┐   │
│  │      Tool Index (L2) SQLite     │   │  ← 항상 메모리 상주
│  │   시맨틱 임베딩 + 카테고리      │   │
│  │   도구 메타데이터 + 스키마      │   │
│  └─────────────────┬───────────────┘   │
│                    │ 검색 결과          │
│  ┌─────────────────▼───────────────┐   │
│  │    Tool Executor (L3)           │   │  ← 필요할 때만 로드
│  │   실제 도구 함수 호출           │   │
│  │   결과 반환                     │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### 도구 등록 흐름

```
1. 도구 제공자가 QLN에 도구 등록
   → 이름, 설명, 스키마, 카테고리, 실행 함수

2. QLN이 자동으로:
   → 설명 임베딩 생성 (nomic-embed-text 등)
   → SQLite 인덱스에 저장
   → 카테고리 자동 분류

3. AI가 "스크린샷 찍어줘" 요청
   → L1: 의도 파악 ("스크린샷" → "화면 캡처")
   → L2: 시맨틱 검색 → "take_screenshot" 매칭 (3.63ms)
   → L3: take_screenshot() 실행 → 결과 반환
```

### 호출 흐름 (상세)

```
AI: "이 웹페이지의 링크를 추출해줘"
         │
    ┌────▼────┐
    │  L1     │  의도: "웹페이지 링크 추출"
    │ Router  │  카테고리: "web_scraping"
    └────┬────┘
         │
    ┌────▼────┐
    │  L2     │  검색: "extract links web page"
    │ Index   │  결과: extract_links (score: 0.94)
    │ SQLite  │        get_page_links (score: 0.87)
    └────┬────┘
         │ Top-1 선택
    ┌────▼────┐
    │  L3     │  extract_links(url="...")
    │Executor │  → [link1, link2, link3, ...]
    └─────────┘
```

---

## 🛠️ 기술 스택

| 영역 | 기술 | 이유 |
|------|------|------|
| **런타임** | Node.js | MCP SDK 호환, Soul과 동일 |
| **인덱스** | SQLite (better-sqlite3) | 경량, 서버리스, 임베딩 저장 |
| **임베딩** | nomic-embed-text (Ollama) | 로컬 실행, 빠름, 무료 |
| **프로토콜** | MCP (Model Context Protocol) | 표준 AI 도구 프로토콜 |
| **패키지** | npm (n2-qln) | Soul과 동일 배포 방식 |

---

## 🔗 Soul 연동

### 독립 실행
```bash
npx n2-qln
# → MCP 서버로 동작, 어떤 AI 에이전트에서든 사용 가능
```

### Soul 플러그인
```javascript
// soul config에서 QLN 활성화
module.exports = {
  QLN: {
    enabled: true,
    indexPath: './data/qln-index.db',
    embedding: 'nomic-embed-text',
  }
};
```

### 기존 Soul 도구와의 관계

| 현재 Soul 도구 | QLN 이후 |
|---------------|---------|
| `n2_tool_route` | → QLN L1 라우터로 대체 |
| `n2_qln_call` | → QLN L3 실행기로 대체 |
| `n2_cdp_discover` | → QLN에 등록되는 도구 중 하나 |
| 브라우저 도구들 | → QLN 인덱스에 등록 |

---

## 📅 로드맵

### Phase 1: 코어 (v0.1)
- [ ] 프로젝트 초기화 (npm init)
- [ ] L1 라우터 구현 (자연어 → 의도)
- [ ] L2 SQLite 인덱스 구현 (임베딩 검색)
- [ ] L3 도구 실행기 구현
- [ ] MCP 서버로 등록
- [ ] 기본 도구 10개 내장 (파일, 브라우저 등)

### Phase 2: Soul 연동 (v0.2)
- [ ] Soul 플러그인 인터페이스
- [ ] 기존 `n2_tool_route` / `n2_qln_call` 마이그레이션
- [ ] 브라우저 CDP 도구 자동 등록
- [ ] KV-Cache 시맨틱 검색 연동

### Phase 3: 생태계 (v1.0)
- [ ] 도구 마켓플레이스 (커뮤니티 도구 공유)
- [ ] 자동 도구 발견 (MCP 서버 스캔)
- [ ] 도구 체인 (도구 A 결과 → 도구 B 입력)
- [ ] npm 배포

---

## 🔬 관련 프로젝트

| 프로젝트 | 관계 |
|---------|------|
| **n2-soul** | QLN의 상위 오케스트레이터. QLN은 Soul의 "도구 두뇌" |
| **SSD-QLN-FP2** | QLN의 레이어 검색 패턴을 LLM 추론에 적용한 연구 |
| **n2-ark** | Soul의 보안 레이어. QLN 도구 호출도 Ark 검사 통과 필요 |

---

## 📦 Installation

```bash
npm install n2-qln
```

**Dependencies:** `@modelcontextprotocol/sdk`, `sql.js`, `zod` (auto-installed)

**Optional:** Install [Ollama](https://ollama.ai) with `nomic-embed-text` for semantic search (Stage 3). Without Ollama, QLN still works with Stage 1 (trigger) + Stage 2 (keyword) matching.

---

## 🚀 Quick Start

### MCP Config

Add to your MCP config (`mcp_config.json` or Claude Desktop config):

```json
{
  "mcpServers": {
    "n2-qln": {
      "command": "node",
      "args": ["path/to/n2-qln/index.js"]
    }
  }
}
```

### Exposed Tools (only 4 in AI context!)

| Tool | Description |
|------|-------------|
| `qln_route` | Search tools by natural language query |
| `qln_exec` | Execute a tool by name |
| `qln_register` | Register a new tool in the index |
| `qln_stats` | Show index statistics |

### How it works (AI Agent POV)

```
USER: "Take a screenshot of this page"

[Step 1] AI calls qln_route(query: "screenshot page")
         → Result: take_screenshot (score: 8.0) in 1ms

[Step 2] AI calls qln_exec(tool: "take_screenshot", args: {fullPage: true})
         → Result: screenshot saved

Token usage: 200 tokens (vs 50,000 with 1000 tools registered normally)
```

### Without Ollama vs With Ollama

| Environment | Search Stages | Accuracy |
|:-:|:-:|:-:|
| Ollama ❌ | Stage 1 (trigger) + Stage 2 (keyword) | ⭐⭐⭐⭐ Very Good |
| Ollama ✅ | Stage 1 + Stage 2 + Stage 3 (semantic) | ⭐⭐⭐⭐⭐ Perfect |

---

## 📁 Project Structure

```
n2-qln/
├── index.js          # MCP server entry point
├── lib/
│   ├── config.js     # Config loader (default + local merge)
│   ├── store.js      # SQLite storage (sql.js WASM)
│   ├── schema.js     # Tool schema normalization
│   ├── embedding.js  # Ollama embedding engine
│   ├── registry.js   # L2 tool index (cache + SQLite)
│   ├── vector-index.js # Float32 vector index (centroid hierarchy)
│   ├── router.js     # L1 3-Stage search engine
│   └── executor.js   # L3 tool executor
├── tools/
│   ├── route.js      # qln_route MCP tool
│   ├── exec.js       # qln_exec MCP tool
│   └── manage.js     # qln_register / qln_stats
├── package.json
└── config.local.js   # (optional) Local config overrides
```

---

## 💡 핵심 인사이트

> "QLN은 MCP의 FP2다."

MCP 생태계가 커질수록 도구 폭발 문제가 심각해진다.
QLN은 **시맨틱 압축**으로 이 문제를 근본적으로 해결한다.

FP2가 모델 가중치를 압축하듯, QLN은 도구 공간을 압축한다.
둘 다 **"필요한 것만 꺼내 쓴다"**는 동일한 철학에 기반한다.

---

> "N2-QLN을 배포해도 난리가 날 것이다. 그런데 이건 시작일 뿐이다." — 주인님, 2026-03-01

