"""크롤러 공통 헬퍼.

- CrawlResult: 단일 자료 결과 (메타 + 저장 경로)
- CrawlHistory: 중복 방지 (JSON 파일 기반)
- setup_browser: Playwright Chromium 헤드리스 컨텍스트
- clean_filename: 파일명 정제
- parse_date: 다양한 날짜 표기 → YYYYMMDD
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Iterable


@dataclass
class CrawlResult:
    """단일 크롤링 결과."""
    source: str              # 발행처 코드 (fsec, fss, ...)
    title: str
    date: str                # YYYYMMDD
    url: str
    out_path: Path | None    # 저장된 raw 파일 경로
    attachments: list[Path] = field(default_factory=list)


@dataclass
class CrawlHistory:
    """중복 크롤링 방지용 history.

    파일 위치 예: .cache/crawl_history.json
    구조: {"{source}_{id}": "2026-06-15T12:34:56"}
    """
    path: Path
    data: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "CrawlHistory":
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                data = {}
        else:
            data = {}
        return cls(path=path, data=data)

    def save(self) -> None:
        self.path.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def has(self, key: str) -> bool:
        return key in self.data

    def add(self, key: str) -> None:
        self.data[key] = datetime.now().isoformat(timespec="seconds")


def setup_browser(playwright):
    """공통 browser context."""
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 900},
        locale="ko-KR",
        accept_downloads=True,
    )
    return browser, context


# 파일명에서 제거할 문자
# - 시스템 금지: \ / * ? : " < > | \n \r \t
# - VSCode/에디터 호환성 저하: [ ] ( ) 「 」 ｢ ｣ < >
# - 콤마·세미콜론 등도 path issue 가능
_FILENAME_BAD = re.compile(r'[\\/*?:"<>|\n\r\t\[\]()「」｢｣＜＞,;]')
_MULTI_SPACE = re.compile(r"\s+")


def clean_filename(name: str, max_len: int = 100) -> str:
    """파일명 안전 정제 (브래킷·따옴표·다중공백 제거)."""
    cleaned = _FILENAME_BAD.sub("", name)
    cleaned = _MULTI_SPACE.sub(" ", cleaned).strip()
    return cleaned[:max_len]


_DATE_PATTERNS = [
    re.compile(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})"),
    re.compile(r"(\d{4})(\d{2})(\d{2})"),
]


def parse_date(text: str) -> str:
    """다양한 날짜 표기 → YYYYMMDD (없으면 ''")."""
    for pat in _DATE_PATTERNS:
        m = pat.search(text)
        if m:
            y, mo, d = m.groups()
            return f"{int(y):04d}{int(mo):02d}{int(d):02d}"
    return ""


def is_after(date_yyyymmdd: str, since_date: str | None) -> bool:
    """since_date 이후인지 (since_date=None이면 항상 True)."""
    if not since_date or not date_yyyymmdd:
        return True
    return date_yyyymmdd >= since_date


def make_filename(date: str, title: str, ext: str = ".md") -> str:
    """표준 출력 파일명: YYYYMMDD_제목.확장자."""
    cleaned_title = clean_filename(title, max_len=80)
    if not ext.startswith("."):
        ext = "." + ext
    if date:
        return f"{date}_{cleaned_title}{ext}"
    return f"{cleaned_title}{ext}"


# 수집 허용 확장자 (이 외는 크롤러에서 수집 X)
ALLOWED_ATTACHMENT_EXTENSIONS = {".pdf", ".json", ".hwp", ".hwpx", ".docx", ".doc"}

# 첨부파일 확장자 우선순위 (낮은 숫자 = 높은 우선)
# 같은 stem (확장자 제외) 그룹에서 1개만 선택
ATTACHMENT_EXT_PRIORITY = {
    ".pdf": 0,
    ".docx": 1,
    ".doc": 2,
    ".hwpx": 3,
    ".hwp": 4,
    ".json": 5,
}


def has_allowed_extension(filename: str) -> bool:
    """파일명이 허용 확장자로 끝나는지."""
    import re as _re
    m = _re.search(r"(\.[a-zA-Z0-9]+)$", filename.strip())
    if not m:
        return False
    return m.group(1).lower() in ALLOWED_ATTACHMENT_EXTENSIONS


def download_attachments_with_priority(
    page,
    out_dir: Path,
    source: str,
    title: str,
    date: str,
    list_url: str,
    attach_selectors: list[str],
    dedup_by: str = "name",
    ext_from_onclick: re.Pattern | None = None,
    fallback_stem: str | None = None,
) -> list[CrawlResult]:
    """상세 페이지에서 첨부파일 수집 → 확장자 필터 → stem별 우선순위 1개 → 다운로드.

    Args:
        page: Playwright Page (상세 페이지 진입한 상태)
        out_dir: 저장 폴더
        source/title/date/list_url: CrawlResult 메타
        attach_selectors: CSS 셀렉터 리스트
        dedup_by: 'name' (inner_text) | 'href'
        ext_from_onclick: anchor 텍스트가 "다운로드" 등이고 onclick에 확장자가 있을 때
            (예: PIPC fn_egov_downFile('FILE_xxx','N','pdf') → r"['\"](\w{2,5})['\"]\)\s*$")
        fallback_stem: file_name에 확장자가 없을 때 사용할 stem (보통 title)

    Returns:
        다운로드한 파일들의 CrawlResult 리스트
    """
    candidates: list[dict] = []
    seen = set()
    for sel in attach_selectors:
        for link in page.query_selector_all(sel):
            try:
                file_name = link.inner_text().strip()
                if not file_name or len(file_name) < 3:
                    continue

                # 사이트가 anchor 텍스트 뒤에 "(파일크기: 31KB)" 등을 붙이는 경우 정리
                file_name = re.sub(r"\s*\([^)]*\)\s*$", "", file_name).strip()

                # 확장자가 inner_text에 없으면 onclick에서 추출 시도
                if not has_allowed_extension(file_name) and ext_from_onclick:
                    onclick = link.get_attribute("onclick") or ""
                    m = ext_from_onclick.search(onclick)
                    if m:
                        ext = "." + m.group(1).lower()
                        if ext in ALLOWED_ATTACHMENT_EXTENSIONS:
                            stem = fallback_stem or file_name
                            file_name = f"{stem}{ext}"

                if not has_allowed_extension(file_name):
                    continue
                if dedup_by == "name":
                    key = file_name
                elif dedup_by == "onclick":
                    key = link.get_attribute("onclick") or file_name
                else:
                    key = link.get_attribute("href") or ""
                if key in seen:
                    continue
                seen.add(key)
                candidates.append({"link": link, "name": file_name})
            except Exception:
                continue

    # PDF > Word > HWP 우선순위로 stem당 1개 선택
    selected = select_best_attachment_per_stem(candidates)

    results: list[CrawlResult] = []
    for cand in selected:
        try:
            safe = clean_filename(cand["name"], max_len=120)
            attach_name = f"{date}_{safe}" if date else safe
            attach_path = out_dir / attach_name
            if attach_path.exists():
                continue
            with page.expect_download(timeout=15000) as dl_info:
                cand["link"].click()
            download = dl_info.value
            download.save_as(str(attach_path))
            results.append(CrawlResult(
                source=source, title=safe, date=date,
                url=list_url, out_path=attach_path,
            ))
        except Exception:
            continue
    return results


def select_best_attachment_per_stem(
    candidates: list[dict],
    name_key: str = "name",
) -> list[dict]:
    """동일 stem(확장자 제외) 그룹에서 우선순위 1개만 선택.

    Args:
        candidates: dict 리스트, 각 dict에 파일명 키(name_key)
        name_key: 파일명 키 (기본 'name')

    Returns:
        선택된 dict 리스트 (그룹당 1개)
    """
    import re as _re
    groups: dict[str, dict] = {}
    for cand in candidates:
        fname = cand.get(name_key) or ""
        # 확장자·stem 추출
        m = _re.match(r"^(.+?)(\.[a-zA-Z]+)$", fname)
        if not m:
            stem = fname
            ext = ""
        else:
            stem = m.group(1)
            ext = m.group(2).lower()
        # 사이트가 파일명에 trailing dot/space를 흘리는 경우 정규화
        # ("...다..hwp" / "...다.pdf" 같은 stem 차이를 흡수)
        stem = _re.sub(r"[\s.]+$", "", stem)
        stem = _re.sub(r"\s+", " ", stem)
        priority = ATTACHMENT_EXT_PRIORITY.get(ext, 99)
        existing = groups.get(stem)
        if existing is None or priority < existing["_priority"]:
            cand_copy = dict(cand)
            cand_copy["_priority"] = priority
            cand_copy["_ext"] = ext
            groups[stem] = cand_copy
    # 내부 키 제거
    selected = []
    for v in groups.values():
        v.pop("_priority", None)
        v.pop("_ext", None)
        selected.append(v)
    return selected
