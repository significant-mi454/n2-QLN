# QLN v4.0.0 신기능 기획서

> **작성**: Rose | **날짜**: 2026-03-31
> **상태**: TS 마이그레이션 + Sindri PASSED 완료. 아래 기능 구현 대기.

---

## 🎯 v4 핵심 철학

> "2 calls → 1 call. 토큰은 돈이다."

v3까지는 `search → exec` 2단계 호출. v4는 **AI가 1번만 부르면 끝나는** 자율 라우팅.

---

## F1. ⚡ `auto` 액션 — Search+Exec 원샷 (최우선)

### 문제
```
현재 (2 calls, ~400 토큰 소비):
  call 1: n2_qln_call(search, "take screenshot") → 5개 결과 텍스트
  call 2: n2_qln_call(exec, "take_screenshot", {url: "..."}) → 실행 결과
```

### 설계
```typescript
// 새 액션: auto
n2_qln_call(action: "auto", query: "take a screenshot of this page", args: { url: "..." })

// 내부 플로우:
// 1. route(query, topK=3) → 검색
// 2. top1.score >= autoThreshold(0.8) → 자동 선택
// 3. executor.exec(top1.name, args) → 실행
// 4. 결과만 반환 (검색 과정 생략)
```

### 반환 형식
```
✅ [take_screenshot] auto-routed (score: 4.29, 15ms)
{결과 데이터}
```

### 안전장치
- `autoThreshold` (기본 0.8): 이하면 검색 결과만 반환 (fallback to search)
- `confirmBeforeExec` config: true면 항상 검색만
- score 차이(1위-2위)가 0.5 미만이면 → 모호하므로 검색 결과 반환

### 토큰 절감 효과
- **50% 감소**: 2 calls → 1 call
- 검색 결과 텍스트(~200 토큰) 생략 → output 토큰도 절감

---

## F2. 📊 `stats` 액션 — 시스템 자가진단

### 설계
```typescript
n2_qln_call(action: "stats")
```

### 반환 정보
```
QLN v4.0.0 | 도구 230개 | DB 45KB
임베딩: 205/230 (89%) | 모델: nomic-embed-text
카테고리: web(42) data(38) ai(29) dev(25) capture(18) file(15) misc(63)
BM25: IDF 1,247 terms | avgDocLen 12.3
벡터: 768dim | 205 indexed | 8 categories | 614KB
Top 5 사용: human_click(342) ai_read(289) ai_surf(201) ...
검색 성능: avg 3ms (Stage1: 0ms, Stage2: 1ms, Stage3: 2ms)
프로바이더: 3 loaded (n2-browser, n2-soul, pdf-tools)
```

### 구현 위치
- `qln-call.ts` _handleStats() 추가
- `registry.stats()` + `router.stats()` 조합

---

## F3. 🎯 소스별 가중치 라우팅

### 문제
n2-soul 도구와 generic provider 도구가 **동일 점수**로 경쟁.
실제로는 현재 에이전트가 사용 중인 MCP 서버 도구가 우선.

### 설계
```javascript
// config.local.js
module.exports = {
  sourceWeights: {
    'mcp:n2-soul': 1.5,      // 50% 가산
    'mcp:n2-browser': 1.3,
    'provider:*': 1.0,        // 기본
    'local': 0.8,
  }
};
```

### 구현 위치
- `router.ts` `_mergeAndRank()` 에서 finalScore에 sourceWeight 곱셈
- config에 없는 source는 기본 1.0

---

## F4. 📦 `inject` 액션 — Bulk 도구 주입

### 문제
MCP 서버가 부팅 시 자기 도구 20~50개를 등록하려면 `create`를 50번 호출.
인덱스 재빌드도 50번.

### 설계
```typescript
n2_qln_call(action: "inject", tools: [
  { name: "read_page", description: "...", source: "mcp:n2-browser", ... },
  { name: "ai_surf", description: "...", source: "mcp:n2-browser", ... },
  // ... 50개
])
```

### 내부 흐름
1. `registry.purgeBySource(source)` — 기존 동일 소스 도구 제거
2. `registry.registerBatch(tools)` — 원자적 일괄 등록
3. `router.buildIndex()` — 인덱스 재빌드 **1회만**
4. 결과: "✅ Injected 50 tools from mcp:n2-browser (rebuild: 3ms)"

### Zod 스키마 변경
```typescript
tools: z.array(z.object({
  name: z.string(),
  description: z.string(),
  source: z.string().optional(),
  category: z.string().optional(),
  // ...
})).optional().describe('[inject] Bulk tool array')
```

---

## F5. 🔥 Hot Reload (프로바이더 감시)

### 설계
```typescript
// index.ts — 프로바이더 디렉토리 fs.watch
if (config.providers?.watch !== false) {
  fs.watch(provDir, { persistent: false }, (event, filename) => {
    if (!filename?.endsWith('.json')) return;
    setTimeout(() => {  // debounce 500ms
      loadProviders(provDir, registry);
      router.buildIndex();
      console.error(`[QLN] Hot-reloaded: ${filename}`);
    }, 500);
  });
}
```

### config
```javascript
providers: {
  enabled: true,
  dir: '...',
  watch: true,  // 새 옵션
}
```

---

## 📋 구현 순서

| 순서 | 기능 | 예상 시간 | 파일 변경 |
|------|------|-----------|-----------|
| 1 | F1 `auto` 액션 | 40분 | qln-call.ts, types.ts, config.ts |
| 2 | F2 `stats` 액션 | 20분 | qln-call.ts |
| 3 | F4 `inject` 액션 | 30분 | qln-call.ts, types.ts |
| 4 | F3 소스 가중치 | 30분 | router.ts, config.ts, types.ts |
| 5 | F5 Hot Reload | 20분 | index.ts, config.ts |

**총 예상: ~2.5시간**

---

## ⚠️ 주의사항

- `auto` 액션의 autoThreshold는 실사용 데이터로 튜닝 필요 (0.8이 적정한지)
- `inject` 시 source별 purge가 기본 → 부분 업데이트가 아닌 전체 교체 모델
- Hot Reload의 fs.watch는 OS별 이벤트 중복 가능 → debounce 필수
- 모든 신규 액션은 validator.ts에 검증 규칙 추가 필요
