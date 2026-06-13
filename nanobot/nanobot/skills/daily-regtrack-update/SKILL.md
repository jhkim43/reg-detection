---
name: daily-regtrack-update
description: 한국 금융규제 일배치 자동 추적. 4-step Python 파이프라인(수집 → Ingest → GAP 분석 → 영향도)을 단일 exec 호출로 실행하며, 결과는 deskrpg UI(NPC 4 명 등장/삭제)와 텔레그램으로 자동 보고. Use when the user requests Korean financial regulation collection or update — trigger phrases include "외규 가져와줘", "외규 수집해줘", "외규 받아와줘", "외규 업데이트", "run daily reg update".
---

# Daily RegTrack Update

## Constraints

- Call `exec` exactly once. Do not call `SpawnTool`, `read_file`, `web_search`, `list_dir`, `grep`, `glob`.
- Do not ask the user for any UUID or context (`channel_id`, `npc_id`, `character_id`, `user_id`). The Python script fills all defaults.
- Respond in Korean only, one short line.

## exec command

Default form (use this unless the user explicitly specified a `since=YYYYMMDD`):

```
exec(
  command="python3 /home/nanobot/.nanobot/api-workspace/skills/daily-regtrack-update/run_daily_pipeline.py",
  timeout=60
)
```

If the user wrote `since=YYYYMMDD` in their message, append the 8-digit number as a positional argument — nothing else, no `--since=`, no quotes:

```
exec(
  command="python3 /home/nanobot/.nanobot/api-workspace/skills/daily-regtrack-update/run_daily_pipeline.py 20260611",
  timeout=60
)
```

The script (`run_daily_pipeline.py`) absorbs the bare 8-digit `YYYYMMDD` as `--since` and uses safe defaults for everything else.

## After exec returns

Stdout JSON looks like `{"status": "pipeline_started_in_background", ...}`. The pipeline runs detached; deskrpg UI and Telegram report progress.

Reply with one Korean line, e.g.:

> 외규 일배치 시작.

Do not explain, summarize, apologize, or switch to English.
