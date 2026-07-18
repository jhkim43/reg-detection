# reg_pipeline 셋업 가이드

> `git pull` 후 이 가이드 한 번이면 일배치 실행까지 됩니다.
> **macOS / Linux / Windows** 모두 지원. 모든 명령은 **regtrack 루트 디렉터리**에서 실행 가정.

---

## 1. OS 의존성 (1회만) — OS별 명령

세 가지를 OS 패키지 매니저로 설치:

| 도구 | 용도 | 크기 |
|---|---|---|
| Java 21 | opendataloader-pdf (PDF → MD) | ~200MB |
| LibreOffice | HWP/DOC/DOCX → PDF 변환 | ~300MB |
| (Chromium은 Python 패키지로 §2에서 같이) | Playwright 크롤링 | ~150MB |

### macOS (Homebrew)
```bash
brew install openjdk@21
brew install --cask libreoffice
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install -y openjdk-21-jdk libreoffice
```

### Linux (Fedora/RHEL)
```bash
sudo dnf install -y java-21-openjdk libreoffice
```

### Windows (winget — Windows 10/11 기본 탑재)
```powershell
winget install Microsoft.OpenJDK.21
winget install TheDocumentFoundation.LibreOffice
```

### Windows (Chocolatey)
```powershell
choco install openjdk21 libreoffice-fresh
```

설치 확인 (모든 OS):
```bash
java --version          # → "openjdk 21.x.x"
# macOS / Linux:
soffice --version
# Windows (PowerShell):
& "C:\Program Files\LibreOffice\program\soffice.exe" --version
```

---

## 2. Python venv + 의존성 (1회만)

### macOS / Linux

#### Option A. 기존 `.venv` 재사용 (권장 — 다른 부분과 같이 씀)
```bash
source .venv/bin/activate
pip install -r obsidian_vault/_tools/requirements.txt
playwright install chromium    # 브라우저 home cache (이미 있으면 skip)
```

#### Option B. 별도 venv 생성
```bash
python3 -m venv .venv-regtrack
source .venv-regtrack/bin/activate
pip install -r obsidian_vault/_tools/requirements.txt
playwright install chromium
```

### Windows (PowerShell)

```powershell
# 기존 .venv 재사용
.\.venv\Scripts\Activate.ps1
pip install -r obsidian_vault\_tools\requirements.txt
playwright install chromium

# 또는 새로 만들기
python -m venv .venv-regtrack
.\.venv-regtrack\Scripts\Activate.ps1
pip install -r obsidian_vault\_tools\requirements.txt
playwright install chromium
```

> PowerShell에서 `Activate.ps1` 실행 정책 오류 나면 한 번만:
> `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

→ 어느 OS / 어느 venv든 의존성만 들어있으면 동작.

---

## 3. PATH 설정 (Java가 PATH에 안 잡힐 때)

opendataloader-pdf 실행 중 `java: command not found` 가 뜨면:

### macOS (Homebrew openjdk@21)
```bash
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
# 영구 적용: ~/.zshrc 또는 ~/.bash_profile에 위 줄 추가
```

### Linux
보통 apt/dnf로 설치하면 자동 PATH. 안 잡히면:
```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
export PATH="$JAVA_HOME/bin:$PATH"
```

### Windows
보통 winget/choco가 자동 설정. 안 잡히면 시스템 환경 변수 `JAVA_HOME` 추가:
```
JAVA_HOME = C:\Program Files\Microsoft\jdk-21.0.x.x-hotspot
PATH      = %JAVA_HOME%\bin;%PATH%
```
PowerShell 세션에서만:
```powershell
$env:Path = "C:\Program Files\Microsoft\jdk-21.0.x.x-hotspot\bin;$env:Path"
```

---

## 4. 환경 변수 (LLM 사용 시)

`regtrack/.env.integration` 파일:
```
OPENROUTER_API_KEY=sk-or-v1-...
```

LLM 호출 없이 mock으로 끝까지 돌리려면 `--no-llm` — API key 불필요.

---

## 5. 첫 실행

```bash
# (macOS/Linux)
source .venv/bin/activate
cd obsidian_vault/_tools
python -m reg_pipeline.daily_batch --since 20260601 --no-llm

