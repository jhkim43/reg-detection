# Seed Diff: v8 → v9

**From**: `/Users/deukkyu/projects/reg-detection/.harness/ouroboros/seeds/seed-v8.yaml`  
**To**: `/Users/deukkyu/projects/reg-detection/.harness/ouroboros/seeds/seed-v9.yaml`  
**Generated**: 2026-05-19T01:19:20Z

## Summary

| Section | Added | Removed | Modified |
|---------|------:|--------:|---------:|
| Acceptance Criteria | 9 | 0 | 2 |
| Entities | 3 | 0 | 0 |
| Actions | 6 | 0 | 0 |
| Constraints (must) | 12 | 1 | — |
| Constraints (must_not) | 8 | 1 | — |

## Details

### Acceptance Criteria

**Added:**
- `AC-013` — NPC/Agent lifecycle parity. AI_PROVIDER=nanobot 모드에서 다음 RPC가
openclaw와 functionally 동등하게 동작한다:
  • agents.create (npcs.openclawConfig.agentId 발급 + personaConfig 저장)
  • agents.delete (npcs row 삭제 + 워크스페이스 cleanup)
  • agents.files.set (IDENTITY.md/SOUL.md 워크스페이스 write — write-only mirror)
  • agents.list (channel 단위 agent 목록 반환)
검증: 통합 테스트 1건 — POST /api/npcs → POST /api/npcs/:id (persona 변경)
→ DELETE /api/npcs/:id 의 happy path가 nanobot 모드에서 통과.

- `AC-014` — Chat streaming parity. nanobot 게이트웨이가 chatSend(agentId, sessionKey,
message, onDelta) 인터페이스를 구현하며 다음을 만족:
  • SSE-style onDelta 콜백 (chunk마다 invoke)
  • 180s timeout 후 자동 중단
  • chatAbort(agentId, sessionKey)로 in-flight 스트림 취소 가능
검증: deskrpg socket-handlers의 chat:send 이벤트로 nanobot 응답이
streaming chunk로 전달되어 in-world 말풍선이 점진적으로 채워진다.

