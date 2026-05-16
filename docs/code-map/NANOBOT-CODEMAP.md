# NANOBOT Code Map — RegTrack 확장 지점 가이드

> **출처**: T-000a/b/c (decomposition Phase 0, M2 prep)
> **작성일**: 2026-05-16
> **목적**: nanobot fork(`/nanobot/`)의 구조와 우리 RegTrack 신규 코드가 들어갈 5개 확장 지점 매핑.
> **대상 독자**: 팀 전원. 특히 M2-M3에서 nanobot 내부를 손대는 작업자.
> **선행 자료**: `nanobot/docs/quick-start.md`, `configuration.md`, `obsidian-interface.md`, `websocket.md`, `agent-social-network.md`

---

## 0. 한 줄 요약

nanobot은 **agent loop + provider + channel + skill + session** 5개 모듈로 이루어진 LLM 에이전트 프레임워크. 우리 RegTrack은 이 5개 지점에 **신규 파일을 추가**(skill·provider)하거나 **기존 파일을 호출**(agent·session)하는 방식으로 통합. **기존 파일 수정은 최소화** — upstream pull 시 충돌 방지.

---

## 1. nanobot 전체 디렉토리 구조 (관련 부분만)

```
nanobot/
├── docs/                              ← 학습 자료 (먼저 읽을 5개)
│   ├── quick-start.md                 ← 30분 onboarding
│   ├── configuration.md               ← provider·channel·skill 선언법
│   ├── obsidian-interface.md          ← 팀 작업: Obsidian REST API 통합 가이드
│   ├── websocket.md                   ← Frontend WebSocket 연동 spec
│   └── agent-social-network.md        ← (참고만 — RegTrack 무관)
│
└── nanobot/                           ← 실제 Python 소스
    ├── agent/                         ← ★ 확장 지점 ① — 에이전트 라이프사이클
    │   ├── loop.py                    ← 에이전트 메인 루프 (수정 X, 호출만)
    │   ├── runner.py                  ← 실행기
    │   ├── context.py                 ← 컨텍스트 빌더
    │   ├── skills.py                  ← BUILTIN_SKILLS_DIR 로딩
    │   └── tools/                     ← ask·cron·shell·spawn 기본 툴
    │
    ├── skills/                        ← ★ 확장 지점 ② — 도메인 skill 추가
    │   ├── README.md                  ← skill 작성 가이드 (먼저 읽기)
    │   ├── obsidian/SKILL.md          ← 팀 작업: Obsidian REST API skill
    │   ├── my/                        ← 사용자 정의 skill 디렉토리
    │   ├── github/, cron/, memory/    ← built-in
    │   └── ⬇ regtrack/                ← 신규 (M3) — 아래 §3 참조
    │
    ├── providers/                     ← ★ 확장 지점 ③ — LLM provider
    │   ├── registry.py                ← ProviderSpec 단일 진실 (수정 거의 X)
    │   ├── base.py                    ← LLMProvider 추상 클래스
    │   ├── factory.py                 ← provider 인스턴스 생성
    │   ├── openai_compat_provider.py  ← OpenRouter는 이걸 재사용
    │   └── ⬇ openrouter_qwen.py        ← 검토 (M3) — 아래 §4 참조
    │
    ├── channels/                      ← ★ 확장 지점 ④ — 외부 채널 통합
    │   ├── base.py                    ← BaseChannel 추상 클래스
    │   ├── manager.py                 ← 채널 매니저
    │   ├── websocket.py               ← Frontend(Next.js)와 연결할 채널
    │   ├── telegram/, discord/, slack/ ← 기본 (사용 X)
    │   └── ⬇ regtrack_dashboard.py    ← 신규 (M4) — 아래 §5 참조
    │
    └── session/                       ← ★ 확장 지점 ⑤ — 대화 세션 관리
        ├── manager.py                 ← Session 클래스 + JSONL 저장
        └── (수정 X — 우리는 데이터 영속화에 SQLite 별도 사용)
```

---

## 2. 5개 확장 지점 요약

| 지점 | nanobot 경로 | RegTrack 신규/수정 | 시점 | 위험도 |
|------|-------------|-------------------|------|--------|
| ① **agent** | `nanobot/agent/loop.py` | 호출만, 수정 X | M3 | 낮음 |
| ② **skill** | `nanobot/skills/regtrack/` | 신규 디렉토리 추가 | M3 | 낮음 |
| ③ **provider** | `nanobot/providers/` | 신규 파일 또는 기존 재사용 | M3 W6 | 중간 (registry.py 수정 여부) |
| ④ **channel** | `nanobot/channels/regtrack_dashboard.py` | 신규 파일 (또는 `websocket.py` 직접 사용) | M4 | 중간 |
| ⑤ **session** | `nanobot/session/manager.py` | 사용만, 수정 X | M3-M4 | 낮음 |

