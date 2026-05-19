# TRD: RegTrack v9 (M3/M4 Owner Scope) — Technical Reference Document

> **Technical Reference Document v3 — Owner-scoped**
> 본 문서는 seed-v9의 결정을 **M3/M4 owner(nanobot↔deskrpg gateway + Obsidian 프론트엔드)** 관점에서 **3-tier layered architecture**로 구현하기 위한 기술 설계서입니다.
> ARCHITECTURE_INVARIANTS.md Part 1을 절대 우선 준수합니다.
> 본 TRD는 v8 TRD(`TRD-RegTrack-2026-05-16.md`)의 보완·갱신본 — 변경 없는 부분은 v8 TRD를 참조합니다.

> **Changelog v2 → v3 (2026-05-19, seed-v9 기반)**:
> - **§1.3 Scope**: owner block 17 AC 중 high-complexity 7개 + AC-001 contract만 다룸 (other team scope 제외)
> - **§2.3 Data Layer**: SQLite 완전 제거 → **PostgreSQL 단일** (D-15/D-17, parallel-change plan `pc-2026-05-19-sqlite-to-postgres`)
> - **§2.2.x Provider Abstraction**: AI_PROVIDER=openclaw 경로 제거 → **nanobot 단일** (D-18, parallel-change plan `pc-2026-05-19-openclaw-to-nanobot`)
> - **§2.2.gateway 신규**: nanobot 게이트웨이 9 functional categories parity 설계 (AC-013..021)
> - **§2.3 신규 엔티티**: NanobotAgentSession, GatewayDeviceIdentity, GatewayChannelBinding
> - **§3.x AC-008 enforcement**: $60 NPCReport push + $90 BUDGET_EXCEEDED 차단 위치 명시 (D4)
> - **§5 신규**: Citation entity 데이터 모델 + cross-team contract for AC-001
> - **§6 D-13..D-19**: 본 TRD의 7개 신규 기술 결정 (D1-D7 from /trd 논의)
> - **§7 Implementation Order**: seed-v9 dependencies.recommended_execution_order 7 phases 채택

---

## 1. Overview

