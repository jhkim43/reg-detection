"""Step 5 helper — 신규 raw → MD 변환. cwd가 obsidian_vault/_tools 라고 가정.

이번 실행에서 새로 생성된 MD만 manifest에 기록한다. 다음 단계는 이 목록만
분류하므로 vault의 기존 문서가 다시 처리되지 않는다.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")
from reg_pipeline.converter import BatchConverter


RAW_ROOT = Path("../external_raw")
MD_ROOT = Path("../external_raw_md")
MANIFEST_PATH = Path("/tmp/regtrack-new-raw-md.json")


def _md_files(md_root: Path) -> set[Path]:
    if not md_root.exists():
        return set()
    return {
        path
        for path in md_root.rglob("*.md")
        if path.is_file() and "reference" not in path.parts
    }


def run_conversion(
    raw_root: Path = RAW_ROOT,
    md_root: Path = MD_ROOT,
    manifest_path: Path = MANIFEST_PATH,
) -> dict:
    # 실패한 재실행에서 이전 manifest를 잘못 쓰지 않도록 먼저 비운다.
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text("[]", encoding="utf-8")
    before = _md_files(md_root)
    stats = BatchConverter(raw_root=raw_root, out_root=md_root).run(skip_existing=True)
    new_md_files = sorted(str(path) for path in _md_files(md_root) - before)
    manifest_path.write_text(
        json.dumps(new_md_files, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    stats["new_md_count"] = len(new_md_files)
    stats["new_md_files"] = new_md_files
    return stats


def main() -> None:
    print(json.dumps(run_conversion(), ensure_ascii=False))


if __name__ == "__main__":
    main()