**원칙**: 신규 파일 추가 ✅ / 기존 파일 수정 ❌ (불가피하면 작은 patch + retro 안건).

---

## 3. 확장 지점 ② — skills/regtrack/ (가장 큰 작업)

**왜 skill인가**: nanobot은 **SKILL.md(markdown frontmatter + 명령어 설명)**를 읽어 에이전트가 자동으로 사용 가능한 도구로 등록함. Python 코드를 새로 짜지 않아도 의도 명세만으로 확장 가능.

**RegTrack 신규 skill 후보**:

```
nanobot/nanobot/skills/regtrack/
├── crawler/SKILL.md           ← 5 사이트 크롤링 의도·제약·예시
├── impact-analyzer/SKILL.md   ← Citation 강제·BR-1 규칙·LLM 호출 패턴
├── meeting-orchestrator/SKILL.md  ← BR-3 4항목 회의 디지스트
└── npc-reporter/SKILL.md      ← NPC 보고 메시지 포맷
```

**참고 예시**: `nanobot/nanobot/skills/obsidian/SKILL.md` (팀이 이미 작성한 것)
- frontmatter: `name`, `description`, `metadata` 형식
- 본문: "Captain's Special Instructions" → 우리도 BR-1/BR-3을 이 패턴으로 강제

**SKILL.md 작성법** — `nanobot/nanobot/skills/README.md` 참조 (위에서 인용한 가이드).

**M3 진입 시 결정 필요**:
- crawler는 별도 Python 서비스(scrapy/playwright)로 분리하기로 결정됨 (seed-v1 D-3) → skill로는 **trigger·결과 조회**만 작성
- impact-analyzer는 BR-1(Citation 강제)을 SKILL.md 단계에서 prompt-level로 enforce할 것인지, Python 코드로 후처리 검증할 것인지 결정 (`docs/api/...` §3 참조)

---

## 4. 확장 지점 ③ — providers/ (OpenRouter + Qwen)

**좋은 소식**: nanobot이 이미 OpenRouter를 **first-class provider**로 지원 (`configuration.md` §Providers 표). `openai_compat_provider.py`를 재사용.

**필요 작업 — minimal**:

`~/.nanobot/config.json`에 OpenRouter + Qwen 설정 추가 — **코드 수정 0줄**:
```json
{
  "providers": {
    "openrouter": {
      "apiKey": "${OPENROUTER_API_KEY}"
    }
  },
  "agents": {
    "defaults": {
      "provider": "openrouter",
      "model": "qwen/qwen3.6-35b-a3b"
    }
  }
}
```

**필요 작업 — 신규 코드 (LLMUsageRecord 추적, AC-008)**:

OpenRouter 응답에서 토큰 비용을 LLMUsageRecord SQLite 테이블에 기록하는 hook 필요. 두 가지 방법:

**A) Wrapper provider 신규 파일** (권장 — 격리·테스트 용이)
```
nanobot/nanobot/providers/openrouter_with_usage.py
  → 기존 openai_compat_provider 상속
  → response 후처리에서 RegTrack SQLite write
```

**B) Hook 패턴 활용** (`agent/hook.py`의 `AgentHook` 등록)
```
nanobot/agent/hook.py 에 callback 등록 — registry.py·base.py 수정 X
```

**M3 W6에서 결정**: prompt cache 지원 여부 검증 후 A/B 택1. seed-v7 pending_v8.

---

## 5. 확장 지점 ④ — channels/ (Frontend ↔ Backend WebSocket)

**RegTrack은 deskrpg 기반 Next.js frontend → nanobot backend WebSocket 연결**.

**좋은 소식**: nanobot의 `channels/websocket.py`가 이미 그 역할. `~/.nanobot/config.json`만 설정:
```json
{
  "channels": {
    "websocket": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 8765
    }
  }
}
```

`nanobot gateway` 실행 → `ws://127.0.0.1:8765/` 가 열림. Frontend가 여기에 connect.

