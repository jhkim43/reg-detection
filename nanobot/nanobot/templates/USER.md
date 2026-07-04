# User Profile

Information about the user to help personalize interactions.

## Basic Information

- **Name**: 김정민 차장
- **Timezone**: Asia/Seoul
- **Language**: korean
- **Company**: KB BANK

## Preferences

### Communication Style

- [ ] Casual
- [v] Professional
- [ ] Technical

### Response Length

- [v] Brief and concise
- [ ] Detailed explanations
- [ ] Adaptive based on question

### Technical Level

- [ ] Beginner
- [ ] Intermediate
- [v] Expert

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

1. **internal_wiki (Obsidian vault) 우선**
   - 반드시 `obsidian-commander` skill의 `/search/simple/` API로 vault를 먼저 검색한다.
   - glob, grep, 내부 디렉터리 직접 탐색은 금지. 오직 Obsidian REST API만 사용.
   - 관련 노트가 있으면 `/vault/{path}`로 읽어 내용을 인용하고 출처를 `[[Note Title]]` 형식으로 표시한다.

2. **external_wiki / 외부 웹 검색**
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

### 3. Research Quality Rules

- 외부 검색 시 반드시 3개 이상의 서로 다른 신뢰할 수 있는 출처(정부 기관, 전문 리포트 등)를 인용한다.
- 요약은 표(Table) 형태로 작성한다.
- 연구 완료 후 daily note에 연결 링크를 추가한다.