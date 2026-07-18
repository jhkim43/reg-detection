"""Step 8 helper — external_wiki 생성 + internal_wiki sync. cwd가 obsidian_vault/_tools 가정.

입력: /tmp/regtrack-judged.json (step_judge 결과)
stdout: {"written": W, "created": C, "updated": U, "synced": S} JSON 1줄
"""
import sys, json
sys.path.insert(0, ".")
from pathlib import Path
from reg_pipeline.daily_batch import EXTERNAL_WIKI, stage_6_build_wiki, stage_7_sync_internal


EXTERNAL_WIKI_MIN_SCORE = 0
INTERNAL_WIKI_MIN_SCORE = 4


def build_wikis(judged_path: Path = Path("/tmp/regtrack-judged.json")) -> dict:
    matched = json.loads(judged_path.read_text(encoding="utf-8"))
    for item in matched:
        item["raw_md"] = Path(item["raw_md"])

    # 외부 규제 위키는 분류를 통과한 신규 문서를 모두 보관한다.
    existing = sum(
        (EXTERNAL_WIKI / item["source"] / item["raw_md"].name).exists()
        for item in matched
    )
    written = stage_6_build_wiki(matched, min_score=EXTERNAL_WIKI_MIN_SCORE)
    created = max(0, written - existing)
    updated = written - created

    # 관련 내규 연결은 영향도 4점 이상부터 수행한다.
    synced = stage_7_sync_internal(matched, min_score=INTERNAL_WIKI_MIN_SCORE)
    return {
        "written": written,
        "created": created,
        "updated": updated,
        "synced": synced,
    }


def main() -> None:
    print(json.dumps(build_wikis()))


if __name__ == "__main__":
    main()
