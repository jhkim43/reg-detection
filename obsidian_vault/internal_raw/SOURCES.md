# 내규 갈음 원천 자료 출처 (SOURCES)

> 은행 내규(개인정보보호/정보보안 영역)를 실제로 반출하기 어려워, **공개된 외부 자료로 갈음**한 raw 파일 모음입니다.
> 본 폴더의 파일은 회사 내규의 **모태가 되는 표준·고시·가이드**로, 외규 영향도 분석의 베이스라인 역할을 합니다.

| 항목 | 값 |
|---|---|
| 정리일 | 2026-06-06 |
| 대상 도메인 | 개인정보보호, 정보보안 |
| 타겟 업권 | 은행 |
| 폴더 위치 | `obsidian_vault/internal_raw/` |

---

## 1. 다운로드 방법

### A. curl 직접 다운로드 (정적 파일)

금융위 첨부파일 URL 패턴은 그대로 `curl -L -o` 가능:

```bash
curl -L -o "전자금융감독규정_제2025-4호_20250205.pdf" \
  "https://www.fsc.go.kr/comm/getFile?srvcId=BBSTY1&upperNo=83957&fileTy=ATTACH&fileNo=6"
```

### B. Playwright 자동화 스크립트 (동적 페이지)

JavaScript 동적 로딩 사이트(law.go.kr, PIPC, FSEC, KB은행)는 본 폴더의 `_download.py` 사용:

```bash
# 1회 설치 (시스템 영향 없이 venv에 격리)
python3 -m venv /tmp/playwright-venv
/tmp/playwright-venv/bin/pip install playwright
/tmp/playwright-venv/bin/playwright install chromium

# 실행
/tmp/playwright-venv/bin/python obsidian_vault/internal_raw/_download.py
```

→ 5건이 자동으로 `internal_raw/`에 저장됨.

---

## 2. 다운로드 완료 파일 — 전체 14건

### 2.1 정적 첨부파일 (curl 다운로드, 9건)

| # | 파일명 | 발행처 | 발행일 | 매칭 내규 | 원본 페이지 | 직접 다운로드 URL |
|---|---|---|---|---|---|---|
| 1 | `금융분야_개인정보보호_가이드라인_개정본_20170224.pdf` | 금융위 + 금감원 | 2017-02-24 | 개인정보 처리방침·운영 상위 정책 | https://www.fsc.go.kr/po010101/72612 | https://www.fsc.go.kr/comm/getFile?srvcId=BBSTY1&upperNo=72612&fileTy=ATTACH&fileNo=1 |
| 2 | `금융분야_개인정보보호_가이드라인_보도자료_20170224.pdf` | 금융위 | 2017-02-24 | (보조 — 발표 안내문) | 위와 동일 | https://www.fsc.go.kr/comm/getFile?srvcId=BBSTY1&upperNo=72612&fileTy=ATTACH&fileNo=3 |
| 3 | `금융분야_개인정보보호_가이드라인_보도자료_20170224.hwp` | 금융위 | 2017-02-24 | (보조 — HWP) | 위와 동일 | https://www.fsc.go.kr/comm/getFile?srvcId=BBSTY1&upperNo=72612&fileTy=ATTACH&fileNo=2 |
| 4 | `전자금융감독규정_제2025-4호_20250205.pdf` | 금융위 (고시) | 2025-02-05 | 정보보안 업무규정 / IT부문 안전성 | https://www.fsc.go.kr/po040200/83957 | https://www.fsc.go.kr/comm/getFile?srvcId=BBSTY1&upperNo=83957&fileTy=ATTACH&fileNo=6 |
| 5 | `전자금융감독규정_일부개정고시안_20250205.pdf` | 금융위 | 2025-02-05 | (보조 — 개정 본문) | 위와 동일 | https://www.fsc.go.kr/comm/getFile?srvcId=BBSTY1&upperNo=83957&fileTy=ATTACH&fileNo=4 |
| 6 | `신용정보업감독규정_제2025-1호_20250121.pdf` | 금융위 (고시) | 2025-01-21 | 신용정보 관리지침 | https://www.fsc.go.kr/po040200/83894 | https://www.fsc.go.kr/comm/getFile?srvcId=BBSTY1&upperNo=83894&fileTy=ATTACH&fileNo=2 |
| 7 | `신용정보업감독규정_일부개정고시안_20250121.pdf` | 금융위 | 2025-01-21 | (보조 — 개정 본문) | 위와 동일 | https://www.fsc.go.kr/comm/getFile?srvcId=BBSTY1&upperNo=83894&fileTy=ATTACH&fileNo=4 |
| 8 | `금융분야_망분리_개선_로드맵_20240813.pdf` | 금융위 | 2024-08-13 | 망분리 운영 정책 (최신 방향) | https://www.fsc.go.kr/no010101/82885 | https://www.fsc.go.kr/comm/getFile?srvcId=BBSTY1&upperNo=82885&fileTy=ATTACH&fileNo=4 |
| 9 | `금융전산_망분리_가이드라인_2014.hwp` | 금융위 | 2014 | 망분리 운영 기본 (구 가이드) | https://www.fsc.go.kr/po010101/70834 | https://www.fsc.go.kr/comm/getFile?srvcId=BBSTY1&upperNo=70834&fileTy=ATTACH&fileNo=1 |

### 2.2 Playwright 자동화 다운로드 (5건)

