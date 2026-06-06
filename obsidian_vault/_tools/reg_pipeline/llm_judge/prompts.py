"""LLM 위임 표준 프롬프트.

규칙:
  - 시스템 프롬프트: 역할·출력 형식 고정
  - 사용자 프롬프트: 동적 데이터 (외규 본문, 매칭 내규)
  - JSON 형식 응답 강제 (json_mode=True)
"""

SYS_JUDGE_AND_SCORE = """\
당신은 은행 컴플라이언스 전문가입니다.
외규(감독기관 발행 자료)가 우리 회사 내규(시중은행 처리방침)에 영향을 줄 가능성을 평가합니다.

출력은 JSON으로:
{
  "has_impact": true | false,
  "impact_score": 0~10 (10이 가장 영향 큼),
  "reason": "한 문장 이유",
  "primary_match": "가장 영향 받을 내규 wiki 이름 (위 후보 중)",
  "affected_articles": ["제5조", "제10조", ...]  // 매칭 내규의 영향 받을 조항 (모르면 빈 배열)
}

판단 기준:
- 외규가 정책·고시·법령이고 처리방침에 영향 → 영향 큼 (점수 7-10)
- 외규가 가이드라인·해설서이고 운영에 영향 → 중간 (점수 4-6)
- 외규가 보도자료·연구 결과 → 영향 작음 (점수 1-3)
- 행사·시상·발간물 안내 → 영향 없음 (점수 0)
"""

SYS_SUMMARIZE_AND_RECOMMEND = """\
당신은 은행 컴플라이언스 전문가입니다.
외규 본문을 3-5 bullet으로 요약하고, 우리 내규(처리방침) 업데이트 권고문을 작성합니다.

출력은 JSON으로:
{
  "summary": ["bullet 1", "bullet 2", ...],
  "update_recommendation": "처리방침 어떤 조항을 어떻게 수정해야 하는지 1-2문단",
  "deadline_hint": "시행일·발효일 등 데드라인 힌트 (없으면 null)"
}
"""


def build_judge_user_prompt(
    external_title: str,
    external_excerpt: str,
    external_sub_areas: list[str],
    matched_internals: list[tuple[str, float]],
) -> str:
    """judge_impact + score 사용자 프롬프트.

    Args:
        external_title: 외규 제목
        external_excerpt: 외규 본문 앞부분 (3000자)
        external_sub_areas: taxonomy 분류된 영역
        matched_internals: [(internal_wiki_name, similarity_score), ...]
    """
    matches_str = "\n".join(
        f"- {name} (유사도: {score:.3f})" for name, score in matched_internals
    ) or "(매칭 후보 없음)"

    return f"""
[외규 정보]
- 제목: {external_title}
- 영역: {', '.join(external_sub_areas)}
- 본문 일부:

{external_excerpt}

[우리 내규 매칭 후보 (단어 분포 유사도 top-3)]
{matches_str}

위 외규가 매칭 후보 내규에 영향을 주는지 평가해주세요.
"""


def build_summarize_user_prompt(
    external_title: str,
    external_full: str,
    primary_match: str,
) -> str:
    """summarize + recommend 사용자 프롬프트."""
    return f"""
[외규]
- 제목: {external_title}
- 영향 받을 내규: {primary_match}
- 본문:

{external_full[:6000]}

위 외규를 요약하고, '{primary_match}'을 어떻게 업데이트해야 할지 권고해주세요.
"""
