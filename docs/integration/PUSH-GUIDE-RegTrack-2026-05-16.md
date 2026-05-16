# Push & Integration Guide — RegTrack

> **목적**: 로컬에서 작성한 분석/설계 산출물을 base repo(`jhkim43/reg-detection`)에 안전하게 push + PR 생성하는 가이드.
> **대상**: 이득규 (deukkyu-tech) — 본인이 직접 실행. AI는 가이드만 제공.

| 항목 | 내용 |
|------|------|
| **버전** | v1 |
| **작성일** | 2026-05-16 |
| **현재 위치** | `/Users/deukkyu/prjects/regtrack/` |
| **현재 브랜치** | `feat/spec-and-design` |
| **타겟 브랜치** | `dev` (먼저 PR) → 나중에 `main` |
| **Remote** | `origin = https://github.com/jhkim43/reg-detection.git` |

---

## 목차

- [1. 사전 점검 (Pre-push Audit)](#1-사전-점검-pre-push-audit)
- [2. 권한·인증 설정](#2-권한인증-설정)
- [3. Push 단계별 명령어](#3-push-단계별-명령어)
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
# 본인(deukkyu-tech)이 보이는지 확인. 안 보이면 PM(김지효)에게 collaborator 추가 요청

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
