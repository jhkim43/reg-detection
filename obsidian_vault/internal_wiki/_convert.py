"""
internal_raw/*.pdf  → internal_raw_md/*.md (opendataloader 본문 추출)
internal_raw_md/*.md → internal_wiki/{영역}/*.md (요약·메타·링크)
                    → internal_wiki/_MOC/MOC_*.md (영역 인덱스)

3단 폴더 분리 구조 (Option C):
- internal_raw/      원본 PDF (인용·정확성)
- internal_raw_md/   본문 전체 마크다운 (검색·LLM·임베딩)
- internal_wiki/     요약·메타·MOC 연결 (사람·Graph)

사용법:
    export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
    /tmp/playwright-venv/bin/python obsidian_vault/internal_wiki/_convert.py
"""

from pathlib import Path
from dataclasses import dataclass
import opendataloader_pdf

ROOT = Path(__file__).parent.parent
RAW = ROOT / "internal_raw"
RAW_MD = ROOT / "internal_raw_md"
WIKI = ROOT / "internal_wiki"


@dataclass
class DocSpec:
    raw_filename: str
    wiki_filename: str
    title: str
    date: str
    source_institution: str
    document_type: str
    tags: list
    sub_area: list
    folder: str
    source_url: str
    substitution_note: str = "회사 실제 내규 반출 불가로 공개 자료 갈음"
    version: str = "v1.0"
    effective_date: str = "2026-06-06"
    last_updated: str = "2026-06-06"


