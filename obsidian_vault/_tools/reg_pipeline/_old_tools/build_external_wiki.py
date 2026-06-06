"""
external_raw → external_raw_md → external_wiki 파이프라인.

흐름:
  [1] 본문 추출:
      - PDF → opendataloader-pdf
      - MD → 그대로 복사
      - JSON → 정형 데이터 파싱 (law_center)
      - HWP/HWPX → olefile/zipfile (crawler.py 로직 포팅)
  [2] sub_area 분류 (taxonomy.yaml 기반)
  [3] 필터: 우리 internal 6 sub_area 중 1개 이상 매칭만 통과
  [4] external_wiki 생성:
      - 폴더: external_wiki/개인정보/{발행처}/{파일명}.md
      - frontmatter (sub_area, source_institution, related_internal placeholder)
      - 짧은 본문 인용 + raw_md 링크

사용법:
    export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
    /tmp/playwright-venv/bin/python obsidian_vault/external_wiki/_tools/build_external_wiki.py [--dry-run]
"""

import sys
import re
import json
import shutil
import struct
from pathlib import Path
from collections import defaultdict
import yaml

# Import classify helpers
sys.path.insert(0, str(Path(__file__).parent))
from classify_external import classify_text, get_domain, load_taxonomy, format_date

ROOT = Path(__file__).parent.parent.parent  # obsidian_vault/
EXTERNAL_RAW = ROOT / "external_raw"
EXTERNAL_RAW_MD = ROOT / "external_raw_md"
EXTERNAL_WIKI = ROOT / "external_wiki" / "외규_분류"
TAXONOMY_FILE = Path(__file__).parent / "taxonomy.yaml"

# 우리 internal과 매칭되는 sub_area (시중은행 처리방침이 커버하는 영역)
INTERNAL_SUB_AREAS = {
    "수집동의", "처리위탁", "제3자제공",
    "안전성조치", "신용정보", "개인정보",
}


# ============================================================
# Stage 1: 본문 추출
# ============================================================

def extract_pdf(pdf_path: Path, out_dir: Path) -> Path | None:
    """PDF → opendataloader-pdf."""
    try:
        import opendataloader_pdf
        out_dir.mkdir(parents=True, exist_ok=True)
        opendataloader_pdf.convert(
            input_path=str(pdf_path),
            output_dir=str(out_dir),
            format="markdown",
            quiet=True,
            image_output="off",
        )
        return out_dir / (pdf_path.stem + ".md")
    except Exception as e:
        print(f"  ⚠️ PDF 추출 실패 {pdf_path.name}: {e}")
        return None


