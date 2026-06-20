"""Step 6 helper — sub_area 분류 + 내규 매칭 후보 식별. cwd가 obsidian_vault/_tools 가정.

결과: /tmp/regtrack-matched.json (matched 리스트)
stdout: matched 건수 1줄
"""
import sys, json
sys.path.insert(0, ".")
from pathlib import Path
from reg_pipeline.classifier import EmbeddingIndex, load_taxonomy, INTERNAL_SUB_AREAS

idx = EmbeddingIndex(
    taxonomy=load_taxonomy(),
    internal_dir=Path("../../internal_wiki/개인정보"),
    cache_path=Path("../../../.cache/embeddings.pkl"),
)

results = []
for md in Path("../external_raw_md").rglob("*.md"):
    if md.parent.name == "reference":
        continue
    text = md.read_text()
    sub_areas, _ = idx.classify(text, title=md.stem, threshold=0.6)
    relevant = [sa for sa, _ in sub_areas if sa in INTERNAL_SUB_AREAS]
    if not relevant:
        continue
    top = idx.match_internal(text, k=3, min_score=0.30)
    results.append({
        "raw_md": str(md),
        "source": md.parent.name,
        "sub_areas": [sa for sa, _ in sub_areas],
        "matched_internal": relevant,
        "top_internal": top,
    })

json.dump(results, open("/tmp/regtrack-matched.json", "w"), ensure_ascii=False)
print(len(results))
