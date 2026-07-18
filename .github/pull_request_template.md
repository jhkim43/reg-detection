# Pull Request

<!--
Scope Change Governance (PRD §17 / seed process_governance):
이 PR이 어떤 크기의 변경인지 분류하고 사유를 명시해 주세요.
-->

## Scope Change Classification

- [ ] **small** — 단일 모듈·데이터값 변경 (예: parser_config 튜닝, poll_interval 조정). 작업자 1인 결정.
- [ ] **medium** — 여러 모듈 영향 또는 신규 기능 (예: 새 게시판 추가, 필터 추가). 주간 retro 결정.
- [ ] **large** — MVP·아키텍처 결정 변경 (예: FSS→BOK 전환, 데이터 레이어 교체). **seed-vN 새 버전 발행 필수**.

## 변경 사유

<!--
small/medium: 한 줄 사유
large: retro 결정 노트 링크 또는 어드바이저 회의록 첨부
-->

## 연결 항목

- 연결 Task: T-XXX (또는 N/A)
- 연결 AC: AC-XXX (또는 N/A)
- seed 영향: 없음 / seed-vN 발행 / constraints 갱신

## 체크리스트 (PRD §17.4 enforcement)

- [ ] ARCHITECTURE_INVARIANTS.md Part 1의 4대 절대 규칙 위반 없음
- [ ] 해당 레이어만 변경 (layer skip 없음)
- [ ] 테스트 추가/갱신 (구현과 함께 작성)
- [ ] `.harness/gates` default 게이트 통과 (`./.harness/detect-violations.sh`)
- [ ] large 변경인 경우 seed-vN 파일이 같은 PR에 포함됨
- [ ] PRD/TRD/ERD/API 등 영향 문서 동기 갱신 (24시간 내, drift 방지)

## 테스트 결과

- pytest: PASS / N개 추가
- Playwright: PASS / N spec 추가 또는 N/A
- 수동 검증: (시연 시나리오 영향 시) Frame N 재실행 결과

## 추가 노트

(있으면)

---

<!--
Reviewer 가이드:
- 'small' 라벨이면 1인 approve 충분
- 'medium' 라벨이면 retro 결정 사항인지 확인
- 'large' 라벨이면 어드바이저 코멘트 + seed-vN 정합성 검증
-->
