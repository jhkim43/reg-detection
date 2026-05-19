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

### 사용자 제안 방향 (2026-05-19)

> "nanobot이 실제 수행하고 있는 task를 가져오는 방식은? LLM 응답 JSON 필드에 의존하니깐 정확하지 않은 것 같은데."

옵션 후보:
- (a) nanobot agent loop이 tool execution state 노출 — `GET /v1/agents/{agentId}/tasks` 또는 SSE channel
- (b) nanobot이 task action을 dedicated tool call로 emit — LLM이 답변 본문에 섞지 않고 tool API로 호출
- (c) Hybrid: 본문 parser는 fallback, 1st-class는 tool API

### `/interview` 가 명확화해야 할 질문 (사전 정리)

1. nanobot fork에 tool execution state 노출 API를 추가하는 것이 본 cycle scope에 들어가는가? (nanobot fork 변경 vs deskrpg-only 변경)
2. 기존 task-action 코드블록 호환은 유지할 것인가, 끊어낼 것인가? (parallel-change vs hard cutover)
3. NPC 응답 본문 parsing의 fallback을 유지할 경우, fallback 우선순위는?
4. tool API가 streaming 중 emit하는 경우, deskrpg socket-handlers는 어떻게 chunk와 분리해서 처리하는가?
5. tool 정의 형식 — OpenAI function calling 호환? nanobot 고유? (모델별 지원 차이 확인 필요)

### 사전 조사 필요 (interview 진입 전)

- nanobot 현재 코드베이스의 tool execution layer 유무 (nanobot/nanobot/agent/* 확인)
- qwen3.6-35b-a3b가 OpenAI function calling 호환 메시지를 지원하는지
- 다른 task source-of-truth 후보 (예: nanobot tool state DB vs deskrpg ChatHistory parse)

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

## 이 문서의 사용법

1. **다른 컴퓨터에서 `/interview` 실행**: 본 문서를 컨텍스트로 줘서 위 질문 두 셋을 묻고, dimension scoring 진행. ambiguity ≤ 0.20에 도달하면 종료.
2. **결과 저장**: `interviews/{YYYY-MM-DD}-seed-v10-{topic}.yaml` 형식 (기존 컨벤션). topic은 "task-tool-api" 또는 "multimodal-chat-input" 등 분리 권장 (두 candidate를 한 cycle에 묶을지 분리할지는 interview 첫 round에서 결정).
3. **그 다음 `/seed` → seed-v10.yaml**: v9 supersede 또는 별 spec으로.

---

## 변경 이력

- 2026-05-19T17:30:00 — 본 stub 생성. seed-v9 amendment 2 backlog-1/6 진입점.