SUMMARIES = {
    "금융분야_개인정보보호_가이드라인.md": {
        "core": [
            "2014년 신용카드 3사 개인정보 유출 사고 후 금융분야 전반에 통합 적용 기준 제시 (개인정보보호법 + 신용정보법 + 금융실명법 + 전자금융거래법)",
            "개인(신용)정보 처리 12단계별 원칙 (수집·이용·제공·위탁·관리·파기·권리보장 등)",
            "은행·보험·증권·신용정보업 등 금융 전 업권 적용, 업종별 사례 포함",
            "법령 위계: 신용정보법(특별법) > 개인정보보호법(일반법) 적용 순서 명시",
        ],
        "controls": [
            "**수집·이용 동의**: 정보주체 동의 원칙, 법령상 의무인 경우 동의 불요, 수집 항목·목적·기간 명시 의무",
            "**제3자 제공**: 동의 또는 법령 근거 필요, 제공 항목·목적·기간 명시, 동의는 일반·포괄적이 아닌 구체적·개별적이어야 함",
            "**처리 위탁**: 위탁 사실 공개, 수탁사 관리·감독 의무, 재위탁 금지 원칙 (제3자 제공과 구분)",
            "**고유식별정보·민감정보**: 별도 동의 또는 법령 근거 필요 (주민등록번호 처리 제한)",
            "**개인(신용)정보 보호책임자**: CPO 및 신용정보관리·보호인 지정 의무, 신용정보활용체제 공시",
            "**파기**: 보유기간 경과 또는 처리목적 달성 시 지체없이 파기",
            "**유출 시 조치**: 통지·신고 의무, 5일 이내 정보주체 통지",
        ],
        "actions": [
            "처리방침 정비: 본 가이드 12단계 기준에 따라 회사 처리방침 재정비",
            "수집 동의서 검토: 필수/선택 구분, 항목·목적·기간 명시 명확화",
            "위탁사 점검 체계 구축: 정기 점검 + 재위탁 통제 절차 수립",
            "보호책임자(CPO) 권한·역할 명시 및 임직원 교육 정례화",
            "업종별 사례(은행/보험/증권) 참고로 회사 특수성 반영",
        ],
    },
    "개인정보안전성확보조치기준.md": {
        "core": [
            "개인정보보호법 제29조 안전조치 의무의 세부 기준 (개인정보위 고시 제2021-2호)",
            "분실·도난·유출·위조·변조·훼손 방지를 위한 기술적·관리적·물리적 안전조치 명시",
            "적용 대상별 차등 (대기업/중견기업/중소기업/소상공인)",
        ],
        "controls": [
            "**내부관리계획** 수립·시행 (개인정보 보호책임자 지정, 보호조직 구성, 교육·점검 절차)",
            "**접근통제**: 접근권한 부여·변경·말소 기준, 침입차단·탐지시스템 운영, 비밀번호 정책",
            "**접속기록**: 처리 내역 저장·관리, 위변조 방지, 별도 저장장치 백업",
            "**암호화**: 비밀번호 일방향 암호화, 주민등록번호·계좌정보 등 양방향 암호화 저장, 전송 시 보안서버",
            "**악성프로그램 방지**: 백신 소프트웨어 설치·갱신·점검",
            "**물리적 접근 방지**: 개인정보처리시스템 보관 장소 출입 통제",
        ],
        "actions": [
            "내부관리계획서 작성·승인·연 1회 갱신",
            "접근권한 정기 점검 (분기 1회 권고) + 권한 변경 이력 관리",
            "접속기록 자동 백업 + 위변조 탐지 시스템 구축 (1년 이상 보관)",
            "암호화 솔루션 도입 + 키관리 정책 수립",
            "기업 규모별 차등 적용 기준 자체 진단",
        ],
    },
    "개인정보안전성확보조치기준_해설서.md": {
        "core": [
            "정보통신서비스 제공자등 대상 안전조치 기준(제2020-2호)의 조항별 상세 해설",
            "11개 조항 해설 + 부록(망분리 해설 + FAQ) 총 90여 페이지",
            "위반 시 매출 3% 이하 과징금 + 2년 이하 징역 또는 2천만원 이하 벌금 + 3천만원 이하 과태료 명시",
        ],
        "controls": [
            "**제3조 내부관리계획**: 수립·시행, 점검·승인 절차, 보호책임자·취급자 교육",
            "**제4조 접근통제**: 권한 차등 부여, 침입차단·탐지시스템, 망분리 (일평균 100만명 이상 또는 매출 100억 이상 시)",
            "**제5조 접속기록 위·변조 방지**: 별도 저장장치 백업, 보관 기간 명시",
            "**제6조 암호화**: 비밀번호 일방향, 주민등록번호 양방향, 전송 시 보안서버 구축",
            "**제7~10조**: 악성코드 방지, 물리적 접근 방지, 출력·복사 보호조치, 표시 제한 보호조치",
        ],
        "actions": [
            "망분리 적용 여부 사전 진단 (100만명 또는 매출 100억 기준)",
            "접속기록 보관 시스템 검증 (1년 이상)",
            "출력·복사 통제 정책 마련 (DLP 솔루션 도입 검토)",
            "FAQ 활용한 실무 케이스 적용 (부록 90~ 참조)",
            "정보통신서비스 제공자 해당 여부 확인 (직접/위탁/방송사업자 등 적용 범위 검토)",
        ],
    },
    "금융회사정보처리업무위탁규정.md": {
        "core": [
            "금융회사가 정보처리 업무를 외부 위탁할 때 따라야 할 규정 (금융위 고시 제2021-9호)",
            "14개 업권(은행/한국산업은행/중소기업은행/금융투자업/보험/저축은행/신협/여신전문/농협·수협/전자금융업/온라인투자연계금융/금융상품자문) 적용",
            "사후 보고 일원화 (구 금감원 보고 + 금융위 승인 → 금감원 사후보고 통합)",
        ],
        "controls": [
            "**위탁 범위**: 정보처리(전산설비 활용 정보 처리) + 전산설비 위탁 모두 포함",
            "**계약 시 포함 사항**: 위탁업무 내용, 위탁사 점검권, 사고 책임, 비밀유지",
            "**외국계 금융회사·계열사** 특례 명시 (국내 지점 또는 계열사 정의)",
            "**사후 보고 의무**: 위탁 사실·변경 사항을 금감원에 보고",
            "**수탁사 관리·감독**: 위탁사가 관계 법령 준수하도록 관리",
        ],
        "actions": [
            "위탁사 인벤토리 구축 + 분기 점검 체계 운영",
            "계약서에 필수 조항 포함 (위탁업무·점검권·책임 명시)",
            "수탁사 보안수준 검증 (ISMS-P 인증 여부 확인)",
            "위탁 변경 시 보고 절차 자동화 (자동 알림 체계)",
            "재위탁 발생 시 통제 절차 별도 수립",
        ],
    },
    "신용정보업감독규정.md": {
        "core": [
            "신용정보법 시행 세부 기준 (금융위 고시 제2025-1호 일부개정)",
            "마이데이터(본인신용정보관리업) 운영 기준 강화",
            "만 14세 이상 청소년 자율 가입 허용 (법정대리인 동의 불요)",
        ],
        "controls": [
            "**본인신용정보관리회사 행위규칙** 신설 (제23조의3제1항제10·11·12호 및 제2항제5호다목)",
            "**마이데이터 제3자 정보 판매**: 침해사고대응기관 전송시스템 이용 의무",
            "**대면점포 마이데이터** 가입·조회·활용 허용 (임직원 준수 기준 내부관리규정 의무)",
            "**전송요구권 범위 확대**: 신용정보주체가 전송요구할 수 있는 자 및 정보 범위 명시 (제23조의4, 별표 1의3)",
            "**공공서비스 추천**: 전송요구로 받은 정보를 공공서비스 추천에 활용 가능",
        ],
        "actions": [
            "마이데이터 가입 절차 검토 (만 14세 이상 청소년 분리 처리)",
            "침해사고대응기관 연계 전송시스템 도입",
            "대면점포 직원 마이데이터 처리 교육 + 내부 운영지침 마련",
            "제3자 정보 판매 절차 보안성·전송시스템 검증",
            "전송요구권 대응 인프라 확장 (공공서비스 연계 채널)",
        ],
    },
    "KB은행_개인정보처리방침.md": {
        "core": [
            "시중은행이 실제 운영 중인 처리방침 사례 (개정 2025.12.11)",
            "22개 조항으로 처리 전 영역 커버 (처리목적/보유기간/항목/제3자제공/위탁/안전성조치 등)",
            "개인정보보호법 + 신용정보법 + 전자금융거래법 통합 적용 사례",
        ],
        "controls": [
            "**제1조 처리 목적**: (금융)거래 / 홍보·판매 권유 / 회원가입·관리 / 온라인거래 4개 범주",
            "**제2조 보유기간**: 동의일로부터 (금융)거래 종료 후 5년 (신용정보법 제20조의2)",
            "**제3조 처리 항목**: 동의 없는 처리(법령 근거) + 동의 필수/선택 항목 구분 명시",
            "**제4조 만 14세 미만 아동**: 법정대리인 동의 의무, 최소한의 정보(법정대리인 성명·연락처)만 요구",
            "**제5·6조 제3자 제공·위탁**: 수탁사 목록 공시, 위탁 사실 명시",
            "**제7조 국외 이전**: 별도 규정",
            "**제10조 안전성 확보조치**: 별도 표준 적용",
            "**제14·16·17조**: 가명정보, 생체인식정보, CI(연계정보) 특수 처리",
        ],
        "actions": [
            "우리 회사 처리방침 작성 시 KB 22개 조항 구조 참고",
            "신용정보활용체제 공시를 별도 운영 (처리방침과 분리)",
            "보유기간 5년 일관 적용 (신용정보법 기준)",
            "정기 갱신 체계 수립 (연 1회 이상 검토 + 개정일 표시)",
            "민감정보(생체·민감정보) 처리 시 별도 동의 절차 마련",
        ],
    },
    "전자금융감독규정.md": {
        "core": [
            "금융위 고시 제2025-4호 일부개정 (원칙중심 합리화)",
            "자율보안 역량 강화 + 결과책임 강조 (룰 → 원칙 전환)",
            "정보보호위원회 → 이사회 보고 의무화 (제8조의2제4항)",
        ],
        "controls": [
            "**제5조 보험 가입 기준** 현실화 (전자금융사고 책임이행)",
            "**제8조의2 거버넌스**: 정보보호위원회 심의 중요사항 이사회 보고 의무",
            "**제9·10·11조 건물·설비·전산실** 원칙중심 규정 (구체 기준 → 원칙 제시)",
            "**제16·17조 악성코드·웹서버 관리** 원칙중심",
            "**제20·21·22조 IT시스템 사업·계약·감리** 원칙중심",
            "**제23조제8항 재해복구센터** 구축의무 확대",
            "**제26조 직무분리** 원칙중심",
            "**제32·33조 비밀번호** 획일적 규율 삭제 (자율 설계)",
        ],
        "actions": [
            "정보보호위원회 보고 사항을 이사회 보고 절차에 통합",
            "자율보안 체계 수립 (회사 환경 기반 보안 통제 자율 구성)",
            "재해복구센터 적용 대상 재검토 (확대된 범위 점검)",
            "비밀번호 정책을 회사 위험 기반으로 재설계 (필수 변경 주기 폐지 가능)",
            "보안 감리 및 점검 절차를 원칙 기반 자체 평가로 전환",
        ],
    },
    "금융분야클라우드컴퓨팅서비스이용가이드.md": {
        "core": [
            "FSEC 2025년 개정 가이드 (전자금융감독규정 + 정보처리위탁규정 운영 지침)",
            "클라우드 이용 = 정보처리 위탁 (CSP = 전자금융보조업자, 금융회사 책임 면제 불가)",
            "9개 장 + 부록: 이용절차·CSP평가·업무연속성·계약·이용보고·이용종료",
        ],
        "controls": [
            "**제2장 이용절차**: 업무 선정 → 중요도 평가 → CSP 평가 → 계약 → 보고",
            "**제3장 업무중요도 평가**: 핵심업무 vs 비핵심업무 구분 (부록 1 참조)",
            "**제4장 CSP 안전성 평가**: 평가 절차·항목 + 생략기준 (인증 CSP 활용 시)",
            "**제5장 업무연속성·안전성 확보조치** (BCP, DR, 보안)",
            "**제6장 정보보호위원회 심의·의결**: 중요 클라우드 도입 시 의결",
            "**제7장 계약**: 기본 포함사항(보안 조항, 감사권) + 추가 포함사항",
            "**제8장 이용 및 보고**: 금감원 보고, 위수탁 운영, 집중 리스크 관리",
            "**제9장 이용 종료**: 데이터 반환·삭제, 종료 시 보안",
        ],
        "actions": [
            "신규 클라우드 도입 전 업무중요도 평가 수행 (가이드 부록 1)",
            "CSP 안전성 평가 결과 검토 (CSP 인증 기관 활용으로 평가 생략 가능)",
            "계약서에 가이드 §7 기본 포함사항 반영 (보안·감사권·BCP)",
            "클라우드 사용 정기 보고 체계 + 종료 시 데이터 처분 절차 수립",
            "집중 리스크 관리 (CSP 다변화) + 국외 CSP 리스크 대응방안 검토",
        ],
    },
    "금융분야_망분리_개선_로드맵.md": {
        "core": [
            "금융위·금감원 2024년 8월 발표 (망분리 도입 후 10년 평가)",
            "3단계 추진: 1단계 샌드박스(즉시) → 2단계 정규제도화 → 3단계 디지털금융보안법 제정",
            "자율보안-결과책임 원칙으로 전환 (룰 → 원칙)",
        ],
        "controls": [
            "**1단계 (2024 연내)**: 생성형 AI 허용(가명정보 처리 가능), 클라우드(SaaS) 이용 확대, 연구·개발 분야 논리적 망분리 허용",
            "**2단계 (~2025)**: 샌드박스 성과 검증 후 정규 제도화, 규제특례 확대 (개인신용정보 처리 등 리스크↑ 업무까지), 정보처리 위탁제도 정비",
            "**3단계 (2024 입법 추진)**: 디지털 금융보안법(가칭) 제정, 자율보안-결과책임 체계, 배상책임 강화, 실효성 과징금, CISO 권한 확대 + CEO·이사회 보고",
            "**기본 방향**: 단계적 개선(급격한 완화 X), 금융권 보안노력 강화, 규제 합리화 이익 금융소비자에게 향유",
        ],
        "actions": [
            "샌드박스 활용 가능 영역 식별 (AI·SaaS·연구개발 등)",
            "CSP·SaaS 도입 로드맵 수립 (1단계 → 2단계 확대 대비)",
            "CISO 권한·이사회 보고 체계 사전 정비 (3단계 법제화 대비)",
            "자율보안 거버넌스 구축 (위험평가 + 결과 책임 + 사고 시 책임)",
            "글로벌 선진 보안체계(제로트러스트 등) 도입 검토",
        ],
    },
}


