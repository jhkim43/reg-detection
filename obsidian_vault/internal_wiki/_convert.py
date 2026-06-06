"""
internal_raw/*.pdf  → internal_raw_md/*.md (opendataloader 본문 추출)
internal_raw_md/*.md → internal_wiki/개인정보/*.md (요약·메타·링크)
                    → internal_wiki/_MOC/MOC_*.md (영역 인덱스)

3단 분리 구조 (Option C):
- internal_raw/      원본 PDF (인용·정확성)
- internal_raw_md/   본문 전체 마크다운 (검색·LLM·임베딩)
- internal_wiki/     요약·메타·MOC 연결 (사람·Graph)

내규 갈음 자료 = 시중은행 4곳 개인정보 처리방침:
  - KB국민은행 (시중은행)
  - 카카오뱅크 (인터넷전문은행)
  - 하나은행 (시중은행)
  - 토스뱅크 (인터넷전문은행, 핀테크 출신)

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
    substitution_note: str = "회사 실제 내규 반출 불가로 시중은행 공개 처리방침으로 갈음"
    version: str = "v1.0"
    effective_date: str = "2026-06-06"
    last_updated: str = "2026-06-06"


# 공통 sub_area: 시중은행 처리방침은 동일 영역 커버
COMMON_SUB_AREA = ["수집동의", "처리위탁", "제3자제공", "안전성조치", "신용정보", "개인정보"]


SPECS = [
    DocSpec(
        raw_filename="KB은행_개인정보처리방침_20260606.pdf",
        wiki_filename="KB은행_개인정보처리방침.md",
        title="KB국민은행 개인정보 처리방침",
        date="2025-12-11",
        source_institution="KB국민은행",
        document_type="처리방침",
        tags=["내규갈음", "처리방침", "시중은행", "KB은행"],
        sub_area=COMMON_SUB_AREA,
        folder="개인정보",
        source_url="https://obank.kbstar.com/quics?page=C110564",
    ),
    DocSpec(
        raw_filename="카카오뱅크_개인정보처리방침_20260606.pdf",
        wiki_filename="카카오뱅크_개인정보처리방침.md",
        title="카카오뱅크 개인정보 처리방침",
        date="2026-06-06",
        source_institution="카카오뱅크",
        document_type="처리방침",
        tags=["내규갈음", "처리방침", "인터넷전문은행", "카카오뱅크"],
        sub_area=COMMON_SUB_AREA,
        folder="개인정보",
        source_url="https://www.kakaobank.com/Corp/Policy/Privacy/ManagementPolicy",
    ),
    DocSpec(
        raw_filename="하나은행_개인정보처리방침_20260606.pdf",
        wiki_filename="하나은행_개인정보처리방침.md",
        title="하나은행 개인정보 처리방침",
        date="2026-06-06",
        source_institution="하나은행",
        document_type="처리방침",
        tags=["내규갈음", "처리방침", "시중은행", "하나은행"],
        sub_area=COMMON_SUB_AREA,
        folder="개인정보",
        source_url="https://www.kebhana.com/cont/customer/customer06/customer0604/index.jsp",
    ),
    DocSpec(
        raw_filename="토스뱅크_개인정보처리방침_20260606.pdf",
        wiki_filename="토스뱅크_개인정보처리방침.md",
        title="토스뱅크 개인정보 처리방침",
        date="2026-06-06",
        source_institution="토스뱅크",
        document_type="처리방침",
        tags=["내규갈음", "처리방침", "인터넷전문은행", "토스뱅크", "핀테크"],
        sub_area=COMMON_SUB_AREA,
        folder="개인정보",
        source_url="https://www.tossbank.com/customer/information/privacy/privacy-policy",
    ),
]


SUMMARIES = {
    "KB은행_개인정보처리방침.md": {
        "core": [
            "4대 시중은행 처리방침 표준 사례 (개정 2025.12.11)",
            "22개 조항으로 개인정보 처리 전 영역 커버 (목적·항목·보유·제공·위탁·국외이전·파기·권리·안전성·자동수집·행태·가명·위치·생체·CI)",
            "개인정보보호법 + 신용정보법 + 전자금융거래법 통합 적용",
            "은행 전통적 처리방침의 모델 — 다른 은행 처리방침의 기준점",
        ],
        "controls": [
            "**처리 목적 4가지**: (금융)거래·홍보판매·회원관리·온라인거래",
            "**보유기간**: 동의일~거래종료 후 5년 (신용정보법 제20조의2)",
            "**처리 항목**: 법령 근거 처리 + 동의 필수/선택 명확 구분",
            "**제3자 제공**: 동의 + 법령 근거 (제5조)",
            "**처리 위탁**: 수탁사 목록 공시, 위탁 사실 명시 (제6조)",
            "**만 14세 미만**: 법정대리인 동의 의무, 최소 정보만 요구 (제4조)",
            "**안전성 확보조치**: 별도 표준 적용 (제10조)",
            "**특수 처리**: 가명정보·생체인식·CI·국외이전 별도 규정",
        ],
        "actions": [
            "우리 회사 처리방침 작성 시 22개 조항 구조 참고",
            "신용정보활용체제 공시를 처리방침과 별도 운영",
            "보유기간 5년 일관 적용 (신용정보법 기준)",
            "정기 갱신 체계 (연 1회 이상 + 개정일 표시)",
            "민감정보·생체인식정보 별도 동의 절차 마련",
        ],
    },
    "카카오뱅크_개인정보처리방침.md": {
        "core": [
            "인터넷전문은행 처리방침 사례 — 디지털/모바일 first",
            "비대면·앱 기반 동의·관리 (시중은행 대면 채널과 차별화)",
            "마이데이터·오픈뱅킹 적극 활용 사례",
            "전통 은행 대비 단순화된 동의 UX",
        ],
        "controls": [
            "**디지털 전용 처리**: 앱·웹 기반 동의·이력 관리",
            "**보유기간**: 거래종료 후 5년 (동일 기준)",
            "**제3자 제공**: 카카오 계열사 연계 (특수)",
            "**마이데이터 통합 조회**: 본인신용정보관리업 (제휴 금융사 정보)",
            "**가명정보 처리**: 통계·과학적연구·공익적 보존 명시",
            "**생체인증**: 모바일 생체인증 (지문·얼굴인식) 처리 절차",
            "**자동 의사결정**: 신용평가 알고리즘 활용 시 거부권 안내",
        ],
        "actions": [
            "디지털 채널 동의 UX 참고 (단순화 + 명확성)",
            "마이데이터 운영 시 침해사고대응기관 전송시스템 사용",
            "계열사 연계 동의 절차 별도 설계 (그룹사간 정보 공유)",
            "자동 의사결정 대응권 안내 절차 마련",
            "모바일 생체인증 처리 기준 명문화",
        ],
    },
    "하나은행_개인정보처리방침.md": {
        "core": [
            "4대 시중은행 처리방침 (디지털 + 전통 채널 균형)",
            "하나금융그룹 계열사간 정보 공유 정책 명시",
            "글로벌 영업 기반 — 국외이전 정책 상세",
            "기업금융·소매·외환 등 다양한 처리 목적 통합",
        ],
        "controls": [
            "**처리 목적 확장**: 거래·홍보·회원관리·기업금융·외환 등",
            "**보유기간**: 거래종료 후 5년 + 외환거래 추가 보유",
            "**그룹사 정보 공유**: 하나금융그룹 내 계열사 (별도 동의)",
            "**국외 이전**: 해외 지점·외환거래 처리국 명시",
            "**제3자 제공**: 신용정보회사·집중기관 + 제휴사",
            "**처리 위탁**: 수탁사 광범위 (시스템·고객센터·문서·마케팅)",
            "**안전성 확보조치**: 그룹 정보보호 정책 + 회사별 운영",
        ],
        "actions": [
            "그룹사 정보 공유 시 별도 동의 절차 명확화",
            "국외이전 위탁사 평가 + 정기 점검",
            "외환거래 보유기간 별도 관리 (법령 따라)",
            "수탁사 인벤토리 분기 갱신",
            "그룹 공통 정보보호 정책 매핑",
        ],
    },
    "토스뱅크_개인정보처리방침.md": {
        "core": [
            "핀테크 출신 인터넷전문은행 — 사용자 경험 최우선",
            "단순화된 동의 절차 + 명확한 항목 표시",
            "마이데이터·오픈뱅킹 native 활용",
            "최소 수집·최소 보관 원칙 강조",
        ],
        "controls": [
            "**최소 수집 원칙**: 서비스 제공에 필수적인 정보만",
            "**보유기간**: 거래종료 후 5년 (법령 기준 준수)",
            "**자동화 의사결정**: AI/ML 기반 신용평가 + 사용자 대응권 안내",
            "**개인정보 이동권**: 사용자가 데이터 다운로드/이전 요청 가능",
            "**제3자 제공**: 최소화 + 명시적 동의",
            "**처리 위탁**: AWS 클라우드·CSP 명시 (디지털 인프라)",
            "**행태정보 통제**: 쿠키·앱 분석 사용·거부 절차 명확",
        ],
        "actions": [
            "최소 수집·최소 보관 원칙 회사 정책에 반영",
            "자동화 의사결정 거부·재심사 절차 명문화",
            "클라우드·CSP 위탁 검증 (FSEC 평가 활용)",
            "사용자 권리 (열람·정정·삭제·이동) 디지털 채널 일원화",
            "행태정보 통제 옵션을 앱 설정에 노출",
        ],
    },
}


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


# === Stage 2: raw_md + spec → wiki ===

def build_frontmatter(spec: DocSpec) -> str:
    inst_short = spec.source_institution.split('+')[0].strip()
    all_tags = list(spec.tags)
    all_tags.append("출처/내규갈음")
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
type: "내규갈음"
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
    raw_md_stem = raw_md_path.stem
    raw_md_size_kb = raw_md_path.stat().st_size // 1024 if raw_md_path.exists() else 0
    raw_md_lines = raw_md_path.read_text(encoding="utf-8").count("\n") if raw_md_path.exists() else 0

    summary = SUMMARIES.get(spec.wiki_filename, {
        "core": ["TODO: 3~5 bullet"],
        "controls": ["TODO: 조항별 핵심 통제"],
        "actions": ["TODO: 실무 대응"],
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

> 마크다운 추출본은 opendataloader-pdf로 생성. LLM 분석·벡터 임베딩·검색은 마크다운 추출본 사용.

# 관련 외규 (자동 갱신)

> 외규 영향도 분석 시 본 내규에 매칭된 외규가 여기에 누적됨.

- (아직 없음)

# 변경 이력

- {spec.version} ({spec.effective_date}): 초기 셋업 (시중은행 처리방침 갈음)
"""


def build_wiki():
    print(f"\n[2/2] raw_md + spec → wiki ({len(SPECS)}건)")
    for folder in {"개인정보", "_MOC"}:
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

## 사내규정 (내규 갈음, 시중은행 처리방침)

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
    print("내규 갈음 (시중은행 처리방침 4건) 생성")
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
