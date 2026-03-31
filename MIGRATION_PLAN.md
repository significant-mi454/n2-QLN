# QLN v4.0.0 TypeScript Migration Plan
> v3.4.2 (JS/CJS) → v4.0.0 (TS/ESM-compatible)
> 작성: Rose | 2026-03-30

---

## 1. 현재 상태 (v3.4.2)

| 항목 | 값 |
|------|-----|
| 언어 | JavaScript (CommonJS `require()`) |
| 엔트리 | `index.js` → `lib/*.js` 9개 + `tools/qln-call.js` 1개 |
| 총 파일 | 14개 (소스 11, 테스트 1, 설정 2) |
| 총 코드량 | ~68KB (1,932줄) |
| 의존성 | `@modelcontextprotocol/sdk`, `sql.js`, `zod` |

### 파일별 줄 수 + TS 대상 경로

| # | 현재 경로 | 줄 | TS 경로 |
|---|----------|-----|---------|
| 1 | `lib/schema.js` | 97 | `src/lib/schema.ts` |
| 2 | `lib/embedding.js` | 132 | `src/lib/embedding.ts` |
| 3 | `lib/store.js` | 218 | `src/lib/store.ts` |
| 4 | `lib/validator.js` | 172 | `src/lib/validator.ts` |
| 5 | `lib/registry.js` | 220 | `src/lib/registry.ts` |
| 6 | `lib/vector-index.js` | 152 | `src/lib/vector-index.ts` |
| 7 | `lib/router.js` | 298 | `src/lib/router.ts` |
| 8 | `lib/executor.js` | 105 | `src/lib/executor.ts` |
| 9 | `lib/config.js` | 72 | `src/lib/config.ts` |
| 10 | `lib/provider-loader.js` | 127 | `src/lib/provider-loader.ts` |
| 11 | `tools/qln-call.js` | 258 | `src/tools/qln-call.ts` |
| 12 | `index.js` | 81 | `src/index.ts` |

---

## 2. 전략: 일괄 전환 (방법 B)

### After 구조
```
QLN/
├── src/                    ← [NEW] TypeScript 소스
│   ├── index.ts
│   ├── types.ts            ← 공통 타입
│   ├── lib/  (10파일)
│   └── tools/ (1파일)
├── dist/                   ← 컴파일 결과 (gitignored)
├── index.js                ← require('./dist/index.js') 포워더
├── tsconfig.json           ← [NEW]
├── package.json            ← v4.0.0, types 필드 추가
├── data/                   ← 유지
├── providers/              ← 유지
└── test/                   ← 유지
```

---

## 3. 타입 설계 (src/types.ts)

```typescript
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
  embedding: number[] | null;
  usageCount: number;
  successRate: number;
  lastUsedAt: string | null;
  registeredAt: string;
  updatedAt: string;
}

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
  usageCount?: number;
  successRate?: number;
  lastUsedAt?: string | null;
  embedding?: number[] | null;
  registeredAt?: string;
}

export interface QLNConfig {
  dataDir: string;
  embedding: { enabled: boolean; model: string; endpoint: string; };
  executor: { httpEndpoint: string | null; timeout: number; };
  providers: { enabled: boolean; dir: string; };
  search: { defaultTopK: number; threshold: number; };
}

export interface SearchResult {
  name: string;
  score: number;
  stages: { trigger: number; keyword: number; semantic: number;
            usage: number; success: number; recencyFactor: number; };
  description: string;
  source: string;
  category: string;
  inputSchema: Record<string, unknown> | null;
  explorer?: boolean;
}

export interface SearchTiming {
  stage1: number; stage2: number; stage3: number; merge: number; total: number;
}

export interface ValidationError {
  field: string; message: string; severity: 'error' | 'warning';
}

export interface ProviderManifest {
  provider: string;
  version?: string;
  description?: string;
  endpoint?: string;
  tools: Array<{
    name: string; description: string; category?: string;
    inputSchema?: Record<string, unknown>; triggers?: string[];
    tags?: string[]; examples?: string[]; endpoint?: string;
  }>;
}

export interface ExecResult {
  result: unknown; source: 'local' | 'http'; elapsed: number;
}

export interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  export(): Uint8Array;
  close(): void;
}

export interface SqlJsStatic {
  Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
}
```

---

## 4. 변환 규칙

- `require()` → `import` (특수: config.local.js, sql.js는 require 유지)
- `module.exports` → `export`
- `any` 금지 → `unknown` + 타입 가드
- private 필드: `_field` → `private _field`

---

## 5. 실행 순서 (의존성 기반)

```
Phase 1: 인프라
  tsconfig.json + types.ts + devDeps 설치

Phase 2: 코어 모듈 (의존 없음 → 있음 순서)
  1. schema.ts       ← 의존 없음
  2. embedding.ts    ← 의존 없음
  3. store.ts        ← sql.js
  4. validator.ts    ← types
  5. registry.ts     ← store, schema, embedding
  6. vector-index.ts ← 의존 없음
  7. router.ts       ← registry, vector-index, embedding, schema
  8. executor.ts     ← 의존 없음
  9. config.ts       ← 의존 없음
  10. provider-loader.ts ← schema, registry

Phase 3: 엔트리
  11. tools/qln-call.ts ← router, executor, registry, validator
  12. index.ts          ← 전체 조합

Phase 4: 빌드 + 검증
  tsc → MCP 핸드셰이크 → n2_qln_call 동작 확인

Phase 5: 정리
  레거시 JS 삭제 (승인 후) + .npmignore + README
```

---

## 6. package.json diff

```diff
-"version": "3.4.2",
+"version": "4.0.0",
-"main": "index.js",
+"main": "dist/index.js",
+"types": "dist/index.d.ts",
+"scripts": { "build": "tsc", "start": "node dist/index.js", "dev": "tsc --watch" }
+"devDependencies": { "typescript": "^5.7.0", "@types/node": "^22.0.0" }
```

---

## 7. 성공 기준

- [ ] `tsc --noEmit` 에러 0개
- [ ] `tsc` 빌드 성공
- [ ] MCP 핸드셰이크: `n2-qln v4.0.0`
- [ ] 기존 data/qln-tools.sqlite 호환
- [ ] npm publish 준비 완료
