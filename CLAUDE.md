# CLAUDE.md — reg-detection

This file provides guidance to Claude Code when working with this repository.

## CRITICAL: Read ARCHITECTURE_INVARIANTS First

**BEFORE starting ANY work**, read `ARCHITECTURE_INVARIANTS.md` to understand the project's non-negotiable rules.

### Document Priority

1. **ARCHITECTURE_INVARIANTS.md** (Supreme - overrides all)
2. **docs/adr.yaml** (Architecture Decision Records)
3. **CLAUDE.md** (This file)
4. **docs/code-convention.yaml** (Coding conventions)

**When in conflict, ARCHITECTURE_INVARIANTS.md always wins.**

---

## Project Overview

**reg-detection** — [TODO: Add project description]

| Item | Detail |
|------|--------|
| Stacks |  |
| Package Manager | unknown |
| Frontend | . |
| Backend | . |

---

## Absolute Rules (NEVER violate)

1. **3-tier layer separation** — Presentation / Logic / Data 계층을 반드시 준수
2. **No layer skipping** — Presentation → Logic → Data 순서로만 호출. 레이어를 건너뛰지 않는다
3. **No secrets in code** — Use environment variables. Never commit .env files
4. **No new dependencies without approval** — Ask before adding packages
5. **Follow existing patterns** — Match the codebase's style, don't introduce new paradigms
6. **Run tests before committing** — All tests must pass

---

## AI Behavioral Baseline

모든 코딩 작업에 항상 적용. 워크플로우 선택과 무관.

> 출처: [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) — Andrej Karpathy의 LLM 코딩 실수 관찰에서 도출한 4원칙

1. **코딩 전 생각** — 불확실하면 가정하지 말고 물어라. 해석이 여럿이면 조용히 고르지 말고 제시한다
2. **최소 코드** — 요청된 것만 구현. 단일 사용 추상화 금지, 추측성 유연성 금지, 발생 불가능한 에러 핸들링 금지. 200줄로 쓴 게 50줄로 될 것 같으면 다시 써라
3. **외과적 변경 (Surgical Changes)** — 변경 대상 외 코드는 손대지 않는다. 무관한 dead code 발견 시 삭제하지 말고 언급만. 내 변경이 만든 orphan(import/var/func)만 정리한다. 모든 변경 라인은 요청으로 역추적 가능해야 한다
4. **목표 기반 실행** — 작업을 검증 가능한 목표로 변환. 다단계 작업은 `[단계] → verify: [검증]` 플랜으로 시작

> **Tradeoff**: 이 원칙들은 속도보다 정확성을 우선한다. 명백한 one-liner는 judgment로.

---

## Architecture Layers (3-Tier)

이 프로젝트는 **3-tier layered architecture**를 따릅니다.

### Layer Definitions

| Layer | 책임 | 금지사항 |
|-------|------|---------|
| **Presentation** | 사용자 소통 (UI, HTTP 요청/응답, 입력 검증, 응답 포맷팅) | 비즈니스 로직 금지, DB 직접 접근 금지 |
| **Logic** | 비즈니스 규칙 (알고리즘, 검증, 트랜잭션, 서비스 조율) | UI 코드 금지, Raw SQL 금지, HTTP 응답 직접 처리 금지 |
| **Data** | 데이터 소통 (DB 조작, 외부 API 호출, 캐싱) | 비즈니스 로직 금지, Presentation 의존 금지 |

### Stack-Layer Mapping


### Layer Communication Rules

```
Presentation ──→ Logic ──→ Data
     ↑               ↑
   DTO/Interface    Model/Entity

  ✅ Presentation → Logic (via service call)
  ✅ Logic → Data (via repository/ORM)
  ❌ Presentation → Data (layer skip)
  ❌ Data → Logic (reverse dependency)
  ❌ Logic → Presentation (reverse dependency)
```

- **레이어 간 통신은 DTO/인터페이스를 통해서만** — 내부 도메인 객체를 직접 노출하지 않는다
- **하위 레이어만 호출** — 상위 레이어를 절대 import하지 않는다
- **각 모듈은 자기 레이어의 책임만 갖는다** — 한 모듈이 다른 레이어의 일을 하면 안 된다

### Testing by Layer

- **Logic Layer**: 테스트 커버리지 최우선. 순수 비즈니스 로직에 집중. mock은 최소화
- **Data Layer**: 통합 테스트 위주. 실제 DB/외부 서비스 연동 검증
- **Presentation Layer**: E2E/스냅샷 테스트. UI 렌더링과 라우팅 검증
- **원칙**: 구현과 테스트를 함께 작성. 일괄 작성 금지

