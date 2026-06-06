"""raw 파일 통합 마크다운 변환기.

진입점: convert_to_md(raw_path, out_path) → bool
배치: BatchConverter(raw_root, out_root).run()
"""

import json
import shutil
import subprocess
import struct
import tempfile
from pathlib import Path
from typing import Callable

_PDF_AVAILABLE: bool | None = None
_LIBREOFFICE_PATH: str | None = None


def _opendataloader_available() -> bool:
    global _PDF_AVAILABLE
    if _PDF_AVAILABLE is None:
        try:
            import opendataloader_pdf  # noqa: F401
            _PDF_AVAILABLE = True
        except ImportError:
            _PDF_AVAILABLE = False
    return _PDF_AVAILABLE


def _find_libreoffice() -> str | None:
    """LibreOffice soffice 경로 탐색 (macOS/Linux/Windows)."""
    global _LIBREOFFICE_PATH
    if _LIBREOFFICE_PATH is not None:
        return _LIBREOFFICE_PATH or None
    import shutil
    # 1) 표준 설치 경로 (OS별)
    candidates = [
        # macOS (Homebrew cask)
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/opt/homebrew/bin/soffice",
        "/usr/local/bin/soffice",
        # Linux (apt/dnf)
        "/usr/bin/soffice",
        "/usr/bin/libreoffice",
        "/snap/bin/libreoffice",
        # Windows (winget/choco 기본 위치)
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ]
    for path in candidates:
        if Path(path).exists():
            _LIBREOFFICE_PATH = path
            return path
    # 2) PATH에서 탐색 (크로스플랫폼 — Windows는 .exe 자동 인식)
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            _LIBREOFFICE_PATH = found
            return found
    _LIBREOFFICE_PATH = ""  # 캐시 (없음)
    return None


def _convert_with_libreoffice(src_path: Path, out_dir: Path) -> Path | None:
    """LibreOffice headless로 HWP/DOC/DOCX → PDF 변환."""
    soffice = _find_libreoffice()
    if not soffice:
        return None
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            [soffice, "--headless", "--convert-to", "pdf",
             "--outdir", str(out_dir), str(src_path)],
            capture_output=True, text=True, timeout=120,
        )
        pdf_path = out_dir / (src_path.stem + ".pdf")
        return pdf_path if pdf_path.exists() else None
    except Exception:
        return None


# ============================================================
# 포맷별 변환 함수
# ============================================================

import re

# CJK 확장 한자 영역 (PDF 폰트 인코딩 잔재로 나오는 거짓 한자)
# 진짜 한자(별표, 부칙 등)는 일반적으로 긴 줄에 있어서 살리고, 단독·짧은 줄만 제거
_CJK_GARBAGE_LINE = re.compile(
    r'^\s*[一-鿿\s]+\s*$',
)
# 너무 짧고 의미 없는 한자 잔재 라인만 (10자 미만)
_MIN_KEEP_LEN = 10


def _strip_cjk_garbage(text: str) -> str:
    """PDF 폰트 잔재 한자만 있는 짧은 줄 제거. 의미 있는 한자는 살림."""
    lines = text.split("\n")
    kept = []
    for line in lines:
        stripped = line.strip()
        if _CJK_GARBAGE_LINE.match(line) and len(stripped) < _MIN_KEEP_LEN:
            continue
        kept.append(line)
    return "\n".join(kept)


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
        if not out.exists():
            return None
        # 한자 잔재 후처리
        try:
            cleaned = _strip_cjk_garbage(out.read_text(encoding="utf-8"))
            out.write_text(cleaned, encoding="utf-8")
        except Exception:
            pass
        return out
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


def convert_via_libreoffice(src_path: Path, out_path: Path) -> Path | None:
    """HWP/HWPX/DOC/DOCX → LibreOffice → PDF → opendataloader → MD.

    LibreOffice 없으면 None (호출자가 fallback 결정).
    """
    soffice = _find_libreoffice()
    if not soffice or not _opendataloader_available():
        return None
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dir = Path(tmpdir)
        pdf_path = _convert_with_libreoffice(src_path, tmp_dir)
        if not pdf_path or not pdf_path.exists():
            return None
        # opendataloader로 PDF → MD
        md_out = convert_pdf(pdf_path, out_path.parent)
        return md_out


