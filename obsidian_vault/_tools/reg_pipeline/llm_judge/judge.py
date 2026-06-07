"""LLM 위임 4 작업 통합 (2 호출로 묶음).

호출 1: judge_impact + score_impact
호출 2 (impact_score >= threshold일 때만): summarize + recommend
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .client import LLMClient
from .prompts import (
    SYS_JUDGE_AND_SCORE,
    SYS_SUMMARIZE_AND_RECOMMEND,
    build_judge_user_prompt,
    build_summarize_user_prompt,
)


@dataclass
class ImpactResult:
    has_impact: bool
    impact_score: int            # 0-10
    reason: str
    primary_match: str           # 매칭 내규 wiki 이름
    affected_articles: list[str] = field(default_factory=list)


@dataclass
class EvaluationResult:
    """LLM 위임 전체 결과."""
    impact: ImpactResult
    summary: list[str] = field(default_factory=list)
    update_recommendation: str = ""
    deadline_hint: str | None = None


class LLMJudge:
    """외규 → 내규 영향 평가 LLM 위임."""

    def __init__(self, client: LLMClient | None = None, score_threshold: int = 4):
        self.client = client or LLMClient()
        self.score_threshold = score_threshold

    def judge(
        self,
        external_title: str,
        external_text: str,
        external_sub_areas: list[str],
        matched_internals: list[tuple[str, float]],
    ) -> EvaluationResult:
        """외규 평가 (2 LLM 호출)."""
        # Call 1: judge + score
        user_prompt = build_judge_user_prompt(
            external_title=external_title,
            external_excerpt=external_text[:3000],
            external_sub_areas=external_sub_areas,
            matched_internals=matched_internals,
        )
        try:
            raw = self.client.chat(
                system=SYS_JUDGE_AND_SCORE,
                user=user_prompt,
                json_mode=True,
            )
            payload = json.loads(raw)
            impact = ImpactResult(
                has_impact=bool(payload.get("has_impact", False)),
                impact_score=int(payload.get("impact_score", 0)),
                reason=str(payload.get("reason", "")),
                primary_match=str(payload.get("primary_match", "")),
                affected_articles=list(payload.get("affected_articles", [])),
            )
        except Exception as e:
            return EvaluationResult(impact=ImpactResult(
                has_impact=False, impact_score=0,
                reason=f"LLM 호출 실패: {e}", primary_match="",
            ))

        # 임계값 미만이면 요약·권고 skip (비용 절약)
        if impact.impact_score < self.score_threshold:
            return EvaluationResult(impact=impact)

        # Call 2: summarize + recommend
        try:
            raw2 = self.client.chat(
                system=SYS_SUMMARIZE_AND_RECOMMEND,
                user=build_summarize_user_prompt(
                    external_title=external_title,
                    external_full=external_text,
                    primary_match=impact.primary_match,
                ),
                json_mode=True,
            )
            payload2 = json.loads(raw2)
            return EvaluationResult(
                impact=impact,
                summary=list(payload2.get("summary", [])),
                update_recommendation=str(payload2.get("update_recommendation", "")),
                deadline_hint=payload2.get("deadline_hint"),
            )
        except Exception as e:
            return EvaluationResult(
                impact=impact,
                summary=[f"요약 실패: {e}"],
            )