---

## Development Workflow

### Ouroboros Loop (Specification-First)

For new features or significant changes, use the Ouroboros workflow:

```
/interview  →  /seed  →  /trd  →  /decompose  →  /run  →  /evaluate  →  /evolve
  (명세 확정)  (스펙 생성) (기술 설계) (태스크 분해)  (구현)    (검증)      (진화)
```

1. **`/interview`** — Socratic interview to clarify requirements (Ambiguity <= 0.2 to pass)
2. **`/seed`** — Generate immutable spec from interview
3. **`/trd`** — Layer-aware technical design document (3-tier mapping, discussion points)
4. **`/decompose`** — Break seed AC into atomic, independently testable tasks
5. **`/run`** — Execute via Double Diamond (Discover→Define→Design→Deliver)
6. **`/evaluate`** — 3-stage verification (Mechanical→Semantic→Judgment)
7. **`/evolve`** — Incorporate learnings, converge ontology

Other commands: `/unstuck` (when stuck), `/pm` (generate PRD)

> **Skip rules**: `/trd` and `/decompose` may be skipped ONLY when all ACs are `low` complexity AND the entire change touches a single layer. In all other cases, both steps are mandatory before `/run`.

### Before Starting Work
1. Read `ARCHITECTURE_INVARIANTS.md`
2. Check `docs/adr.yaml` for relevant architectural decisions
3. For new features: run `/interview` to clarify scope first
4. Understand the scope of changes

### During Work
1. Follow `docs/code-convention.yaml` rules for your stack
2. Respect dependency boundaries (see `.harness/gates/rules/boundaries.yaml`)
3. Stay aligned with seed spec (if exists in `.harness/ouroboros/seeds/`)
4. Write tests for new functionality

### Before Committing
1. Run the gate checks: `.harness/gates/check-boundaries.sh`
2. Run tests
3. Ensure no secrets are exposed: `.harness/gates/check-secrets.sh`
4. If seed exists: run `/evaluate` to verify against spec

---

---

## Harness Gate Commands

See `.harness/gates/GATES.md` for the full default vs opt-in breakdown.

```bash
# DEFAULT gates (blocking — run on pre-commit + CI)
.harness/gates/check-secrets.sh        # Leaked secrets
.harness/gates/check-boundaries.sh     # Dependency boundary violations
.harness/gates/check-structure.sh      # Project structure rules
.harness/gates/check-spec.sh           # Seed spec completeness
.harness/gates/check-layers.sh         # 3-tier layer separation
.harness/gates/check-security.sh       # SAST security scanning
.harness/gates/check-deps.sh           # Dependency vulnerabilities

# OPT-IN gates (manual; enable via HARNESS_ENABLE_* env vars)
.harness/gates/check-complexity.sh     # Code complexity metrics
.harness/gates/check-mutation.sh       # Mutation testing score
.harness/gates/check-performance.sh    # Performance budgets
.harness/gates/check-ai-antipatterns.sh # AI-generated code anti-patterns

# Run all
.harness/detect-violations.sh
```

---

## Agent Personas

9 specialized agents available via commands:

| Agent | Role | When to Use |
|-------|------|-------------|
| Interviewer | 질문만 한다 | `/interview` — 요구사항 명확화 |
| Ontologist | 본질을 정의한다 | `/seed` — 도메인 모델 추출 |
| Seed Architect | 스펙을 결정화한다 | `/seed` — 불변 명세 생성 |
| Evaluator | 검증한다 | `/evaluate` — 3단계 평가 |
| Contrarian | 반대 상황을 묻는다 | `/evolve` — 가정 검증 |
| Simplifier | 복잡성을 줄인다 | `/unstuck` — 단순화 |
| Researcher | 근거를 조사한다 | `/unstuck` — 사실 확인 |
| Architect | 구조를 본다 | `/unstuck` — 설계 분석 |
| Hacker | 우회로를 찾는다 | `/unstuck` — 임시 해결 |

---

## Reference Documents

- `docs/code-convention.yaml` — Coding conventions (filterable by `stacks` field)
- `docs/adr.yaml` — Architecture Decision Records (filterable by `stacks`, `date`, `status`)
- `.harness/gates/rules/boundaries.yaml` — Dependency boundary rules
- `.harness/gates/rules/structure.yaml` — Project structure rules
- `.harness/ouroboros/seeds/` — Seed specifications (if using Ouroboros workflow)
- `.harness/ouroboros/scoring/ambiguity-checklist.yaml` — Ambiguity scoring criteria
