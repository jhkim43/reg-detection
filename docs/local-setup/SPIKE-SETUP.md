# Walking Skeleton Spike — 로컬 셋업 가이드

> **목적**: deskrpg + nanobot walking skeleton spike를 본인 PC에서 재현하기 위한 명령어 모음
> **대상**: 팀원 전원 (macOS·Windows·Linux). 정식 통합 전 spike 확인 시.
> **작성일**: 2026-05-16
> **선행 자료**: [DESKRPG-GATEWAY-INTEGRATION.md](../code-map/DESKRPG-GATEWAY-INTEGRATION.md) §9 (spike 검증 결과)

> ⚠ **폐기 예정**: M3 docker-compose 통합(T-069) 완료 후 본 문서는 삭제됩니다.
> 그때부터는 `docker-compose up` 한 줄로 끝남.

---

## 0. 필수 사전 조건

| 도구 | 버전 | 설치 |
|------|------|------|
| Git | latest | macOS·Linux: 기본 / Windows: [git-scm.com](https://git-scm.com) |
| Node.js | **20.x** (deskrpg `Dockerfile FROM node:20-bookworm-slim` 기준) | **반드시 격리** — system Node와 충돌 회피 |
| Python | **3.11+** (nanobot `requires-python = ">=3.11"`) | macOS Python 3.9는 부족 |
| OpenRouter API Key | sk-or-v1-... | 팀장에게 요청 |

---

## 1. 격리 도구 설치 (OS별)

### macOS (검증됨)

```bash
brew install fnm           # Node 버전 매니저
brew install python@3.12   # 또는 3.11

# fnm shell 통합 (~/.zshrc에 한 번만)
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc
source ~/.zshrc
```

### Windows (검증 필요 — 시도 시 결과 본인 팀 채팅에 공유 부탁)

```powershell
# PowerShell (관리자)
winget install Schniz.fnm                    # Node 버전 매니저
winget install Python.Python.3.12             # Python 3.12

# fnm shell 통합 (PowerShell profile)
notepad $PROFILE
# 파일에 추가: fnm env --use-on-cd | Out-String | Invoke-Expression
```

대안:
- **WSL2 Ubuntu 사용** — macOS 명령 그대로 사용 가능, native 차이 거의 없음 (권장)
- 또는 scoop·choco 사용

### Linux

```bash
curl -fsSL https://fnm.vercel.app/install | bash
# (~/.bashrc 또는 ~/.zshrc에 eval "$(fnm env --use-on-cd)" 추가)

sudo apt install python3.12 python3.12-venv     # Ubuntu/Debian
```

---

## 2. Repo Clone + 디렉토리 진입

```bash
git clone https://github.com/jhkim43/reg-detection.git regtrack
cd regtrack
git checkout dev
git pull origin dev
```

---

## 3. nanobot 셋업 (Python venv 격리)

```bash
# venv 생성 (Python 3.12 사용)
python3.12 -m venv .venv

# 활성화 (매 새 터미널마다)
source .venv/bin/activate                # macOS / Linux / WSL
# .venv\Scripts\activate                  # Windows PowerShell (백슬래시 주의)

# pip 업그레이드
pip install --upgrade pip

# nanobot fork editable install (우리 repo의 nanobot/ 사용)
pip install -e ./nanobot

# 동작 확인
nanobot --version                        # 🐈 nanobot v0.1.5.post3
```

### nanobot config (한 번만)

```bash
mkdir -p ~/.nanobot                      # Linux/macOS
# Windows: mkdir %USERPROFILE%\.nanobot

# config.json 작성
cat > ~/.nanobot/config.json <<'EOF'
{
  "providers": {
    "openrouter": {
      "apiKey": "sk-or-v1-팀장에게-받은-key"
    }
  },
  "agents": {
    "defaults": {
      "provider": "openrouter",
      "model": "qwen/qwen3.6-35b-a3b"
    }
  },
  "channels": {
    "websocket": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 8765,
      "allowFrom": ["*"],
      "websocketRequiresToken": false
    }
  }
}
EOF
```

> ⚠ **`apiKey`는 본인이 받은 실제 값으로 교체**. 이 파일은 `~/.nanobot/` 안이라 git에 안 올라감.
> 정식 production에선 `websocketRequiresToken: true` + token 발급. spike엔 false.

---

## 4. deskrpg 셋업 (Node 격리 + SQLite)

```bash
cd deskrpg                               # regtrack 안의 deskrpg/ — clone 단계에서 자동으로 생성 (subtree/submodule 아님, 별도 clone 필요할 수 있음)

# deskrpg가 regtrack/ 안에 없으면 별도 clone:
# git clone https://github.com/dandacompany/deskrpg.git
# (deskrpg/는 RegTrack .gitignore에 등록되어 RegTrack git에 미포함)

# .nvmrc 작성 (cd 시 자동 Node 20 전환)
echo "20" > .nvmrc

# Node 20 설치 + 사용
fnm install 20
fnm use 20
node --version                           # v20.x.x 나와야 함

# 의존성 설치 (5~10분)
npm install

# SQLite 모드 셋업 (PostgreSQL 미사용)
# ⚠ upstream `npm run setup:lite`에 경로 버그 있음 — 아래 수동 절차 사용
cat > .env.local <<'EOF'
JWT_SECRET=spike-only-jwt-secret-change-before-prod-padding-padding-padding-pad
DB_TYPE=sqlite
SQLITE_PATH=data/deskrpg.db
EOF
mkdir -p data
DB_TYPE=sqlite SQLITE_PATH=data/deskrpg.db \
  npx drizzle-kit push --config=drizzle-sqlite.config.ts --force

# 동작 확인 (data/deskrpg.db 파일 + 27 테이블 생성됨)
ls data/deskrpg.db
```

---

## 5. Spike 컴포넌트 (NanobotChat) 활성화

> ⚠ **NanobotChat.tsx는 spike 전용 컴포넌트**. 본인이 직접 작성해야 함 (deskrpg/는 RegTrack git 미포함).
> 참고: [DESKRPG-GATEWAY-INTEGRATION.md §6](../code-map/DESKRPG-GATEWAY-INTEGRATION.md#6-스파이크-우회-구현--1-2h-작업-계획) 의 spike 우회 구현 코드 예시.

요약:
1. `deskrpg/src/components/NanobotChat.tsx` 생성 (위 §6 코드 복붙)
2. `deskrpg/src/app/game/GamePageClient.tsx` 메인 return 안에 `<NanobotChat />` 1줄 + import 1줄

---

## 6. 두 서비스 동시 실행

**터미널 2개 필요** — 동시에 띄움.

### 터미널 A — deskrpg

```bash
cd regtrack/deskrpg
npm run dev
# 로그: > Dev server ready on http://localhost:3000
```

### 터미널 B — nanobot

```bash
cd regtrack
source .venv/bin/activate                # 매 새 터미널마다 필수
nanobot gateway
# 로그: ✓ WebSocket server listening on ws://127.0.0.1:8765/
```

---

## 7. 브라우저에서 확인

1. http://localhost:3000 접속
2. 가입 → 캐릭터 만들기 → 캐릭터 카드 클릭
3. 채널 만들기 → 입장
4. 우측 하단 **🐈 nanobot · <캐릭터> @ <채널>** 박스 (status: open)
5. 메시지 입력 → Enter
6. Qwen 응답 streaming 표시 + 캐릭터 이름 자연스럽게 호칭

---

## 8. ⚠ Token 사용 경고 (중요)

**`nanobot gateway` 떠있는 동안에도 백그라운드 LLM 호출이 발생**합니다:
- **Cron job `dream`**: 2시간마다 (background reflection)
- **Heartbeat**: 30분마다 (task 진행 체크)
- 채팅·메시지 송수신 외에도 `~/.nanobot/workspace/sessions/*.token.json`에 사용량 기록

### 우리 예산 (PRD AC-008)

- **총 예산: $100 / 2.5개월**
- 임계: $30 YELLOW / $60 ORANGE / $90 RED → BUDGET_EXCEEDED 차단
- Qwen은 저렴($0.15/$1.00 per 1M tokens)이라 1시간 idle gateway는 약 $0.01

### 본인 사용량 확인

```bash
# 현재 사용량 (모든 채널·세션 합계)
cat ~/.nanobot/workspace/sessions/*.token.json 2>/dev/null \
  | jq -s 'map(.totals.total_tokens) | add // 0'

# 또는 ls로 빠르게
ls -la ~/.nanobot/workspace/sessions/
```

### 작업 끝났을 때 종료 (필수)

| 무엇 | 명령 |
|------|------|
| **nanobot gateway 종료** (token 소비 막음 — 가장 중요) | `lsof -ti:8765 \| xargs kill` (Linux/macOS) <br> Windows: `Get-Process \| Where-Object {$_.Name -like "*python*"} \| Stop-Process` 또는 터미널에서 Ctrl+C |
| **deskrpg dev server 종료** | 터미널 A에서 Ctrl+C |
| **venv 빠져나옴** | `deactivate` |

### 본인이 PC 떠나기 전에

```bash
# 한 줄 점검
lsof -ti:8765 -ti:3000 -ti:18790 2>/dev/null | xargs -r kill && echo "✓ all stopped"
```

---

## 9. 자주 묻는 질문

| 증상 | 원인 / 해결 |
|------|-----------|
| `nanobot: command not found` | venv 활성화 안 함 → `source .venv/bin/activate` |
| `Python 3.9.6` (macOS system) | `python3.12 -m venv .venv`로 재생성 |
| `better-sqlite3 was compiled against...` | npm install·실행 시 같은 Node 버전 사용 (.nvmrc=20 + fnm use) |
| WS error 401 | `~/.nanobot/config.json`에 `"websocketRequiresToken": false` 추가 |
| WS error closed | nanobot gateway 안 떠있음 → 터미널 B 확인 |
| 응답 없음 (status: open인데 무반응) | OpenRouter key 잘못됨 또는 quota 초과 → nanobot gateway 로그 확인 |
| 채널 입장 후 ECONNREFUSED | SQLite 셋업 미완 → §4 마지막 명령 다시 |
| 채널 만들기 화면 안 보임 | URL `http://localhost:3000/characters` → 카드 클릭 → `?characterId=...` 자동 부여됨 |
| 캐릭터 안 보임 | localhost:3000/characters/create 직접 접속 |

---

## 10. Spike 검증 체크리스트

본인 PC에서 다음 5개 다 ✓ 표시면 spike 통과:

- [ ] deskrpg dev server (port 3000) 정상 실행
- [ ] nanobot gateway (port 8765 WS + 18790 health) 정상 실행
- [ ] 브라우저에서 캐릭터·채널·맵 진입
- [ ] NanobotChat 박스 status: open (초록)
- [ ] 메시지 입력 → Qwen 응답 (캐릭터 이름 호칭 포함)

→ 통과 시 본인 팀 채팅에 "spike OK on 본인PC (macOS|Windows|Linux)" 공유 부탁.
→ 막힌 부분 있으면 화면·로그 캡처 + 채팅에 공유.

---

## 11. 다음 (정식 통합 — M3-M4)

- 이 spike는 통신 가능성 검증만
- 실제 NPC dialog bubble·회의 디지스트·Citation은 정식 통합에서
- 진입 자료: [DESKRPG-GATEWAY-INTEGRATION.md](../code-map/DESKRPG-GATEWAY-INTEGRATION.md) §10 체크리스트
- M3 docker-compose 통합(T-069) 완료 후 본 문서 삭제 + `docker-compose up` 한 줄로 대체
