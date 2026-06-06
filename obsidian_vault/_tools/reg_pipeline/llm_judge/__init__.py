"""llm_judge — LLM 위임 작업 (OpenRouter 경유).

위임 작업:
  - judge_impact: 외규가 internal과 매칭 후보에 영향 있나? (Yes/No + 이유)
  - score_impact: 영향도 점수 (0-10)
  - summarize: 본문 요약 (3-5 bullet)
  - recommend_update: 내규 업데이트 권고

비용 절약 위해 2건씩 묶어 호출:
  - judge + score: 한 번에
  - summary + recommend: 한 번에

LLM 모델: openai/gpt-5-mini (OpenRouter)
"""

from .client import LLMClient, load_api_key
from .judge import LLMJudge, ImpactResult, EvaluationResult

__all__ = ["LLMClient", "LLMJudge", "ImpactResult", "EvaluationResult", "load_api_key"]