def extract_md(md_path: Path, out_path: Path) -> Path:
    """MD → 그대로 복사 (fsec 110건)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(md_path, out_path)
    return out_path


def extract_json(json_path: Path, out_path: Path) -> Path | None:
    """JSON → 마크다운 (law_center 정형 데이터).

    law_center JSON 구조:
      법령.조문.조문내용 (배열)
      법령.부칙
      법령.개정문.개정문내용 (배열)
    """
    try:
        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        # 모든 string 값을 재귀적으로 추출
        lines = [f"# {json_path.stem}\n"]

        def walk(obj, depth=0):
            indent = "  " * depth
            if isinstance(obj, dict):
                for key, val in obj.items():
                    if isinstance(val, (dict, list)):
                        lines.append(f"\n{indent}## {key}\n")
                        walk(val, depth + 1)
                    elif isinstance(val, str) and val.strip():
                        lines.append(f"{indent}- **{key}**: {val.strip()}")
            elif isinstance(obj, list):
                for item in obj:
                    if isinstance(item, (dict, list)):
                        walk(item, depth)
                    elif isinstance(item, str) and item.strip():
                        lines.append(f"{indent}{item.strip()}")

        walk(data)
        out_path.write_text("\n".join(lines), encoding="utf-8")
        return out_path
    except Exception as e:
        print(f"  ⚠️ JSON 추출 실패 {json_path.name}: {e}")
        return None


def extract_hwp(hwp_path: Path, out_path: Path) -> Path | None:
    """HWP v5 → 마크다운 (olefile + zlib).

    crawler.py의 extract_hwp_text_pure 포팅.
    """
    try:
        import olefile
        import zlib

        if not olefile.isOleFile(str(hwp_path)):
            return None

        ole = olefile.OleFileIO(str(hwp_path))
        sections = []
        for path in ole.listdir():
            if len(path) >= 2 and path[0] == "BodyText" and path[1].startswith("Section"):
                sections.append(path)
        sections.sort()

        paragraphs = []
        for section in sections:
            stream = ole.openstream(section)
            data = stream.read()
            try:
                decompressed = zlib.decompress(data, -15)
            except Exception:
                try:
                    decompressed = zlib.decompress(data)
                except Exception:
                    decompressed = data

            offset = 0
            length = len(decompressed)
            while offset < length:
                if offset + 4 > length:
                    break
                header = struct.unpack_from("<I", decompressed, offset)[0]
                offset += 4
                tag_id = header & 0x3FF
                size = (header >> 20) & 0xFFF
                if size == 0xFFF:
                    if offset + 4 > length:
                        break
                    size = struct.unpack_from("<I", decompressed, offset)[0]
                    offset += 4
                if offset + size > length:
                    break
                record_data = decompressed[offset: offset + size]
                offset += size

                if tag_id == 67:  # HWPTAG_PARA_TEXT
                    try:
                        text_str = record_data.decode("utf-16le", errors="ignore")
                        clean_chars = []
                        for c in text_str:
                            val = ord(c)
                            if 1 <= val <= 31:
                                if val in [9, 10, 13]:
                                    clean_chars.append(c)
                            elif 0x4E00 <= val <= 0x9FFF:
                                if val not in [0x6364, 0x7365, 0x746F, 0x6F63, 0x6C20, 0x7462, 0x6E70, 0x6770]:
                                    clean_chars.append(c)
                            else:
                                clean_chars.append(c)
                        paragraph_text = "".join(clean_chars).strip()
                        if paragraph_text:
                            paragraphs.append(paragraph_text)
                    except Exception:
                        pass

        text = "\n\n".join(paragraphs)
        if not text.strip():
            return None
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(f"# {hwp_path.stem}\n\n{text}", encoding="utf-8")
        return out_path
    except Exception as e:
        print(f"  ⚠️ HWP 추출 실패 {hwp_path.name}: {e}")
        return None


def extract_hwpx(hwpx_path: Path, out_path: Path) -> Path | None:
    """HWPX → 마크다운 (zipfile + xml).

    crawler.py의 extract_hwpx_text_pure 포팅.
    """
    try:
        import zipfile
        import xml.etree.ElementTree as ET

        text_parts = []
        with zipfile.ZipFile(hwpx_path) as z:
            section_files = sorted(
                f for f in z.namelist()
                if f.startswith("Contents/section") and f.endswith(".xml")
            )
            for sf in section_files:
                xml_content = z.read(sf)
                root = ET.fromstring(xml_content)
                for elem in root.iter():
                    if elem.tag.endswith("}t") or elem.tag == "t":
                        if elem.text:
                            text_parts.append(elem.text.strip())

        text = "\n\n".join(p for p in text_parts if p)
        if not text.strip():
            return None
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(f"# {hwpx_path.stem}\n\n{text}", encoding="utf-8")
        return out_path
    except Exception as e:
        print(f"  ⚠️ HWPX 추출 실패 {hwpx_path.name}: {e}")
        return None


# ============================================================
# Stage 1 entrypoint: 모든 raw 파일 추출
# ============================================================

def extract_all() -> dict:
    """external_raw/ 전체 → external_raw_md/ 변환.

    Returns:
        {발행처: [(원본Path, raw_md Path)]}
    """
    EXTERNAL_RAW_MD.mkdir(exist_ok=True)
    results = defaultdict(list)
    skipped = defaultdict(int)

    for source in sorted(EXTERNAL_RAW.iterdir()):
        if not source.is_dir():
            continue
        source_name = source.name
        out_dir = EXTERNAL_RAW_MD / source_name
        out_dir.mkdir(exist_ok=True)
        print(f"\n[{source_name}] 처리 중...")

        for raw_file in sorted(source.rglob("*")):
            if not raw_file.is_file():
                continue
            suffix = raw_file.suffix.lower()
            out_path = out_dir / (raw_file.stem + ".md")
            if out_path.exists():
                skipped[source_name] += 1
                results[source_name].append((raw_file, out_path))
                continue

            extracted = None
            if suffix == ".pdf":
                # opendataloader는 자체 출력 경로 결정
                extracted = extract_pdf(raw_file, out_dir)
            elif suffix == ".md":
                extracted = extract_md(raw_file, out_path)
            elif suffix == ".json":
                extracted = extract_json(raw_file, out_path)
            elif suffix == ".hwp":
                extracted = extract_hwp(raw_file, out_path)
            elif suffix == ".hwpx":
                extracted = extract_hwpx(raw_file, out_path)
            else:
                continue  # xlsx, jpg 등 skip

            if extracted and extracted.exists():
                results[source_name].append((raw_file, extracted))

        print(f"  → {len(results[source_name])}건 처리 ({skipped[source_name]}건 skip)")

    return results


# ============================================================
# Stage 2 & 3: 분류 + 필터
# ============================================================

def classify_and_filter(extraction_results: dict, taxonomy: dict) -> list:
    """raw_md 분류 → internal sub_area 매칭만 통과.

    Returns:
        [{'source': ..., 'raw': ..., 'raw_md': ..., 'sub_areas': [...], 'matched': [...]}]
    """
    matched = []
    total = 0
    classified = 0
    internal_matched = 0

    print("\n=== 분류 + 필터 ===")
    for source, files in extraction_results.items():
        src_matched = 0
        for raw_file, raw_md in files:
            total += 1
            try:
                text = raw_md.read_text(encoding="utf-8")
            except Exception:
                continue
            title = raw_md.stem
            sub_areas, skip_reason = classify_text(title, text, taxonomy)
            if sub_areas:
                classified += 1

            # 우리 internal 6 sub_area와 매칭되는 것만
            relevant = [sa for sa in sub_areas if sa in INTERNAL_SUB_AREAS]
            if relevant:
                internal_matched += 1
                src_matched += 1
                matched.append({
                    "source": source,
                    "raw": raw_file,
                    "raw_md": raw_md,
                    "sub_areas": sub_areas,
                    "matched_internal": relevant,
                })
        print(f"  [{source}] {src_matched}건 internal 매칭")

    print(f"\n전체: {total}건, 분류 성공: {classified}건, internal 매칭: {internal_matched}건")
    return matched


# ============================================================
# Stage 4: external_wiki 생성
# ============================================================

def extract_date_from_filename(name: str) -> str:
    """파일명에서 날짜 추출 (YYYYMMDD 또는 YYYY-MM-DD 패턴)."""
    m = re.search(r"(\d{8})", name)
    if m:
        return m.group(1)
    return ""


def build_external_wiki_content(item: dict) -> str:
    """external_wiki MD 콘텐츠 생성."""
    raw_md = item["raw_md"]
    source = item["source"]
    sub_areas = item["matched_internal"]  # internal과 매칭된 것만 표시
    all_sub_areas = item["sub_areas"]
    raw_file = item["raw"]

    title = raw_md.stem
    date_raw = extract_date_from_filename(title)
    date = format_date(date_raw) if date_raw else ""

    source_map = {
        "fsec": "금융보안원",
        "fss": "금융감독원",
        "pipc": "개인정보보호위원회",
        "law_center": "국가법령정보센터",
    }
    institution = source_map.get(source, source)

    # 본문 첫 부분 인용 (1500자)
    raw_text = raw_md.read_text(encoding="utf-8")
    excerpt = raw_text[:1500]
    truncated = len(raw_text) > 1500

    # tags
    tags = ["외규"]
    tags.append(f"출처/{institution}")
    tags.append("status/active")
    tags.extend(f"영역/{sa}" for sa in sub_areas)

    tags_yaml = "\n".join(f"  - {t}" for t in tags)
    sub_areas_yaml = ", ".join(sub_areas)

    return f"""---