- `AC-015` — Workspace file management parity. nanobot 워크스페이스 ~/.nanobot/workspace-${agentId}
에 IDENTITY.md/SOUL.md가 write-only mirror로 저장된다. nanobot agent loop은
이 파일들을 read 하지 않으며 (DB의 personaConfig가 source of truth), 디렉토리
마이그레이션(기존 ~/.openclaw/* → ~/.nanobot/*)은 첫 부팅 시 자동 수행.

- `AC-016` — Device pairing parity. nanobot 게이트웨이가 다음을 구현:
  • Ed25519 keypair 생성 + ~/.nanobot-devices/${hash}.json 저장
  • Pairing challenge-response (modern device auth protocol)
  • Pairing state machine 4상태 (idle/connected/pairingRequired/error)
  • OpenClawPairingStatusCard UI 컴포넌트 재활용 (브랜드만 'Nanobot Pairing'으로)
검증: 페어링 미완 상태에서 RPC 호출 시 HTTP 409 + errorCode=PAIRING_REQUIRED
반환, UI 카드는 pairingRequired 상태로 전환.

- `AC-017` — Error mapping parity. nanobot 에러는 openclaw 호환 shape으로 변환:
  { ok: false, errorCode: string, error: string, requestId: string,
    details: object, pairingRequired: boolean }
HTTP 상태 매핑: PAIRING_REQUIRED → 409, NOT_PAIRED → 409, 기타 → fallback.
검증: 강제 실패 케이스 3종(페어링 미완 / 인증 실패 / 일반 에러)에 대해
buildGatewayErrorPayload + getGatewayErrorStatus 결과가 openclaw 모드와 동일.

- `AC-018` — Configuration storage parity. npcs.openclawConfig JSONB 필드 shape 유지:
  { agentId: string, sessionKeyPrefix: string,
    personaConfig: { identity: string, soul: string } }
v9: legacy npcs.openclawConfig.persona (string) 필드는 제거 (deprecated).
검증: schema migration이 personaConfig만 정식으로 두고, parseDbObject /
loadPersonaFromNpc 함수가 legacy 경로 없이 동작.

- `AC-019` — Authentication tokens parity. nanobot 게이트웨이가:
  • Bearer Token 인증 (Authorization 헤더 + INTERNAL_RPC_SECRET 검증)
  • 채널 단위 토큰 암호화 저장: AES-256-GCM, channels.gatewayConfig.encryptedToken
  • encryptGatewayToken/decryptGatewayToken 함수 호환 (v1 format: iv:tag:encrypted base64url)
검증: 채널 페어링 후 encryptedToken이 DB에 base64url 형식으로 저장되고
restart 후 decryptGatewayToken으로 복호화 + RPC 호출 성공.

- `AC-020` — Telemetry parity. nanobot 모드의 모든 LLM 호출이 LLMUsageRecord에 기록되어
AC-008 위젯에 실시간 반영된다 (provider='nanobot' 또는 'openrouter' 라벨링).
검증: nanobot agent 1회 chat 호출 → llmUsageRecords에 row 1건 추가 + WebSocket
llm-usage:update 이벤트 dispatch + 위젯의 누적 cost·call count 증가.

- `AC-021` — Provider abstraction hardening. AI_PROVIDER 환경변수의 default가 'nanobot'으로
변경되고, AI_PROVIDER=openclaw 경로의 모든 코드(socket-handlers의 OpenClawGateway
분기, nanobot-client.js의 dual-mode 코드 등)가 제거된다.
검증: grep "AI_PROVIDER === 'openclaw'" → 0 hits. grep "openclawGateway" (instance
use) → 0 hits. /api/* 라우트들이 nanobotAdapter 단일 경로로 통합.


**Modified:**
- `AC-008`
- `AC-012`

### Entities

**Added:**
- `NanobotAgentSession` — nanobot 게이트웨이의 chat 세션 추적 (chatSend/chatAbort 단위)
- `GatewayDeviceIdentity` — Ed25519 device keypair + 페어링 상태 (openclaw parity)
- `GatewayChannelBinding` — 채널별 nanobot 게이트웨이 토큰·암호화 저장 (encryptGatewayToken/decryptGatewayToken)

### Actions

**Added:**
- `pairDeviceWithChannel`
- `chatSendStream`
- `chatAbortStream`
- `createNpcAgent`
- `updateNpcPersona`
- `migrateLegacyOpenClawPaths`

### Constraints (must)

**Added:**
- `워크스페이스 경로 prefix ~/.nanobot/workspace-${agentId} (기존 ~/.openclaw/workspace-*는 1회용 마이그레이션 스크립트로 이동)`
- `Ed25519 device identity + challenge-response 페어링을 nanobot도 구현 (~/.nanobot-devices/${hash}.json). OpenClawPairingStatusCard UI 4상태(idle/connected/pairingRequired/error) 그대로 재활용`
- `DB 컬럼명 npcs.openclawConfig 유지 (rename 영향도 vs 명확성 tradeoff에서 영향도 우선). 의미는 'agent gateway config'로 reinterpret`
- `IDENTITY.md/SOUL.md는 워크스페이스에 write-only mirror로 같이 쓰기 (인간 디버깅·tail 용도). nanobot agent loop은 이 파일을 read 하지 않는다`
- `nanobot 게이트웨이는 openclaw 9 functional categories(NPC lifecycle / Chat streaming / File-workspace / Pairing / Error mapping / Config storage / Auth tokens / Telemetry / Provider abstraction)에 대해 functional parity 제공`
- `AI_PROVIDER=nanobot 모드에서 agents.create/agents.files.set RPC는 no-op (DB의 personaConfig가 source of truth)`
- `Chat streaming은 openclaw와 동일 onDelta 콜백 패턴 + 180s timeout + chatAbort RPC 지원 (functional parity)`
- `NPC persona의 source of truth는 DB npcs.openclawConfig.personaConfig (필드명 유지). nanobot은 매 호출마다 system prompt를 DB에서 재구성`
- `환경 변수 AI_PROVIDER=nanobot 단일 경로 (openclaw 경로는 v9에서 제거)`
- `구조화 데이터는 PostgreSQL에 저장 (로컬 docker-compose 서비스). v9: SQLite must 해제`
- `Error 응답은 openclaw 호환 shape 유지: {ok, errorCode, error, requestId, details, pairingRequired}. HTTP 409는 pairing required 케이스`
- `AC-008 LLM 위젯의 $60 도달 시 NPCReport(ERROR) push, $90 도달 시 NPCReport(ERROR) + BUDGET_EXCEEDED로 LLM 호출 차단 — v9에서 명시 enforcement 추가`

**Removed:**
- `구조화 데이터는 SQLite에 저장 (단일 파일 DB)`

### Constraints (must_not)

**Added:**
- `Ed25519 device key 알고리즘 변경 (호환성 깨짐 + UI 페어링 흐름 봉인)`
- `AI_PROVIDER=openclaw 신규 코드 추가 (openclaw 경로는 v9 contract phase에서 제거 대상)`
- `openclaw 모드와 nanobot 모드를 동시 운영하는 dual-mode 코드 신규 작성`
- `nanobot agent loop이 .md persona 파일(IDENTITY.md/SOUL.md)을 read (drift/loop/bloat 위험 — DB가 source of truth)`
- `pgvector를 MVP 의존성에 포함 (stretch goal로만 — v9에서 PostgreSQL은 must 승격, pgvector만 stretch 유지)`
- `SQLite 코드 신규 작성 또는 better-sqlite3 의존성 재추가`
- `워크스페이스 ~/.openclaw/ 경로 신규 참조 (v9에서 ~/.nanobot/로 마이그레이션 후 제거)`
- `legacy npcs.openclawConfig.persona 문자열 필드 신규 참조 (deprecated, .personaConfig 사용)`

**Removed:**
- `PostgreSQL/pgvector를 MVP 의존성에 포함 (stretch goal로만)`

## 🔴 Breaking-change indicators

This diff likely contains breaking changes (removed AC/entities/actions, added must_not constraints, or architecture pattern shift). Review with care and consider a Parallel Change methodology rollout.
