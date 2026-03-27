🇺🇸 [English](README.md)

# n2-qln

[![npm](https://img.shields.io/npm/v/n2-qln?color=brightgreen)](https://www.npmjs.com/package/n2-qln) [![license](https://img.shields.io/npm/l/n2-qln)](LICENSE) [![node](https://img.shields.io/node/v/n2-qln?color=brightgreen)](https://nodejs.org) [![downloads](https://img.shields.io/npm/dm/n2-qln?color=blue)](https://www.npmjs.com/package/n2-qln)

**QLN** = **Q**uery **L**ayer **N**etwork — AI와 도구 사이에 위치하는 시맨틱 검색 레이어.

> **1,000개 이상의 도구를 1개의 MCP 도구로 라우팅합니다.** AI는 라우터 하나만 봅니다 — 1,000개 전체가 아닙니다.

![QLN Architecture — Without vs With](docs/architecture.png)

## 목차

- [기능](#기능)
- [문제점](#문제점)
- [설치](#설치)
- [설정](#설정)
- [작동 방식](#작동-방식)
- [API 레퍼런스](#api-레퍼런스)
- [설정 파일](#설정-파일)
- [시맨틱 검색 설정](#시맨틱-검색-설정-선택사항)
- [프로젝트 구조](#프로젝트-구조)
- [실전 검증 완료](#실전-검증-완료)
- [FAQ](#faq)
- [기여하기](#기여하기)

## 기능

 **하나의 도구로 모든 것을** — AI는 `n2_qln_call` (~200 토큰)만 봅니다. 1,000개의 개별 도구가 아닙니다. 99.6% 컨텍스트 절감.

 **5ms 이하 검색** — 3단계 검색 엔진 (트리거 + BM25 키워드 + 시맨틱)이 1,000개 이상의 도구에서도 5ms 이내에 최적 도구를 찾습니다.

 **BM25 키워드 랭킹** *(v3.4)* — Stage 2에 [Okapi BM25](https://en.wikipedia.org/wiki/Okapi_BM25) 알고리즘 적용. 희귀한 단어일수록 높은 점수, 문서 길이 정규화. Google, Elasticsearch, Wikipedia 검색의 핵심 알고리즘.

 **자동 학습 랭킹** — 많이 사용되고 성공률이 높은 도구는 자동으로 상위에 랭크됩니다. 수동 튜닝 불필요.

 **런타임 동적 관리** — 서버 재시작 없이 도구를 추가, 수정, 삭제할 수 있습니다. Provider 단위 일괄 관리 지원.

 **강제 품질 검증** — 도구 등록 시 엄격한 검증: `verb_target` 네이밍, 최소 설명 길이, 카테고리 제약. 잘못된 도구는 거부됩니다.

 **시맨틱 검색 (선택)** — [Ollama](https://ollama.ai) 추가 시 벡터 유사도 검색 활성화. 없어도 Stage 1 + 2만으로 충분한 결과. Ollama가 다운되어도 검색은 정상 작동합니다.

 **네이티브 의존성 제로** — [sql.js](https://github.com/sql-js/sql.js) (WASM) 기반. `node-gyp` 빌드 없음, 플랫폼별 바이너리 없음. `npm install`이면 끝.

 **이중 실행** — 도구를 로컬 함수 또는 HTTP 엔드포인트로 실행. 핸들러를 직접 등록하거나 원격 서비스를 연결. 혼합도 가능.

 **Provider 자동 인덱싱** *(v3.3)* — `providers/`에 JSON 매니페스트를 넣으면 부팅 시 자동 등록. 코드 수정 불필요, 수동 `create` 호출 불필요. 멱등성 보장 및 에러 격리.

 **10,000개 이상 확장** — 카테고리별 centroid hierarchy 파티셔닝. 100개 ~1ms, 1,000개 ~3ms, 10,000개 ~5ms.

 **범용 MCP** — Claude Desktop, Cursor, n2-soul 또는 모든 MCP 호환 클라이언트에서 동작. 표준 stdio 전송.

## 문제점

MCP 도구를 등록할 때마다 AI 컨텍스트 토큰을 소모합니다. 10개는 괜찮습니다. 100개면 느려집니다. **1,000개면 불가능합니다** — 대화가 시작되기도 전에 컨텍스트 윈도우가 가득 찹니다.

QLN은 **시맨틱 검색 라우터**로 이 문제를 해결합니다:

1. 모든 도구를 QLN의 SQLite 인덱스에 등록
2. AI는 **하나의 도구**만 봅니다: `n2_qln_call` (~200 토큰)
3. AI가 도구가 필요하면 **검색** → **최적 매칭** → **실행**

**결과: ~50,000 토큰 대신 ~200 토큰. 99.6% 절감.**

---

## 설치

```bash
npm install n2-qln
```

**요구사항:** Node.js ≥ 18

**선택사항:** 시맨틱 벡터 검색(Stage 3)을 위해 [Ollama](https://ollama.ai) 설치. [시맨틱 검색 설정](#시맨틱-검색-설정-선택사항) 참조.

---

## 설정

QLN은 MCP 서버입니다. 모든 MCP 호환 AI 클라이언트에 연결할 수 있습니다.

### Claude Desktop

Claude Desktop 설정 파일을 편집합니다:

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

Claude Desktop을 재시작하면 `n2_qln_call` 도구가 목록에 나타납니다.

### Cursor

**Settings → MCP Servers → Add Server**에서 설정:

```json
{
 "name": "n2-qln",
 "command": "npx",
 "args": ["-y", "n2-qln"]
}
```

### n2-soul

Soul `config.local.js`에 추가:

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

npm으로 설치한 경우:

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

### 기타 MCP 클라이언트

QLN은 **stdio 전송** — 표준 MCP 통신 방식을 사용합니다. 모든 MCP 호환 클라이언트에서 연결 가능합니다:

```
command: npx
args: ["-y", "n2-qln"]
```

소스를 클론한 경우:

```
command: node
args: ["/absolute/path/to/n2-qln/index.js"]
```

> ** 팁:** 가장 쉬운 설정 방법? **그냥 AI 에이전트에게 부탁하세요.** *"n2-qln을 내 MCP 설정에 추가해줘"* — 에이전트가 알아서 설정합니다.

---

## 작동 방식

### 단계별 예시

```
사용자: "이 페이지 스크린샷 찍어"

Step 1 → AI 호출: n2_qln_call(action: "search", query: "screenshot page")
 QLN이 1,000개 이상의 도구를 <5ms에 검색
 응답: take_screenshot (score: 8.0)

Step 2 → AI 호출: n2_qln_call(action: "exec", tool: "take_screenshot", args: {fullPage: true})
 QLN이 실제 도구로 라우팅 및 실행
 응답: 스크린샷 저장됨
```

AI는 `n2_qln_call`만 사용했습니다. 나머지 999개 도구는 전혀 보지 않았습니다.

### 3단계 검색 엔진

QLN은 세 단계의 검색으로 적합한 도구를 찾습니다:

| 단계 | 방식 | 속도 | 작동 원리 |
|:---:|--------|:---:|---------|
| **1** | 트리거 매칭 | <1ms | 도구 이름과 트리거 키워드 정확 매칭 |
| **2** | BM25 키워드 | 1-3ms | [Okapi BM25](https://en.wikipedia.org/wiki/Okapi_BM25) 랭킹 검색 — IDF 가중치 + 문서 길이 정규화 *(v3.4)* |
| **3** | 시맨틱 검색 | 5-15ms | 임베딩 벡터 유사도 검색 *(선택, Ollama 필요)* |

모든 단계의 결과를 병합 후 랭킹:

```
final_score = trigger_score × 3.0
 + bm25_keyword_score × 1.0
 + semantic_score × 2.0
 + log2(usage_count + 1) × 0.5
 + success_rate × 1.0
```

많이 사용되고 성공률이 높은 도구가 시간이 지날수록 상위에 랭크됩니다.

---

## API 레퍼런스

QLN은 **하나의 MCP 도구** — `n2_qln_call` — 5개의 액션을 제공합니다.

### search — 자연어로 도구 검색

```javascript
n2_qln_call({
 action: "search",
 query: "take a screenshot", // 자연어 쿼리 (필수)
 category: "capture", // 카테고리 필터 (선택)
 topK: 5 // 최대 결과 수, 기본: 5 (선택)
})
```

### exec — 이름으로 도구 실행

```javascript
n2_qln_call({
 action: "exec",
 tool: "take_screenshot", // 도구 이름 (필수)
 args: { // 도구 인수 (선택)
 fullPage: true,
 format: "png"
 }
})
```

### create — 새 도구 등록

```javascript
n2_qln_call({
 action: "create",
 name: "read_pdf", // 필수, verb_target 형식
 description: "Read and extract text from PDF files", // 필수, 최소 10자
 category: "data", // 필수, 아래 카테고리 참조
 provider: "pdf-tools", // 선택, 소스별 도구 그룹화
 tags: ["pdf", "read", "extract", "document"], // 선택, 검색 개선
 examples: [ // 선택, 키워드 검색에 색인
 "read this PDF file",
 "extract text from PDF",
 "open the PDF"
 ],
 endpoint: "http://127.0.0.1:3100", // 선택, HTTP 기반 도구용
 toolSchema: { filePath: { type: "string" } } // 선택, 입력 스키마
})
```

**검증 규칙 (강제 — 위반 시 거부):**

| 규칙 | 요구사항 | 예시 |
|------|---------|------|
| **이름** | `verb_target` 형식 (소문자 + 밑줄) | `read_pdf`, `take_screenshot` |
| **설명** | 최소 10자 | `"Read and extract text from PDF files"` |
| **카테고리** | 유효한 카테고리 중 하나 | `"data"` |
| **고유성** | 중복 이름 불가 | — |

**유효 카테고리:** `web` · `data` · `file` · `dev` · `ai` · `capture` · `misc`

### update — 기존 도구 수정

```javascript
n2_qln_call({
 action: "update",
 tool: "read_pdf", // 수정할 도구 (필수)
 description: "Enhanced PDF text extractor", // 변경할 필드만 제공
 examples: ["read this PDF", "parse PDF"],
 tags: ["pdf", "read", "parse"]
})
```

변경된 필드만 제공하면 됩니다. 미변경 필드는 기존 값 유지. 동일한 검증 규칙 적용.

### delete — 도구 삭제

```javascript
// 이름으로 단일 도구 삭제
n2_qln_call({
 action: "delete",
 tool: "read_pdf"
})

// Provider의 모든 도구 일괄 삭제
n2_qln_call({
 action: "delete",
 provider: "pdf-tools"
})
// → Deleted 3 tools from provider: pdf-tools
```

---

## 설정 파일

QLN은 설정 없이 바로 동작합니다. 커스터마이즈하려면 QLN 디렉토리에 `config.local.js`를 생성하세요:

```javascript
module.exports = {
 dataDir: './data', // SQLite DB 저장 위치
 embedding: {
 enabled: true, // Stage 3 시맨틱 검색 활성화
 provider: 'ollama',
 model: 'nomic-embed-text',
 baseUrl: 'http://127.0.0.1:11434',
 },
};
```

> **참고:** `config.local.js`는 gitignore 처리됩니다. 로컬 설정은 커밋되지 않습니다.

---

## 시맨틱 검색 설정 (선택사항)

Ollama 없이도 QLN은 Stage 1 (트리거) + Stage 2 (키워드) 매칭을 사용하며, 대부분의 경우 충분한 결과를 제공합니다.

최대 정확도를 원한다면 시맨틱 벡터 검색(Stage 3)을 추가하세요:

### 1. Ollama 설치

[ollama.ai](https://ollama.ai)에서 다운로드 후 설치.

### 2. 임베딩 모델 다운로드

```bash
ollama pull nomic-embed-text
```

### 3. 설정 활성화

`config.local.js` 생성:

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

### 비교

| 설정 | 검색 단계 | 정확도 | 의존성 |
|:------|:---:|:---:|:---:|
| **기본** (Ollama 없음) | Stage 1 + 2 | 훌륭 | 없음 |
| **Ollama 포함** | Stage 1 + 2 + 3 | 완벽 | Ollama 실행 필요 |

### 다국어 사용자

`nomic-embed-text`는 영어에 최적화되어 있습니다. **한국어, 일본어, 중국어** 등 다른 언어를 사용한다면 다국어 모델로 교체하세요:

```bash
ollama pull bge-m3
```

```javascript
// config.local.js
module.exports = {
 embedding: {
 enabled: true,
 model: 'bge-m3', // 다국어 지원 (100개 이상 언어)
 },
};
```

코드 수정 없이 config의 모델명만 바꾸면 됩니다.

### 클라우드 동기화

도구 인덱스를 여러 기기에서 동기화하고 싶다면 `dataDir`을 클라우드 폴더로 지정하세요:

```javascript
// config.local.js
module.exports = {
 dataDir: 'G:/My Drive/n2-qln', // Google Drive, OneDrive, Dropbox, NAS...
};
```

[n2-soul 클라우드 스토리지](https://github.com/choihyunsus/soul#%EF%B8%8F-cloud-storage--store-your-ai-memory-anywhere)와 동일한 방식입니다. SQLite 파일이 해당 폴더에 저장되고, 동기화 서비스가 나머지를 처리합니다.

---

## 프로젝트 구조

```
n2-qln/
├── index.js # MCP 서버 진입점
├── lib/
│ ├── config.js # 설정 로더 (기본 + 로컬 병합)
│ ├── store.js # SQLite 스토리지 엔진 (sql.js WASM)
│ ├── schema.js # 도구 스키마 정규화 + 검색 텍스트 빌더
│ ├── validator.js # 강제 검증 (이름, 설명, 카테고리)
│ ├── registry.js # 도구 CRUD + 사용량 추적 + 임베딩 캐시
│ ├── router.js # 3단계 검색 엔진 (BM25 v3.4)
│ ├── vector-index.js # Float32 벡터 인덱스 (centroid hierarchy)
│ ├── embedding.js # Ollama 임베딩 클라이언트 (nomic-embed-text)
│ ├── executor.js # HTTP/함수 도구 실행기
│ └── provider-loader.js # 부팅 시 providers/*.json 자동 인덱싱
├── tools/
│ └── qln-call.js # 통합 MCP 도구 (search/exec/create/update/delete)
├── providers/ # 도구 provider 매니페스트 (일괄 등록용)
├── config.local.js # 로컬 설정 오버라이드 (gitignored)
└── data/ # SQLite 데이터베이스 (gitignored, 자동 생성)
```

## 기술 스택

| 컴포넌트 | 기술 | 이유 |
|-----------|-----------|------|
| 런타임 | Node.js ≥ 18 | MCP SDK 호환성 |
| 데이터베이스 | SQLite via [sql.js](https://github.com/sql-js/sql.js) (WASM) | 네이티브 의존성 제로, 크로스 플랫폼, 빌드 불필요 |
| 임베딩 | [Ollama](https://ollama.ai) + nomic-embed-text | 로컬, 빠름, 무료, 선택사항 |
| 프로토콜 | [MCP](https://modelcontextprotocol.io) (Model Context Protocol) | 표준 AI 도구 프로토콜 |
| 검증 | [Zod](https://zod.dev) | 런타임 타입 안전 스키마 검증 |

## 관련 프로젝트

| 프로젝트 | 관계 |
|---------|------|
| [n2-soul](https://github.com/choihyunsus/soul) | AI 에이전트 오케스트레이터 — QLN은 Soul의 "도구 브레인" 역할 |

## 실전 검증 완료

주말 프로토타입이 아닙니다. QLN은 **2개월 이상 운영 환경에서 검증**되었으며, [n2-soul](https://github.com/choihyunsus/soul)의 핵심 도구 라우터로 매일 실사용되고 있습니다.

**Rose** 제작 — N2의 첫 번째 AI 에이전트. 하루에 수백 번 QLN을 통해 라우팅합니다.

문제가 있거나 아이디어가 있다면 이슈를 열어주세요. 여러분의 활용 사례를 듣고 싶습니다.

## FAQ

**"왜 프로젝트를 이렇게 자주 올리나요?"**

N2 생태계는 4개월 이상 활발히 개발되어 왔습니다. Soul, QLN, Ark — 보이는 모든 프로젝트는 공개 전에 실제 업무에서 충분히 테스트되고 검증되었습니다. 앞으로 더 나올 예정이지만, 도배가 아니라 이미 만들어져서 검증 완료된 것들이 많기 때문입니다.

혼자서 개발하고 배포하는 프로젝트입니다. 빌드, 테스트, 문서화를 혼자 하다 보니 시간이 많이 걸렸습니다. 관심과 인내에 감사드립니다 

## 기여하기

기여를 환영합니다! 시작하는 방법:

1. 저장소를 Fork합니다
2. 기능 브랜치를 생성합니다 (`git checkout -b feature/amazing-feature`)
3. 변경사항을 커밋합니다 (`git commit -m 'feat: add amazing feature'`)
4. 브랜치에 Push합니다 (`git push origin feature/amazing-feature`)
5. Pull Request를 엽니다

## Star History

QLN이 도움이 되었다면 Star를 눌러주세요! 

## 라이선스

Apache-2.0

---

> *"1,000개 도구를 200 토큰으로. 이건 최적화가 아니라 패러다임 전환이다."*

 [nton2.com](https://nton2.com) · [npm](https://www.npmjs.com/package/n2-qln) · lagi0730@gmail.com

<sub> Rose가 만들었습니다 — N2의 첫 번째 AI 에이전트. 하루에 수백 번 QLN으로 검색하고, 이 README도 직접 작성했습니다.</sub>
