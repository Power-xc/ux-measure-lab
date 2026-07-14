# Measurement Harness — 실행 계획

> **작성일:** 2026-07-15
> **상태:** 사용자 검토 대기 · Wave 0부터 순차 구현
> **전제:** [spec.md](spec.md)의 불변 조건·AC·바인딩 계약 결정을 따른다.

## Wave 0 — 어댑터 계약과 스키마 v2

영향 파일:

```text
src/features/harness/contract.ts        SourceAdapter·MeasurementQuery·NormalizedMeasurement
src/features/harness/contract.test.ts
src/shared/lib/project-schema.ts        schemaVersion 2, sourceRef 검증 (additive)
src/shared/lib/project-repository.ts    v1→v2 마이그레이션 + 사전 백업
src/shared/lib/project-invariants.ts    sourceRef invariant 3종
src/entities/project/model.ts           EvidenceSourceRef (optional)
```

체크리스트:

- [ ] `SourceCapability`·`MeasurementQuery`(discriminated union)·`MeasurementOutcome` 타입을 research-harness.md §2.2대로 구현.
- [ ] Evidence에 optional `sourceRef` 가산, `FunnelImport.source`에 `"adapter"` 가산.
- [ ] `migrateV1toV2`: 값 무변형, 마이그레이션 전 workspace JSON 자동 백업, 미래 version 거부 유지.
- [ ] invariant: `sourceRef.sampleSize > 0`, capability ⊆ 어댑터 선언, evidence-ID 참조 규칙 유지.
- [ ] 단위 테스트: v1 데이터 무손실 로드(HAC-01), invariant 위반 거부, 스키마 round-trip.

검증: typecheck·lint·`npm test`(기존 53 + 신규)·build·E2E 전부 green.

## Wave 1 — 수집 SDK

영향 파일: `packages/collector/` 신규 (research-sdk.md §8.1 구조), 루트 `package.json` workspaces 설정.

체크리스트:

- [ ] envelope·wire enum은 spec §4 확정값 사용 (`aid`, `pv|click|rage|dead|scroll|route|s_start|s_end`).
- [ ] consent 게이트(HAC-02)·PII 하드 규칙(HAC-03)·마스킹 기본값.
- [ ] rage 30px·1s·3연속(HAC-04), dead 3000ms 기본, scroll 마일스톤 — 전부 주입 타임스탬프로 결정적 테스트.
- [ ] 세션: cookie 1순위 + localStorage 폴백, 30분/24h, 멀티탭 공유.
- [ ] SPA: pushState/replaceState 래핑 + popstate + hashchange, 원본 메서드 보존.
- [ ] 전송: 배치(20/5s) + visibilitychange/pagehide flush + sendBeacon, 지수 백오프, bounded 버퍼.
- [ ] 번들 실측 gzip ≤ 10KB 확인(예산 초과 시 모듈 옵트아웃으로 조정).
- [ ] jsdom 단위 + Playwright 통합(3연타→rage, 라우트→pv, 동의 전후 전송 유무, 입력값 미수집).

검증: Wave 0 게이트 + SDK 테스트. 외부 런타임 의존성 0 확인.

## Wave 2 — Ingest (D-101·D-102·D-104 승인 후)

영향 파일:

```text
src/app/api/ingest/route.ts             POST/OPTIONS, 검증 순서 §4.6
src/shared/server/rate-limit-durable.ts 기존 인터페이스 유지, 백엔드 교체
supabase/migrations/                     sites·events(주 파티션)·sessions + pg_cron 잡
.env.example                             SUPABASE_URL 등 서버 전용 키 항목 추가
```

체크리스트:

- [ ] same-origin 가드 미사용 — 사이트키 해시 대조 + Origin allowlist + 반사 CORS(`Vary: Origin`, `*` 금지).
- [ ] text/plain simple request 허용, gzip 해제 후 재-bound(256KB), 배치 ≤50.
- [ ] 개별 이벤트 드롭 + 202 `{accepted, dropped}` (HAC-06).
- [ ] durable rate limit(site+IP 이중), 429+Retry-After (HAC-05).
- [ ] 세션 롤업 잡(gap 규칙, `server_session_id`)·skew 보정·봇 필터 플래그.
- [ ] 보존: 주 파티션 DETACH+DROP 잡, `anon_id` 삭제 경로 (HAC-07).
- [ ] dogfood 사이트 1개 수동 프로비저닝(D-103) 후 수집→집계 실측.

검증: route 단위 테스트(거부 계약 전수) + 실측 수집 증거. 시크릿은 `.env.local`만.

## Wave 3 — 하네스 스킬 + first-party 어댑터

체크리스트:

- [ ] 스킬 카탈로그 중 `퍼널 이탈`·`마찰 신호`·`여정 연속성` 3종 우선 구현(나머지는 후속).
- [ ] 질문 → 유형 후보(AI 보조 가능) → 사용자 확정 → capability 매칭 → 측정 → 검토 → 명시 적용(HAC-10).
- [ ] first-party 어댑터: ingest 집계를 `NormalizedMeasurement`로 정규화, `insufficient_sample` 경로(HAC-11).
- [ ] queryHash 캐시 재현성(HAC-08).
- [ ] Diagnose 진입: sourceRef 붙은 Evidence가 기존 friction·hypothesis 흐름에 그대로 얹힘.

검증: 계약 테스트 + E2E에 harness golden path 1본 추가.

## Wave 4 — PostHog 커넥터

체크리스트:

- [ ] personal API key 최소 scope, 서버 경계에서만 사용, 리전별 base URL.
- [ ] capability 매핑(research-harness.md §5.1), rate limit 선제어 + 429 backoff.
- [ ] 계약 검증: 동일 질문을 1호·2호로 측정 → 동일 스키마·provenance 구조(HAC-09).

검증: mock 계약 테스트(실 키 없이) + 사용자 키 제공 시 실측 1회.

## Wave 5 — Session replay

별도 spec에서 설계한다. 사전 동의·기본 마스킹·짧은 보존이 선행 조건이며 본 계획에 포함하지 않는다.

## 범위 이탈 방지

- Wave 0·1은 외부 서비스 없이 완결된다. D-101~104 승인 전 Wave 2를 시작하지 않는다.
- 각 Wave는 전체 게이트(typecheck·lint·test·build·E2E) green 상태로만 종료한다.
- README "방향" 표의 상태는 해당 Wave의 검증 증거가 verification.md에 기록된 뒤에만 갱신한다.
