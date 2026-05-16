# Push & Integration Guide — RegTrack

> **목적**: 로컬 작업물을 base repo(`jhkim43/reg-detection`)에 안전하게 push + PR 생성하는 팀 공용 가이드.
> **대상**: 팀 전원. 각자 자기 feature 브랜치를 push할 때 동일 절차 적용. AI는 가이드만 제공·실행 X.
> **이번 적용 예시**: M1 분석/설계 산출물 push (브랜치 `feat/spec-and-design`, 작업자 = deukkyu-tech). 다른 마일스톤·작업자는 변수만 교체.

| 항목 | 이번 예시 값 | 일반화 |
|------|-------------|--------|
| **버전** | v2 (일반화) | — |
| **작성일** | 2026-05-16 | — |
| **현재 위치** | `/Users/deukkyu/prjects/regtrack/` | 본인 clone 경로 |
| **현재 브랜치** | `feat/spec-and-design` | 본인 feature 브랜치 |
| **타겟 브랜치** | `dev` (먼저 PR) → 나중에 `main` | 동일 (모든 작업자) |
| **Remote** | `origin = https://github.com/jhkim43/reg-detection.git` | 동일 (모든 작업자) |
| **작업자** | deukkyu-tech (예시) | 본인 GitHub 계정 |

---

## 목차