SPECS = [
    DocSpec(
        raw_filename="금융분야_개인정보보호_가이드라인_개정본_20170224.pdf",
        wiki_filename="금융분야_개인정보보호_가이드라인.md",
        title="금융분야 개인정보보호 가이드라인",
        date="2017-02-24",
        source_institution="금융위원회+금융감독원",
        document_type="사내규정-갈음",
        tags=["사내규정", "개인정보", "처리방침", "금융분야"],
        sub_area=["수집동의", "처리위탁", "제3자제공", "안전성조치"],
        folder="개인정보",
        source_url="https://www.fsc.go.kr/po010101/72612",
    ),
    DocSpec(
        raw_filename="개인정보안전성확보조치기준_제2021-2호.pdf",
        wiki_filename="개인정보안전성확보조치기준.md",
        title="개인정보의 안전성 확보조치 기준",
        date="2021-09-15",
        source_institution="개인정보보호위원회",
        document_type="사내규정-갈음",
        tags=["사내규정", "개인정보", "안전성조치"],
        sub_area=["안전성조치"],
        folder="개인정보",
        source_url="https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000204677",
    ),
    DocSpec(
        raw_filename="개인정보안전성확보조치기준해설서_2020-2호.pdf",
        wiki_filename="개인정보안전성확보조치기준_해설서.md",
        title="개인정보의 안전성 확보조치 기준 해설서",
        date="2020-12-01",
        source_institution="개인정보보호위원회",
        document_type="사내규정-갈음",
        tags=["사내규정", "개인정보", "안전성조치", "해설서"],
        sub_area=["안전성조치"],
        folder="개인정보",
        source_url="https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=7045",
    ),
    DocSpec(
        raw_filename="금융회사정보처리업무위탁규정_제2021-9호.pdf",
        wiki_filename="금융회사정보처리업무위탁규정.md",
        title="금융회사의 정보처리 업무 위탁에 관한 규정",
        date="2021-03-25",
        source_institution="금융위원회",
        document_type="사내규정-갈음",
        tags=["사내규정", "처리위탁", "금융분야"],
        sub_area=["처리위탁"],
        folder="개인정보",
        source_url="https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000200327&chrClsCd=010201",
    ),
    DocSpec(
        raw_filename="신용정보업감독규정_제2025-1호_20250121.pdf",
        wiki_filename="신용정보업감독규정.md",
        title="신용정보업감독규정",
        date="2025-01-21",
        source_institution="금융위원회",
        document_type="사내규정-갈음",
        tags=["사내규정", "신용정보", "금융분야"],
        sub_area=["신용정보"],
        folder="개인정보",
        source_url="https://www.fsc.go.kr/po040200/83894",
    ),
    DocSpec(
        raw_filename="KB은행_개인정보처리방침_표준_20260606.pdf",
        wiki_filename="KB은행_개인정보처리방침.md",
        title="KB국민은행 개인정보 처리방침 (표준)",
        date="2025-12-11",
        source_institution="KB국민은행",
        document_type="사내규정-갈음(실사례)",
        tags=["사내규정", "개인정보", "처리방침", "은행샘플"],
        sub_area=["수집동의", "처리위탁", "제3자제공", "안전성조치"],
        folder="개인정보",
        source_url="https://obank.kbstar.com/quics?page=C110564",
    ),
    DocSpec(
        raw_filename="전자금융감독규정_제2025-4호_20250205.pdf",
        wiki_filename="전자금융감독규정.md",
        title="전자금융감독규정",
        date="2025-02-05",
        source_institution="금융위원회",
        document_type="사내규정-갈음",
        tags=["사내규정", "정보보안", "전자금융", "금융분야"],
        sub_area=["IT안전성", "정보보안"],
        folder="정보보안",
        source_url="https://www.fsc.go.kr/po040200/83957",
    ),
    DocSpec(
        raw_filename="금융분야클라우드컴퓨팅서비스이용가이드_2025개정.pdf",
        wiki_filename="금융분야클라우드컴퓨팅서비스이용가이드.md",
        title="금융분야 클라우드컴퓨팅서비스 이용 가이드 (2025 개정)",
        date="2025-05-22",
        source_institution="금융보안원",
        document_type="사내규정-갈음",
        tags=["사내규정", "정보보안", "클라우드", "금융분야"],
        sub_area=["클라우드", "정보보안"],
        folder="정보보안",
        source_url="https://www.fsec.or.kr/bbs/detail?menuNo=222&bbsNo=11691",
    ),
    DocSpec(
        raw_filename="금융분야_망분리_개선_로드맵_20240813.pdf",
        wiki_filename="금융분야_망분리_개선_로드맵.md",
        title="금융분야 망분리 개선 로드맵",
        date="2024-08-13",
        source_institution="금융위원회",
        document_type="사내규정-갈음",
        tags=["사내규정", "정보보안", "망분리", "금융분야"],
        sub_area=["망분리", "정보보안"],
        folder="정보보안",
        source_url="https://www.fsc.go.kr/no010101/82885",
    ),
]


