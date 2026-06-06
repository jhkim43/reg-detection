"""
은행 내규 갈음 자료 자동 다운로드 스크립트 (Playwright)

JavaScript 동적 페이지 5건을 헤드리스 브라우저로 처리합니다.

사용법:
    pip install playwright
    playwright install chromium
    python obsidian_vault/internal_raw/_download.py

각 작업 결과는 콘솔에 출력되며, 결과 파일은 본 스크립트와 같은 폴더에 저장됩니다.
"""

import asyncio
from pathlib import Path
from playwright.async_api import async_playwright, Page

OUTPUT_DIR = Path(__file__).parent


async def save_page_as_pdf(
    page: Page, url: str, filename: str, wait_text: str | None = None
) -> None:
    """동적 페이지를 렌더링 후 PDF로 저장 (law.go.kr, KB은행 같은 SPA용)."""
    print(f"  → {url}")
    await page.goto(url, wait_until="domcontentloaded", timeout=60000)

    if wait_text:
        try:
            await page.get_by_text(wait_text).first.wait_for(timeout=10000)
        except Exception:
            print(f"  ⚠️  '{wait_text}' 텍스트 미발견, 계속 진행")

    try:
        await page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    await page.wait_for_timeout(3000)

    output = OUTPUT_DIR / filename
    await page.emulate_media(media="print")
    await page.pdf(
        path=str(output),
        format="A4",
        print_background=True,
        margin={"top": "10mm", "bottom": "10mm", "left": "10mm", "right": "10mm"},
    )
    size_kb = output.stat().st_size // 1024
    print(f"  ✅ {filename} ({size_kb} KB)")


async def click_and_download(
    page: Page, url: str, filename: str, link_pattern: str
) -> None:
    """페이지 진입 → 첨부 PDF 링크 클릭 → 다운로드 캡처 (PIPC, FSEC 같은 첨부파일용)."""
    print(f"  → {url}")
    await page.goto(url, wait_until="networkidle", timeout=60000)
    await page.wait_for_timeout(3000)

    try:
        async with page.expect_download(timeout=30000) as dl_info:
            link = page.locator(f"a:has-text('{link_pattern}')").first
            await link.click()
        download = await dl_info.value
        output = OUTPUT_DIR / filename
        await download.save_as(str(output))
        size_kb = output.stat().st_size // 1024
        print(f"  ✅ {filename} ({size_kb} KB)")
    except Exception as e:
        print(f"  ❌ 실패: {e}")
        print(f"     수동 다운로드 필요: {url}")


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=True,
            locale="ko-KR",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )

        # [1] 개인정보 안전성 확보조치 기준 (law.go.kr 행정규칙)
        print("\n[1/5] 개인정보 안전성 확보조치 기준 (개인정보위 고시 제2021-2호)")
        page = await context.new_page()
        await save_page_as_pdf(
            page,
            "https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000204677",
            "개인정보안전성확보조치기준_제2021-2호.pdf",
            wait_text="안전성",
        )
        await page.close()

        # [2] 금융회사의 정보처리 업무 위탁에 관한 규정 (law.go.kr 행정규칙)
        print("\n[2/5] 금융회사의 정보처리 업무 위탁에 관한 규정 (금융위 고시 제2021-9호)")
        page = await context.new_page()
        await save_page_as_pdf(
            page,
            "https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000200327&chrClsCd=010201",
            "금융회사정보처리업무위탁규정_제2021-9호.pdf",
            wait_text="위탁",
        )
        await page.close()

        # [3] 안전성 확보조치 기준 해설서 (PIPC) — selector 검증됨: '다운로드'
        print("\n[3/5] 안전성 확보조치 기준 해설서 (개인정보위, 2020.12)")
        page = await context.new_page()
        await click_and_download(
            page,
            "https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=7045",
            "개인정보안전성확보조치기준해설서_2020-2호.pdf",
            link_pattern="다운로드",
        )
        await page.close()

        # [4] 금융분야 클라우드 이용 가이드 (FSEC)
        print("\n[4/5] 금융분야 클라우드컴퓨팅서비스 이용 가이드 (FSEC 2025 개정)")
        page = await context.new_page()
        await click_and_download(
            page,
            "https://www.fsec.or.kr/bbs/detail?menuNo=222&bbsNo=11691",
            "금융분야클라우드컴퓨팅서비스이용가이드_2025개정.pdf",
            link_pattern=".pdf",
        )
        await page.close()

        # [5] KB국민은행 개인정보 처리방침 (표준)
        print("\n[5/5] KB국민은행 개인정보 처리방침 (표준)")
        page = await context.new_page()
        await save_page_as_pdf(
            page,
            "https://obank.kbstar.com/quics?page=C110564",
            "KB은행_개인정보처리방침_표준_20260606.pdf",
            wait_text="처리방침",
        )
        await page.close()

        await browser.close()
        print("\n🎉 완료")


if __name__ == "__main__":
    asyncio.run(main())
