"""
internal_raw/*.pdf  -> internal_raw_md/*.md (opendataloader body extraction)
internal_raw_md/*.md -> internal_wiki/개인정보/*.md (LLM structured analysis + renderer)
                    -> internal_wiki/_MOC/MOC_*.md (area index)

Design:
- raw_md is the source of truth for policy text.
- LLM produces structured JSON only. It does not write final wiki markdown.
- This script validates evidence quotes, preserves related_external links, and renders a stable wiki format.
- sub_area/interest sections are taxonomy hints for the LLM, not rule-based match criteria.

Use:
    python obsidian_vault/internal_wiki/_convert.py --use-llm

Safety:
- LLM calls use OpenRouter through the existing reg_pipeline LLMClient.
- Project policy says external service API calls are user-run actions. Agents should not run --use-llm.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import opendataloader_pdf

ROOT = Path(__file__).parent.parent
RAW = ROOT / "internal_raw"
RAW_MD = ROOT / "internal_raw_md"
WIKI = ROOT / "internal_wiki"
LLM_CACHE = WIKI / "_llm_cache"
TOOLS = ROOT / "_tools"


@dataclass
class DocSpec:
    raw_filename: str
    wiki_filename: str
    title: str
    date: str
    source_institution: str
    document_type: str
    tags: list[str]
    sub_area: list[str]
    folder: str
    source_url: str
    substitution_note: str = "회사 실제 내규 반출 불가로 시중은행 공개 처리방침으로 갈음"
    version: str = "v1.0"
    effective_date: str = "2026-06-06"
    last_updated: str = "2026-06-06"


@dataclass
class EvidenceItem:
    quote: str
    source_line: int = 0
    validation: str = "unverified"


@dataclass
class InternalPolicyAnalysis:
    generated_by: str = "llm"
    analysis_version: str = "internal-wiki-llm-v1"
    document_profile: dict[str, Any] = field(default_factory=dict)
    core_summary: list[dict[str, Any]] = field(default_factory=list)
    control_map: list[dict[str, Any]] = field(default_factory=list)
    processing_coverage: list[dict[str, Any]] = field(default_factory=list)
    review_points: list[dict[str, Any]] = field(default_factory=list)
    external_matching_terms: list[dict[str, Any]] = field(default_factory=list)
    gaps_or_uncertainties: list[dict[str, Any]] = field(default_factory=list)
    evidence_index: list[EvidenceItem] = field(default_factory=list)
    validation_notes: list[str] = field(default_factory=list)


COMMON_SUB_AREA = ["수집동의", "처리위탁", "제3자제공", "안전성조치", "신용정보", "개인정보"]


# Taxonomy only. The LLM receives this as a controlled vocabulary and decides coverage from raw_md context.
SUB_AREA_TAXONOMY = [
    {
        "id": "수집동의",
        "meaning": "개인정보/신용정보 수집, 이용 목적, 항목, 동의 근거, 필수/선택 구분",
        "look_for": ["처리 목적", "처리 항목", "동의", "법적 근거", "필수/선택"],
    },
    {
        "id": "처리위탁",
        "meaning": "수탁자, 재위탁, 위탁계약, 수탁자 관리·감독, 국외 위탁",
        "look_for": ["수탁자", "재위탁", "위탁계약", "관리·감독", "국외 위탁"],
    },
    {
        "id": "제3자제공",
        "meaning": "제공받는 자, 제공 목적, 제공 항목, 보유·이용기간, 목적 외 제공",
        "look_for": ["제공받는 자", "제공 목적", "제공 항목", "보유·이용기간", "목적 외"],
    },
    {
        "id": "안전성조치",
        "meaning": "관리적·기술적·물리적 보호조치 및 보안 통제",
        "look_for": ["접근통제", "암호화", "접속기록", "내부관리계획", "물리적 보호조치"],
    },
    {
        "id": "신용정보",
        "meaning": "개인신용정보, 신용정보법, 금융거래정보, 신용평가/마이데이터 관련 처리",
        "look_for": ["개인신용정보", "신용거래정보", "신용정보법", "금융거래 종료 후 5년", "마이데이터"],
    },
    {
        "id": "개인정보",
        "meaning": "개인정보 일반 처리, 정보주체 권리, 보유·파기, 자동수집, 행태정보, 가명정보",
        "look_for": ["정보주체 권리", "파기", "자동 수집 장치", "행태정보", "가명정보"],
    },
]


# Section design is informed by:
# - 개인정보 보호법/시행령의 개인정보 처리방침 고지 항목
# - NIST Privacy Framework functions: Identify-P, Govern-P, Control-P, Communicate-P, Protect-P
# - NIST CSF profile approach: current/target profile, gap, action-oriented communication
REQUIRED_COVERAGE_TOPICS = [
    "문서 목적 및 적용 범위",
    "처리 목적",
    "처리 항목",
    "보유 및 이용기간",
    "제3자 제공",
    "처리위탁 및 재위탁",
    "국외 이전",
    "파기",
    "정보주체 권리 및 행사방법",
    "안전성 확보조치",
    "자동 수집 장치 및 행태정보",
    "가명정보",
    "신용정보/민감정보/생체정보/연계정보(CI)",
    "책임자 및 고충처리",
    "변경 고지 및 시행일",
]


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


def extract_raw_md() -> None:
    """internal_raw/*.pdf -> internal_raw_md/*.md."""
    RAW_MD.mkdir(exist_ok=True)
    print(f"\n[1/3] PDF -> raw_md ({len(SPECS)}건)")
    for spec in SPECS:
        pdf_path = RAW / spec.raw_filename
        if not pdf_path.exists():
            print(f"  raw 파일 없음: {spec.raw_filename}")
            continue

        out_name = pdf_path.stem + ".md"
        if (RAW_MD / out_name).exists():
            print(f"  skip: {out_name} (이미 존재)")
            continue

        print(f"  convert: {spec.raw_filename}")
        opendataloader_pdf.convert(
            input_path=str(pdf_path),
            output_dir=str(RAW_MD),
            format="markdown",
            quiet=True,
            image_output="off",
        )


def yaml_inline_list(values: list[str]) -> str:
    if not values:
        return "[]"
    quoted = []
    for value in values:
        text = str(value).replace("\\", "\\\\").replace('"', '\\"')
        quoted.append(f'"{text}"')
    return "[" + ", ".join(quoted) + "]"


def as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def as_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n\n[TRUNCATED]"


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def compact_for_search(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def find_quote_line(raw_text: str, quote: str) -> int:
    quote = normalize_space(quote)
    if not quote:
        return 0

    lines = raw_text.splitlines()
    quote_compact = compact_for_search(quote)
    for idx, line in enumerate(lines, start=1):
        if quote in normalize_space(line) or quote_compact in compact_for_search(line):
            return idx

    window = ""
    start_line = 1
    for idx, line in enumerate(lines, start=1):
        if not window:
            start_line = idx
        window = normalize_space(f"{window} {line}")
        if len(window) > max(len(quote) * 2, 500):
            window = normalize_space(line)
            start_line = idx
        if quote in window or quote_compact in compact_for_search(window):
            return start_line
    return 0


def validate_quote(raw_text: str, quote: str, source_line: Any = 0) -> EvidenceItem:
    quote = as_str(quote)
    line = int(source_line or 0) if str(source_line or "").isdigit() else 0
    found_line = find_quote_line(raw_text, quote)
    if found_line:
        return EvidenceItem(quote=quote, source_line=found_line, validation="verified")
    if quote:
        return EvidenceItem(quote=quote, source_line=line, validation="not_found")
    return EvidenceItem(quote="", source_line=0, validation="missing")


def add_validation_note(notes: list[str], message: str) -> None:
    if message and message not in notes:
        notes.append(message)


def sanitize_entry_with_evidence(
    raw_text: str,
    entry: Any,
    text_keys: list[str],
    notes: list[str],
) -> dict[str, Any]:
    if not isinstance(entry, dict):
        add_validation_note(notes, f"dict가 아닌 항목 제거: {entry!r}")
        return {}

    cleaned: dict[str, Any] = {}
    for key, value in entry.items():
        if key in {"evidence_quote", "source_line", "validation"}:
            continue
        if key in text_keys:
            cleaned[key] = as_str(value)
        elif key in {"sub_area", "target_sections", "related_topics", "terms", "evidence_quotes"}:
            cleaned[key] = [as_str(item) for item in as_list(value) if as_str(item)]
        else:
            cleaned[key] = value

    evidence = validate_quote(raw_text, entry.get("evidence_quote", ""), entry.get("source_line", 0))
    cleaned["evidence_quote"] = evidence.quote
    cleaned["source_line"] = evidence.source_line
    cleaned["validation"] = evidence.validation
    if evidence.validation == "not_found":
        add_validation_note(notes, f"원문에서 evidence_quote를 찾지 못함: {evidence.quote[:80]}")
    return cleaned


def parse_analysis(raw_text: str, payload: dict[str, Any]) -> InternalPolicyAnalysis:
    notes: list[str] = []
    profile = payload.get("document_profile", {})
    if not isinstance(profile, dict):
        profile = {}
        add_validation_note(notes, "document_profile이 dict가 아니어서 비움")

    core_summary = [
        item
        for item in (
            sanitize_entry_with_evidence(raw_text, item, ["text"], notes)
            for item in as_list(payload.get("core_summary"))
        )
        if item
    ]
    control_map = [
        item
        for item in (
            sanitize_entry_with_evidence(
                raw_text,
                item,
                ["control_area", "policy_requirement", "operating_standard", "owner_hint", "risk_if_changed"],
                notes,
            )
            for item in as_list(payload.get("control_map"))
        )
        if item
    ]
    processing_coverage = [
        item
        for item in (
            sanitize_entry_with_evidence(raw_text, item, ["topic", "status", "summary"], notes)
            for item in as_list(payload.get("processing_coverage"))
        )
        if item
    ]
    review_points = [
        item
        for item in (
            sanitize_entry_with_evidence(raw_text, item, ["trigger", "review_action", "reason"], notes)
            for item in as_list(payload.get("review_points"))
        )
        if item
    ]

    external_matching_terms = []
    allowed_sub_areas = {item["id"] for item in SUB_AREA_TAXONOMY}
    for item in as_list(payload.get("external_matching_terms")):
        if not isinstance(item, dict):
            continue
        sub_area = as_str(item.get("sub_area"))
        if sub_area not in allowed_sub_areas:
            add_validation_note(notes, f"알 수 없는 sub_area 제거: {sub_area}")
            continue
        external_matching_terms.append({
            "sub_area": sub_area,
            "terms": [as_str(term) for term in as_list(item.get("terms")) if as_str(term)],
            "rationale": as_str(item.get("rationale")),
        })

    gaps = []
    for item in as_list(payload.get("gaps_or_uncertainties")):
        if not isinstance(item, dict):
            continue
        gaps.append({
            "item": as_str(item.get("item")),
            "reason": as_str(item.get("reason")),
            "severity": as_str(item.get("severity") or "medium"),
        })

    evidence_index: list[EvidenceItem] = []
    for collection in (core_summary, control_map, processing_coverage, review_points):
        for item in collection:
            quote = as_str(item.get("evidence_quote"))
            if quote:
                evidence_index.append(EvidenceItem(
                    quote=quote,
                    source_line=int(item.get("source_line") or 0),
                    validation=as_str(item.get("validation") or "unverified"),
                ))

    if not core_summary:
        add_validation_note(notes, "core_summary가 비어 있음")
    if not control_map:
        add_validation_note(notes, "control_map이 비어 있음")
    if not processing_coverage:
        add_validation_note(notes, "processing_coverage가 비어 있음")

    return InternalPolicyAnalysis(
        generated_by=as_str(payload.get("generated_by") or "llm"),
        analysis_version=as_str(payload.get("analysis_version") or "internal-wiki-llm-v1"),
        document_profile=profile,
        core_summary=core_summary,
        control_map=control_map,
        processing_coverage=processing_coverage,
        review_points=review_points,
        external_matching_terms=external_matching_terms,
        gaps_or_uncertainties=gaps,
        evidence_index=evidence_index,
        validation_notes=notes,
    )


def analysis_to_json(analysis: InternalPolicyAnalysis) -> dict[str, Any]:
    return {
        "generated_by": analysis.generated_by,
        "analysis_version": analysis.analysis_version,
        "document_profile": analysis.document_profile,
        "core_summary": analysis.core_summary,
        "control_map": analysis.control_map,
        "processing_coverage": analysis.processing_coverage,
        "review_points": analysis.review_points,
        "external_matching_terms": analysis.external_matching_terms,
        "gaps_or_uncertainties": analysis.gaps_or_uncertainties,
        "evidence_index": [
            {
                "quote": item.quote,
                "source_line": item.source_line,
                "validation": item.validation,
            }
            for item in analysis.evidence_index
        ],
        "validation_notes": analysis.validation_notes,
    }


def cache_path_for(spec: DocSpec) -> Path:
    return LLM_CACHE / f"{Path(spec.wiki_filename).stem}.json"


def load_nanobot_llm_config(config_path: Path) -> tuple[str | None, str | None]:
    if not config_path.exists():
        return None, None

    data = json.loads(config_path.read_text(encoding="utf-8"))
    defaults = data.get("agents", {}).get("defaults", {})
    provider_name = defaults.get("provider") or "openrouter"
    model = defaults.get("model")
    provider_config = data.get("providers", {}).get(provider_name, {})
    api_key = provider_config.get("apiKey") or provider_config.get("api_key")
    return as_str(model) or None, as_str(api_key) or None


def load_cached_analysis(spec: DocSpec, raw_text: str) -> InternalPolicyAnalysis | None:
    path = cache_path_for(spec)
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    return parse_analysis(raw_text, payload)


def save_cached_analysis(spec: DocSpec, analysis: InternalPolicyAnalysis) -> None:
    LLM_CACHE.mkdir(parents=True, exist_ok=True)
    cache_path_for(spec).write_text(
        json.dumps(analysis_to_json(analysis), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def is_usable_analysis(analysis: InternalPolicyAnalysis) -> bool:
    return bool(analysis.core_summary and analysis.control_map and analysis.processing_coverage)


def load_existing_related_external(wiki_path: Path) -> list[str]:
    if not wiki_path.exists():
        return []

    text = wiki_path.read_text(encoding="utf-8")
    related: list[str] = []

    frontmatter = re.search(r"^---\n(.*?)\n---", text, flags=re.S)
    if frontmatter:
        value = re.search(r"^related_external:\s*(\[[^\n]*\])", frontmatter.group(1), flags=re.M)
        if value:
            raw_value = value.group(1).strip()
            quoted_values = re.findall(r'"([^"]*)"', raw_value)
            if quoted_values:
                related.extend(quoted_values)
            elif raw_value != "[]":
                related.extend(item.strip() for item in raw_value.strip("[]").split(",") if item.strip())

    related_section = re.search(
        r"^# 관련 외규 \(자동 갱신\).*?\n(.*?)(?=\n# 변경 이력|\Z)",
        text,
        flags=re.M | re.S,
    )
    if related_section:
        related.extend(re.findall(r"\[\[([^\]]+)\]\]", related_section.group(1)))

    deduped: list[str] = []
    for item in related:
        if item and item not in deduped:
            deduped.append(item)
    return deduped


def build_llm_system_prompt() -> str:
    return """\
당신은 금융회사 개인정보보호/신용정보 컴플라이언스 내규를 정리하는 전문가입니다.
입력으로 제공되는 internal_raw_md 원문과 기존 wiki 형식을 참고해, 사람이 읽고 외규-내규 매칭에도 쓸 수 있는 구조화 JSON을 작성합니다.

원칙:
- 원문에 근거가 없는 내용을 만들지 마세요.
- 모든 core_summary, control_map, processing_coverage, review_points 항목에는 evidence_quote를 넣으세요.
- evidence_quote는 반드시 입력 원문에서 그대로 찾을 수 있는 짧은 구절이어야 합니다.
- 모르는 항목은 추측하지 말고 gaps_or_uncertainties에 적으세요.
- 문서가 은행 공개 처리방침이라도, 회사 실제 내규를 갈음하는 자료로 읽히도록 통제/검토 관점으로 정리하세요.
- 최종 응답은 JSON object만 반환하세요. markdown을 반환하지 마세요.
"""


def build_llm_user_prompt(
    spec: DocSpec,
    raw_text: str,
    existing_wiki: str,
    max_input_chars: int,
) -> str:
    taxonomy_json = json.dumps(SUB_AREA_TAXONOMY, ensure_ascii=False, indent=2)
    required_topics_json = json.dumps(REQUIRED_COVERAGE_TOPICS, ensure_ascii=False, indent=2)
    schema = {
        "generated_by": "llm",
        "analysis_version": "internal-wiki-llm-v1",
        "document_profile": {
            "purpose": "문서의 목적",
            "scope": "적용 범위",
            "data_subjects": ["고객", "임직원 등"],
            "data_categories": ["개인정보", "개인신용정보 등"],
            "processing_lifecycle": ["수집", "이용", "보관", "제공", "위탁", "파기"],
            "regulatory_basis": ["개인정보 보호법", "신용정보법 등"],
        },
        "core_summary": [
            {
                "text": "이 문서의 핵심 의미를 1문장으로 요약",
                "evidence_quote": "원문 짧은 인용",
                "source_line": 0,
            }
        ],
        "control_map": [
            {
                "control_area": "처리위탁",
                "sub_area": ["처리위탁"],
                "policy_requirement": "문서가 요구/선언하는 통제",
                "operating_standard": "운영 시 확인해야 하는 기준",
                "owner_hint": "추정 관리 부서/역할",
                "risk_if_changed": "관련 외규 변경 시 영향",
                "evidence_quote": "원문 짧은 인용",
                "source_line": 0,
            }
        ],
        "processing_coverage": [
            {
                "topic": "제3자 제공",
                "status": "covered | partial | not_found",
                "summary": "커버 여부와 근거 요약",
                "related_topics": ["보유기간", "동의"],
                "evidence_quote": "원문 짧은 인용",
                "source_line": 0,
            }
        ],
        "review_points": [
            {
                "trigger": "외규/운영 변경 트리거",
                "review_action": "내규 검토 시 해야 할 일",
                "target_sections": ["제5조 등 원문 조항명"],
                "reason": "왜 봐야 하는지",
                "evidence_quote": "원문 짧은 인용",
                "source_line": 0,
            }
        ],
        "external_matching_terms": [
            {
                "sub_area": "제3자제공",
                "terms": ["제공받는 자", "제공 목적", "보유·이용기간"],
                "rationale": "외규 문서와 매칭할 때 유용한 이유",
            }
        ],
        "gaps_or_uncertainties": [
            {
                "item": "원문에서 불명확하거나 별도 문서 확인이 필요한 항목",
                "reason": "불확실한 이유",
                "severity": "low | medium | high",
            }
        ],
    }
    return f"""\
[문서 메타]
- title: {spec.title}
- source_institution: {spec.source_institution}
- document_type: {spec.document_type}
- predefined_sub_area: {', '.join(spec.sub_area)}
- substitution_note: {spec.substitution_note}

[sub_area taxonomy]
{taxonomy_json}

[처리방침/내규 커버리지로 확인할 주요 항목]
{required_topics_json}

[출력 JSON schema 예시]
{json.dumps(schema, ensure_ascii=False, indent=2)}

[기존 internal_wiki 형식 참고]
기존 문구는 참고만 하세요. 원문 근거가 없는 해석은 재사용하지 마세요.
{truncate(existing_wiki, 14000) if existing_wiki else "(기존 wiki 없음)"}

[internal_raw_md 원문]
아래 원문을 기준으로 JSON을 작성하세요. evidence_quote는 반드시 아래 원문에서 찾을 수 있는 짧은 구절이어야 합니다.
{truncate(raw_text, max_input_chars)}
"""


def call_llm_analysis(
    spec: DocSpec,
    raw_md_path: Path,
    wiki_path: Path,
    model: str,
    max_input_chars: int,
    api_key: str | None,
) -> InternalPolicyAnalysis:
    if str(TOOLS) not in sys.path:
        sys.path.insert(0, str(TOOLS))

    from reg_pipeline.llm_judge.client import LLMClient

    raw_text = raw_md_path.read_text(encoding="utf-8")
    existing_wiki = wiki_path.read_text(encoding="utf-8") if wiki_path.exists() else ""
    client = LLMClient(model=model, api_key=api_key)
    raw_response = client.chat(
        system=build_llm_system_prompt(),
        user=build_llm_user_prompt(spec, raw_text, existing_wiki, max_input_chars),
        temperature=0.1,
        max_tokens=6000,
        json_mode=True,
    )
    payload = json.loads(raw_response)
    return parse_analysis(raw_text, payload)


def build_frontmatter(spec: DocSpec, related_external: list[str]) -> str:
    inst_short = spec.source_institution.split("+")[0].strip()
    all_tags = list(spec.tags)
    all_tags.append("출처/내규갈음")
    all_tags.append(f"출처/{inst_short}")
    all_tags.append("status/active")
    all_tags.extend(f"영역/{sa}" for sa in spec.sub_area)
    tags_yaml = "\n".join(f"  - {tag}" for tag in all_tags)
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
analysis_method: "llm_structured_json"
related_external: {yaml_inline_list(related_external)}
---

"""


def bullet_lines(items: list[dict[str, Any]], key: str = "text") -> str:
    lines = []
    for item in items:
        text = as_str(item.get(key))
        if not text:
            continue
        evidence = evidence_suffix(item)
        lines.append(f"- {text}{evidence}")
    return "\n".join(lines) or "- (LLM 분석 결과 없음)"


def evidence_suffix(item: dict[str, Any]) -> str:
    line = int(item.get("source_line") or 0)
    validation = as_str(item.get("validation"))
    if line and validation == "verified":
        return f" `raw_md:{line}`"
    if line:
        return f" `raw_md:{line}, evidence 미검증`"
    if as_str(item.get("evidence_quote")):
        return " `evidence 미검증`"
    return ""


def quote_block(item: dict[str, Any]) -> str:
    quote = as_str(item.get("evidence_quote"))
    if not quote:
        return ""
    quote = quote.replace("\n", " ")
    line = int(item.get("source_line") or 0)
    validation = as_str(item.get("validation") or "unverified")
    location = f"raw_md {line}행" if line else "raw_md 행 미확인"
    return f"> {quote}\n>\n> 출처: {location}, 검증: {validation}"


def render_document_profile(profile: dict[str, Any]) -> str:
    rows = [
        ("목적", as_str(profile.get("purpose"))),
        ("적용 범위", as_str(profile.get("scope"))),
        ("정보주체", ", ".join(as_str(item) for item in as_list(profile.get("data_subjects")) if as_str(item))),
        ("정보 유형", ", ".join(as_str(item) for item in as_list(profile.get("data_categories")) if as_str(item))),
        ("처리 생애주기", ", ".join(as_str(item) for item in as_list(profile.get("processing_lifecycle")) if as_str(item))),
        ("규제 근거", ", ".join(as_str(item) for item in as_list(profile.get("regulatory_basis")) if as_str(item))),
    ]
    body = "\n".join(f"| {name} | {value or '(미기재)'} |" for name, value in rows)
    return f"""| 항목 | 내용 |
|---|---|
{body}"""


def render_control_map(controls: list[dict[str, Any]]) -> str:
    if not controls:
        return "- (LLM 분석 결과 없음)"

    sections = []
    for control in controls:
        sub_areas = ", ".join(as_str(item) for item in as_list(control.get("sub_area")) if as_str(item))
        sections.append(f"""### {as_str(control.get("control_area")) or "통제 영역 미기재"}

- **연결 sub_area**: {sub_areas or "(미기재)"}
- **정책 요구사항**: {as_str(control.get("policy_requirement")) or "(미기재)"}
- **운영 기준**: {as_str(control.get("operating_standard")) or "(미기재)"}
- **담당 역할 힌트**: {as_str(control.get("owner_hint")) or "(미기재)"}
- **외규 변경 시 리스크**: {as_str(control.get("risk_if_changed")) or "(미기재)"}

{quote_block(control)}
""")
    return "\n".join(sections).strip()


def render_processing_coverage(items: list[dict[str, Any]]) -> str:
    if not items:
        return "- (LLM 분석 결과 없음)"

    rows = []
    for item in items:
        topic = as_str(item.get("topic")) or "(미기재)"
        status = as_str(item.get("status")) or "(미기재)"
        summary = as_str(item.get("summary")) or "(미기재)"
        line = int(item.get("source_line") or 0)
        source = f"raw_md:{line}" if line else "미확인"
        rows.append(f"| {topic} | {status} | {summary} | {source} |")
    return "\n".join([
        "| 항목 | 상태 | 요약 | 근거 |",
        "|---|---|---|---|",
        *rows,
    ])


def render_review_points(items: list[dict[str, Any]]) -> str:
    if not items:
        return "- (LLM 분석 결과 없음)"

    blocks = []
    for item in items:
        targets = ", ".join(as_str(section) for section in as_list(item.get("target_sections")) if as_str(section))
        blocks.append(f"""### {as_str(item.get("trigger")) or "검토 트리거 미기재"}

- **검토 액션**: {as_str(item.get("review_action")) or "(미기재)"}
- **대상 조항/섹션**: {targets or "(미기재)"}
- **검토 이유**: {as_str(item.get("reason")) or "(미기재)"}

{quote_block(item)}
""")
    return "\n".join(blocks).strip()


def render_external_matching_terms(items: list[dict[str, Any]]) -> str:
    if not items:
        return "- (LLM 분석 결과 없음)"

    lines = []
    for item in items:
        terms = ", ".join(as_str(term) for term in as_list(item.get("terms")) if as_str(term))
        rationale = as_str(item.get("rationale"))
        lines.append(f"- **{as_str(item.get('sub_area'))}**: {terms or '(미기재)'}")
        if rationale:
            lines.append(f"  - 근거: {rationale}")
    return "\n".join(lines)


def render_gaps(items: list[dict[str, Any]]) -> str:
    if not items:
        return "- (없음)"
    return "\n".join(
        f"- **{as_str(item.get('severity')) or 'medium'}**: {as_str(item.get('item'))} - {as_str(item.get('reason'))}"
        for item in items
        if as_str(item.get("item")) or as_str(item.get("reason"))
    ) or "- (없음)"


def render_evidence_index(items: list[EvidenceItem]) -> str:
    if not items:
        return "- (LLM 근거 없음)"

    seen: set[str] = set()
    lines = []
    for item in items:
        if not item.quote or item.quote in seen:
            continue
        seen.add(item.quote)
        source = f"raw_md:{item.source_line}" if item.source_line else "행 미확인"
        lines.append(f"- `{source}` ({item.validation}) {item.quote}")
    return "\n".join(lines) or "- (LLM 근거 없음)"


def render_validation_notes(notes: list[str]) -> str:
    if not notes:
        return "- 모든 LLM 근거 검증이 통과했거나 추가 경고가 없습니다."
    return "\n".join(f"- {note}" for note in notes)


def build_related_external_section(related_external: list[str]) -> str:
    if not related_external:
        return "- (아직 없음)"
    return "\n".join(f"- [[{title}]]" for title in related_external)


def build_wiki_body(
    spec: DocSpec,
    raw_md_path: Path,
    analysis: InternalPolicyAnalysis,
    related_external: list[str],
) -> str:
    raw_md_stem = raw_md_path.stem
    raw_md_size_kb = raw_md_path.stat().st_size // 1024 if raw_md_path.exists() else 0
    raw_md_lines = raw_md_path.read_text(encoding="utf-8").count("\n") if raw_md_path.exists() else 0

    return f"""# 개요

- **발행처**: {spec.source_institution}
- **원천 발행일**: {spec.date}
- **회사 시행일**: {spec.effective_date}
- **버전**: {spec.version}
- **영역**: {', '.join(spec.sub_area)}
- **분석 방식**: LLM 구조화 JSON + 원문 근거 검증

> {spec.substitution_note}

# 문서 프로파일

{render_document_profile(analysis.document_profile)}

# 핵심 요약

{bullet_lines(analysis.core_summary, "text")}

# 주요 통제 및 운영 기준

{render_control_map(analysis.control_map)}

# 개인정보 처리 커버리지

{render_processing_coverage(analysis.processing_coverage)}

# 외규 매칭 관점

외규가 들어왔을 때 본 내규와 연결하기 좋은 용어와 판단 축입니다.

{render_external_matching_terms(analysis.external_matching_terms)}

# 실무 검토 포인트

{render_review_points(analysis.review_points)}

# 불확실성 및 추가 확인 필요

{render_gaps(analysis.gaps_or_uncertainties)}

# 원문 근거 인덱스

{render_evidence_index(analysis.evidence_index)}

# LLM 검증 메모

{render_validation_notes(analysis.validation_notes)}

# 본문 (원문 참조)

본문 전체는 wiki에 포함하지 않고 별도 보관 (Option C 정책):

- **원문 PDF**: [`{spec.raw_filename}`](../../internal_raw/{spec.raw_filename})
- **마크다운 추출본** ({raw_md_size_kb}KB, {raw_md_lines}줄): [`internal_raw_md/{raw_md_stem}.md`](../../internal_raw_md/{raw_md_stem}.md)
- **LLM 분석 캐시**: [`_llm_cache/{Path(spec.wiki_filename).stem}.json`](../_llm_cache/{Path(spec.wiki_filename).stem}.json)

> 마크다운 추출본은 opendataloader-pdf로 생성. LLM 분석·벡터 임베딩·검색은 마크다운 추출본 사용.

# 관련 외규 (자동 갱신)

> 외규 영향도 분석 시 본 내규에 매칭된 외규가 여기에 누적됨.

{build_related_external_section(related_external)}

# 변경 이력

- {spec.version} ({spec.effective_date}): LLM 구조화 분석 기반 wiki 렌더링
"""


def selected_specs(only: str | None = None) -> list[DocSpec]:
    if not only:
        return SPECS
    needle = only.casefold()
    return [
        spec for spec in SPECS
        if needle in spec.title.casefold()
        or needle in spec.wiki_filename.casefold()
        or needle in Path(spec.wiki_filename).stem.casefold()
    ]


def build_wiki(
    use_llm: bool,
    refresh_llm: bool,
    model: str,
    max_input_chars: int,
    api_key: str | None,
    only: str | None = None,
) -> None:
    specs = selected_specs(only)
    print(f"\n[2/3] raw_md -> LLM JSON -> wiki ({len(specs)}건)")
    for folder in {"개인정보", "_MOC"}:
        (WIKI / folder).mkdir(parents=True, exist_ok=True)

    for spec in specs:
        raw_md_path = RAW_MD / (Path(spec.raw_filename).stem + ".md")
        if not raw_md_path.exists():
            print(f"  raw_md 없음: {raw_md_path.name}")
            continue

        wiki_path = WIKI / spec.folder / spec.wiki_filename
        raw_text = raw_md_path.read_text(encoding="utf-8")
        related_external = load_existing_related_external(wiki_path)

        analysis = None if refresh_llm else load_cached_analysis(spec, raw_text)
        if analysis:
            print(f"  cache: {cache_path_for(spec).relative_to(ROOT)}")
        elif use_llm:
            print(f"  llm: {spec.title} ({model})")
            analysis = call_llm_analysis(spec, raw_md_path, wiki_path, model, max_input_chars, api_key)
            if not is_usable_analysis(analysis):
                raise RuntimeError(f"LLM 분석 결과가 비어 있거나 필수 섹션이 부족합니다: {spec.title}")
            save_cached_analysis(spec, analysis)
        else:
            print(f"  skip: {spec.wiki_filename} (LLM cache 없음; --use-llm 필요)")
            continue

        wiki_path.write_text(
            build_frontmatter(spec, related_external) + build_wiki_body(spec, raw_md_path, analysis, related_external),
            encoding="utf-8",
        )
        size_kb = wiki_path.stat().st_size / 1024
        print(f"  write: {wiki_path.relative_to(ROOT)} ({size_kb:.1f}KB)")


def build_moc(sub_area: str, related_internal: list[DocSpec]) -> str:
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


def build_all_mocs() -> None:
    print("\n[3/3] MOC 영역 인덱스 생성")
    all_sub_areas = sorted({sa for spec in SPECS for sa in spec.sub_area})
    for sub_area in all_sub_areas:
        related = [spec for spec in SPECS if sub_area in spec.sub_area]
        moc_path = WIKI / "_MOC" / f"MOC_{sub_area}.md"
        moc_path.write_text(build_moc(sub_area, related), encoding="utf-8")
        print(f"  write: MOC_{sub_area}.md ({len(related)}건 연결)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate internal_wiki from internal_raw_md via LLM JSON analysis.")
    parser.add_argument(
        "--use-llm",
        action="store_true",
        help="Call OpenRouter through reg_pipeline LLMClient when cache is missing.",
    )
    parser.add_argument(
        "--refresh-llm",
        action="store_true",
        help="Ignore existing _llm_cache and call LLM again. Implies --use-llm.",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="OpenRouter model name for LLM extraction. Defaults to ~/.nanobot/config.json agents.defaults.model.",
    )
    parser.add_argument(
        "--nanobot-config",
        default=str(Path.home() / ".nanobot" / "config.json"),
        help="nanobot config path used for OpenRouter apiKey/model defaults.",
    )
    parser.add_argument(
        "--max-input-chars",
        type=int,
        default=120_000,
        help="Maximum raw_md characters sent to the LLM.",
    )
    parser.add_argument(
        "--skip-pdf",
        action="store_true",
        help="Skip PDF -> raw_md extraction step.",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="Generate only specs whose title or wiki filename contains this text.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    use_llm = bool(args.use_llm or args.refresh_llm)
    config_model, api_key = load_nanobot_llm_config(Path(args.nanobot_config).expanduser())
    model = args.model or config_model or "google/gemma-4-31b-it"

    print("=" * 60)
    print("내규 갈음 wiki 생성")
    print("  internal_raw/      원본 PDF")
    print("  internal_raw_md/   본문 마크다운")
    print("  internal_wiki/     LLM 구조화 분석 렌더링")
    print("=" * 60)

    if not args.skip_pdf:
        extract_raw_md()
    else:
        print("\n[1/3] PDF -> raw_md skip")

    build_wiki(
        use_llm=use_llm,
        refresh_llm=bool(args.refresh_llm),
        model=model,
        max_input_chars=args.max_input_chars,
        api_key=api_key,
        only=args.only,
    )
    build_all_mocs()
    print("\n완료")


if __name__ == "__main__":
    main()
