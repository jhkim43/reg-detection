"""Step 8 helper — external_wiki 생성 + internal_wiki sync. cwd가 obsidian_vault/_tools 가정.

입력: /tmp/regtrack-judged.json (step_judge 결과)
stdout: {"created": C, "synced": S} JSON 1줄
"""
import sys, json
sys.path.insert(0, ".")
from pathlib import Path
from reg_pipeline.daily_batch import stage_6_build_wiki, stage_7_sync_internal

matched = json.load(open("/tmp/regtrack-judged.json"))
for item in matched:
    item["raw_md"] = Path(item["raw_md"])

# external_wiki = 정보보호 도메인 아카이브. 분류 통과한 모든 자료 영구 보존
# (min_score=0). impact 낮은 자료도 검토·reference 용도로 살림.
created = stage_6_build_wiki(matched, min_score=0)
# internal_wiki sync = 사내 내규 자동 갱신. 영향 큰 자료만 (impact >= 4).
synced = stage_7_sync_internal(matched, min_score=4)
print(json.dumps({"created": created, "synced": synced}))
