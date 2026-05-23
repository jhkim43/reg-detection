# Seed-v10 Interview Candidates — 2026-05-19

> seed-v9 amendment 두 번째 블록(`post_creation_amendments[1].non_blocking_backlog`)에서 backlog-1, backlog-6은 새 AC 정의가 필요한 항목이라 seed-v10 cycle 진입 대상으로 분류. 본 문서는 `/interview` 명령이 처음 다룰 candidate 두 건을 한 묶음으로 정리한 사전 메모.

**상태**: pending interview (사용자와 대화 필요)
**다음 단계**: 다른 컴퓨터에서 `/interview` 실행 → 본 문서를 source로 dimension scoring → seed-v10.yaml 작성
**해당 backlog**: `seed-v9.yaml` amendment 2번째 블록 — `backlog-1`, `backlog-6`
**관련 메모리**: `project_v9_smoke_backlog.md`

---

## Candidate 1 — Task 추출을 nanobot tool/state API로 재설계 (backlog-1)

### 현재 상태 (Phase 3 smoke test에서 발견)

- `deskrpg/src/lib/task-parser.js`: NPC 응답 본문의 ` ```task-action ` 코드블록을 정규식으로 추출
- LLM이 코드블록 형식을 빠뜨리면 → parser miss → 등록 누락
- 2026-05-19 smoke 재현: "등록해" 2회 응답 → 1건만 board 반영
- 일반적인 LLM-output-parsing 신뢰성 문제

### 사용자 제안 방향 (2026-05-19 / 보정 2026-05-23)

> "nanobot이 실제 수행하고 있는 task를 가져오는 방식은? LLM 응답 JSON 필드에 의존하니깐 정확하지 않은 것 같은데."

**방향 보정 (2026-05-23)**: 초안의 (a)는 deskrpg가 nanobot을 polling/subscribe하는 *pull* 모델로 작성되어 있었으나, 사용자 실제 의도는 **push 모델** — nanobot이 task/sub-agent 이벤트의 **원천(source of truth)** 이고, deskrpg는 그 이벤트를 internal endpoint로 받아 DB insert + UI 렌더링만 담당. nanobot의 `LLMUsageRecordHook`가 이미 같은 패턴으로 `/api/internal/llm-usage`에 POST 중이라 인프라 재사용 가능 (`INTERNAL_RPC_SECRET` + `x-deskrpg-internal-secret` 헤더).

옵션 후보:
- **(a) push — nanobot이 deskrpg `/api/internal/tasks` POST 호출 (권장, 1st-class)**:
  nanobot 측에서 task action을 dedicated tool call 또는 agent loop hook로 emit → 해당 hook이 deskrpg internal endpoint에 POST → deskrpg가 `tasks` 테이블 insert + socket.io로 채널 broadcast.
  - 장점: 단일 source of truth, polling 비용 0, deskrpg는 reactive
  - 인프라: `LLMUsageRecordHook` → `/api/internal/llm-usage` 패턴 재사용 (인증/secret/transport 동일)
- **(b) pull — deskrpg가 nanobot에 `GET /v1/agents/{agentId}/tasks` 폴링 (덜 권장)**:
  주기적 호출 + diff 적용. 장점은 nanobot fork 변경 최소화. 단점은 polling cost + 지연 + 일관성 race.
- **(c) hybrid — push 1st-class + 응답 본문 parser(`task-parser.js`)는 fallback**:
  legacy 호환성 유지. nanobot 측 push 미구현 시점에도 동작. parallel-change expand 단계에 적합.

### `/interview` 가 명확화해야 할 질문 (보정)

1. (a) push 모델로 확정 시 nanobot 측 emit 단위 — LLM tool call(function calling)인가, agent loop hook(`AgentHook`)인가? 어느 시점에 fire하는가 (after_iteration vs tool_call dispatch)?
2. emit 인증 — 기존 `INTERNAL_RPC_SECRET` 그대로 재사용? endpoint scope만 분리 (`/api/internal/tasks`)?
3. 기존 `task-parser.js` 본문 parsing을 (c) fallback으로 유지할 것인가, 끊어낼 것인가 (parallel-change vs hard cutover)?
4. nanobot이 push 실패(network/deskrpg down) 시 retry 정책 — at-most-once OK인가, at-least-once(deskrpg 측 `npc_task_id` idempotency key로 dedup)인가?
5. task와 sub-agent 이벤트를 같은 endpoint로 묶을지(`/api/internal/events`), 분리할지(`/api/internal/tasks` + `/api/internal/npcs`)?
6. tool 정의 형식 — OpenAI function calling 호환? nanobot 고유? qwen3.6-35b-a3b는 reasoning 모델인데 tool call 지원 정도 사전 확인.

### 사전 조사 필요 (interview 진입 전)

- nanobot agent loop의 hook 진입점 (`nanobot/agent/hook.py`의 `AgentHook` 패턴, `LLMUsageRecordHook`가 reference 구현)
- qwen3.6-35b-a3b의 OpenAI function calling 호환 messages 지원 여부 (reasoning 모델 한계 확인)
- 기존 `/api/tasks` POST(user-auth) vs `/api/internal/tasks` 신설 — 분리 권장 (인증·rate-limit·로그 분리)

---

## Candidate 2 — 채팅 첨부파일 multimodal 지원 (backlog-6)

### 현재 상태 (Phase 3 smoke test에서 발견)

- `ChatPanel.tsx` showFileUpload prop으로 파일 UI 활성화 + 클라이언트는 ArrayBuffer로 socket 전송
- `server.js:125`: `maxHttpBufferSize: 20e6` (3 × 5 MB 첨부 전제로 버퍼 열려있음)
- `server.js:698`: 핸들러가 `const { npcId, message } = data` — **`files` destructure 누락 → drop**
- **silent UX bug**: 사용자가 첨부 클릭은 가능하나 backend에서 그대로 버려짐, nanobot에 전달 X

### seed-v9 AC 매핑

- AC-014(Chat streaming parity)는 **텍스트-only chunk 스트리밍**으로만 명세
- seed-v8/v9 본문에 "attach/첨부/file upload" 언급 없음 → seed-v9 scope 외부

### `/interview` 가 명확화해야 할 질문 (사전 정리)

1. **모델 제약**: qwen3.6-35b-a3b가 multimodal(이미지/PDF) 입력을 지원하는가? 모델 한계가 결정적.
2. **파일 종류 범위**: 이미지만? PDF/텍스트도? 코드 파일은?
3. **저장 위치**: nanobot 워크스페이스 mirror(AC-015 연장)? deskrpg 별 storage? S3-호환?
4. **수명**: 채팅 세션 종료 시 삭제? 영구 첨부? 사용자가 명시 삭제?
5. **AC-014 확장 vs 신규 AC**: chat streaming AC에 multimodal을 포함시킬지, 새 AC(예: AC-022 Multimodal chat input)로 분리할지.
6. **모델 미지원 시 fallback**: 파일 메타데이터를 텍스트로 변환(파일명/사이즈/내용 요약)해서 prompt에 prefix?
7. **보안/검증**: 파일 size cap, MIME 검사, 악성코드 스캔? 현재 20MB만 있음.

### 사전 조사 필요 (interview 진입 전)

- nanobot OpenAI-compat이 vision/file 메시지를 어디까지 forward 하는가
- qwen3.6-35b-a3b의 multimodal capability matrix
- ChatPanel `showFileUpload` 활성 조건 (현재 어느 화면에서 보이는지)

---

## Candidate 3 — nanobot sub-agent → deskrpg NPC create/delete 연동 (backlog-7 신설 추정)

### 배경 (2026-05-23 사용자 / 다른 팀원)

> "다른 팀원이 nanobot에서 agent(sub agent)가 생기면 deskrpg create npc 혹은 delete npc api 스펙을 호출한다고 알려달라."

현재 NPC 생성 흐름:
- UI: `NpcHireModal` → `POST /api/npcs` (user auth) → 사용자가 명시적으로 고용
- nanobot 측은 NPC 생성 권한 없음

미래 흐름 (Candidate 3):
- nanobot agent loop이 sub-agent 생성 시 (e.g. parent agent가 작업 위임하려고 child spawn)
- nanobot이 deskrpg `/api/internal/npcs` POST 호출 → 새 NPC가 UI에 자동 등장 (channel 안 어딘가에 spawn)
- 마찬가지로 sub-agent 종료 시 `/api/internal/npcs/{id}` DELETE 호출

### `/interview` 가 명확화해야 할 질문

1. **트리거 조건**: nanobot이 sub-agent를 언제 만드는가? LLM tool call(parent → spawn_child)인가, agent loop hook인가?
2. **NPC placement**: sub-agent NPC가 채널 맵에 어디에 spawn하는가? 사용자가 위치 선택? parent NPC 근처 자동 배치? UI에서만 표시?
3. **소유권**: 사용자가 sub-agent NPC를 수정/삭제할 권한이 있는가? 또는 nanobot만 lifecycle 제어?
4. **persona 정의**: parent agent가 child의 identity/soul을 받아오는가, deskrpg가 default 채우는가?
5. **identification**: 사용자 입장에서 일반 NPC vs sub-agent NPC를 구분해야 하는가 (UI 마크/뱃지)?
6. **session_key**: sub-agent도 `ot-{channel8}-{agentId}` 컨벤션 따르는가? 부모-자식 관계 추적은 어떻게?
7. **lifecycle 정리**: parent agent 종료 시 child sub-agent도 자동 cleanup? cascade delete?

### 사전 조사 필요

- nanobot의 sub-agent / subagents 모듈 (예: `nanobot/agent/loop.py:769` 부근 `subagents.cancel_by_session` 등 기존 코드 사용 패턴)
- `POST /api/npcs` 요청 본문 spec (현 user-auth 흐름과 internal 흐름의 차이)
- channels 맵의 maxNpcs(10) 한계 — sub-agent도 카운트되는가?

### 본 candidate의 dependency

- backlog-1 (Candidate 1)의 (a) push 모델 채택이 선행되어야 동일 인프라 (`/api/internal/*`) 재사용 가능. 별 cycle보다는 같은 seed-v10에 묶는 것이 효율적.

---

## Candidate 4 — qwen reasoning_content forward (사용자 owner, 2026-05-23 추가)

### 배경 (Phase 4.5 smoke test에서 발견)

qwen3.6-35b-a3b 같은 reasoning 모델은 OpenRouter SSE에서 두 가지 delta 필드를 보냄:
- `delta.content`     — 자연어 응답 (사용자에게 보일 텍스트)
- `delta.reasoning`   — 사고 과정 (CoT, chain-of-thought)

reasoning 단계가 길어 max_tokens 한계까지 reasoning만 출력되는 경우, content는 0 tokens 이거나 매우 짧음 → deskrpg는 chunk 0건 → UI에 빈 NPC 응답 박스.

증거 (2026-05-23 PM-B/designer-A NPC):
```
TokenTrackingHook: prompt_tokens=10439, completion_tokens=8192, total=18631
                                                    ↑
                                            max_tokens 한계 도달
Empty response on turn 0; retrying
```

### 문제

nanobot의 LLM provider response 처리 layer가 `delta.content`만 forward 하고 `delta.reasoning`은 drop. 외형상 streaming이 끊긴 것처럼 보이며, 30~120초 후에야(또는 retry 후에도 빈 응답으로) 사용자가 응답 확인.

### 옵션

- **(A) reasoning forward + UI indicator** — nanobot이 `delta.reasoning`을 별 SSE event type으로 forward → deskrpg가 "🤔 생각하는 중..." 표시. UX 큰 개선이지만 nanobot fork + deskrpg ChatPanel 둘 다 수정 필요.
- **(B) heartbeat만** — reasoning content는 버리고 alive 신호만 보냄. timeout 방지 + UI "응답 대기 중" 상태 유지. 코드 변경 작음.
- **(C) OpenRouter parameter로 reasoning 줄임** — `reasoning: {effort: "low"}` 또는 `reasoning: {exclude: true}` 전달. nanobot 1줄 수정. 모델 자체의 reasoning 양이 줄어 응답 빨라짐. 단, qwen이 OpenRouter parameter를 어디까지 지원하는지 확인 필요.
- **(D) seed-v10 작업 후 자연 해소 확인** — task push 모델 + withTaskReminder/injectTaskPrompt 제거 후 LLM의 reasoning 부담↓ → reasoning_content 한계 도달 빈도 자동↓. 별도 패치 없이 충분할 수도.

### Owner & dependency

- **Owner**: 사용자 (deskrpg owner) — 2026-05-23 확정.
- 다른 팀원의 작업 범위(nanobot 측 deskrpg push hook)와는 **다른 layer** (LLM I/O vs event emission).
- seed-v10 backlog-2/3/4 작업 완료 후 (D) 검증 → 잔존 시 (A)/(B)/(C) 중 선택.

### `/interview` 명확화 필요

1. (A) UI indicator를 도입할 가치가 있는가, 단순 "응답 대기" 표시면 충분한가?
2. OpenRouter parameter가 qwen3.6-35b-a3b에서 실제로 동작하는지 사전 테스트 필요.
3. nanobot fork upstream에 PR 보내야 할 영역인가 (general fix), 우리 fork만 수정인가?
4. 다른 reasoning 모델 (deepseek-r1, o1 류) 대응까지 일반화할지?

---

## 작업 분담 (2026-05-23 사용자 확인)

| 역할 | 작업 |
|---|---|
| **본인 (deskrpg owner)** | (1) deskrpg internal API 신설: `/api/internal/tasks` (POST) + `/api/internal/npcs` (POST/DELETE), 인증은 `INTERNAL_RPC_SECRET` 재사용. (2) **legacy task 로직 제거** — 아래 "제거 대상" 표 참조. |
| **다른 팀원 (nanobot fork)** | nanobot agent loop에 task/sub-agent emission hook 추가 (`LLMUsageRecordHook` 패턴 모사). emit 시 deskrpg internal endpoint 호출. |

### deskrpg 측 제거 대상 (legacy LLM-output-parsing 흐름)

본인 작업 완료의 조건은 새 internal API가 동작하는 것 + 아래 legacy 코드가 제거되는 것:

| 종류 | 파일 / 함수 | 현재 역할 |
|---|---|---|
| 완전 제거 | `deskrpg/src/lib/task-parser.js` (parseNpcResponse, isValidTaskAction) | NPC 응답 본문 `json:task` 코드블록 정규식 추출 |
| 완전 제거 | `deskrpg/src/lib/task-prompt.js: withTaskReminder` + `buildTaskReminder` | 매 user 메시지에 `[SYSTEM REMINDER - MANDATORY TASK PROTOCOL]` ~200 tokens prepend |
| 부분 제거 (interview에서 확정) | `task-prompt.js: injectTaskPrompt` + `buildTaskCorePrompt` | NPC persona의 Identity 문서에 task protocol 본문 prepend (NPC 생성 1회) |
| 호출 흐름 단순화 | `deskrpg/server.js` L303/372/375/734/742/843 | parseNpcResponse + withTaskReminder 호출 hot path |

### 토큰 절감 효과 (예측, qwen3.6-35b 기준)

- Phase 4.5 Option A(이미 적용): system 누적 14→1번, 14턴 누적 ~80% 절감
- + withTaskReminder 제거 (본 작업): ~200 tokens × N turns 추가 절감
- + injectTaskPrompt 제거 (확정 시): persona Identity의 task block ~500 tokens (1회) 절감

→ reasoning 모델 응답 시간 + 비용 추가 단축. 누적 14턴 기준 prompt_tokens 약 9626 → ~6500 예상.

---

## 이 문서의 사용법

1. **다른 컴퓨터에서 `/interview` 실행**: 본 문서를 컨텍스트로 줘서 위 질문 두 셋을 묻고, dimension scoring 진행. ambiguity ≤ 0.20에 도달하면 종료.
2. **결과 저장**: `interviews/{YYYY-MM-DD}-seed-v10-{topic}.yaml` 형식 (기존 컨벤션). topic은 "task-tool-api" 또는 "multimodal-chat-input" 등 분리 권장 (두 candidate를 한 cycle에 묶을지 분리할지는 interview 첫 round에서 결정).
3. **그 다음 `/seed` → seed-v10.yaml**: v9 supersede 또는 별 spec으로.

---

## 변경 이력

- 2026-05-19T17:30:00 — 본 stub 생성. seed-v9 amendment 2 backlog-1/6 진입점.