# === Stage 1: PDF → raw_md (opendataloader) ===

def extract_raw_md():
    """internal_raw/*.pdf → internal_raw_md/*.md"""
    RAW_MD.mkdir(exist_ok=True)
    print(f"\n[1/2] PDF → raw_md ({len(SPECS)}건)")
    for spec in SPECS:
        pdf_path = RAW / spec.raw_filename
        if not pdf_path.exists():
            print(f"  ❌ raw 파일 없음: {spec.raw_filename}")
            continue
        # 이미 추출돼있으면 skip
        out_name = pdf_path.stem + ".md"
        if (RAW_MD / out_name).exists():
            print(f"  ⏭️  {out_name} (skip, 이미 존재)")
            continue
        print(f"  → {spec.raw_filename}")
        opendataloader_pdf.convert(
            input_path=str(pdf_path),
            output_dir=str(RAW_MD),
            format="markdown",
            quiet=True,
            image_output="off",
        )


# === Stage 2: raw_md + spec → wiki (요약·메타·링크) ===

def build_frontmatter(spec: DocSpec) -> str:
    """Frontmatter tags에 slash hierarchy 통합 (inline 태그 제거)."""
    inst_short = spec.source_institution.split('+')[0].strip()
    # 기본 태그 + 자동 생성 slash 태그
    all_tags = list(spec.tags)
    all_tags.append("출처/내규")
    all_tags.append(f"출처/{inst_short}")
    all_tags.append("status/active")
    all_tags.extend(f"영역/{sa}" for sa in spec.sub_area)
    tags_yaml = "\n".join(f"  - {t}" for t in all_tags)
    sub_area_yaml = ", ".join(spec.sub_area)
    return f"""---
title: "{spec.title}"
date: {spec.date}
source_institution: "{spec.source_institution}"
document_type: "{spec.document_type}"
tags:
{tags_yaml}
status: "active"
type: "사내규정"
version: "{spec.version}"
effective_date: {spec.effective_date}
last_updated: {spec.last_updated}
sub_area: [{sub_area_yaml}]
source_doc: "{spec.raw_filename}"
source_url: "{spec.source_url}"
substitution_note: "{spec.substitution_note}"
related_external: []
---

"""


