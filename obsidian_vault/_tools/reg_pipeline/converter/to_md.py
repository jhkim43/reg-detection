"""raw 파일 통합 마크다운 변환기.

진입점: convert_to_md(raw_path, out_path) → bool
배치: BatchConverter(raw_root, out_root).run()
"""

import json
import shutil
import struct
from pathlib import Path
from typing import Callable

_PDF_AVAILABLE: bool | None = None


def _opendataloader_available() -> bool:
    global _PDF_AVAILABLE
    if _PDF_AVAILABLE is None:
        try:
            import opendataloader_pdf  # noqa: F401
            _PDF_AVAILABLE = True
        except ImportError:
            _PDF_AVAILABLE = False
    return _PDF_AVAILABLE


# ============================================================
# 포맷별 변환 함수
# ============================================================

def convert_pdf(pdf_path: Path, out_dir: Path) -> Path | None:
    """PDF → opendataloader-pdf 마크다운."""
    if not _opendataloader_available():
        return None
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
        out = out_dir / (pdf_path.stem + ".md")
        return out if out.exists() else None
    except Exception:
        return None


def convert_md(md_path: Path, out_path: Path) -> Path:
    """MD → 그대로 복사."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(md_path, out_path)
    return out_path


def convert_json(json_path: Path, out_path: Path) -> Path | None:
    """JSON → 마크다운 (재귀 파싱).

    law_center 정형 데이터에 최적화.
    구조 예: {"법령": {"조문": {"조문내용": [...]}}}
    """
    try:
        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None

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
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


def convert_hwp(hwp_path: Path, out_path: Path) -> Path | None:
    """HWP v5 → 마크다운 (olefile + zlib).

    crawler.py extract_hwp_text_pure 포팅.
    """
    try:
        import olefile
        import zlib
    except ImportError:
        return None

    try:
        if not olefile.isOleFile(str(hwp_path)):
            return None
        ole = olefile.OleFileIO(str(hwp_path))
        sections = sorted(
            path for path in ole.listdir()
            if len(path) >= 2 and path[0] == "BodyText" and path[1].startswith("Section")
        )
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
                        clean = []
                        for c in text_str:
                            val = ord(c)
                            if 1 <= val <= 31:
                                if val in (9, 10, 13):
                                    clean.append(c)
                            elif 0x4E00 <= val <= 0x9FFF:
                                # 일부 구조 잡음 한자 제외
                                if val not in (0x6364, 0x7365, 0x746F, 0x6F63,
                                                0x6C20, 0x7462, 0x6E70, 0x6770):
                                    clean.append(c)
                            else:
                                clean.append(c)
                        text = "".join(clean).strip()
                        if text:
                            paragraphs.append(text)
                    except Exception:
                        pass

        full_text = "\n\n".join(paragraphs)
        if not full_text.strip():
            return None
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(f"# {hwp_path.stem}\n\n{full_text}", encoding="utf-8")
        return out_path
    except Exception:
        return None


def convert_hwpx(hwpx_path: Path, out_path: Path) -> Path | None:
    """HWPX → 마크다운 (zipfile + xml)."""
    try:
        import zipfile
        import xml.etree.ElementTree as ET
        text_parts: list[str] = []
        with zipfile.ZipFile(hwpx_path) as z:
            section_files = sorted(
                f for f in z.namelist()
                if f.startswith("Contents/section") and f.endswith(".xml")
            )
            for sf in section_files:
                root = ET.fromstring(z.read(sf))
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
    except Exception:
        return None


# ============================================================
# 통합 dispatcher
# ============================================================

EXTRACTORS: dict[str, Callable] = {
    ".pdf":  lambda src, dst: convert_pdf(src, dst.parent),
    ".md":   convert_md,
    ".json": convert_json,
    ".hwp":  convert_hwp,
    ".hwpx": convert_hwpx,
}


def convert_to_md(raw_path: Path, out_path: Path) -> Path | None:
    """단일 raw 파일 → MD 변환.

    Returns:
        성공: 출력 Path
        실패 또는 미지원 포맷: None
    """
    suffix = raw_path.suffix.lower()
    fn = EXTRACTORS.get(suffix)
    if not fn:
        return None
    return fn(raw_path, out_path)


# ============================================================
# 배치 처리
# ============================================================

class BatchConverter:
    """폴더 트리 전체 일괄 변환.

    예: BatchConverter(
            raw_root=Path("external_raw/reference"),
            out_root=Path("external_raw_md/reference"),
        ).run()
    """

    def __init__(self, raw_root: Path, out_root: Path):
        self.raw_root = raw_root
        self.out_root = out_root

    def run(self, skip_existing: bool = True) -> dict:
        results = {"success": 0, "skip": 0, "failed": 0, "unsupported": 0, "by_source": {}}
        if not self.raw_root.exists():
            return results

        for source_dir in sorted(p for p in self.raw_root.iterdir() if p.is_dir()):
            src_name = source_dir.name
            src_stats = {"success": 0, "skip": 0, "failed": 0, "unsupported": 0}
            out_dir = self.out_root / src_name

            for raw_file in sorted(source_dir.rglob("*")):
                if not raw_file.is_file():
                    continue
                suffix = raw_file.suffix.lower()
                if suffix not in EXTRACTORS:
                    src_stats["unsupported"] += 1
                    continue

                out_path = out_dir / (raw_file.stem + ".md")
                if skip_existing and out_path.exists():
                    src_stats["skip"] += 1
                    continue

                result = convert_to_md(raw_file, out_path)
                if result and result.exists():
                    src_stats["success"] += 1
                else:
                    src_stats["failed"] += 1

            results["by_source"][src_name] = src_stats
            for k, v in src_stats.items():
                results[k] += v

        return results
