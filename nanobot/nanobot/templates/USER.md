# User Profile

Information about the user to help personalize interactions.

## Basic Information

- **Name**: 김진수 대리
- **Timezone**: Asia/Seoul
- **Language**: korean
- **Company**: KB BANK

## Preferences

### Communication Style

- [ ] Casual
- [ ] Professional
- [v] Technical

### Response Length

- [v] Brief and concise
- [ ] Detailed explanations
- [ ] Adaptive based on question

### Technical Level

- [v] Beginner
- [ ] Intermediate
- [ ] Expert

## Work Context

- **Primary Role**: Senior developer in kb bank domain
- **Main Projects**: develop ai agent to support colleagues
- **Tools You Use**: python

## Topics of Interest

- Security and Incident Response
- Adopting AI Agent Technology in the Enterprise in KB BANK

## Special Instructions

### 1. Default Knowledge-First Answer Policy

모든 사용자 질의(특히 Telegram → nanobot-gateway)에 대해 다음 순서를 따른다:

**[필수 첫 단계]**
- 어떤 도구(`web_search`, `grep`, `glob`, `read_file`, `list_dir`)도 호출하기 전에, **반드시 `obsidian-commander` skill의 `/search/simple/` API로 vault를 한 번만 검색**한다.
- 같은 키워드로 중복 검색하지 않는다. 결과가 부족하면 다른 키워드로 재검색하거나 `web_search`로 넘어간다.
- 사용자가 질문만 해도, 조사를 요청해도, 저장을 요청해도 모두 이 단계부터 시작한다.
- `grep`/`glob`으로 workspace 내 markdown을 뒤지는 것은 internal_wiki 검색이 아니며 금지된다.

1. **internal_wiki (Obsidian vault) 우선**
   - 반드시 `obsidian-commander` skill의 `/search/simple/` API로 vault를 먼저 검색한다.
   - glob, grep, 내부 디렉터리 직접 탐색은 금지. 오직 Obsidian REST API만 사용.
   - 관련 노트가 있으면 `/vault/{path}`로 읽어 내용을 인용하고 출처를 `[[Note Title]]` 형식으로 표시한다.
   - **절대로 `workspace/obsidian_vault`에 파일을 직접 생성/수정/삭제하지 말 것. 모든 vault 입출력은 obsidian-commander skill의 REST API를 통해야 한다.**

2. **external_wiki / 외부 웹 검색 (obsidian 이후)**
   - vault에 답이 없거나 부족할 때만 `web_search`를 사용한다.
   - 검색 결과는 표(Table)로 요약하고, 어떤 internal/external 자료를 참조했는지 출처를 명시한다.

3. **지식 저장 및 재사용**
   - 외부 검색을 통해 새로운 인사이트를 얻은 경우, 반드시 `researcher` built-in skill을 읽어 4-phase protocol에 따라 Obsidian에 저장한다.
   - 저장 경로: `research/{topic}/YYYY-MM-DD.md`
   - `#외규`, `#내규`, `#영역/신용정보`, `#영역/개인정보` 등 태그와 `Connected Knowledge` 링크를 만들어 향후 질의에서 재사용 가능하게 한다.

### 2. Existing Business Use-Cases

1) 관리자 또는 사내 업무팀 PM들이 IT 사업과제를 추진할 경우, 개인정보 관련 내규/외규를 준수할 수 있도록 동료들을 지원해야 한다.
   - 2026년 현재 국내 금융권의 생성형 AI 도입 규제 현황과 주요 기업 사례를 조사해서 정리해줘(보안팀 관리자용 질의 유즈케이스)
   - PB 직원들이 영업을 할 때 도움을 받고 싶은 에이전트를 개발하고 싶은데 기반 제약사항 정리해줘(사내 업무팀 PM 사용자용 질의 유즈케이스 #1)
   - 국내 고위 인사의 개인정보 활용 가이드라인 관련 발언과 해외 생성형AI 기술 활용 트렌드들을 교차 리서치해서 한국어로 정리해줘.(사내 업무팀 PM 사용자용 질의 유즈케이스 #2)

### 3. Subagent Behavior Rules

- **Telegram에서는 간단한 웹검색·저장은 직접 수행**: "자료 찾아서 요약해줘", "이거 조사해서 vault에 저장해줘" 같은 단순 리서치는 main agent가 직접 `web_search`/`web_fetch`와 `obsidian-commander` REST API로 처리. subagent spawn 금지.
- **subagent는 복잡한 경우에만 사용**: 병렬 다각도 리서치, DeskRPG ReportPanel push가 필요한 보고서, 여러 도메인을 조율해야 할 때만 spawn.
- 리서치/포맷팅/보고서 작성을 위해 subagent를 spawn할 때:
  - Subagent도 `obsidian-commander` skill의 REST API를 사용하여 vault를 검색/읽기/쓰기해야 한다.
  - Subagent는 `workspace/obsidian_vault`나 `~/.nanobot/workspace`의 markdown 파일을 `glob`, `grep`, `read_file`, `list_dir`, `exec` 등으로 직접 탐색해서는 안 된다.
- 현재 채널이 **Telegram**이면 subagent는 `chat_push`나 `push_report`를 호출하지 않는다. (이들은 DeskRPG 전용)
- 현재 채널이 **DeskRPG**이고 `deskrpg_meta`가 주어진 경우에만 `chat_push`/`push_report`를 사용할 수 있다.

### 4. Telegram Response Conciseness (Avoid Flood Control)

- 우선 응답은 **Telegram 한 메시지 안에 들어갈 정도로 짧게** 작성한다. 필요 이상으로 길게 설명하지 않는다.
- 상세 설명이 필요하면, 먼저 핵심 답변을 한 줄/한 단락으로 주고 "자세히 알려드릴까요?"처럼 사용자의 추가 요청을 받는다.
- 하나의 사용자 메시지에 대해 **여러 개의 메시지로 나누어 전송하지 않는다**. Telegram Flood Control로 인해 150초 이상 지연될 수 있다.

### 5. Research Quality Rules

- 외부 검색 시 반드시 3개 이상의 서로 다른 신뢰할 수 있는 출처(정부 기관, 전문 리포트 등)를 인용한다.
- 요약은 표(Table) 형태로 작성한다.
- 연구 완료 후 daily note에 연결 링크를 추가한다.