| # | 파일명 | 발행처 | 발행일 | 매칭 내규 | 원본 페이지 | 다운로드 방식 |
|---|---|---|---|---|---|---|
| 10 | `개인정보안전성확보조치기준_제2021-2호.pdf` | 개인정보위 (고시) | 2021-09-15 | 안전성 확보조치 지침 | https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000204677 | Playwright `page.pdf()` (행정규칙 본문 렌더링 → PDF) |
| 11 | `금융회사정보처리업무위탁규정_제2021-9호.pdf` | 금융위 (고시) | 2021-03-25 | 처리위탁 관리지침 | https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000200327&chrClsCd=010201 | Playwright `page.pdf()` |
| 12 | `개인정보안전성확보조치기준해설서_2020-2호.pdf` | 개인정보위 | 2020-12 | (위 10번 해설서) | https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=7045 | Playwright 클릭 다운로드 (selector: `a:has-text('다운로드')`) |
| 13 | `금융분야클라우드컴퓨팅서비스이용가이드_2025개정.pdf` | 금융보안원 (FSI) | 2025-05-22 | 클라우드 보안 지침 | https://www.fsec.or.kr/bbs/detail?menuNo=222&bbsNo=11691 | Playwright 클릭 다운로드 (selector: `.pdf`) |
| 14 | `KB은행_개인정보처리방침_표준_20260606.pdf` | KB국민은행 | 2025-12-11 개정 | 처리방침 (실제 은행 샘플) | https://obank.kbstar.com/quics?page=C110564 | Playwright `page.pdf()` |

---

## 3. 매칭 내규별 대표 자료 (분석 우선순위)

각 영역별로 **분석에 우선 사용할 main 자료** (개정안·보도자료 등 보조 자료는 audit trail용):

| 회사 내규 영역 | 대표 자료 (main) |
|---|---|
| 개인정보 처리방침 (상위) | 1번 (금융분야 개인정보보호 가이드라인) |
| 개인정보 처리방침 (실 사례) | 14번 (KB은행 처리방침) |
| 안전성 확보조치 | 10번 + 12번 (해설서) |
| 처리위탁 관리 | 11번 (정보처리 업무 위탁 규정) |
| 신용정보 관리 | 6번 (신용정보업감독규정) |
| 정보보안 업무 (IT 안전성) | 4번 (전자금융감독규정) |
| 클라우드 보안 | 13번 (FSEC 클라우드 가이드) |
| 망분리 운영 | 8번 (망분리 개선 로드맵) + 9번 (구 가이드라인) |

---

## 4. 폴더 컨벤션

```
obsidian_vault/
├── raw/                  ← (기존, 다른 팀원) 외규 raw 보도자료 .md
├── wiki/                 ← (기존, 다른 팀원) 외규 분류 wiki
└── internal_raw/         ← (이 폴더) 내규 갈음 원천 자료
    ├── SOURCES.md        ← 이 파일
    ├── _download.py      ← Playwright 자동화 스크립트 (재실행 가능)
    └── *.pdf, *.hwp      ← 다운로드된 raw 파일들 (14건)
```

> ※ 폴더 위치는 협의 후 변경 가능. 일단 외규(raw/, wiki/)와 명확히 분리하기 위해 `internal_raw/`로 둠.

---

## 5. 발행처 사이트 (외규 크롤링 대상이기도 함)

| 발행처 | URL |
|---|---|
| 금융위원회 (FSC) | https://www.fsc.go.kr |
| 금융감독원 (FSS) | https://www.fss.or.kr |
| 금융보안원 (FSI) | https://www.fsec.or.kr |
| 신용정보원 (KCIS) | https://www.kcredit.or.kr |
| 개인정보보호위원회 (PIPC) | https://www.pipc.go.kr |
| 국가법령정보센터 | https://www.law.go.kr |

---

## 6. 참고 — 다운로드 URL 패턴

### 금융위 (fsc.go.kr)

```
/comm/getFile?srvcId=BBSTY1&upperNo={게시글ID}&fileTy=ATTACH&fileNo={N}
```

- 게시글ID: 페이지 URL 끝의 숫자 (예: `/po010101/72612` → `72612`)
- fileNo: 첨부파일 순번 (1부터)

### 법제처 (law.go.kr)

```
/LSW/admRulLsInfoP.do?admRulSeq={N}       # 행정규칙 상세 (메인)
/LSW/admRulInfoP.do?admRulSeq={N}         # 행정규칙 정보 (대체 path)
```

→ JavaScript 동적 로딩이라 `curl` 불가. Playwright로 렌더링 후 `page.pdf()` 권장.

### 개인정보위 (pipc.go.kr)

```
/np/cop/bbs/selectBoardArticle.do?bbsId={게시판ID}&mCode={메뉴}&nttId={게시글ID}
```

- 첨부파일 다운로드 링크는 `<a>` 태그 안에 `다운로드` 텍스트로 표시
- Playwright selector: `a:has-text('다운로드')`

### 금융보안원 (fsec.or.kr)

```
/bbs/detail?menuNo={메뉴}&bbsNo={게시글ID}
```

- 첨부파일이 JavaScript onclick으로 다운로드 트리거
- Playwright selector: `a:has-text('.pdf')` 같은 파일명 매칭

### KB은행 (obank.kbstar.com)

```
/quics?page={페이지코드}
```

- 페이지코드 C110564 = 표준 개인정보 처리방침
- SPA 구조, 페이지 자체를 PDF로 저장하는 게 가장 안정적

---

## 7. 정합성 확인

받은 파일 hash 검증:

```bash
shasum -a 256 *.pdf *.hwp
```

원본 페이지 재방문 후 동일 hash 비교로 위·변조 확인 가능.

---

## 8. 갱신 (다음 사이클)

원천 자료는 시간이 지나면서 개정됩니다. 신규 자료 추가/갱신 시:

1. 본 SOURCES.md 표에 항목 추가
2. 정적 파일이면 curl, 동적 페이지면 `_download.py`에 추가
3. 기존 파일 갱신 시 파일명에 새 발행일 prefix (예: `..._20260615.pdf`) + 구버전은 `archived/`로 이동
