# Measurement Harness — 통합 Spec

> **작성일:** 2026-07-15 · **작성자:** Power-xc
> **상태:** 사용자 검토 대기 · 구현 전
> **입력:** [research-sdk.md](research-sdk.md) · [research-ingest.md](research-ingest.md) · [research-harness.md](research-harness.md)

## 1. 정의

UX MeasureLab을 "CSV를 수동 연결하는 evidence-to-decision 워크스페이스"에서 "질문을 입력하면 필요한 측정이 자동 구성되는 measurement harness"로 확장한다.

```text
질문 → 스킬 라우팅 → 어댑터 capability 매칭 → 결정적 측정 → 정규화 Evidence
→ 기존 8단계 Measure Loop (진단 → 가설 → 실험 → 검증 → 사람의 결정)
```

수집원 전략은 **first-party 우선 + 어댑터 성장형**이다. 스크립트 한 줄로 설치되는 자체 SDK가 1호 소스, PostHog read-only 커넥터가 2호 소스이며, 이후 어떤 소스든 동일한 Source Adapter 계약을 구현하면 기존 스킬이 재작성 없이 동작한다.

## 2. 불변 조건

- 8단계 Measure Loop의 순서·의미·디자인 기준선을 변경하지 않는다. harness는 Measure와 Diagnose 사이의 입력 확장이다.
- 전환율·delta·guardrail·verdict는 계속 TypeScript가 계산한다. 어댑터·AI는 수치를 생성·수정할 수 없다.
- 측정 결과는 사용자가 검토하고 명시적으로 적용해야 Project에 저장된다.
- 무결성 계층(Project·verdict·Decision — localStorage + JSON backup)과 증거 계층(행동 이벤트 — 서버, 손실 허용, 90일 보존)을 분리하고, 무결성 데이터는 절대 ingest 파이프라인을 통과하지 않는다.
- 동의 없는 수집은 없다: `requireConsent` 기본 on, 입력값 절대 미수집, 마스킹 기본, GPC/DNT 존중, anon_id 삭제 경로 제공.

## 3. 범위 (Wave)

| Wave | 내용 | 산출 |
|---|---|---|
| 0 | Source Adapter 계약 + Evidence 스키마 v2 (additive `sourceRef`, v1→v2 무손실 마이그레이션) | `src/features/harness/` 계약 타입·검증·마이그레이션 + 단위 테스트 |
| 1 | 수집 SDK (`packages/collector/`) — pv·click·rage·dead·scroll·route·session, 의존성 0, gzip ≤10KB 목표 | SDK 번들 + jsdom 단위 + Playwright 통합 |
| 2 | Ingest — `POST /api/ingest`, Supabase Postgres(events/sessions/sites), durable rate limit, 보존 잡 | route + 마이그레이션 SQL + 검증 순서 테스트 |
| 3 | 하네스 스킬 + first-party 어댑터 — 질문 유형 판정(사용자 확정), 스킬 카탈로그 7종 중 funnel·interaction·paths 우선 | 스킬 라우팅 UI + 어댑터 1호 + 계약 테스트 |
| 4 | PostHog read-only 커넥터 (어댑터 2호) + 계약 검증(1호와 동일 질문 → 동일 스키마) | 어댑터 2호 + 교차 계약 테스트 |
| 5 | Session replay — 별도 spec. 사전 동의·기본 마스킹·짧은 보존이 선행 조건 | 본 spec 범위 밖 |

제외(불변): 통계적 유의성·p-value·세그먼트 자동 판정, heatmap 자체 집계, feature flag, 실시간 스트리밍 대시보드.

## 4. 바인딩 계약 결정 (리서치 간 불일치 단일화)

세 리서치 문서 사이의 표기 차이를 다음으로 확정한다.

- **Wire 이벤트 enum:** `pv | click | rage | dead | scroll | route | s_start | s_end` (SDK 문서 기준). ingest 문서의 `custom`은 v1 제외, `route`·`s_*`는 포함.
- **배치 envelope:** ingest 문서 형태로 확정 — `{ k, sent_at, sid, aid, events[] }`. SDK 문서의 `vid`는 wire에서 `aid`로 통일한다(의미 동일: pseudonymous 방문자 ID).
- **배치 한도:** SDK 기본 flush 20개, ingest 수용 상한 50개 (양립).
- **세션 규칙:** 30분 무활동 + 24시간 상한, 자정 롤오버 없음, 서버 롤업이 gap 규칙으로 `server_session_id` 재도출 — 세 문서 일치, 그대로 확정.

## 5. Acceptance Criteria

| AC | 기준 |
|---|---|
| HAC-01 | Evidence v2는 v1 데이터를 무손실로 읽고, v1→v2 마이그레이션 전 자동 백업이 생성된다 |
| HAC-02 | SDK는 동의 granted 이전에 어떤 이벤트도 큐잉·전송하지 않는다 (자동화 테스트로 증명) |
| HAC-03 | SDK는 입력값·비밀번호·결제 필드를 어떤 설정으로도 수집할 수 없다 |
| HAC-04 | rage click은 30px·1초·3연속 규칙으로 결정적으로 검출된다 (고정 타임스탬프 테스트) |
| HAC-05 | ingest는 미등록 사이트 키·불허 Origin·한도 초과를 각각 401/403·403·429로 거부한다 |
| HAC-06 | 유효하지 않은 개별 이벤트는 드롭하되 배치의 나머지는 수집된다 (202 + accepted/dropped) |
| HAC-07 | 90일 경과 파티션이 잡에 의해 제거된다 (보존 정책 실행 증거) |
| HAC-08 | 같은 질문·기간·세그먼트는 동일 queryHash로 캐시에서 재현되어 동일 Evidence를 만든다 |
| HAC-09 | 동일 질문을 1호(first-party)·2호(PostHog) 어댑터로 측정하면 동일 `MeasurementOutcome` 스키마·provenance 구조로 정규화된다 |
| HAC-10 | 측정 결과는 사용자가 명시 적용하기 전 Project를 변경하지 않는다 |
| HAC-11 | 표본·기간 부족 시 수치를 만들지 않고 `insufficient_sample`을 표시한다 |
| HAC-12 | 기존 53개 단위 테스트·E2E 6종·전체 품질 게이트가 계속 통과한다 |

## 6. 사용자 결정 필요 (구현 전 승인)

| ID | 결정 | 권장 |
|---|---|---|
| D-101 | Supabase 프로젝트 프로비저닝 (Wave 2 전제, Free→Pro 기준선) | 승인 필요 — 계정·리전(권장: 가까운 리전) |
| D-102 | Upstash Redis 도입 (durable rate limit·dedup) | 승인 필요 — 무료 tier로 시작 |
| D-103 | dogfood 대상: 본인 운영 제품 1개에 사이트 키 수동 프로비저닝 | 승인 필요 — 대상 제품 지정 |
| D-104 | `@supabase/supabase-js` 등 서버 의존성 추가 (SDK 자체는 의존성 0 유지) | 승인 필요 |

## 7. 리스크 (요약)

- 공개 write 키 남용 — Origin allowlist·durable rate·봇 필터·월 상한의 합으로 방어, 출시 전 edge rate limit 게이트.
- dogfood 단계 격리 — 인증 전에는 개인 단일 사용으로 제한, 다중 사용자 전 RLS 필수.
- 손실 허용 스트림의 신뢰 과장 — 대시보드·Evidence에 표본·근사·기간 병기.
- 요금 `NOT_CHECKED` 항목 — 프로비저닝 전 공식 문서로 확정.

상세는 각 리서치 문서의 위험 절을 따른다.