**RegTrack 신규 작업 (M4)**:
- `nanobot/channels/websocket.py`는 그대로 사용
- 우리가 보낼 이벤트 타입(예: `npc_report`, `meeting_digest`, `llm_usage_update`)은 **메시지 페이로드**로 처리 (채널 코드 수정 불필요)
- API spec `docs/api/API-RegTrack-2026-05-16.md` §WS 채널 정의 참조

**선택**: 도메인별 채널을 따로 만들고 싶으면:
```
nanobot/channels/regtrack_dashboard.py
  → BaseChannel 상속 + RegTrack 특화 인증·라우팅
```
하지만 시연 범위에선 기본 websocket.py로 충분 — over-engineering 회피.

---

## 6. 확장 지점 ① + ⑤ — agent loop + session (수정 없음)

**원칙**: 직접 수정하지 않고 **호출만** 한다.

- `nanobot/agent/loop.py` — agent 메인 루프. 우리는 `nanobot.agent.runner.AgentRunner`를 외부에서 import하여 사용.
- `nanobot/session/manager.py` — 대화 세션을 JSONL로 영속화. 우리 비즈니스 데이터(Regulation, ImpactAnalysis 등)는 **별도 SQLite**에 저장(TRD §3 Data Layer). nanobot session은 LLM 대화 히스토리만 담당.

만약 수정이 필요해 보이는 상황이 생기면 → **retro 안건** (large 변경 분류, seed-v9 발급 가능성).

---

## 7. RegTrack 구현 시점별 매핑 (decomposition 참고)

| 시점 | 확장 지점 | 신규 파일 | 참조 task |
|------|----------|-----------|-----------|
| M2 (W3-W5) | (없음) | — | T-001~T-025: 모두 RegTrack 별도 백엔드(FastAPI+SQLite). nanobot 미터치 |
| M3 W6 | ③ provider | `providers/openrouter_with_usage.py` 또는 hook | T-026~T-030 (LLM 클라이언트·cache·tracker) |
| M3 W7-W8 | ② skill | `skills/regtrack/impact-analyzer/SKILL.md`, `meeting-orchestrator/SKILL.md` | T-035 (Pair), T-039 (Pair) |
| M4 W9 | ④ channel | (config만, 코드 X) | T-054 (Frontend WS 연결) |
| M4 W10 | ① agent | (호출, 코드 X) | T-067 (e2e Pair) |

---

## 8. nanobot upstream pull 시 주의사항

- 우리는 `fork/nanobot-20260509` 시점에 freezing (seed-v1 constraint).
- upstream `HKUDS/nanobot` 최신 변경을 가져오는 것은 **시연 종료 후 (M5 retro 안건)** — 우리 변경과 conflict 가능성 ↑.
- 만약 보안 패치 등 긴급 pull 필요 시:
  1. 우리 신규 파일(skills/regtrack/, providers/openrouter_with_usage.py 등)이 conflict 없는지 먼저 확인
  2. 게이트 `check-boundaries.sh`는 `/nanobot/` 제외 설정되어 있음 (commit b29d8bf) — pull 후에도 안전

---

## 9. M2 종료 retro 안건 (nanobot 수정 정책)

본 코드맵 작성 결과를 토대로 다음 정책 중 택1:

| 옵션 | 설명 | 트레이드오프 |
|------|------|------------|
| **A) Diff 기반** | PR diff에 포함된 파일만 게이트 검사 | upstream 코드 자동 제외. workflow 복잡도 ↑ |
| **B) 화이트리스트** | `skills/regtrack/`, `providers/openrouter_*.py` 등 명시 등록 | 의도 명확. 신규 파일마다 yaml 갱신 |
| **C) 디렉토리 분리** | RegTrack 코드를 `regtrack/skills/` 등 별도 트리에 두고 plugin 로딩 | upstream 충돌 0. nanobot이 외부 plugin 지원하는지 검증 필요 |

**현재 본 코드맵 결과 기반 추천**: **B (화이트리스트)** — 신규 파일이 적고(~5개) 명시적 관리가 가장 단순. C는 nanobot 구조 변경 risk.

→ 최종 결정은 M2 종료 retro (예상 2026-06-16 주).

---

## 10. 한 줄로 다시 정리

> **신규 skill 4개 추가 + provider hook 1개 + websocket config 1개 — 나머지는 nanobot 그대로**.
> 그 외 모든 RegTrack 백엔드 비즈니스 로직은 **별도 FastAPI 서비스 + SQLite** (TRD §3).
> nanobot upstream과의 충돌 가능성은 최소화.