title: "{title}"
date: {date}
source_institution: "{institution}"
document_type: "외규"
tags:
{tags_yaml}
status: "active"
type: "외규"
sub_area: [{sub_areas_yaml}]
all_classified_sub_areas: [{', '.join(all_sub_areas)}]
source_doc: "external_raw/{source}/{raw_file.name}"
source_md: "external_raw_md/{source}/{raw_md.name}"
related_internal: []
---

# 개요

- **발행처**: {institution}
- **발행일**: {date or '미상'}
- **영역**: {', '.join(sub_areas)} (internal 매칭)
- **분류 (전체)**: {', '.join(all_sub_areas)}

# 원문 인용 (앞 {len(excerpt)}자)

{excerpt}{"...(중략)" if truncated else ""}

# 출처

- 📄 **원본**: [`external_raw/{source}/{raw_file.name}`](../../external_raw/{source}/{raw_file.name})
- 📝 **추출본**: [`external_raw_md/{source}/{raw_md.name}`](../../external_raw_md/{source}/{raw_md.name})

# 관련 내규 (자동 갱신 예정)

> v13.2: 매칭된 내규를 여기에 자동 누적.

- (아직 없음)
"""


def build_wikis(matched: list, dry_run: bool = False):
    """external_wiki/개인정보/{발행처}/*.md 생성."""
    print(f"\n=== external_wiki 생성 ===")
    out_root = EXTERNAL_WIKI / "개인정보"
    if not dry_run:
        out_root.mkdir(parents=True, exist_ok=True)

    by_source = defaultdict(int)
    for item in matched:
        source = item["source"]
        raw_md = item["raw_md"]
        # 파일명 정제
        safe_name = re.sub(r'[\\/*?:"<>|]', '', raw_md.name)
        out_dir = out_root / source
        out_path = out_dir / safe_name

        if dry_run:
            by_source[source] += 1
            continue

        out_dir.mkdir(parents=True, exist_ok=True)
        content = build_external_wiki_content(item)
        out_path.write_text(content, encoding="utf-8")
        by_source[source] += 1

    for src, cnt in by_source.items():
        print(f"  [{src}] {cnt}건 wiki 생성{'(dry-run)' if dry_run else ''}")
    print(f"  총 {sum(by_source.values())}건")


# ============================================================
# Main
# ============================================================

def main():
    """기본: external_raw → external_raw_md 추출만.

    분류·wiki 생성은 나노봇에서 진행 예정.
    옵션 flag로 분류·wiki 미리보기 가능 (개발용).
    """
    do_classify = "--classify" in sys.argv
    do_wiki = "--build-wiki" in sys.argv
    dry_run = "--dry-run" in sys.argv

    print("=" * 60)
    print(f"external_raw → external_raw_md 일괄 변환 {'(dry-run)' if dry_run else ''}")
    print("=" * 60)

    print("\n[1/N] 본문 추출 (PDF/MD/JSON/HWP/HWPX)")
    extraction_results = extract_all()

    total_extracted = sum(len(v) for v in extraction_results.values())
    print(f"\n📊 추출 결과: 총 {total_extracted}건 raw_md 생성")
    for source, files in extraction_results.items():
        print(f"  [{source}] {len(files)}건")

    if not (do_classify or do_wiki):
        print("\n💡 추가 옵션 (개발용):")
        print("   --classify     분류 + 필터 결과 미리보기")
        print("   --build-wiki   분류 + wiki 생성 (나노봇 영역, 테스트용)")
        print("\n🎉 추출 완료")
        return

    taxonomy = load_taxonomy()
    matched = classify_and_filter(extraction_results, taxonomy)
    if do_wiki:
        build_wikis(matched, dry_run=dry_run)
    print("\n🎉 완료")


if __name__ == "__main__":
    main()
