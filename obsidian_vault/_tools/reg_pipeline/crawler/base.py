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


_FILENAME_BAD = re.compile(r'[\\/*?:"<>|\n\r\t]')


def clean_filename(name: str, max_len: int = 100) -> str:
    """파일명 안전 정제."""
    cleaned = _FILENAME_BAD.sub("", name).strip()
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
