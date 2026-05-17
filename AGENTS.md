# AGENTS.md — reg-detection (RegTrack)

> **이 파일은 모든 코딩 에이전트(Claude Code · Cursor · OpenCode · Aider · GitHub Copilot 등)가 본 repo에서 작업 시 첫 번째로 읽어야 하는 공통 진입점입니다.**
> Claude Code는 `CLAUDE.md`도 추가로 읽지만, 본 파일의 규칙이 모든 에이전트에 동일하게 적용됩니다.
> 이 규칙들은 "에이전트가 누구든 같은 목표·같은 정합성으로 작업한다"를 보장하기 위함입니다.

## 0. 작업 시작 직전 — 반드시 읽기 (능동 trigger)

작업 지시받은 직후, **첫 코드 변경 전에** 다음 파일을 모두 read 합니다. 사용자가 묻기 전에 능동적으로.

1. **`ARCHITECTURE_INVARIANTS.md`** (Supreme — 충돌 시 최우선)
2. **`docs/adr.yaml`** (관련 영역의 ADR)
3. **`docs/code-convention.yaml`** (해당 stack의 LAYER/GEN/TS 규칙)
4. **`.harness/gates/rules/boundaries.yaml`** + **`structure.yaml`** (의존성/구조 제약)
5. **`docs/README.md`** (어느 docs를 언제 봐야 하는지 메타 인덱스)
6. **작업 영역 관련 `docs/code-map/*.md`** (통합/모듈 구조)
7. **`.harness/ouroboros/seeds/seed-v{최신}.yaml`** (immutable 명세 — AC, ontology, constraints)
8. **`docs/integration/PUSH-GUIDE-RegTrack-2026-05-16.md`** (push/PR 전 체크리스트)

작업 영역과 관련된 분석/설계 문서:
- 시연 영역 → `docs/demo-scenario/STORYBOARD-*.md`
- API 영역 → `docs/api/API-*.md`
- 데이터 영역 → `docs/data-model/ERD-*.md`
- 아키텍처 → `docs/architecture/ARCHITECTURE-*.md` + `docs/trd/TRD-*.md`
- LLM 비용/임계 → `docs/llm-cost/LLM-COST-*.md`
- Risk → `docs/risk/RISK-*.md`
- 셋업 → `docs/local-setup/SPIKE-SETUP.md`

---

## 1. 절대 규칙 (위반 시 작업 중단)

1. **3-tier layer 분리** — Presentation / Logic / Data 경계. `src/components`에서 DB 직접 import 금지, `src/lib`에 React/Next 의존 금지 등. 자세히는 `ARCHITECTURE_INVARIANTS.md` Part 1.
2. **레이어 스킵 금지** — Presentation → Logic → Data 순서로만. 역참조·스킵 모두 금지.
3. **secret 금지** — `.env*` 파일은 절대 git에 커밋하지 않음. `init-env.sh` 외 방법으로 .env 생성하지 않음. API key·token·전화번호 패턴은 push 전 grep 검사 (PUSH-GUIDE §1.3).
4. **새 의존성 사전 합의** — 기존 의존성으로 해결 가능한지 먼저 확인. 불가피한 경우 retro에서 결정 + ADR 기록.
5. **테스트 함께 작성** — 구현과 동시에. Logic 레이어는 순수 비즈니스 로직에 집중. mock은 레이어 경계에서만.

---

## 2. 작업 진행 절차

### 2.1 새 작업 시작 시
```bash
git fetch origin
git log --oneline HEAD..origin/dev    # dev에 새 커밋이 있나
git diff --stat HEAD..origin/dev      # 본인 영역과 겹치는 파일이 있나
```
겹침 있으면 반드시 머지 또는 rebase. (PUSH-GUIDE §3.0.1.1)

### 2.2 변경 → 문서 sync (commit 전)
코드 변경의 reason/effect가 문서에 반영돼야 합니다. 매핑은 PUSH-GUIDE §1.5 참조:
- 통합/아키텍처 결정 → `docs/code-map/`
- 새 결정 → `docs/adr.yaml` ADR 등록 후보 검토
- AC 흐름 변경 → seed 새 버전 발행 (대형)
- 시연 영향 → STORYBOARD 갱신
- 셋업 흐름 변경 → SPIKE-SETUP 또는 scripts/ 가이드

### 2.3 commit 직전
```bash
bash .harness/detect-violations.sh
```
실패하면 fix 후 새 commit. `--no-verify`는 절대 금지.

### 2.4 commit 메시지
다음 둘 중 택1:
- `[small]/[medium]/[large]` prefix + 사유 (PRD §17.2 분류)
- conventional commit (`feat:/fix:/docs:/chore:`) + PR 라벨로 분류 표기 (2026-05-17 정책 보강)

### 2.5 push / PR 생성은 사용자가 직접
**push, PR 생성, force-push, 외부 서비스 API 호출 등 외부 영향 액션은 에이전트가 실행하지 않습니다.** 에이전트는 명령어 안내까지만. (PUSH-GUIDE §3 "모든 명령어는 본인이 직접 실행")

---

## 3. 절대 금지 (Hard Constraints)

- `git push --force` (단순) — `--force-with-lease` 외 절대 금지
- `dev`, `main` 브랜치에 직접 push (둘 다 protection 적용)
- `.env*` 파일을 git add
- OpenRouter API key 또는 GitHub PAT을 코드/문서에 평문 기재
- Project Charter (`Project Charter_4팀_*.docx`) 같은 PII 포함 파일을 git에 추가
- nanobot upstream 코드를 PR 1~3 동안 임의 수정 (M3 retro에서 정책 결정 전)
- deskrpg fork의 비RegTrack 신규 기능을 임의 통합 (M5 retro에서 정책 결정 전)
- 외부 vault repo를 public으로 전환

---

## 4. 의도적 cross-link

| 다른 에이전트 메모리/규칙 파일 | 본 파일과의 관계 |
|--|--|
| `CLAUDE.md` | Claude Code 전용 보조. 본 파일과 동일 규칙 + Claude 전용 슬래시 명령(/interview, /seed 등) 안내 |
| `ARCHITECTURE_INVARIANTS.md` | Supreme. 충돌 시 항상 우선 |
| `docs/integration/PUSH-GUIDE-*.md` | push/PR 절차 상세 |
| `.harness/gates/GATES.md` | gate 정책 (default vs opt-in) |

---

## 5. 도움이 필요한 경우

- 절차가 모호하면 docs/README.md를 먼저 읽어 어느 문서를 봐야 하는지 확인합니다.
- 결정이 모호하면 `.harness/ouroboros/seeds/seed-v{최신}.yaml`의 `acceptance_criteria` / `constraints` 가 권위 있는 답입니다.
- 그래도 모호하면 사용자에게 묻기. 추측해서 커밋하지 않습니다.

---

> **이 파일을 읽지 않고 작업한 에이전트는 "산으로 갈" 위험이 있다는 것이 본 프로젝트의 전제입니다.**
> 매 세션 시작 시 본 파일 + §0 read list 능동 수행 = 본 프로젝트의 기본 컨벤션.
