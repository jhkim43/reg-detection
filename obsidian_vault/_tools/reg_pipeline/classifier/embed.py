"""임베딩 기반 sub_area 분류 + internal 매칭 (1D + 2C).

모델: jhgan/ko-sroberta-multitask (~470MB, 1회 다운로드, 캐시 재사용)

흐름:
  EmbeddingIndex — 모델 로드 + sub_area / internal_wiki 임베딩 캐시
  classify(text) → [(sub_area, score), ...]   유사도 ≥ threshold만
  match_internal(text) → [(wiki_name, score), ...]   top-K

캐시:
  .cache/embeddings.pkl 에 sub_area·internal 벡터 보관 (재계산 X)
  taxonomy.yaml 또는 internal wiki 본문 바뀌면 invalidate
"""

from __future__ import annotations

import pickle
import hashlib
from pathlib import Path

# Optional dependency
_st = None


def _lazy_import_sentence_transformers():
    global _st
    if _st is None:
        try:
            from sentence_transformers import SentenceTransformer  # noqa: F401
            import sentence_transformers as _st_mod
            _st = _st_mod
        except ImportError as e:
            raise RuntimeError(
                "sentence-transformers 미설치: pip install sentence-transformers"
            ) from e
    return _st


def _cosine(a, b) -> float:
    """순수 numpy 코사인 유사도 (model.encode 결과는 ndarray)."""
    import numpy as np
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denom) if denom > 0 else 0.0


def _strip_frontmatter(md_text: str) -> str:
    if md_text.startswith("---"):
        end = md_text.find("\n---", 3)
        if end != -1:
            return md_text[end + 4:]
    return md_text


class EmbeddingIndex:
    """모델 + sub_area·internal 임베딩 캐시.

    Usage:
        idx = EmbeddingIndex(
            taxonomy=load_taxonomy(),
            internal_dir=Path("internal_wiki/개인정보"),
            cache_path=Path(".cache/embeddings.pkl"),
        )
        sub_areas = idx.classify(external_text, threshold=0.6)
        top = idx.match_internal(external_text, k=3)
    """

    def __init__(
        self,
        taxonomy: dict,
        internal_dir: Path,
        model_name: str = "jhgan/ko-sroberta-multitask",
        cache_path: Path | None = None,
    ):
        st = _lazy_import_sentence_transformers()
        self.model_name = model_name
        self.taxonomy = taxonomy
        self.internal_dir = internal_dir
        self.cache_path = cache_path

        print(f"  📦 임베딩 모델 로드: {model_name}")
        self.model = st.SentenceTransformer(model_name)

        cache_key = self._cache_key()
        if cache_path and cache_path.exists():
            cached = pickle.loads(cache_path.read_bytes())
            if cached.get("key") == cache_key:
                self.sub_area_vectors = cached["sub_areas"]
                self.internal_vectors = cached["internals"]
                print(f"  💾 캐시에서 임베딩 로드 ({cache_path})")
                return

        # Build fresh
        print(f"  🔨 임베딩 신규 생성...")
        self.sub_area_vectors = self._build_sub_area_index()
        self.internal_vectors = self._build_internal_index()
        if cache_path:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(pickle.dumps({
                "key": cache_key,
                "sub_areas": self.sub_area_vectors,
                "internals": self.internal_vectors,
            }))
            print(f"  💾 캐시 저장: {cache_path}")

    def _cache_key(self) -> str:
        """taxonomy + internal 본문 변경 시 캐시 invalidate."""
        h = hashlib.sha256()
        # taxonomy description hash
        for sa, conf in sorted(self.taxonomy.get("sub_areas", {}).items()):
            h.update(sa.encode())
            h.update((conf.get("description") or "").encode())
        # internal 본문 hash
        for md in sorted(self.internal_dir.glob("*.md")):
            h.update(md.stem.encode())
            h.update(md.read_bytes())
        h.update(self.model_name.encode())
        return h.hexdigest()

    def _build_sub_area_index(self) -> dict:
        result = {}
        for sa, conf in self.taxonomy.get("sub_areas", {}).items():
            desc = conf.get("description") or sa
            result[sa] = self.model.encode(desc.strip())
        return result

    def _build_internal_index(self) -> dict:
        result = {}
        for md in sorted(self.internal_dir.glob("*.md")):
            text = _strip_frontmatter(md.read_text(encoding="utf-8"))
            result[md.stem] = self.model.encode(text[:4000])  # 길이 제한
        return result

    def classify(
        self,
        text: str,
        threshold: float = 0.6,
        title_excludes: list[str] | None = None,
        title: str = "",
    ) -> tuple[list[tuple[str, float]], str]:
        """본문 → sub_area 매칭 리스트.

        Returns:
            ([(sub_area, score), ...] 내림차순, skip_reason)
        """
        # Title exclude
        excludes = title_excludes or self.taxonomy.get("title_excludes") or []
        for ex in excludes:
            if ex in title:
                return [], f"title-excluded:{ex}"

        vec = self.model.encode(text[:3000])
        matched = []
        for sa, sa_vec in self.sub_area_vectors.items():
            sim = _cosine(vec, sa_vec)
            if sim >= threshold:
                matched.append((sa, sim))
        matched.sort(key=lambda x: -x[1])
        return matched, ""

    def match_internal(
        self,
        text: str,
        k: int = 3,
        min_score: float = 0.0,
    ) -> list[tuple[str, float]]:
        """external 본문 → internal_wiki top-K 매칭."""
        vec = self.model.encode(text[:4000])
        scores = {name: _cosine(vec, ivec) for name, ivec in self.internal_vectors.items()}
        ranked = sorted(scores.items(), key=lambda x: -x[1])
        return [(name, s) for name, s in ranked[:k] if s >= min_score]