def convert_hwp(hwp_path: Path, out_path: Path) -> Path | None:
    """HWP v5 → 마크다운.

    1차: LibreOffice → PDF → opendataloader (고품질)
    2차 fallback: olefile + zlib (한자 잔재 있음, LibreOffice 없을 때)
    """
    # 1차: LibreOffice 경로
    result = convert_via_libreoffice(hwp_path, out_path)
    if result and result.exists():
        return result

    # 2차: pure-python fallback
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


def convert_doc(doc_path: Path, out_path: Path) -> Path | None:
    """DOC/DOCX → LibreOffice → PDF → opendataloader → MD."""
    return convert_via_libreoffice(doc_path, out_path)


_PARA_MARKERS = ("□", "◦", "○", "•", "■", "▪", "▶", "①", "②", "③", "④",
                 "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "*", "-", "Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ")


def _merge_hwpx_fragments(text: str) -> str:
    """HWPX zipfile dump의 단어 단위 줄바꿈을 단락 단위로 머지.

    HWPX는 인쇄 줄 단위로 텍스트 노드가 분리돼 있어 그대로 dump하면
    "Ⅰ\\n.\\n품질관리\\n감리 개요" 처럼 쪼개진다. 단락 시작 기호(□/◦/①/Ⅰ 등)를
    만나거나 빈 줄을 만나면 단락 경계로 보고 그 전 버퍼를 flush한다.
    """
    lines = text.split("\n")
    merged: list[str] = []
    buf = ""
    for line in lines:
        s = line.strip()
        if not s:
            if buf:
                merged.append(buf)
                buf = ""
            continue
        if s.startswith(_PARA_MARKERS):
            if buf:
                merged.append(buf)
            buf = s
        else:
            buf = (buf + " " + s).strip() if buf else s
    if buf:
        merged.append(buf)
    return "\n\n".join(merged)


def convert_hwpx(hwpx_path: Path, out_path: Path) -> Path | None:
    """HWPX → 마크다운.

    1차: LibreOffice → PDF → opendataloader (LibreOffice 26.x는 HWPX 미지원이라 보통 실패)
    2차 fallback: zipfile + XML 텍스트 추출 + 단락 머지 후처리
                  (정확도 떨어지지만 raw_md 누락보다는 낫다 — 헤더에 경고 명시)
    """
    result = convert_via_libreoffice(hwpx_path, out_path)
    if result and result.exists():
        return result

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

        raw_text = "\n".join(p for p in text_parts if p)
        if not raw_text.strip():
            return None

        cleaned = _merge_hwpx_fragments(raw_text)
        warning = (
            "> ⚠️ **HWPX fallback 변환** — LibreOffice가 HWPX를 미지원하여 "
            "단순 텍스트 추출로 변환됨. 헤딩 계층·표 구조 손실. "
            "같은 게시물의 PDF 본문이 있으면 그쪽이 더 정확함.\n"
        )
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            f"# {hwpx_path.stem}\n\n{warning}\n{cleaned}",
            encoding="utf-8",
        )
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
    ".doc":  convert_doc,
    ".docx": convert_doc,
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

    # 변환에서 제외할 하위 폴더 (사용자가 직접 적재한 참고 코퍼스 등)
    SKIP_DIRS = frozenset({"reference"})

    def __init__(self, raw_root: Path, out_root: Path):
        self.raw_root = raw_root
        self.out_root = out_root

    def run(self, skip_existing: bool = True) -> dict:
        results = {"success": 0, "skip": 0, "failed": 0, "unsupported": 0, "by_source": {}}
        if not self.raw_root.exists():
            return results

        for source_dir in sorted(p for p in self.raw_root.iterdir() if p.is_dir()):
            src_name = source_dir.name
            if src_name in self.SKIP_DIRS:
                continue
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
