"""발행처별 크롤러 모듈.

각 모듈은 다음 시그니처의 함수 export:
  crawl(out_dir: Path, since_date: str | None, history: CrawlHistory, page) -> list[CrawlResult]

since_date는 YYYYMMDD 형식 (이 날짜 이후만 수집).
history는 중복 방지용.
page는 Playwright Page (브라우저 컨텍스트는 호출자가 관리).
"""
