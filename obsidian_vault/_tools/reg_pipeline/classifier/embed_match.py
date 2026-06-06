"""internal_wiki 와 외규 본문의 유사도 매칭.

목적:
  외규가 sub_area 매칭됐다고 해서 다 우리 내규에 영향 있는 건 아님.
  본문 단어 분포가 어느 내규 wiki와 가까운지 보고
  매칭 후보(top-K)를 LLM에게 넘김.

알고리즘 (LLM 없는 경량 매칭):
  1. 한국어 명사 추출 (regex `[가-힣]{2,}`)
  2. 각 internal wiki 본문에서 단어 빈도 (Counter)
  3. IDF 가중치 (전체 internal 4건 중 몇 건에 등장하는지)
  4. 외규 본문의 단어 빈도 × IDF → 각 internal과 dot product
  5. 정규화 (코사인 유사도 근사)

운영 시 임베딩 모델로 교체 가능 (sentence-transformers Korean 모델 등).
"""

import re
from collections import Counter
from math import log
from pathlib import Path


_TOKEN_RE = re.compile(r"[가-힣]{2,}")


def extract_korean_tokens(text: str) -> Counter:
    """2자+ 한글 명사 후보 빈도."""
    return Counter(_TOKEN_RE.findall(text))


def strip_frontmatter(md_text: str) -> str:
    """YAML frontmatter 제거 후 본문만 반환."""
    if md_text.startswith("---"):
        end = md_text.find("\n---", 3)
        if end != -1:
            return md_text[end + 4:]
    return md_text


class InternalCorpus:
    """internal_wiki 본문을 인덱싱.

    Usage:
        corpus = InternalCorpus.from_folder(Path("internal_wiki/개인정보"))
        scores = corpus.score(external_text)  # {wiki_filename: score}
        top = corpus.top_k(external_text, k=3)
    """

    def __init__(self, docs: dict[str, Counter]):
        self.docs = docs              # {wiki_name: Counter}
        self.idf = self._compute_idf()

    @classmethod
    def from_folder(cls, folder: Path) -> "InternalCorpus":
        docs: dict[str, Counter] = {}
        for md in sorted(folder.glob("*.md")):
            text = strip_frontmatter(md.read_text(encoding="utf-8"))
            docs[md.stem] = extract_korean_tokens(text)
        return cls(docs)

    def _compute_idf(self) -> dict[str, float]:
        N = len(self.docs)
        if N == 0:
            return {}
        df: Counter = Counter()
        for tokens in self.docs.values():
            for tok in tokens:
                df[tok] += 1
        return {tok: log(N / (1 + cnt)) for tok, cnt in df.items()}

    def score(self, external_text: str) -> dict[str, float]:
        """외규 본문 vs 각 internal wiki — 유사도 (정규화된 dot product)."""
        ext_tokens = extract_korean_tokens(external_text)
        ext_norm = sum(c * c for c in ext_tokens.values()) ** 0.5
        if ext_norm == 0:
            return {name: 0.0 for name in self.docs}

        scores: dict[str, float] = {}
        for name, tokens in self.docs.items():
            # idf 가중 dot product
            dot = sum(
                ext_tokens.get(tok, 0) * cnt * self.idf.get(tok, 0)
                for tok, cnt in tokens.items()
            )
            doc_norm = sum(
                (cnt * self.idf.get(tok, 0)) ** 2
                for tok, cnt in tokens.items()
            ) ** 0.5
            denom = ext_norm * doc_norm
            scores[name] = dot / denom if denom > 0 else 0.0
        return scores

    def top_k(self, external_text: str, k: int = 3, min_score: float = 0.0):
        """상위 K개 internal wiki + score."""
        scores = self.score(external_text)
        ranked = sorted(scores.items(), key=lambda x: -x[1])
        return [(name, s) for name, s in ranked[:k] if s >= min_score]
