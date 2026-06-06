"""
내규 갈음 자료 — 시중은행 4곳 처리방침 자동 다운로드.

대상:
  KB국민은행 / 신한은행 / 카카오뱅크 / 하나은행 / 토스뱅크

방식: Playwright headless → page.pdf() (SPA HTML 페이지를 PDF로 인쇄)

사용법:
    /tmp/playwright-venv/bin/python obsidian_vault/internal_raw/_download.py
"""

import asyncio
from pathlib import Path
from playwright.async_api import async_playwright, Page

OUTPUT_DIR = Path(__file__).parent


async def save_page_as_pdf(
    page: Page, url: str, filename: str, wait_text: str | None = None
) -> None:
    """동적 페이지 렌더링 후 PDF 저장."""
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

        # 시중은행 4곳 (신한은행은 표준 URL 못 찾음, 추후 추가)
        targets = [
            ("KB국민은행", "https://obank.kbstar.com/quics?page=C110564", "KB은행_개인정보처리방침_20260606.pdf"),
            ("카카오뱅크", "https://www.kakaobank.com/Corp/Policy/Privacy/ManagementPolicy", "카카오뱅크_개인정보처리방침_20260606.pdf"),
            ("하나은행", "https://www.kebhana.com/cont/customer/customer06/customer0604/index.jsp", "하나은행_개인정보처리방침_20260606.pdf"),
            ("토스뱅크", "https://www.tossbank.com/customer/information/privacy/privacy-policy", "토스뱅크_개인정보처리방침_20260606.pdf"),
        ]
        for idx, (name, url, fname) in enumerate(targets, 1):
            print(f"\n[{idx}/{len(targets)}] {name} 개인정보 처리방침")
            page = await context.new_page()
            try:
                await save_page_as_pdf(page, url, fname, wait_text="처리방침")
            except Exception as e:
                print(f"  ❌ {name} 실패: {e}")
            finally:
                await page.close()

        await browser.close()
        print("\n🎉 완료")


if __name__ == "__main__":
    asyncio.run(main())