| 항목 | 내용 |
|------|------|
| **TRD 버전** | v3 (Owner-scoped, M3/M4) |
| **작성일** | 2026-05-19 |
| **출처(Source)** | `seed-v9.yaml`, 인터뷰 `2026-05-19-10-04.yaml` |
| **이전 TRD** | `TRD-RegTrack-2026-05-16.md` (v2, seed-v4 기반) |
| **아키텍처 패턴** | 3-tier-layered (Presentation / Logic / Data) |
| **Active methodologies** | ouroboros + living-spec + parallel-change + rfc-driven + incident-review |
| **Active parallel-change plans** | `pc-2026-05-19-sqlite-to-postgres` (expand, 5/4) · `pc-2026-05-19-openclaw-to-nanobot` (expand, 11/10) |
| **Base repo** | `github.com/jhkim43/reg-detection @ dev/nanobot` (현재 HEAD: `69b3f2c9` after PR #14) |
| **Forks** | 백엔드: nanobot (Python) / 프론트: deskrpg (Next.js+TS) |

### 1.1 목표 요약 (seed-v9 goal.summary)

금융 규제 변동 자동 수집·분석 → deskrpg RPG 대시보드 NPC가 in-world 보고 + 주간 컴플 회의실 디지스트 자동 발표. **FSS 1개 소스 end-to-end MVP**.

### 1.2 owner 정의 (seed-v9 owner block)

본 TRD가 다루는 owner = **m3_m4_gateway** (nanobot↔deskrpg 게이트웨이 + Obsidian 프론트엔드 + 스토리보드 시연 구현). 담당 AC 17개 중 본 TRD의 **상세 설계 대상은 high-complexity 7개**.

### 1.3 Scope

| 분류 | AC | TRD 상세 설계 | 비고 |
|---|---|:---:|---|
| owner (high) | AC-003, AC-005, AC-008, AC-011, AC-013, AC-014, AC-016 | ✅ 본 TRD §2~§5 | 7개 |
| owner (medium/low) | AC-002, AC-004, AC-006, AC-009 *partial*, AC-012, AC-015, AC-017, AC-018, AC-019, AC-020, AC-021 | 📋 §7 Implementation Order에만 언급 | 11개 |
| cross-team (other) | AC-001 | 🤝 §5.4 contract만 명시 (D1=c) | 인터페이스 계약 |
| 타 팀 | AC-007, AC-009 (full), AC-010 | ❌ 본 TRD 범위 외 | 3개 |

### 1.4 핵심 결정 요약 (D1-D7, /trd 논의 결과)

| # | 결정 요지 | 결정값 | §참조 |
|---|----------|-------|------|
| **D-13** | AC-001은 owner가 아니므로 TRD에는 **인터페이스 계약(contract)만** 포함 | D1=c | §5.4 |
| **D-14** | nanobot↔deskrpg 통신 프로토콜은 **현재 WebSocket + HTTP + RPC 패턴 유지** (functional parity) | D2=a | §2.4 |
| **D-15** | Citation 데이터 모델은 **deskrpg drizzle (PostgreSQL) 단일 source**, nanobot이 dispatch 시 POST | D3=a | §2.3, §5.2 |
| **D-16** | AC-008 BUDGET_EXCEEDED 차단은 **nanobot LLMUsageHook (provider 직접)** + DB cumulative cost를 source of truth, 위젯은 **read-only** | D4=a | §2.2.b, §3.4 |
| **D-17** | 주간 회의실(AC-011)은 **기존 meeting-broker.js 재활용 + repurpose** (openclaw 분기는 parallel-change contract에서 정리) | D5=a | §3.5 |
| **D-18** | Ed25519 페어링 첫 실행 UX는 **env var 분기**: `PAIRING_MODE=auto` (dev/demo) / `manual` (prod) | D6=c | §3.6 |
| **D-19** | 구현 순서는 seed-v9 `dependencies.recommended_execution_order` 7 phases **그대로 채택** | D7=a | §7 |

---

## 2. Layer Design

### 2.1 Presentation Layer (`deskrpg/src/...`)

| AC | 컴포넌트/페이지 | 책임 | 의존 (Logic API) |
|----|--------------|------|------|
| AC-003 | `<NpcChatPanel>` (기존 ChatPanel 확장) | 사용자 → 분석 NPC 자연어 질문, 응답 in-world 말풍선 (streaming) | `POST /api/npcs/:id/chat` (SSE) |
| AC-005 | `<GamePageClient>` 시연 시나리오 hooks | 4단계 연출 (입장→크롤러 보고→질문→Citation 응답) | NPCReport WebSocket + AC-003 chat API |
| AC-008 | `<LlmUsageWidget>` (PR2a/2b 확장) | 위젯 (a)cost (b)calls (c)cache% (d)model (e)threshold_level, **read-only** | `GET /api/llm-usage/snapshot` + WS `llm-usage:update` |
| AC-011 | `<WeeklyComplianceMeetingRoom>` (meeting-broker.js 재활용) | 크롤러+분석 NPC 좌석 배치, 디지스트 낭독 분배 | `POST /api/meetings/:id/start` + WS `meeting:turn` |
| AC-013 | `<NpcManagementUI>` (기존 NPC CRUD UI 유지) | 페르소나 편집 → IDENTITY.md/SOUL.md write-only mirror 트리거 | `POST/PUT/DELETE /api/npcs/:id` |
| AC-014 | `<NpcChatPanel>` streaming 표시 | onDelta chunk마다 말풍선 점진 갱신, chatAbort 버튼 | SSE through nanobot adapter |
| AC-016 | `<OpenClawPairingStatusCard>` rename → `<NanobotPairingStatusCard>` | 4상태(idle/connected/pairingRequired/error), env-aware 자동/수동 분기 | `POST /api/gateways/:id/pair` + WS `pairing:state` |

**DTO 위치**: `deskrpg/src/types/api/*.dto.ts` (presentation→logic 계약). Presentation은 Data 레이어 직접 import 금지(ARCHITECTURE_INVARIANTS Part 1 §1).

**WebSocket 채널 (D2=a 유지)**:
- `npc-report` — NPCReport push (AC-002/005)
- `llm-usage:update` — 위젯 실시간 (AC-008)
- `pairing:state` — 페어링 상태 전이 (AC-016)
- `chat:stream` — chat streaming chunk (AC-014, optional — SSE 우선)
- `meeting:turn` — 회의 좌석·턴 동기화 (AC-011)

### 2.2 Logic Layer (`nanobot/nanobot/...` + `deskrpg/src/lib/...`)

#### 2.2.a ImpactAnalyzer (AC-003)

- **모듈**: `nanobot/nanobot/agent/impact_analyzer.py`
- **책임**: RAG 검색(BM25 + Obsidian wikilink) → LLM(OpenRouter+Qwen) 호출 → Citation 강제 추출(char_offset 포함) → ImpactAnalysis DTO 반환
- **계약**: Citation 1개 이상 보장; 없으면 LLM 재호출 또는 fallback "Citation 부재" 명시
- **must_not 위반 점검**: must_not "LLM 응답을 Citation 없이 노출" — Service 진입점에서 assert

#### 2.2.b LLMUsageHook + BUDGET_EXCEEDED (AC-008 enforcement, D-16)

- **모듈**: `nanobot/nanobot/agent/hook.py` (확장)
- **흐름**:
  ```
  agent loop이 LLM 호출 직전 → llm_usage_hook.before_call()
    1. DB(PostgreSQL llm_usage_records 테이블)에서 cumulative cost_usd 조회
    2. cost >= $90 → raise BudgetExceededError (호출 차단, NPCReport(ERROR) dispatch)
    3. cost >= $60 → NPCReport(ERROR) push (호출은 계속)
    4. cost >= $30 → stderr 경고
  호출 후 → llm_usage_hook.after_call()
    5. LLMUsageRecord INSERT (provider, model, prompt_tokens, completion_tokens, cost_usd, cache_hit)
    6. WebSocket llm-usage:update dispatch
  ```
- **DB가 source of truth** (D-16): 위젯·차단 모두 DB 조회. Race condition은 Postgres advisory lock 또는 단순 SERIALIZABLE 트랜잭션.
- **위젯은 read-only**: 위젯이 임계치 판단 X (서버가 threshold_level enum 계산하여 push)

#### 2.2.c Nanobot Gateway (AC-013/014/015/017/018/019)

- **모듈**: `deskrpg/src/lib/nanobot-client.ts` (기존 .js와 통합 — duplicate 정리)
- **인터페이스** (openclaw functional parity, D-14 유지):
  ```typescript
  interface NanobotGateway {
    // AC-013 NPC lifecycle
    createAgent(npcId: string, personaConfig: PersonaConfig): Promise<{agentId: string, workspacePath: string}>
    deleteAgent(agentId: string): Promise<void>
    setAgentFiles(agentId: string, files: {identity?: string, soul?: string}): Promise<void>  // write-only mirror
    listAgents(channelId: string): Promise<Agent[]>
    
    // AC-014 Chat streaming
    chatSend(agentId: string, sessionKey: string, message: string, onDelta: (chunk: string) => void): Promise<string>  // 180s timeout
    chatAbort(agentId: string, sessionKey: string): Promise<void>
    
    // AC-016 Pairing
    pair(channelId: string, token: string): Promise<PairingResult>
    
    // AC-017 Error mapping
    // (모든 에러는 OpenClawGatewayError-호환 shape: {ok:false, errorCode, error, requestId, details, pairingRequired})
  }
  ```
- **AI_PROVIDER 분기**: v9에서 nanobot 단일 — `nanobot-client.ts`가 단일 export, `openclaw-gateway.js`는 contract phase에서 삭제

#### 2.2.d Ed25519 Pairing Manager (AC-016)

- **모듈**: `deskrpg/src/lib/pairing-manager.ts` (신규 — 기존 openclaw 페어링 로직 추출+재활용)
- **책임**:
  - Ed25519 keypair 생성·`~/.nanobot-devices/${hash}.json` 저장
  - Challenge-response (modern device auth protocol v3)
  - 4-state machine (idle/connecting/connected/pairing_required/error)
  - WS `pairing:state` 이벤트 발행
- **env 분기 (D-18)**:
  ```
  PAIRING_MODE=auto (default dev/demo): 첫 부팅 시 자동 keypair + challenge
  PAIRING_MODE=manual (prod): UI Pair 버튼 + 토큰 입력 후 challenge
  ```

#### 2.2.e MeetingOrchestrator (AC-011)

- **모듈**: `deskrpg/src/lib/meeting-broker.js` 재활용 + `meeting-digest-service.ts` 신규
- **digest 생성** (별도 30초 phase — seed v8 should):
  ```
  generateMeetingDigest(window: TimeRange) → MeetingReport {
    new_regulation_count, high_severity_count,
    top_regulation, top_citation, next_week_recommendation,
    digest_text  // LLM 생성, 낭독용
  }
  ```
- nanobot 호출(ImpactAnalyzer)로 디지스트 산출 — AC-003 인프라 재사용

#### 2.2.f Scenario Orchestrator (AC-005)

- **모듈**: `deskrpg/src/lib/demo-scenario.ts` (신규)
- **흐름** (4단계 finite state machine):
  ```
  IDLE → USER_ENTER (캐릭터 입장 애니메이션)
       → CRAWLER_REPORT (mock 또는 실제 NPCReport push 대기)
       → USER_QUESTION (사용자 askAnalystNPC 호출)
       → ANALYST_RESPOND_WITH_CITATION (in-world 말풍선 + Citation)
       → COMPLETE
  ```
- 각 단계는 다른 AC와 통합 (AC-002, AC-003, AC-013, AC-014). 시연 mode에서는 mock·fixture 데이터로도 동작.

### 2.3 Data Layer

#### 2.3.a PostgreSQL 스키마 (drizzle ORM, deskrpg)

v9 신규 + 갱신 테이블 (기존 v8 유지 부분은 생략):

```sql
-- v9 신규 (nanobot gateway 영역)

CREATE TABLE nanobot_agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  npc_id UUID NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,  -- npcs.openclawConfig.agentId 미러
  session_key TEXT NOT NULL,  -- 'agent:<id>:<name>'
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_chunk_at TIMESTAMPTZ,
  aborted_at TIMESTAMPTZ,
  timeout_ms INT NOT NULL DEFAULT 180000,
  total_tokens INT,
  UNIQUE(agent_id, session_key)
);

CREATE TABLE gateway_device_identities (
  device_hash TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_key_path TEXT NOT NULL,  -- '~/.nanobot-devices/{hash}.json'
  pairing_state TEXT NOT NULL CHECK (pairing_state IN ('idle','connecting','connected','reconnecting','pairing_required','error')),
  paired_with_channel_id UUID REFERENCES channels(id),
  last_pairing_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  connected_at TIMESTAMPTZ
);

CREATE TABLE gateway_channel_bindings (
  channel_id UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  encrypted_token TEXT NOT NULL,  -- v1 format: iv:tag:encrypted base64url (AES-256-GCM)
  cipher_key_source TEXT NOT NULL CHECK (cipher_key_source IN ('INTERNAL_RPC_SECRET','JWT_SECRET')),
  gateway_url TEXT NOT NULL,
  device_hash TEXT REFERENCES gateway_device_identities(device_hash),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ
);

-- v9 신규 (D3=a: Citation은 deskrpg drizzle 단일 source)
-- 참고: 시드 ontology의 Citation을 deskrpg PG로 끌어옴 — nanobot은 POST API로만 기록
CREATE TABLE citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  impact_analysis_id UUID NOT NULL REFERENCES impact_analyses(id) ON DELETE CASCADE,
  regulation_id UUID NOT NULL REFERENCES regulations(id),  -- AC-001 contract: regulations 테이블 존재 전제
  vault_document_id UUID REFERENCES vault_documents(id),
  quote_text TEXT NOT NULL,
  char_offset_start INT NOT NULL,
  char_offset_end INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_citations_impact_analysis ON citations(impact_analysis_id);

-- v9 갱신 (legacy persona field 제거 — D-23)
-- ALTER TABLE npcs DROP COLUMN IF EXISTS persona;  -- 만약 분리 column이었다면
-- 단, openclawConfig.persona (JSONB 내부 key) 제거는 migration script로 처리
```

**SQLite 코드 제거**: `schema-sqlite.ts`, `sqlite-base-schema.js`, `drizzle-sqlite.config.ts`, `better-sqlite3` dep 전부 contract phase에서 삭제 (parallel-change `pc-2026-05-19-sqlite-to-postgres`).

#### 2.3.b 파일시스템 (~/.nanobot/*)

| 경로 | 목적 | AC |
|------|------|---|
| `~/.nanobot/workspace-${agentId}/IDENTITY.md` | NPC persona identity — **write-only mirror** (D-22) | AC-015 |
| `~/.nanobot/workspace-${agentId}/SOUL.md` | NPC persona soul — write-only mirror | AC-015 |
| `~/.nanobot-devices/${hash}.json` | Ed25519 keypair (private key + state) | AC-016 |

**마이그레이션 스크립트**: `deskrpg/scripts/migrate-openclaw-paths.ts` — 첫 부팅 시 `~/.openclaw/*` 존재 검출 → 이동.

#### 2.3.c Obsidian Local REST API (port 27123, v5 carry-over)

본 TRD owner 범위 내에선 **read-only RAG 데이터 source** (AC-003 ImpactAnalyzer가 BM25/wikilink로 검색). 작성(PUT/POST)은 AC-006(crawler 산출물 vault sync) 영역.

### 2.4 Layer Communication (D-14 유지)

| From → To | 프로토콜 | 데이터 형식 |
|-----------|----------|------------|
| Presentation (deskrpg UI) → Logic (deskrpg API route) | HTTP REST | DTO (`*.dto.ts`) |
| Presentation → Logic (실시간) | WebSocket | 채널별 event 페이로드 |
| Presentation → Logic (chat streaming) | SSE | text chunk (UTF-8) |
| Logic (deskrpg) → Logic (nanobot) | HTTP + internal RPC | OpenClaw-호환 RPC envelope (functional parity) |
| Logic → Data (Postgres) | drizzle ORM | row → DTO 변환 (repository) |
| Logic → Data (Obsidian REST) | HTTP + Bearer | markdown + frontmatter |
| Logic → Data (파일시스템) | Node fs/promises | 직접 (인간 디버깅용 mirror만, no read-back from nanobot) |

---

## 3. AC 상세 설계 (high complexity 7개)

### 3.1 AC-003 — 분석 NPC Citation 응답

- **흐름**:
  ```
  (P) NpcChatPanel: 사용자 입력 "리테일 영향?" 
       → POST /api/npcs/:id/chat {message}
  (L) deskrpg API route → nanobotGateway.chatSend(agentId, sessionKey, msg, onDelta)
       → nanobot ImpactAnalyzer agent loop:
            1. RAG: BM25 인덱스 + Obsidian wikilink로 후보 passage 5개
            2. LLM 호출 (Citation 강제 프롬프트)
            3. JSON 응답 파싱: {analysis, citations: [{quote, char_offset_start, char_offset_end, vault_doc_id, regulation_id}]}
            4. assert len(citations) >= 1 (없으면 retry 1회, 그래도 없으면 "Citation 부재" 명시 + ERROR 로깅)
            5. POST /api/_internal/impact-analyses (deskrpg) — ImpactAnalysis + Citation rows insert
       → onDelta chunk마다 in-world 말풍선 진행
  (P) NpcChatPanel: 마지막 chunk + citations 배열 UI 렌더
  ```
- **테스트**:
  - Logic: ImpactAnalyzer.analyze() 단위 — fixture passage 입력 → Citation ≥ 1 보장 (Pair Mode + Test Designer)
  - Data: citations 테이블 insert/조회 integration test (real PG)
  - Presentation: chat 응답 UI에 Citation 표시 E2E

### 3.2 AC-005 — 메인 시연 시나리오 4단계

- **모듈**: `deskrpg/src/lib/demo-scenario.ts` + `<DemoScenarioRunner>` 컴포넌트
- **테스트**:
  - 시연 모드 (`DEMO_MODE=true`): 모든 단계가 fixture로 진행되어야 함 (실 크롤러/LLM 의존 0)
  - 통합 모드 (`DEMO_MODE=false`): 실 NPCReport + 실 LLM 응답 (E2E)
- **acceptance**: 4단계가 끊김 없이 (각 단계 timeout 60s) 진행되어 5분 안에 완료

### 3.3 AC-008 — LLM 사용량 위젯 + 임계치 enforcement (PR2a/2b 확장)

- **현황**: PR2a/2b로 위젯 UI + $30 stderr는 구현. $60 NPCReport push + $90 BUDGET_EXCEEDED 차단은 미구현 (이번 TRD 추가 대상).
- **차단 위치 (D-16)**: nanobot LLMUsageHook (§2.2.b). deskrpg API 게이트는 신뢰 X — nanobot이 직접 raise.
- **DB source of truth**: `llm_usage_records` 테이블의 `SUM(cost_usd)`을 매 호출 직전 조회. 캐시 X (정확성 > 성능, 호출 빈도 낮음).
- **테스트**:
  - Logic: hook이 $90 도달 시 BudgetExceededError raise (Pair Mode + Test Designer)
  - Logic: $60에서 NPCReport(ERROR) dispatch (mock socket)
  - Data: cumulative cost 조회의 정확성 (concurrent insert 케이스)
  - Presentation: 위젯이 threshold_level 변화 시 색상 + 효과 표시 (E2E)

### 3.4 AC-011 — 주간 컴플라이언스 회의실

- **재활용 (D-17)**: `meeting-broker.js` 좌석/턴 매니징 로직 유지, openclaw 분기는 contract phase 정리.
- **신규 모듈**: `meeting-digest-service.ts` — ImpactAnalyzer 호출하여 4항목 디지스트 생성.
- **WS `meeting:turn`**: 좌석 sprite 이동 + 발화 turn 동기화.
- **테스트**:
  - Logic: generateMeetingDigest() — 입력 window에서 a/b/c/d 4항목 모두 채워짐 (Pair Mode)
  - Presentation: 회의실 씬 진입 → 디지스트 낭독 → 종료 E2E

### 3.5 AC-013 — NPC/Agent lifecycle parity

- **계약**: §2.2.c `NanobotGateway` 인터페이스의 createAgent/deleteAgent/setAgentFiles/listAgents
- **nanobot 측 구현**: stateless 모드 — `agents.create`는 npcs.openclawConfig DB 저장 + 워크스페이스 .md write-only mirror만 (no LLM call)
- **테스트**: happy path 통합 — POST /api/npcs → POST /api/npcs/:id → DELETE /api/npcs/:id (Pair Mode + Test Designer)

### 3.6 AC-014 — Chat streaming parity

- **계약**: chatSend(agentId, sessionKey, msg, onDelta) — SSE-style, 180s timeout, chatAbort.
- **deskrpg 측**: SSE 우선 (WebSocket fallback). EventSource API 사용.
- **nanobot 측**: Server-Sent Events 응답 — `text/event-stream`.
- **테스트**: 1회 chat → chunk N개 수신 → onDelta N회 호출, 마지막 chunk 후 NanobotAgentSession.last_chunk_at 기록 (Pair Mode + Test Designer)

### 3.7 AC-016 — Device pairing parity (Ed25519)

- **모듈**: §2.2.d PairingManager
- **env 분기 (D-18)**:
  ```
  if (process.env.PAIRING_MODE === 'auto' || !process.env.PAIRING_MODE):
    onBoot: keypair 생성 + challenge 즉시 시도
  else if (process.env.PAIRING_MODE === 'manual'):
    onBoot: state = 'idle'
    UI "Pair" 버튼 클릭 → 토큰 입력 → challenge
  ```
- **테스트**:
  - Logic: keypair 생성·로드·challenge 서명·검증 단위 (Pair Mode + Test Designer)
  - Logic: 4-state machine 전이 (idle→connecting→connected, idle→connecting→error, connected→reconnecting→connected 등)
  - Presentation: PairingStatusCard UI 4상태 시각 검증 (storybook 또는 manual)
  - Risk: R-20 (페어링 누락 시 시연 봉인) — 시연 직전 dry-run 1회 강제 (process_governance retro 안건)

---

## 4. Directory Structure

```
reg-detection/
├── deskrpg/
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── npcs/                        # AC-013 — Presentation
│   │   │   │   ├── llm-usage/                   # AC-008 — Presentation (read-only)
│   │   │   │   ├── meetings/                    # AC-011 — Presentation
│   │   │   │   ├── gateways/[id]/pair/route.ts  # AC-016 — Presentation (신규)
│   │   │   │   └── _internal/                   # nanobot → deskrpg 내부 콜백
│   │   │   │       └── impact-analyses/         # AC-003 (Citation 적재)
│   │   │   └── game/GamePageClient.tsx          # AC-005 (시연 시나리오 hook)
│   │   ├── components/
│   │   │   ├── npc/NpcChatPanel.tsx             # AC-003/014
│   │   │   ├── npc/NanobotPairingStatusCard.tsx # AC-016 (rename from OpenClaw)
│   │   │   ├── widgets/LlmUsageWidget.tsx       # AC-008
│   │   │   └── meeting/WeeklyComplianceMeetingRoom.tsx  # AC-011
│   │   ├── lib/
│   │   │   ├── nanobot-client.ts                # AC-013/014 (단일 — .js 통합)
│   │   │   ├── pairing-manager.ts               # AC-016 (신규)
│   │   │   ├── demo-scenario.ts                 # AC-005 (신규)
│   │   │   ├── meeting-broker.js                # AC-011 (재활용 + repurpose)
│   │   │   └── meeting-digest-service.ts        # AC-011 (신규)
│   │   ├── db/
│   │   │   ├── schema.ts                        # Postgres 단일
│   │   │   └── index.ts                         # DB_TYPE 분기 제거 (Contract phase)
│   │   ├── server/socket-handlers.ts            # WS 채널 (provider 분기 제거)
│   │   └── types/api/                           # DTO 정의 (계약)
│   ├── scripts/
│   │   └── migrate-openclaw-paths.ts            # ~/.openclaw → ~/.nanobot (1회용)
│   └── drizzle/
│       └── 0003_v9_gateway_postgres.sql         # 신규 migration
└── nanobot/
    └── nanobot/
        ├── agent/
        │   ├── impact_analyzer.py               # AC-003 (신규)
        │   ├── hook.py                          # AC-008 enforcement 확장
        │   └── meeting_digest.py                # AC-011 디지스트 LLM
        └── gateway/                             # 신규 — nanobot gateway 측 endpoint
            ├── chat_stream.py                   # AC-014 (SSE 응답)
            └── pairing_handler.py               # AC-016 (challenge-response)
```

---

## 5. 추가 설계

### 5.1 DTO 카탈로그 (presentation ↔ logic 계약)

```typescript
// deskrpg/src/types/api/
type ChatRequestDto = { message: string; sessionKey?: string }
type ChatResponseChunkDto = { chunk: string; isLast: boolean; citations?: CitationDto[] }
type CitationDto = { quote: string; charOffsetStart: number; charOffsetEnd: number; regulationId: string; vaultDocumentId?: string }
type LlmUsageSnapshotDto = { costUsd: number; callCount: number; cacheHitPercent: number; lastModel: string; thresholdLevel: 'NONE'|'YELLOW'|'ORANGE'|'RED' }
type NpcReportDto = { id: string; kind: 'NEW_REGULATION'|'ERROR'|'MEETING_DIGEST'; payload: Record<string, unknown> }
type PairingStateDto = { state: 'idle'|'connecting'|'connected'|'reconnecting'|'pairing_required'|'error'; requestId?: string; errorCode?: string }
type MeetingReportDto = { newRegulationCount: number; highSeverityCount: number; topRegulation: { id: string; title: string }; topCitation: CitationDto; nextWeekRecommendation: string; digestText: string }
```

### 5.2 Citation 데이터 흐름 (D-15)

```
nanobot ImpactAnalyzer
   │  생성된 ImpactAnalysis + Citations 보유
   ▼
POST /api/_internal/impact-analyses
   │  body: { analysis: AnalysisDto, citations: CitationDto[] }
   ▼
deskrpg API route (auth: INTERNAL_RPC_SECRET)
   │  drizzle INSERT impact_analyses + citations (트랜잭션)
   ▼
WebSocket npc-report dispatch
   │  payload: { kind: 'ANALYSIS_COMPLETE', analysisId }
   ▼
NpcChatPanel — Citation 배열 렌더
```

### 5.3 BM25 인덱스 위치

- **deskrpg drizzle 측 not인덱스**: PostgreSQL `tsvector` (GIN 인덱스) — 한국어 형태소(Kiwi) 활용 위해 별도 ETL 필요. 또는 Obsidian Local REST API의 search endpoint 위임.
- **권고**: Obsidian search API 우선 (v5 BM25 결정), Postgres tsvector는 future (pgvector 도입 시 같이 검토).

### 5.4 AC-001 Cross-Team Contract (D1=c — 인터페이스만 명시)

본 TRD는 AC-001(크롤러 + Regulation 적재)을 다른 팀이 구현한다고 가정. 본 owner가 의존하는 인터페이스:

```typescript
// 크롤러 팀이 보장해야 할 contract
type RegulationCreatedEvent = {
  id: string  // UUID
  source_code: 'FSS' | 'BOK' | 'FSC' | 'NA' | 'BCBS'  // enum
  board_type: 'BOARD_REPORT' | 'REGULATION' | 'EXPLANATION'  // FSS 3개 게시판
  external_id: string  // 원본 게시판 글 ID
  title: string
  url: string
  change_type: 'NEW' | 'AMENDED'
  published_at: string  // ISO8601
  vault_document_id: string  // VaultDocument 참조
  raw_content_excerpt: string  // 첫 1000자
}

// 크롤러 → deskrpg WebSocket 또는 internal API
POST /api/_internal/regulations { regulation: RegulationCreatedEvent }
  → drizzle INSERT regulations row
  → emit NPCReport(NEW_REGULATION) WebSocket
```

**owner가 의존하는 DB 테이블** (크롤러 팀이 정의해야):
- `regulations` (Citation FK)
- `regulation_sources` (필터링 — AC-004)
- `regulation_versions` (AC-009)
- `vault_documents` (Citation FK)

이 테이블들이 없으면 owner의 AC-002/003/004/011은 fixture로만 동작. 통합 시점은 phase 6 (§7 참조).

---

## 6. Decisions & Trade-offs

본 TRD 작성 중 결정 (D-13~D-19, /trd 논의 결과). seed-v9의 D-15~D-24는 시드 결정사항으로 별도 분리.

| # | 결정 | 근거 | 대안 | Trade-off |
|---|------|------|------|-----------|
| **D-13** | AC-001은 contract만 (구현은 다른 팀) | owner block은 m3_m4_gateway가 9개 + 8개 = 17개. 17개도 8주에 빠듯. AC-001 풀구현은 +2-3주. | (a) AC-001도 owner 흡수 → seed-v10 / (b) 다른 팀 소유 + TRD 미포함 | (c) 선택 — owner 부담 ↓ + cross-team 인터페이스는 명확화. seed-v10 발행 회피. |
| **D-14** | nanobot↔deskrpg 통신은 현재 WebSocket+HTTP+RPC 유지 | functional parity가 v9 결정 (D-19), 새 프로토콜은 시연 risk. | (b) SSE 단순화 / (c) gRPC | 8주 일정에서 단순화·신규 채택 risk가 functional parity 비용보다 큼. |
| **D-15** | Citation은 deskrpg drizzle 단일 source | 프론트엔드 필터/표시가 주 use case. nanobot은 ImpactAnalyzer 산출 후 dispatch. | (b) nanobot DB / (c) 양쪽 sync | 단일 source는 일관성 ↑. nanobot이 deskrpg API 호출 latency 100ms 수준은 시연 영향 없음. |
| **D-16** | BUDGET_EXCEEDED는 nanobot LLMUsageHook + DB source of truth | provider 직접 차단이 가장 단단. 위젯이 임계치 판단하면 client 우회 가능. | (b) deskrpg gateway / (c) defense in depth | (a) 충분. deskrpg 위젯은 read-only로 클린한 separation. |
| **D-17** | 회의실은 meeting-broker.js 재활용 + repurpose | 좌석/턴 코드 재구현 +1주 비용. openclaw 분기는 contract phase에 묶임. | (b) 새로 작성 | risk 적은 path. v10에서 별도 컴포넌트로 리팩토링 검토. |
| **D-18** | 페어링 첫 실행은 env var 분기 (auto/manual) | 시연(auto) + 보안(manual) 두 use case 공존. | (a) 항상 auto / (b) 항상 manual | 가장 유연. PAIRING_MODE 미설정 시 default auto (dev 친화). |
| **D-19** | 구현 순서는 seed-v9 dependencies.recommended_execution_order 7 phases 그대로 | 인터뷰 시점에 이미 의존성 검증. 임의 재배치 risk. | (b) high complexity 먼저 / (c) 시연 critical path 우선 | (a) 안전. 단 phase 내부 AC는 본인이 병렬 진행 가능. |

---

## 7. Implementation Order (seed-v9 dependencies.recommended_execution_order)

| Phase | AC | 비고 |
|-------|----|------|
| **1. Foundation** | AC-012, AC-018, AC-019 | 의존 최소. LPC + Configuration + Auth 토큰 — 다른 모든 parity AC의 기반 |
| **2. Gateway core** | AC-013, AC-016, AC-017 | NPC lifecycle + pairing + error mapping. 서로 약하게 결합 → 병렬 가능 |
| **3. Streaming + telemetry** | AC-014, AC-015, AC-020 | chat streaming 위에 .md mirror + telemetry |
| **4. AC-008 enforcement 완결** | AC-008 | AC-020 완료 후 위젯 데이터 소스 교체 + $60/$90 enforcement 추가 |
| **5. Obsidian + UI** | AC-006, AC-004 | 다른 팀(AC-001/007) 산출물 완료 시점과 맞물려 진행 |
| **6. Integration (cross-team)** | AC-002, AC-003, AC-011, AC-005 | Regulation·Citation 실 데이터 의존 — fixture로 선행 후 실 데이터로 교체 |
| **7. Contract phase** | AC-021 | 다른 8개 nanobot AC 완료 후 openclaw 경로 일괄 제거. `pc-2026-05-19-openclaw-to-nanobot` advance contract + `pc-2026-05-19-sqlite-to-postgres` advance contract |

**Pair Mode + Test Designer 강제** (high complexity 7개): AC-003, AC-005, AC-008, AC-011, AC-013, AC-014, AC-016 — 모두 별도 worktree로 Test Designer subagent 활용.

**Parallel-change 이정표**:
- Phase 4 완료 후: `pc-2026-05-19-openclaw-to-nanobot` Migrate phase (nanobot default switch)
- Phase 7: 두 plan 모두 Contract (dead code 제거)

---

## 8. Test Strategy

| Layer | 테스트 종류 | 도구 | 우선순위 |
|-------|----------|------|--------|
| **Logic (nanobot)** | 단위 (순수 비즈니스 로직) | pytest | **최우선** (ImpactAnalyzer / LLMUsageHook / Ed25519 PairingManager) |
| **Logic (deskrpg)** | 단위 (gateway adapter / scenario state machine) | vitest 또는 jest | 우선 |
| **Data** | 통합 (real Postgres + Obsidian REST) | pytest + docker-compose test | 필수 (Citation INSERT, gateway_device_identities 영속성) |
| **Presentation** | E2E (Playwright) | Playwright | AC-005 시연 시나리오 + AC-008 위젯 색상 전이 |
| **Contract** | parallel-change gate (caller=0 검증) | `pc.py callers` + `check-parallel-state.sh` | Phase 7 직전 |

**mock 정책** (ARCHITECTURE_INVARIANTS §3 준수):
- LLM API → mock (deterministic response)
- DB → real (testcontainers Postgres)
- 외부 Obsidian REST → mock 또는 testcontainer (Obsidian docker가 어렵다면 mock)
- WebSocket → real (in-process socket.io)

**구현과 테스트는 한 쌍** — 일괄 작성 금지 (CLAUDE.md AI Behavioral Baseline §4).

---

## 9. Risks (seed-v9 risk_register carry-over + TRD-specific)

| ID | Risk | Severity | Mitigation |
|----|------|----------|----------|
| R-19 | openclaw → nanobot 회귀 (128+ 터치포인트) | High | 9 AC 분할 + PR 단위 분할 + Phase 7에 contract 묶음 |
| R-20 | Ed25519 페어링 누락 시 시연 봉인 | High | AC-016 Phase 2 조기 배치 + 시연 직전 dry-run 1회 강제 |
| R-21 | Postgres healthcheck 전 컨테이너 기동 → connection refused | Medium | docker-compose healthcheck + depends_on condition |
| R-22 | SQLite 제거 시 drizzle 마이그레이션 누락 | Medium | fresh docker volume에서 migrate.js + seed CI 추가 |
| **R-23 (TRD 신규)** | AC-001 contract 불일치 — 크롤러 팀이 다른 DB 스키마 채택 시 owner phase 5/6 봉인 | Medium-High | §5.4 contract를 RFC 또는 ADR로 문서화 (다음 retro 안건) |
| **R-24 (TRD 신규)** | nanobot LLMUsageHook의 DB 조회가 매 호출마다 cumulative SUM — concurrent 호출 시 race | Low-Medium | advisory lock 또는 SERIALIZABLE 트랜잭션; 캐시 X (D-16 결정) |
| **R-25 (TRD 신규)** | meeting-broker.js의 openclaw 의존이 contract phase 정리 누락 시 dead path 잔존 | Medium | parallel-change `pc-2026-05-19-openclaw-to-nanobot` caller 0 검증을 AC-021 gate로 |

---

## 10. Architecture Section 갱신 안건 (seed-v10 후보)

seed-v9의 `architecture.data` 섹션은 v8에서 carry-over되어 여전히 "SQLite + Obsidian Local REST API"로 기술됨. v9 결정(Postgres 채택)과 불일치. **seed-v10에서 architecture.data 텍스트 갱신** 필요 (TRD가 immutable seed를 수정할 수는 없음).

| 갱신 항목 | 현재 (v9 inconsistency) | v10 권장 |
|----------|----------------------|----------|
| `architecture.data.description` | "SQLite + Obsidian Local REST API (Obsidian이 vault 관리, v5)" | "PostgreSQL (로컬 docker-compose) + Obsidian Local REST API" |
| `architecture.data.directories` | `backend/data/sqlite` | `backend/data/postgres` 또는 제거 |
| `architecture.data.responsibilities` | "SQLite CRUD (...)" | "PostgreSQL CRUD via drizzle ORM (...)" |

---

## 11. References

- **seed-v9**: `.harness/ouroboros/seeds/seed-v9.yaml`
- **인터뷰**: `.harness/ouroboros/interviews/2026-05-19-10-04.yaml`
- **diff v8→v9**: `.harness/ouroboros/seeds/.diffs/diff-v8-to-v9.md`
- **task migration v8→v9**: `.harness/ouroboros/tasks/migration-plans/migration-v8-to-v9.yaml`
- **parallel-change plans**:
  - `.harness/parallel-change/plans/pc-2026-05-19-sqlite-to-postgres.yaml`
  - `.harness/parallel-change/plans/pc-2026-05-19-openclaw-to-nanobot.yaml`
- **prior TRD (v8 era)**: `docs/trd/TRD-RegTrack-2026-05-16.md`
- **architecture invariants**: `ARCHITECTURE_INVARIANTS.md`
- **storyboard**: `docs/demo-scenario/STORYBOARD-RegTrack-2026-05-16.md`
