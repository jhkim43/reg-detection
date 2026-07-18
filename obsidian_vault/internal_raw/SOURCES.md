# 내규 갈음 원천 자료 출처 (SOURCES)

> 회사 내규 반출 불가로 **시중은행 4곳 공개 처리방침**으로 갈음.
> 시중은행이 실제 운영 중인 처리방침은 우리 회사 내규의 가장 가까운 모델.

| 항목 | 값 |
|---|---|
| 정리일 | 2026-06-06 |
| 대상 도메인 | 개인정보보호 (처리방침) |
| 타겟 업권 | 은행 |
| 폴더 위치 | `obsidian_vault/internal_raw/` |
| 자료 수 | 4건 (KB·카카오·하나·토스) |

---

## 1. 다운로드 방법

시중은행 처리방침은 모두 HTML 페이지 (SPA). `_download.py` (Playwright) 사용:

```bash
# 1회 설치 — 자세히는 obsidian_vault/_tools/SETUP.md 참조
source .venv/bin/activate
pip install -r obsidian_vault/_tools/requirements.txt
playwright install chromium

# 실행 (4건 자동)
python obsidian_vault/internal_raw/_download.py
```

→ `page.pdf()`로 렌더링된 페이지를 PDF로 저장.

---

## 2. 자료 4건

| # | 파일명 | 발행처 | 종류 | 원본 URL |
|---|---|---|---|---|
| 1 | `KB은행_개인정보처리방침_20260606.pdf` | KB국민은행 | 시중은행 | https://obank.kbstar.com/quics?page=C110564 |
| 2 | `카카오뱅크_개인정보처리방침_20260606.pdf` | 카카오뱅크 | 인터넷전문은행 | https://www.kakaobank.com/Corp/Policy/Privacy/ManagementPolicy |
| 3 | `하나은행_개인정보처리방침_20260606.pdf` | 하나은행 | 시중은행 | https://www.kebhana.com/cont/customer/customer06/customer0604/index.jsp |
| 4 | `토스뱅크_개인정보처리방침_20260606.pdf` | 토스뱅크 | 인터넷전문은행 | https://www.tossbank.com/customer/information/privacy/privacy-policy |

### 미수집 (추후 보강)

| 은행 | 사유 | 상태 |
|---|---|---|
| 신한은행 | 표준 URL 못 찾음 (oldm.shinhan.com SSL 오류) | v13에서 재시도 |

---

## 3. 영역 분류 (sub_area)

시중은행 처리방침은 모두 동일 영역 커버 (공통 sub_area):

| sub_area | 설명 |
|---|---|
| 수집동의 | 제1·3조 (처리목적, 처리항목) |
| 처리위탁 | 제6조 |
| 제3자제공 | 제5조 |
| 안전성조치 | 제10조 |
| 신용정보 | 신용정보법 적용 (전체) |
| 개인정보 | 본문 전체 (개인정보보호법 적용) |

→ 4건 모두 6개 sub_area 매칭. MOC도 6개 생성됨.

---

## 4. 폴더 컨벤션

```
obsidian_vault/
├── internal_raw/                 (이 폴더) PDF 원본 + SOURCES.md + _download.py
├── internal_raw_md/              opendataloader 추출본 (4건)
└── internal_wiki/                요약·메타·MOC (4 wiki + 6 MOC)
    ├── _convert.py
    ├── _MOC/                      6 MOC (수집동의·처리위탁·제3자제공·안전성조치·신용정보·개인정보)
    └── 개인정보/                   4 wiki
```

---

## 5. 발행처별 비교 (4 은행)

| 항목 | KB국민은행 | 카카오뱅크 | 하나은행 | 토스뱅크 |
|---|---|---|---|---|
| 유형 | 4대 시중은행 | 인터넷전문은행 | 시중은행 | 인터넷전문은행 (핀테크) |
| 채널 | 대면+비대면 | 비대면 중심 | 대면+비대면 | 비대면 only |
| 그룹 | KB금융그룹 | 카카오 계열 | 하나금융그룹 | 비바리퍼블리카 |
| 특징 | 표준 처리방침 모델 | 디지털 first, 모바일 UX | 그룹사 정보 공유, 글로벌 | 단순화 UX, 최소수집 |
| 분량 | 1.1MB, 15p | 385KB | 698KB | 1.1MB |
| 마이데이터 | 포함 | 적극 활용 | 포함 | 적극 활용 |

---

## 6. 갱신 (다음 사이클)

원천 자료는 시간이 지나면서 개정됩니다. 신규 자료 추가/갱신 시:

1. 본 SOURCES.md 표에 항목 추가
2. `_download.py`에 URL/파일명 spec 추가
3. `internal_wiki/_convert.py`의 SPECS + SUMMARIES 업데이트
4. 변환 재실행