# (Windows PowerShell)
.\.venv\Scripts\Activate.ps1
cd obsidian_vault\_tools
python -m reg_pipeline.daily_batch --since 20260601 --no-llm
```

`--no-llm` 으로 먼저 한 번 돌려서 흐름 확인 → 정상이면 `--no-llm` 빼고 본 실행.

---

## 5.1 DeskRPG 일배치 동작 기준

DeskRPG 채팅에서 "외부 규제 수집해줘"와 같이 요청하면
`skills/daily-regtrack-update/run_daily_pipeline.py`가 실행된다.

- 날짜를 지정하지 않으면 **현재 날짜의 5일 전부터 오늘까지** 수집한다.
- 최초 채팅 응답과 수집 Agent 메시지에 실제 수집 기간을 표시한다.
- 변환 단계가 이번 실행에서 새로 생성한 MD 목록을 manifest로 남기고, 분류 이후 단계는 그 문서만 처리한다.
- taxonomy `sub_area` 코사인 유사도 `0.6` 이상 중 `INTERNAL_SUB_AREAS`와 하나 이상 겹치면 영향평가 대상으로 분류한다.
- 실제 내규 후보는 코사인 유사도 `0.30` 이상, 최대 3개를 LLM에 제공한다.
- 영향평가 대상 문서는 점수와 관계없이 `external_wiki`에 보관한다.
- 영향도 **4점 이상**이며 LLM의 `primary_match`와 같은 이름의 내규 파일이 존재하면 해당 `internal_wiki`의 `related_external`과 `# 관련 외규 (자동 갱신)`에 링크를 추가한다.
- 영향도 7점 이상은 `internal_wiki` 진입 기준이 아니라 보고서의 **우선 검토** 등급이다.
- 최종 보고서는 수집 기간, 처리 건수, 영향도 분포, 문서별 핵심 변화·내규 영향·권고 조치·기한을 보여준다.

`internal_wiki` 자동 갱신은 내규 본문이나 조항을 자동 개정하는 작업이 아니다. 검토가 필요한 외규 링크를 내규 문서에 누적하는 작업이다.

---

## 6. 자주 묻는 것

**Q. `ModuleNotFoundError: No module named 'playwright'`**
A. venv 미활성 또는 의존성 미설치. 위 §2 실행.

**Q. `python daily_batch.py` 직접 호출하면 import 깨짐**
A. cwd를 `obsidian_vault/_tools` 로 두고 `python -m reg_pipeline.daily_batch` 형태로 호출.

**Q. opendataloader-pdf 실행 중 `java: command not found`**
A. §3 PATH 설정 참조.

**Q. HWPX 파일이 변환되긴 하지만 `> ⚠️ HWPX fallback 변환` 경고가 뜸**
A. 정상. LibreOffice 26.x가 HWPX 포맷 미지원이라 zipfile fallback 사용. 같은 게시물 본문 PDF가 있으면 그쪽이 더 정확.

**Q. (Windows) `soffice not found` 인데 LibreOffice는 설치됨**
A. 코드가 표준 경로(`C:\Program Files\LibreOffice\program\soffice.exe`)를 자동 탐색하므로 보통 자동. 그래도 안 잡히면 시스템 PATH에 `C:\Program Files\LibreOffice\program` 추가.

**Q. 임베딩 모델 첫 다운로드 (~470MB) 시간이 오래 걸림**
A. 1회만. `~/.cache/huggingface/` (Windows는 `%USERPROFILE%\.cache\huggingface\`) 에 저장되어 재실행 시 즉시 로드.

**Q. 이미 받은 자료를 다시 받고 싶음**
A. vault 산출물만 삭제하면 `.cache/crawl_history.json`의 수집 이력은 남아 동일 게시물을 다시 받지 않는다. 완전한 재수집 테스트가 필요할 때만 해당 이력을 별도로 초기화하고 `external_raw/{source}/`를 비운 후 재실행한다.

---

## 7. 호출 형태 reference

```bash
# 전체 일배치 (1주일치)
python -m reg_pipeline.daily_batch

# 7일 전부터, 한 발행처만
python -m reg_pipeline.daily_batch --since 20260601 --sources pipc

# LLM 비용 없이 산출물 형태 검증 (mock impact_score=5)
python -m reg_pipeline.daily_batch --no-llm

# 변환 단계까지만 (selector 디버깅용)
python -m reg_pipeline.daily_batch --no-classify

# 크롤만 (selector 검증)
python -m reg_pipeline.daily_batch --crawl-only --sources fsc

# 한 발행처만 빠르게
python -m reg_pipeline.crawler.run_one pipc --since 20260601
```
