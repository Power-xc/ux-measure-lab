# Experiment Fleet — 실행 계획

> **작성일:** 2026-07-16
> **상태:** Wave 0·1 구현 완료 · Wave 2+ 사용자 검토 대기
> **전제:** [spec.md](spec.md)의 불변 조건·계약 결정·AC를 따른다.

## Wave 0 — 결정적 함대 엔진 (완료)

영향 파일:

```text
src/entities/fleet/model.ts                                  함대 어휘: FleetPlan·FleetPolicy·FleetVariant·웨이브 입출력
src/features/experiment-fleet/lib/validate-fleet-plan.ts     사전 등록 검증 (threshold·예산·변형 규칙)
src/features/experiment-fleet/lib/evaluate-fleet-wave.ts     웨이브 판정: evaluateExperiment 재사용 + 컷·순위·예산
src/features/experiment-fleet/lib/plan-next-wave.ts          successive-halving식 다음 웨이브 배분·중단 판정
src/features/harness/catalog.ts                              fleet 측정 스킬 등록 (available: false)
package.json                                                 테스트 3종 연결
```

체크리스트:

- [x] `FleetPolicy`는 성공/실패 threshold, 변형별 최소 표본, 웨이브 기간, 동시 상한, 생존 비율, 표본 예산, guardrail, 종료 규칙을 한 번에 사전 등록한다.
- [x] 검증: 변형 2개 미만·중복 ID·역전 threshold·(0,1] 밖 keepShare·첫 웨이브를 못 채우는 예산을 거부 (FLEET-PLAN-001~006).
- [x] 판정: 변형별 수치는 `evaluateExperiment` 재사용, 교차 검증 테스트로 동일성 보장 (FAC-01).
- [x] 컷 우선순위: guardrail 위반 → 컷, 표본 부족 → 재수집, not_supported → 컷, 순위 대상은 원시 delta + 결정적 tie-break (FAC-02~04).
- [x] 예산 산술 투명성: 공유 기준선 + Σ변형, 초과는 음수 노출 (FAC-05).
- [x] 다음 웨이브: 생존 변형 순위순 + 재수집 후순위, 동시 상한 컷, 수렴·소진·전멸 중단 사유 (FAC-06).
- [x] `fleet` 스킬을 하네스 카탈로그에 등록 (funnel×segments, available: false — Wave 2에서 활성화).

검증: typecheck·lint·`npm test` 182/182·build green.

## Wave 1 — 워크스페이스 통합 (완료)

영향 파일:

```text
src/entities/project/model.ts                     schemaVersion 3 + 선택적 fleet 필드
src/entities/fleet/model.ts                       FleetWaveRecord·FleetState + exposureWarnings
src/shared/lib/project-repository.ts              v1·v2→v3 승격 + 승격 전 백업
src/shared/lib/fleet-schema.ts                    백업 경계 검증: 구조 + 판정 재계산 대조
src/shared/lib/project-invariants.ts              함대 도메인 규칙(KPI·가설 게이트, 웨이브 연쇄)
src/features/project-workflow/lib/project-updates.ts   applyFleetPlan·applyFleetWave
src/widgets/measure-workspace/panels/FleetSection.tsx  실험 단계 내 함대 섹션 (8단계 루프 불변)
src/widgets/measure-workspace/panels/FleetWaveForm.tsx 웨이브 관찰 입력
src/features/report/lib/build-experiment-report.ts     함대 요약 섹션
e2e/fleet.spec.ts                                 함대 golden loop
```

- [x] 스키마 v3: additive `fleet`, v1·v2 데이터 무손실 로드, 마이그레이션 전 자동 백업 (STORAGE-010·HAC-01).
- [x] 백업 복원 시 함대 판정을 재계산해 위조 거부 (FLEET-SCHEMA-001~004).
- [x] 함대 섹션: 사전 등록 → 웨이브 관찰 입력 → 판정 결과, "동시 판정 N건" 다중 비교 한계 병기. 8단계 루프는 변경하지 않고 실험 단계 안의 선택 섹션으로 통합.
- [x] OSS 관행 반영: 노출 불균형 경고(결정적 규칙, FLEET-WAVE-007) — research.md §6.
- [x] 리포트: 함대 요약(정책·웨이브·승격 후보) 추가 (FLOW-001 확장).
- [x] E2E: 함대 golden loop — 사전 등록·웨이브 판정·수렴·새로고침 복구.

검증: typecheck·lint·`npm test` 191/191·build·E2E 9/9 green.

## Wave 2 — harness 연동 (검토 대기)

- [ ] `MeasurementQuery`에 함대 관찰 쿼리(변형 dimension) 추가 또는 segments 쿼리 재사용 결정.
- [ ] first-party 어댑터에서 변형별 RateCount 집계 → `FleetVariantObservation` 정규화.
- [ ] `fleet` 스킬 `available: true` 전환 + 계약 테스트.
- [ ] 영구 holdout과 승격 후보 확정 웨이브(신규 표본) 설계 — 승자의 저주 완화 (research.md §6).

## Wave 3 — AI 변형 후보 생성 (검토 대기)

- [ ] 기존 AI trust boundary 규칙 재사용: evidence ID 참조만 허용, 수치 생성 금지, 결정적 fallback.
- [ ] 후보 상한(D-203)과 사람 검토 큐: 후보는 검토·적용 전 함대에 등록되지 않는다.
