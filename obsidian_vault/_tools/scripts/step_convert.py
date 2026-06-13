"""Step 5 helper — raw → MD 변환. cwd가 obsidian_vault/_tools 라고 가정."""
import sys, json
sys.path.insert(0, ".")
from pathlib import Path
from reg_pipeline.converter import BatchConverter

stats = BatchConverter(
    raw_root=Path("../external_raw"),
    out_root=Path("../external_raw_md"),
).run(skip_existing=True)
print(json.dumps(stats))