def build_wiki_body(spec: DocSpec, raw_md_path: Path) -> str:
    """짧은 요약·메타·링크 (본문 X). 핵심요약/주요통제/실무대응 SUMMARIES에서."""
    raw_md_stem = raw_md_path.stem
    raw_md_size_kb = raw_md_path.stat().st_size // 1024 if raw_md_path.exists() else 0
    raw_md_lines = raw_md_path.read_text(encoding="utf-8").count("\n") if raw_md_path.exists() else 0

    summary = SUMMARIES.get(spec.wiki_filename, {
        "core": ["TODO: 3~5 bullet"],
        "controls": ["TODO: 조항별 핵심 통제 사항"],
        "actions": ["TODO: 회사 적용 포인트"],
    })
    core_lines = "\n".join(f"- {b}" for b in summary["core"])
    controls_lines = "\n".join(f"- {b}" for b in summary["controls"])
    actions_lines = "\n".join(f"- {b}" for b in summary["actions"])

    return f"""# 개요

- **발행처**: {spec.source_institution}
- **원천 발행일**: {spec.date}
- **회사 시행일**: {spec.effective_date}
- **버전**: {spec.version}
- **영역**: {', '.join(spec.sub_area)}

> {spec.substitution_note}

# 핵심 요약

{core_lines}

# 주요 통제 및 규제 사항

{controls_lines}

# 실무 대응 방향

{actions_lines}

# 본문 (원문 참조)

본문 전체는 wiki에 포함하지 않고 별도 보관 (Option C 정책):

- 📄 **원문 PDF**: [`{spec.raw_filename}`](../../internal_raw/{spec.raw_filename})
- 📝 **마크다운 추출본** ({raw_md_size_kb}KB, {raw_md_lines}줄): [`internal_raw_md/{raw_md_stem}.md`](../../internal_raw_md/{raw_md_stem}.md)

> 마크다운 추출본은 opendataloader-pdf로 생성. 조항 구조·헤더·표 보존.
> LLM 분석·벡터 임베딩·검색은 마크다운 추출본 사용.

# 관련 외규 (자동 갱신)

> 외규 영향도 분석 시 본 내규에 매칭된 외규가 여기에 누적됨.

- (아직 없음)

# 변경 이력

- {spec.version} ({spec.effective_date}): 초기 셋업 (공개 자료 갈음)
"""


