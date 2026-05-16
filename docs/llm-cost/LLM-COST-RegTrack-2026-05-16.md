# LLM 비용 모델 — RegTrack (OpenRouter + Qwen3.6-35b-a3b)

> 12주 시연 기간 동안 LLM API 호출별 토큰·비용 추정 + 캐싱 시나리오 + 모델 선택 매트릭스 + 예산 가드 정책.
> seed-v7 확정 모델 기준.

| 항목 | 내용 |
|------|------|
| **버전** | v1 |
| **작성일** | 2026-05-16 |
| **출처** | seed-v7 D-12 · OpenRouter pricing API |
| **Provider** | OpenRouter (`https://openrouter.ai/api/v1`) |
| **Default Model** | **`qwen/qwen3.6-35b-a3b`** (MoE: 35B 전체 / 3B active) |
| **단가** | **$0.15 / $1.00** per 1M tokens (prompt / completion) |
| **총 예산** | $100 / 2.5개월 |
| **AC-008 임계치** | $30 YELLOW / $60 ORANGE / $90 RED |

---

## 목차

- [1. 가격 기준 (Pricing Reference)](#1-가격-기준-pricing-reference)
- [2. 호출 시나리오별 토큰·비용 추정](#2-호출-시나리오별-토큰비용-추정)
- [3. 12주 시연 기간 누적 비용 시뮬레이션](#3-12주-시연-기간-누적-비용-시뮬레이션)
- [4. 캐싱 전략별 절감 시나리오](#4-캐싱-전략별-절감-시나리오)
- [5. 단계별 임계치 (AC-008) 도달 분석](#5-단계별-임계치-ac-008-도달-분석)
- [6. 모델 선택 매트릭스 (전환 후보)](#6-모델-선택-매트릭스-전환-후보)
- [7. 예산 가드 정책 (코드 의사결정)](#7-예산-가드-정책-코드-의사결정)
- [8. 모니터링·알림 운영](#8-모니터링알림-운영)
- [9. Risk 시나리오 (worst-case)](#9-risk-시나리오-worst-case)
- [10. References](#10-references)

---

## 1. 가격 기준 (Pricing Reference)

### 1.1 확정 모델

| 항목 | 값 |
|------|-----|
| Provider | OpenRouter |
| Model ID | `qwen/qwen3.6-35b-a3b` |
| 아키텍처 | MoE (Mixture of Experts) — 35B 전체 / **3B active** per inference |
| Context window | 32k tokens (Qwen3.6 standard) |
| Prompt 단가 | **$0.15 / 1M tokens** ($0.00000015/token) |
| Completion 단가 | **$1.00 / 1M tokens** ($0.000001/token) |
| 비교 (가정) GPT-4o-mini | $0.15 / $0.60 — prompt 동일, completion 67% 저렴 |
| 비교 Claude Haiku | $0.25 / $1.25 — prompt 67% 비쌈, completion 25% 비쌈 |

### 1.2 비용 계산 공식

```
cost_per_call_usd = (input_tokens × 0.15 + output_tokens × 1.00) / 1_000_000
```

예시:
- 2,000 input + 600 output → **$0.0009** (= 0.09 cent)
- 1,000 input + 100 output → **$0.00025**
- 5,000 input + 1,000 output → **$0.00175**

> Qwen3.6-35b-a3b는 MoE 특성상 latency가 dense 모델보다 빠름 (시연 wow 강화).

---

## 2. 호출 시나리오별 토큰·비용 추정

### 2.1 호출 종류 6가지

| ID | 호출 위치 | 트리거 | 평균 input | 평균 output | $/call |
|----|----------|--------|-----------|------------|--------|
| **C-1** | `classifyChangeType` | 신규 Regulation 발견 시 | 1,500 | 50 | **$0.000275** |
| **C-2** | `analyzeImpact` (Citation 강제) | 사용자 질문 OR 자동 분석 | 2,500 | 600 | **$0.000975** |
| **C-3** | `generateMeetingDigest` | 주 1회 회의 conduct | 3,500 | 500 | **$0.001025** |
| **C-4** | `diff_summary` (RegulationVersion) | 개정 발견 시 | 2,000 | 80 | **$0.000380** |
| **C-5** | (stretch) 의미 검색 임베딩 | RAG 인덱스 빌드 | 500 | 0 | $0.000075 |
| **C-6** | 개발·디버깅 호출 | 개발자가 ad-hoc | 1,000 | 200 | **$0.000350** |

> C-2 (analyzeImpact)이 가장 무거움 — Citation 검증 + 근거 후보 5개 포함 prompt.

### 2.2 토큰 구성 상세 (C-2 예시)

```
analyzeImpact 호출 시 prompt 구성:
┌──────────────────────────────────────────────────────────┐
│ system prompt                              ~ 300 tokens  │  ← 캐시 가능
│   "당신은 금융 규제 영향도 분석가입니다..."                  │
│                                                          │
│ rag_hits (BM25 top-5)                     ~ 1,500 tokens │  ← 호출마다 다름
│   1. "제5조 ②항에 따라..." (300 tokens)                   │
│   2. ...                                                 │
│                                                          │
│ user query                                ~ 100 tokens   │
│   "이 규제가 우리 리테일 부서에..."                          │
│                                                          │
│ format instructions                       ~ 600 tokens   │  ← 캐시 가능
│   "응답은 다음 JSON 스키마로 ..."                           │
├──────────────────────────────────────────────────────────┤
│ Total input                               ~ 2,500 tokens │
└──────────────────────────────────────────────────────────┘

Output:
┌──────────────────────────────────────────────────────────┐
│ JSON response                             ~ 600 tokens   │
│   {                                                      │
│     "severity": "HIGH",                                  │
│     "summary": "...",                                    │
│     "citations": [...]                                   │
│   }                                                      │
└──────────────────────────────────────────────────────────┘
```

> **캐시 가능 비율**: system + format instructions ≈ 900 / 2,500 = **36%**. OpenRouter prompt cache 지원 시 큰 절감.

---

## 3. 12주 시연 기간 누적 비용 시뮬레이션

### 3.1 호출 빈도 가정 (운영 + 개발 합)

| 호출 | 빈도 (per day) | 12주(84일) 총 | 단가 | 누적 |
|------|--------------|-------------|------|------|
| C-1 classify | 5 (신규 평균) | 420 | $0.000275 | $0.116 |
| C-2 analyzeImpact | 3 (질문 + 자동) | 252 | $0.000975 | $0.246 |
| C-3 digest | 0.14 (주 1회) | 12 | $0.001025 | $0.012 |
| C-4 diff_summary | 1 (개정 평균) | 84 | $0.000380 | $0.032 |
| **소계 (운영)** | | | | **$0.406** |
| C-6 개발/디버깅 | 12 (4명×3회) | 1,008 | $0.000350 | $0.353 |
| 테스트 자동화 (CI) | 50/run × 30 runs | 1,500 | $0.000275 | $0.413 |
| 리허설 (3회 × 6 calls) | - | 18 | $0.001000 | $0.018 |
| **소계 (개발)** | | | | **$0.784** |
| **시연 본편** (1회) | - | 5 | $0.000975 | $0.005 |
| ─────────────────────────── | | | | ─────── |
| **총 추정 (12주)** | | | | **$1.20** |

> **$100 예산의 1.2%**. 추정 정확도 ±50% 가정해도 최대 $1.80.

### 3.2 시연 본편 5분 30초 — 호출 5건 상세

| Frame | 호출 | input | output | $/call | 누적 $ |
|-------|------|-------|--------|--------|--------|
| Frame 2 | C-1 classify | 1,500 | 50 | $0.000275 | $0.0003 |
| Frame 3 | C-2 analyzeImpact (BM25 + LLM) | 2,500 | 600 | $0.000975 | $0.0013 |
| Frame 3 | C-2.1 Citation extract (별도 호출 필요 시) | 1,800 | 400 | $0.000670 | $0.0019 |
| Frame 4 | (응답 표시만, LLM 호출 X) | - | - | - | $0.0019 |
| Bonus | C-3 generateMeetingDigest | 3,500 | 500 | $0.001025 | $0.0030 |
| ─── | **시연 본편 총** | | | | **$0.003** (= 0.3 cent) |

> 시연 동안 위젯은 `💰 $0.00 → $0.003`로만 변화. **threshold_level NONE 유지**.

### 3.3 누적 비용 그래프 (월별)

```
Month 1 (W1-W4):   $0.20  (M1 분석·설계 + M2 일부 — 개발 호출만)
Month 2 (W5-W8):   $0.55  (M2-M3 — analyzer benchmark + 통합 테스트)
Month 2.5 (W9-W12): $0.45 (M4 통합 + 리허설 + 시연 본편)
─────────────────────────────────────
누적                $1.20   (예산 1.2%)
```

> 매월 1회 비용 점검 (월말 retro 안건). 임계 도달 시 즉시 대응.

---

## 4. 캐싱 전략별 절감 시나리오

### 4.1 캐싱 가능 항목

| 항목 | 캐시 키 | TTL | 절감 |
|------|---------|-----|------|
| **System prompt** (analyze/digest) | `hash(system_prompt)` | 영구 | ~$0.10 (cache 35% × $0.25 운영 비용) |
| **Format instructions** | `hash(instructions)` | 영구 | 포함 above |
| **동일 Regulation 영향도 (재질문)** | `hash(reg_id + dept)` | 24h | ~$0.05 (반복 질문 가정) |
| **classify 결과** (동일 external_id 재처리) | `hash(text_hash)` | 영구 | ~$0.02 (개정 재분류) |
| **RAG search results** | `hash(query + reg_id)` | 1h | 검색 LLM 호출 없음 — 토큰만 |

### 4.2 캐싱 전략 비교

| 전략 | 적용 | 추정 절감 | 추정 비용 |
|------|------|-----------|----------|
| **No cache** | - | $0 | $1.20 |
| **Lazy disk cache** | 마지막 호출 디스크 저장 | $0.15 | $1.05 |
| **Smart prompt cache** (Recommended) | system + format + 동일 질문 | $0.35 | **$0.85** |
| **OpenRouter prompt cache** (지원 시) | provider 측 cache | $0.50 | **$0.70** |

> seed-v7 should 권장: "Smart prompt cache" 우선 적용. OpenRouter prompt cache 지원 여부는 W6 LLMClient 구현 시 검증 (pending_v8).

### 4.3 캐시 적중률 (시연 위젯 표시)

위젯의 `cache_hit_rate`는 직전 100회 기준:
- 시연 시작: 0% (cache 비어있음)
- 1~2분: ~25% (system prompt 캐싱)
- 5분 (시연 종료): ~33%
- 일주일 운영 후: ~50% (반복 질문 + classify 패턴)

→ **위젯의 ⚡ 카드 적중률 증가가 시연 wow 모먼트 중 하나**.

---

## 5. 단계별 임계치 (AC-008) 도달 분석

### 5.1 임계치 도달 예측

| 임계치 | 누적 $ | 추정 도달 시점 | 트리거 조건 |
|--------|--------|--------------|------------|
| YELLOW | $30 | **거의 도달 불가** | 운영 30배 가속 (개발 호출 × 30) |
| ORANGE | $60 | **불가** | 의도적 stress test 또는 무한 루프 버그 |
| RED | $90 | **불가** | 같음 |

### 5.2 도달 가능 시나리오 (버그·실수)

| 시나리오 | 발생 호출 수 | 추정 시간 |
|---------|-------------|----------|
| `analyzeImpact` 무한 루프 (호출 1000회/분) | 60,000회 | 60분 → ~$58 |
| 디스크 캐시 손실로 system prompt 매 호출 fresh | 운영 호출의 100% | 12주 → ~$0.7 (영향 작음) |
| 잘못된 stress test (10만 호출) | 100,000회 | 1회 → ~$97 (한 번에 RED) |
| 외부 사용자 무단 호출 (보안 사고) | 의존 | 즉시 RED |

> **결론**: 정상 운영에서 임계치 도달 불가. **단계별 가드는 버그·실수 대비 안전망**.

### 5.3 시연 시각 효과

시연 본편에선 위젯 색상이 NONE(GRAY) 유지 → "비용 통제 잘 됨" 메시지. 그러나 **데모용 stress test**로 일부러 일정 누적시켜 단계 변화를 1회 시연하는 것도 옵션 (양보 §6 ⑤ 이후):

```python
# scripts/demo-budget-stress.py (옵션)
# 시연 발표 전 별도 30초 데모로 단계별 임계 변화 보여주기
for i in range(200):
    await llm.complete(big_prompt, big_user)   # 누적 $30 도달 → YELLOW
    if i == 100: print("YELLOW reached")
    ...
```

> 다만 메인 시연엔 포함 X (storyboard §2). 발표자 임의 가능.

---

## 6. 모델 선택 매트릭스 (전환 후보)

### 6.1 W6 benchmark 후 전환 검토 가능 모델

| Model | Prompt $/1M | Completion $/1M | 강점 | 약점 | 12주 추정 비용 |
|-------|------------|----------------|------|------|--------------|
| **qwen/qwen3.6-35b-a3b** (현 default) | $0.15 | $1.00 | 가성비, MoE 빠름 | 도메인 정확도 미검증 | **$1.20** |
| qwen/qwen3.6-flash | $0.19 | $1.13 | 가장 빠름 | 정확도 ↓ | $1.42 |
| qwen/qwen3.6-27b (dense) | $0.32 | $3.20 | 정확도 ↑ | 가격 ↑↑ | $4.20 |
| qwen/qwen3.6-plus | $0.33 | $1.95 | 균형 | 시연 비용 ↑ | $2.30 |
| qwen/qwen3.6-max-preview | $1.04 | $6.24 | 최강 | 가격 부담 | $7.80 |
| qwen/qwen3.5-35b-a3b | $0.14 | $1.00 | v3.6 거의 동일 가격 | 한 단계 이전 | $1.18 |

### 6.2 전환 의사결정 트리

```
1. qwen3.6-35b-a3b로 시작 (현재 default)
   ↓
2. W6 첫 주: 영향도 분석 benchmark (FSS 30건)
   ↓
3a. hit rate ≥ 70% AND Citation 정확도 OK
    → 유지 → 12주 동안 default
3b. hit rate < 70% AND 예산 여유 (현재 $1.20)
    → qwen3.6-27b 또는 qwen3.6-plus로 전환 (seed-v8)
3c. 정확도 OK이지만 latency 문제
    → qwen3.6-flash로 전환 (실시간성 우선)
```

### 6.3 다중 모델 동시 사용 (옵션)

```python
# 호출 타입별 다른 모델 사용 가능
TASK_MODEL_MATRIX = {
    "classify": "qwen/qwen3.6-flash",       # 빠르고 단순
    "analyze":  "qwen/qwen3.6-35b-a3b",     # 정확도 중요
    "digest":   "qwen/qwen3.6-35b-a3b",     # 정확도 중요
    "diff":     "qwen/qwen3.6-flash",       # 단순
}
```

> 단 운영 복잡도 ↑. MVP는 단일 모델 권장.

---

## 7. 예산 가드 정책 (코드 의사결정)

### 7.1 단계별 행동 매트릭스 (BR-2 강화)

| 누적 $ | level | 자동 행동 | 사용자 알림 | 호출 차단 |
|--------|-------|----------|-----------|----------|
| 0~29.99 | NONE | - | 위젯 GRAY | - |
| 30~59.99 | YELLOW | stderr 경고 | 위젯 🟡 + NPC 알림 | - |
| 60~89.99 | ORANGE | NPCReport(ERROR) push | 위젯 🟠 + 명시적 경고 | - |
| 90~99.99 | RED | NPCReport(ERROR) push | 위젯 🔴 + 차단 임박 경고 | **non-essential 차단** |
| ≥100 | LIMIT | - | 위젯 🔴 + 차단 메시지 | **모든 호출 차단** |

### 7.2 호출 우선순위 (RED·LIMIT 시 차단 순서)

```python
class CallPriority(Enum):
    DEMO_REHEARSAL = 1     # 시연 리허설 — 최우선 (절대 차단 X)
    USER_REQUEST = 2       # 사용자 askAnalystNPC — 시연 본편 보장
    AUTO_CLASSIFY = 3      # 자동 분류 — 시연 외 차단 가능
    MEETING_DIGEST = 4     # 주간 회의 — RED 시 cut 가능
    DEV_DEBUG = 5          # 개발 디버깅 — 가장 먼저 차단
```

### 7.3 의사코드 (`services/llm/budget_guard.py`)

```python
async def call_llm_with_guard(
    *,
    prompt: str,
    priority: CallPriority,
    estimated_cost: float,
) -> LlmResponse:
    cumulative = repo.usage.cumulative_cost_usd()

    # LIMIT 100% 차단
    if cumulative + estimated_cost >= 100.0:
        raise BudgetExceededError(cumulative)

    # RED 90% — non-essential 차단
    if cumulative >= 90.0 and priority.value > 2:
        raise BudgetThrottledError(priority, cumulative)

    # ORANGE 60% — NPCReport ERROR push (한 번만)
    if cumulative >= 60.0 and not _orange_warned:
        await notifier.push_error("BUDGET_ORANGE", cumulative)
        _orange_warned = True

    # YELLOW 30% — stderr
    if cumulative >= 30.0:
        sys.stderr.write(f"[BUDGET] YELLOW: ${cumulative:.2f}\n")

    return await llm_client.complete(prompt)
```

---

## 8. 모니터링·알림 운영

### 8.1 모니터링 지표

| 지표 | 측정 위치 | 갱신 주기 | 노출 |
|------|----------|----------|------|
| `cumulative_cost_usd` | LLMUsageRecord SUM | 매 호출 | LlmUsageWidget + `/api/llm-usage/snapshot` |
| `call_count` | LLMUsageRecord COUNT | 매 호출 | 위젯 |
| `cache_hit_rate` (window 100) | services.llm.cache | 매 호출 | 위젯 |
| `last_model` | 최신 record | 매 호출 | 위젯 |
| `tokens_per_call` (avg, window 50) | aggregate | 매 50회 | retro 보고 |
| `cost_per_call` (avg, window 50) | aggregate | 매 50회 | retro 보고 |
| `daily_cost` | aggregate (24h) | 1일 | 일간 retro |

### 8.2 알림 채널 (시연 환경 기준)

| 알림 | 채널 | 트리거 |
|------|------|--------|
| stderr 로그 | docker logs | YELLOW |
| NPCReport(ERROR) | WebSocket → 위젯 + 분석 NPC 말풍선 | ORANGE, RED |
| Slack/이메일 (stretch) | webhook | RED, LIMIT |
| 어드바이저 보고 | manual | LIMIT 또는 retro 발견 |

### 8.3 일간 점검 스크립트 (제안)

```bash
# scripts/daily-cost-check.sh
TODAY_COST=$(sqlite3 data/sqlite.db \
  "SELECT COALESCE(SUM(cost_usd), 0) FROM llm_usage_records \
   WHERE created_at >= date('now', 'localtime')")

CUMULATIVE=$(sqlite3 data/sqlite.db \
  "SELECT COALESCE(SUM(cost_usd), 0) FROM llm_usage_records")

echo "오늘: \$${TODAY_COST}"
echo "누적: \$${CUMULATIVE} / \$100"
```

---

## 9. Risk 시나리오 (worst-case)

### 9.1 시나리오 분석

| 시나리오 | 확률 | 영향 | 대응 |
|---------|------|------|------|
| **A. OpenRouter 가격 인상** (예: 2배) | Low | $2.40 → 여전히 안전 | 모니터링만 |
| **B. Qwen 정확도 미달 → qwen3.6-plus 전환** | Medium | $1.20 → $2.30 → 안전 | seed-v8 + 비용 재추정 |
| **C. 무한 루프 버그 (1시간)** | Low | +$58 → ORANGE 도달 | $90 RED에서 자동 차단 |
| **D. 외부 사용자 무단 호출** | Very Low | $100 한 번에 도달 | LIMIT 차단 + 알림 |
| **E. OpenRouter 서비스 다운** | Low | 0 cost but R-12 trigger | prompt cache fallback (4.2) |
| **F. 예산 0 도달 (시연 직전)** | Very Low | 시연 불가 | **사전 캐싱 fixture** (storyboard §7.2) |

### 9.2 최악 시나리오 비용 추정

```
정상 운영:                      $1.20  (1.2%)
+ 가격 인상 2배:                $2.40  (2.4%)
+ qwen3.6-plus 전환:           $4.60  (4.6%)
+ 무한 루프 1회 (자동 차단):    $4.60 + $58 = $62.60  (62.6%)
─────────────────────────────────
잔여 예산:                      $37.40  → 시연 가능
```

> **결론**: 모든 worst-case가 동시 발생해도 예산 내. AC-008 단계별 가드의 효용 = "조기 발견·대응 가능".

---

## 10. References

- **Seed v7**: `.harness/ouroboros/seeds/seed-v7.yaml` (D-12 모델 결정)
- **PRD §10 R-3**: `docs/prd/PRD-RegTrack-2026-05-16.md`
- **TRD §2.2.3 BR-2**: `docs/trd/TRD-RegTrack-2026-05-16.md`
- **API spec §5**: `docs/api/API-RegTrack-2026-05-16.md` (OpenRouter 통합)
- **Storyboard §6**: `docs/demo-scenario/STORYBOARD-RegTrack-2026-05-16.md` (위젯 변화)
- **Risk R-3, R-12, R-13**: `docs/risk/RISK-RegTrack-2026-05-16.md`
- **OpenRouter pricing**: https://openrouter.ai/api/v1/models
- **Qwen3.6 모델 페이지**: https://openrouter.ai/qwen/qwen3.6-35b-a3b
- **Qwen MoE 아키텍처**: https://qwenlm.github.io/blog/qwen3/
