"""Step 6 helper — 신규 MD sub_area 분류 + 내규 매칭 후보 식별.

입력: /tmp/regtrack-new-raw-md.json (step_convert 결과)
결과: /tmp/regtrack-matched.json (matched 리스트)
stdout: {"new_documents": N, "matched": M} JSON 1줄
"""
import json
import sys

sys.path.insert(0, ".")
from pathlib import Path
from reg_pipeline.classifier import EmbeddingIndex, load_taxonomy, INTERNAL_SUB_AREAS


MANIFEST_PATH = Path("/tmp/regtrack-new-raw-md.json")
MATCHED_PATH = Path("/tmp/regtrack-matched.json")


def load_new_documents(manifest_path: Path = MANIFEST_PATH) -> list[Path]:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []

    documents = []
    seen = set()
    for raw_path in manifest if isinstance(manifest, list) else []:
        md = Path(raw_path)
        if (
            md not in seen
            and md.is_file()
            and md.suffix.lower() == ".md"
            and "reference" not in md.parts
        ):
            documents.append(md)
            seen.add(md)
    return documents


def classify_documents(new_documents: list[Path]) -> list[dict]:
    if not new_documents:
        return []

    idx = EmbeddingIndex(
        taxonomy=load_taxonomy(),
        internal_dir=Path("../../internal_wiki/개인정보"),
        cache_path=Path("../../../.cache/embeddings.pkl"),
    )
    results = []
    for md in new_documents:
        text = md.read_text(encoding="utf-8")
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
    return results


def main() -> None:
    new_documents = load_new_documents()
    results = classify_documents(new_documents)
    MATCHED_PATH.write_text(
        json.dumps(results, ensure_ascii=False),
        encoding="utf-8",
    )
    print(json.dumps({
        "new_documents": len(new_documents),
        "matched": len(results),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
