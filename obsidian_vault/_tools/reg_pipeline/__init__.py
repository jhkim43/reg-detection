"""
reg_pipeline — 외규 일일 배치 통합 파이프라인.

모듈 구성:
  crawler/      발행처별 크롤러 (5 모듈, 10 함수)
  converter/    raw → MD 변환 (PDF/HWP/JSON/MD)
  classifier/   sub_area 분류 + internal 매칭
  llm_judge/    LLM 위임 (영향도·점수·요약·권고) via OpenRouter
  daily_batch   통합 entry
  run_one       단일 발행처 실행

데이터 흐름:
  external_raw/{발행처}/         크롤링 결과
    ↓ converter
  external_raw_md/{발행처}/      MD 변환
    ↓ classifier
  (필터) internal 영역 매칭만
    ↓ llm_judge
  external_wiki/{발행처}/        wiki 생성 + internal sync
"""