def build_wiki():
    """raw_md + spec → wiki MD"""
    print(f"\n[2/2] raw_md + spec → wiki ({len(SPECS)}건)")
    for folder in {"개인정보", "정보보안", "_MOC"}:
        (WIKI / folder).mkdir(parents=True, exist_ok=True)

    for spec in SPECS:
        raw_md_path = RAW_MD / (Path(spec.raw_filename).stem + ".md")
        if not raw_md_path.exists():
            print(f"  ❌ raw_md 없음: {raw_md_path.name}")
            continue
        wiki_path = WIKI / spec.folder / spec.wiki_filename
        wiki_path.write_text(
            build_frontmatter(spec) + build_wiki_body(spec, raw_md_path),
            encoding="utf-8",
        )
        size_kb = wiki_path.stat().st_size / 1024
        print(f"  ✅ {wiki_path.relative_to(ROOT)} ({size_kb:.1f}KB)")


# === Stage 3: MOC (영역 인덱스) ===

def build_moc(sub_area: str, related_internal: list) -> str:
    internal_list = "\n".join(
        f"- [[{spec.wiki_filename.removesuffix('.md')}]]" for spec in related_internal
    ) or "- (없음)"

    return f"""---
type: MOC
sub_area: {sub_area}
date: 2026-06-06
tags:
  - MOC
  - 영역인덱스
  - 영역/{sub_area}
---

# 영역: {sub_area}

> 본 영역과 관련된 모든 내규·외규·영향분석을 모아둔 인덱스 노드.
> Obsidian graph view에서 hub 역할.

## 사내규정 (내규 갈음)

{internal_list}

## 외규 (자동 갱신)

> 본 영역과 매칭된 외규가 여기에 누적됨.

- (아직 없음)

## 영향도 분석 (자동 갱신)

- (아직 없음)
"""


def build_all_mocs():
    print(f"\n[3/3] MOC 영역 인덱스 생성")
    all_sub_areas = sorted({sa for spec in SPECS for sa in spec.sub_area})
    for sub_area in all_sub_areas:
        related = [spec for spec in SPECS if sub_area in spec.sub_area]
        moc_path = WIKI / "_MOC" / f"MOC_{sub_area}.md"
        moc_path.write_text(build_moc(sub_area, related), encoding="utf-8")
        print(f"  ✅ MOC_{sub_area}.md ({len(related)}건 연결)")


def main():
    print("=" * 60)
    print("3단 분리 구조 (Option C) 생성")
    print("  internal_raw/      원본 PDF")
    print("  internal_raw_md/   본문 마크다운 (opendataloader)")
    print("  internal_wiki/     요약·메타·MOC 연결")
    print("=" * 60)
    extract_raw_md()
    build_wiki()
    build_all_mocs()
    print("\n🎉 완료")


if __name__ == "__main__":
    main()