- [1. 사전 점검 (Pre-push Audit)](#1-사전-점검-pre-push-audit)
- [2. 권한·인증 설정](#2-권한인증-설정)
- [3. Push 단계별 명령어](#3-push-단계별-명령어)
  - [3.0 Push 경로 선택 — PR vs Fast-path](#30-push-경로-선택--pr-vs-fast-path)
- [4. PR 생성](#4-pr-생성)
- [5. 후속 정리](#5-후속-정리)
- [6. 충돌·실수 대응](#6-충돌실수-대응)
- [7. 자주 묻는 질문](#7-자주-묻는-질문)

---

## 1. 사전 점검 (Pre-push Audit)

push 전에 반드시 실행. **순서대로 1~5번 모두 통과해야 안전**.

### 1.1 현재 상태 확인

```bash
cd /Users/deukkyu/prjects/regtrack
git status                  # 'working tree clean' 확인
git log --oneline -15       # 우리 10개 commit + base 6개 = 16개
git branch -vv              # feat/spec-and-design 활성
git remote -v               # origin = jhkim43/reg-detection
```

기대 결과:
- 10 commits on `feat/spec-and-design`이 `origin/dev`보다 앞섬
- `git status` clean

### 1.2 우리가 추가한 파일 검토

```bash
# dev 대비 추가/변경된 파일 목록
git diff dev --stat

# 약 12개 신규 파일 + .gitignore 수정 + Project Charter 삭제 예상
```

### 1.3 민감 정보·차터 잔류 확인

```bash
# Project Charter 파일 잔류 검사 (반드시 0건이어야 함)
git ls-files | grep -i "charter" || echo "✅ no charter files"

# 코드/문서 안의 API key·token·전화번호 패턴 검사
git diff dev | grep -iE "(api[_-]?key|secret|password|token|010-[0-9]{4}-[0-9]{4}|@(gmail|naver|skku))" | head -20
# 출력이 있으면 → 민감 정보 누출. push 중단 + 해당 파일 정리
```

### 1.4 .gitignore 작동 확인

```bash
git check-ignore -v vault/ .env.local .DS_Store "Project Charter_4팀_0514.docx" 2>&1
# 각 파일에 대해 어느 패턴이 매치하는지 표시되면 OK
```

### 1.5 harness gates (있으면)

```bash
# 만약 .harness/detect-violations.sh가 실행 가능한 상태면
chmod +x .harness/detect-violations.sh
./.harness/detect-violations.sh || echo "⚠️ gates 실패 — 검토 필요"
```

> M1 단계엔 소스 코드가 없으므로 일부 gate(check-layers, check-boundaries)는 의미 없을 수 있음. M2부터 활성.

---

## 2. 권한·인증 설정

### 2.1 본인이 repo collaborator인지 확인

`jhkim43/reg-detection`은 본인 소유가 아닙니다. **collaborator 권한 또는 fork 후 PR** 필요.

```bash
# 권한 확인 (브라우저)
open https://github.com/jhkim43/reg-detection/settings/access
# 본인(deukkyu-tech)이 보이는지 확인. 안 보이면 PM(팀장)에게 collaborator 추가 요청

# 또는: 본인 계정으로 fork
open https://github.com/jhkim43/reg-detection/fork
```

### 2.2 인증 방식 선택

#### A. HTTPS + Personal Access Token (간단, 권장)

```bash
# GitHub에서 PAT 생성
open https://github.com/settings/tokens/new
# 권한: repo (전체) — 12주 만료 설정

# 첫 push 시 username + PAT 입력
# 또는 keychain에 저장
git config --global credential.helper osxkeychain
```

#### B. SSH (보안 ↑, 1회 세팅 후 편함)

```bash
# SSH 키 확인 또는 생성
ls ~/.ssh/id_ed25519.pub 2>/dev/null || \
  ssh-keygen -t ed25519 -C "deukkyu3751@gmail.com"

# 공개키 복사
pbcopy < ~/.ssh/id_ed25519.pub
# GitHub Settings → SSH and GPG keys → New SSH key (붙여넣기)
open https://github.com/settings/keys

# remote URL을 SSH로 변경
git -C /Users/deukkyu/prjects/regtrack remote set-url origin git@github.com:jhkim43/reg-detection.git

# 테스트
ssh -T git@github.com
```

### 2.3 git user 확인

```bash
git -C /Users/deukkyu/prjects/regtrack config user.name   # deukkyu-tech
git -C /Users/deukkyu/prjects/regtrack config user.email  # deukkyu3751@gmail.com
```

> 위 값으로 commit이 잡혀있는지 확인. 다르면 `git config user.name "..."` 으로 수정.

---

## 3. Push 단계별 명령어

> **모든 명령어는 본인이 직접 실행**. AI는 실행하지 않음.

### 3.0 Push 경로 선택 — PR vs Fast-path

> **GitHub에서 PR이 구조적으로 강제되는 경우는 단 하나**: `dev`(또는 `main`) 브랜치에 **branch protection rule**이 걸려있을 때. 그 외엔 직접 push도 가능.

**우리 §17 Scope Change Governance와 매핑한 권장 경로 (dev 브랜치 기준 — 모두 선택):**

| 변경 크기 | 권장 경로 | 명령 흐름 | 리뷰 | 사용 예시 |
|----------|----------|----------|------|----------|
| **small** (단일 모듈·데이터값) | **Fast-path** | feat branch push → 본인이 dev로 local merge → `git push origin dev` | 본인 1인 | parser_config 튜닝, 오타, 폴링 주기 조정 |
| **medium** (여러 모듈·신규 기능) | **PR 권장** | feat branch push → GitHub PR → 팀원 1+ approve → merge | 1+ approve | 새 게시판 추가, 필터 추가 |
| **large** (MVP·아키텍처) | **PR 권장** (seed-vN 동봉) | feat branch push → GitHub PR → 어드바이저+팀 리뷰 → merge | 어드바이저 + 팀 | FSS → BOK 전환, LLM provider 변경 |

> **dev 브랜치에는 protection 없음** → 어느 크기든 직접 push도 기술적으로 가능.
> 단 medium/large는 **리뷰 누락 시 일정 risk 큼** → PR 사용 권장 (강제 아님).
> `main` 브랜치는 보호 — M5 release 시점에만 PR로 머지.

#### 3.0.1 Fast-path (small 변경) — PR 생략

```bash
# 본인 feat 브랜치에서 작업·커밋
git checkout feat/내작업이름
git add ... && git commit -m "[small] 사유 1줄"

# 1. feat 브랜치 push (백업·기록용)
git push -u origin feat/내작업이름

# 2. dev로 local merge + push
git checkout dev
git pull origin dev                           # 최신 상태 sync
git merge feat/내작업이름 --ff-only           # fast-forward만 허용 (불가 시 PR로 전환)
git push origin dev

# 3. (선택) feat 브랜치 정리
git push origin --delete feat/내작업이름
git branch -d feat/내작업이름
```

**주의:**
- `--ff-only`가 실패하면 dev에 다른 변경이 머지된 상태 → `git rebase origin/dev` 후 다시 시도, 또는 PR 경로로 전환
- commit 메시지 1줄에 `[small] 사유`를 반드시 적기 — §17.2 enforcement
- 본인이 collaborator 권한 있을 때만 가능 (없으면 fork → §3.2)

#### 3.0.2 PR 경로 (medium/large) — 표준 흐름

§3.1 → §3.2 → §3.3 → §4 그대로 따라감. 이번 M1 PR(분석·설계 산출물)이 여기에 해당.

#### 3.0.3 dev 브랜치 protection 확인하는 법

```bash
# gh CLI 있으면
gh api repos/jhkim43/reg-detection/branches/dev/protection 2>&1 | head -5
# {} 또는 404면 보호 없음 (fast-path 가능)
# rules 객체 나오면 보호 있음 (PR 강제됨 — main에 해당)

# 또는 GitHub 웹에서:
# Settings → Branches → Branch protection rules
```

만약 dev에 보호가 걸려 있고 fast-path 시도하면:
```
remote: error: GH006: Protected branch update failed for refs/heads/dev.
```
→ PR 경로(§3.1~§4)로 전환.

#### 3.0.4 운영 정책 (현 상태 + 권장 컨벤션)

- **`main` 브랜치는 보호 ON** — M5 release 시점에만 PR로 머지
- **`dev` 브랜치는 보호 OFF** — 어느 크기든 직접 push 가능. 단 §17.2 분류를 commit 메시지에 명시 (`[small] / [medium] / [large]`)
- medium/large는 **PR 권장** (강제 아님) — 코드 리뷰 + 머지 기록을 남기고 싶을 때 사용

→ 본인 판단으로 fast-path vs PR 선택. **리뷰가 필요한 변경은 PR, 단순 변경은 fast-path**.

---

### 3.1 표준 시나리오 — feat 브랜치 push

```bash
cd /Users/deukkyu/prjects/regtrack

# 안전 점검: 다시 확인
git status                      # clean
git log --oneline -5            # 최신 commit 확인

# push (upstream 설정 포함)
git push -u origin feat/spec-and-design
```

기대 출력:
```
* [new branch]      feat/spec-and-design -> feat/spec-and-design
Branch 'feat/spec-and-design' set up to track 'origin/feat/spec-and-design'.
```

### 3.2 만약 push가 거부됨 — collaborator 아닌 경우

```
remote: Permission to jhkim43/reg-detection.git denied to deukkyu-tech.
```

→ 본인 계정으로 **fork 후 push**:

```bash
# 1. 브라우저에서 fork
open https://github.com/jhkim43/reg-detection/fork

# 2. fork된 repo 주소 (예: github.com/deukkyu-tech/reg-detection)
#    remote에 추가
git -C /Users/deukkyu/prjects/regtrack remote add fork https://github.com/deukkyu-tech/reg-detection.git

# 3. fork로 push
git -C /Users/deukkyu/prjects/regtrack push -u fork feat/spec-and-design

# 4. PR은 fork → jhkim43:dev 으로 (다음 §4)
```

### 3.3 push 후 검증

```bash
# 원격 브랜치 확인
git -C /Users/deukkyu/prjects/regtrack ls-remote --heads origin

# 또는 fork로 push했으면
git -C /Users/deukkyu/prjects/regtrack ls-remote --heads fork

# 브라우저에서 확인
open https://github.com/jhkim43/reg-detection/branches    # collaborator 경우
open https://github.com/deukkyu-tech/reg-detection/branches  # fork 경우
```

---

## 4. PR 생성

### 4.1 PR 대상 결정

- **타겟 브랜치**: `dev` (모든 작업은 먼저 dev로)
- **소스 브랜치**: `feat/spec-and-design` (collaborator) 또는 `deukkyu-tech:feat/spec-and-design` (fork)

### 4.2 GitHub UI에서 PR

```bash
# 브라우저 자동 열기 (collaborator)
open "https://github.com/jhkim43/reg-detection/compare/dev...feat/spec-and-design?expand=1"

# 또는 fork
open "https://github.com/jhkim43/reg-detection/compare/dev...deukkyu-tech:reg-detection:feat/spec-and-design?expand=1"
```

### 4.3 PR 본문 (복사·붙여넣기 권장)

```markdown
# Analysis & Design Documents Phase 1 — 10 commits

## Scope Change Classification
- [x] **medium** — 여러 모듈 영향 (전체 분석/설계 산출물 도입)

## 변경 사유
프로젝트 시작 단계의 분석·설계 문서 일괄 통합.
8개 핵심 문서 + 7개 seed 버전 + 73개 atomic task 분해.

## 연결 항목
- 연결 Task: M1 (W1-W2) 전체
- 연결 AC: AC-001~AC-012 (모든 AC에 대한 명세 + 분해)
- seed 영향: seed-v1~v7 신규 발행

## 포함 내용
### 분석·설계 문서 (docs/)
- `prd/PRD-RegTrack-2026-05-16.md` v4 — Product Requirements
- `trd/TRD-RegTrack-2026-05-16.md` v2 — Technical Reference
- `architecture/ARCHITECTURE-RegTrack-2026-05-16.md` v1 — C4 + 시퀀스
- `data-model/ERD-RegTrack-2026-05-16.md` v1 — SQLite + Obsidian
- `api/API-RegTrack-2026-05-16.md` v1 — REST + WS + Obsidian + OpenRouter
- `demo-scenario/STORYBOARD-RegTrack-2026-05-16.md` v1 — 시연 풀 스크립트
- `risk/RISK-RegTrack-2026-05-16.md` v1 — 17 risk + 12주 갠트
- `llm-cost/LLM-COST-RegTrack-2026-05-16.md` v1 — Qwen3.6 비용 모델
- `integration/PUSH-GUIDE-RegTrack-2026-05-16.md` v1 — 본 PR 절차

### Spec (.harness/ouroboros/)
- `seeds/seed-v1.yaml` ~ `seed-v7.yaml` (immutable spec 진화)
- `tasks/decomposition-2026-05-16.yaml` — 73 atomic tasks
- `interviews/2026-05-16-10-12.yaml` — 인터뷰 결과

### 기타
- `CLAUDE.md`, `ARCHITECTURE_INVARIANTS.md`
- `.claude/` — agents + commands + settings
- `.github/pull_request_template.md` — scope governance §17.2
- `.gitignore` — vault/ + .env.local + Project Charter 패턴 추가

## 체크리스트
- [x] ARCHITECTURE_INVARIANTS.md 4대 절대 규칙 위반 없음 (코드 변경 없음)
- [x] 레이어 분리 영향 없음 (분석/설계만)
- [x] PRD §17 scope governance 정책 정의
- [x] Project Charter 파일 제거 + .gitignore 패턴 (PII 보호)
- [x] OpenRouter API key 등 secret 미포함

## 후속 작업
PR 머지 후:
- M2 (W3-W5) 시작: T-001~T-025 (Data + Crawler)
- 다음 retro에서 R-11 (시연 환경 Windows VM vs Mac) 결정 → seed-v8

## Reviewer 가이드
- 양이 많으므로 영역별 별도 리뷰 권장:
  1. PRD + TRD (전체 그림)
  2. ERD + API (구현 spec)
  3. Risk + Decomposition (실행 plan)
  4. seed-v7 (immutable 최종 상태)
```

### 4.4 GitHub CLI로 PR (gh 설치 시)

```bash
# gh 설치 (옵션)
brew install gh
gh auth login

# PR 생성
gh pr create \
  --base dev \
  --head feat/spec-and-design \
  --title "Analysis & Design Documents Phase 1 — 10 commits" \
  --body-file - <<'EOF'
[위 4.3의 본문 그대로 붙여넣기]
EOF
```

---

## 5. 후속 정리

### 5.1 PR 머지 후 로컬 정리

```bash
cd /Users/deukkyu/prjects/regtrack

# dev 브랜치로 전환 + fetch
git checkout dev
git pull origin dev

# 머지된 feat 브랜치 정리
git branch -d feat/spec-and-design       # local
git push origin --delete feat/spec-and-design   # remote
```

### 5.2 백업 위치 (reg-detection/) 처리 결정

```bash
# 옵션 A: 보존 (백업으로 계속 유지)
ls /Users/deukkyu/prjects/reg-detection/

# 옵션 B: 아카이브
mv /Users/deukkyu/prjects/reg-detection /Users/deukkyu/prjects/_archive/reg-detection-backup-2026-05-16

# 옵션 C: 삭제 (push 검증 후)
# rm -rf /Users/deukkyu/prjects/reg-detection   # ⚠️ 신중!
```

> **권장**: 옵션 B (아카이브). 시연일까지 보존 후 D-day에 옵션 C.

### 5.3 M2 시작 준비

```bash
# 새 작업 브랜치 (T-001부터)
git checkout dev
git pull
git checkout -b feat/m2-data-schema-T001

# 첫 작업: alembic 초기화 등
```

---

## 6. 충돌·실수 대응

### 6.1 push 후 잘못된 commit 발견

```bash
# 케이스: 마지막 commit만 수정
git commit --amend -m "..."
git push --force-with-lease origin feat/spec-and-design
# --force-with-lease는 다른 사람이 그 사이 push했으면 거부 (안전)

# 케이스: 여러 commit 정리
git rebase -i origin/dev    # interactive rebase
git push --force-with-lease origin feat/spec-and-design
```

> ⚠️ `--force` (without `-with-lease`)는 금지. 반드시 `--force-with-lease`.

### 6.2 PR 도중 추가 commit

```bash
# 추가 작업 후
git add ...
git commit -m "..."
git push origin feat/spec-and-design       # 같은 브랜치에 append
# PR이 자동으로 업데이트됨
```

### 6.3 dev가 그 사이 변경됨 (충돌 가능)

```bash
# rebase로 dev 위에 우리 commit 재배열
git fetch origin
git rebase origin/dev

# 충돌 발생 시:
# 1. 충돌 파일 수정
# 2. git add <파일>
# 3. git rebase --continue

# 완료 후 force push
git push --force-with-lease origin feat/spec-and-design
```

### 6.4 PAT 만료/잃어버림

```bash
# 새 PAT 발급
open https://github.com/settings/tokens/new

# keychain 갱신
git credential-osxkeychain erase
# (다음 git push 시 새 PAT 입력 요청)
```

### 6.5 잘못 push한 경우 (긴급 회수)

```bash
# 마지막 push commit 되돌리기 (다른 사람이 pull 안 했다면)
git reset --hard HEAD~1
git push --force-with-lease origin feat/spec-and-design

# 이미 다른 사람이 pull했다면 → revert 사용 (history 보존)
git revert HEAD
git push origin feat/spec-and-design
```

---

## 7. 자주 묻는 질문

### Q1. base repo에 직접 collaborator로 추가받지 못한 경우?

→ §3.2 **fork → PR 흐름**. 본인 fork에 push 후 jhkim43:dev로 PR.

### Q2. nanobot/ 디렉토리 변경한 것이 머지되면 팀원 obsidian skill에 영향 있나?

→ 우리는 nanobot/ 안의 코드를 **수정하지 않음** (분석/설계 문서만 추가). 충돌 없음. 단 M2 이후 nanobot fork 커스터마이징 시작 시 nanobot 안에도 변경 발생 — 그때부터 retro에서 통합 전략 합의 필요.

### Q3. 차터 파일은 어디 보관?

→ 로컬 `/Users/deukkyu/prjects/reg-detection/Project Charter_4팀_0514.docx`에 백업되어 있음. git에는 들어가지 않음. 팀 공유는 Notion·Slack·private vault 등 git 외부 채널.

### Q4. PR 리뷰 받기 전에 다음 작업(M2) 시작해도 되나?

→ **YES**, 단 다음 작업 브랜치는 **현재 PR commit 위에** 만들지 말고 **dev 위에** 만들 것 (PR 거부 시 영향 격리).

```bash
git checkout dev
git checkout -b feat/m2-data-schema-T001     # dev 기반
```

### Q5. push 후 OpenRouter API key가 commit에 들어간 걸 발견하면?

→ 즉시:
```bash
# 1. key 무효화 (OpenRouter UI에서)
open https://openrouter.ai/keys

# 2. git history에서 제거 (git-filter-repo 권장)
brew install git-filter-repo
git filter-repo --invert-paths --path .env.local --force
git push --force-with-lease origin feat/spec-and-design

# 3. 새 key 발급 후 .env.local에 재설정 (gitignore 확인)
```

### Q6. M2 시작 전 어드바이저 리뷰가 필요한가?

→ Risk Register §8.4: **PR 머지 = 어드바이저 리뷰의 비공식 시작**. 정식 리뷰는 M1 게이트(2026-05-25) 직전·직후 advisor 회의에서. PR 머지 자체는 PM 결정.

---

## 8. 명령어 요약 (Cheat Sheet)

```bash
# ───── push 표준 시퀀스 ─────
cd /Users/deukkyu/prjects/regtrack
git status                                        # clean 확인
git ls-files | grep -i charter || echo "ok"      # 차터 없음 확인
git push -u origin feat/spec-and-design          # push

# ───── PR 생성 (브라우저) ─────
open "https://github.com/jhkim43/reg-detection/compare/dev...feat/spec-and-design?expand=1"

# ───── 머지 후 정리 ─────
git checkout dev && git pull
git branch -d feat/spec-and-design
git push origin --delete feat/spec-and-design

# ───── 다음 작업 시작 ─────
git checkout -b feat/m2-data-schema-T001
```

---

## 9. References

- **본 PR의 산출물**: `docs/` 전체 + `.harness/ouroboros/`
- **PR 템플릿**: `.github/pull_request_template.md`
- **Scope Governance**: `docs/prd/PRD-RegTrack-2026-05-16.md` §17
- **Risk Register**: `docs/risk/RISK-RegTrack-2026-05-16.md`
- **GitHub Docs — PR**: https://docs.github.com/en/pull-requests
- **GitHub CLI**: https://cli.github.com/manual/
- **git-filter-repo**: https://github.com/newren/git-filter-repo
