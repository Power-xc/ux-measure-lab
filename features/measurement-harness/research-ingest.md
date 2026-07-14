# UX MeasureLab Ingest 서버·저장 아키텍처 리서치

> **작성일:** 2026-07-14
> **상태:** 설계 (구현 전) · 로드맵 "Ingest 서버" 단계
> **결정 질문:** 자체 SDK가 보내는 행동 이벤트를 어디에 어떻게 저장하고, 인증 없이도 남용되지 않는 공개 쓰기 경계를 어떻게 만드는가.
> **근거:** 사용자 요청, [`../../README.md`](../../README.md) 방향 표, [`../../docs/architecture.md`](../../docs/architecture.md), [`../../docs/security.md`](../../docs/security.md), [`../../docs/data-model.md`](../../docs/data-model.md), [`../../src/shared/server/request-guards.ts`](../../src/shared/server/request-guards.ts), 두 개의 기존 same-origin POST route.

## 0. 요약

이 설계는 저장소에 **서버 영속성을 처음 도입**한다. 지금까지 제품 데이터는 `localStorage`에만 있었고 서버 route는 상태를 소유하지 않았다. 행동 이벤트는 그 원칙의 예외가 아니라, **등급이 다른 두 번째 데이터 계층**으로 분리해서 도입한다.

- 스토리지 추천: **Supabase Postgres** 하나로 확정. 월 10만~100만 이벤트 규모에서 퍼널·경로·세션 집계는 Postgres가 여유롭게 처리하고, ClickHouse 계열은 이 규모에서 운영 비용만 늘린다. 저장소가 이미 "localStorage repository를 Supabase adapter로 교체 가능하게 둔다"([`../personal-product-v1/research.md`](../personal-product-v1/research.md))는 결정을 내려 두었고, Supabase RLS가 뒤따르는 인증·멀티테넌시 로드맵과 곧바로 연결된다.
- 공개 쓰기 경계: 사이트 키(공개 write 토큰) + **사이트별 Origin allowlist** + durable rate limit + 봇 필터 + bounded payload. 인증 없는 익명 쓰기 엔드포인트는 없다.
- 핵심 경계 이동: 수집은 **cross-origin이 정상**이다. 기존 두 route의 `hasAllowedOrigin`/`isCrossSite` same-origin 가드를 **그대로 재사용하면 실제 트래픽을 전부 차단**한다. Ingest는 의도적으로 다른 경계를 쓴다(§4.4).
- 데이터 등급: 행동 스트림은 **손실 허용·근사 증거**다. 전환율·delta·verdict·Decision을 소유하는 결정적 계층(현재 `localStorage`·서버 계산)은 그대로 무결성 계층으로 남는다. 이 분리가 "행동 신호를 원인이 아닌 관찰로 취급한다"([`../product-foundation/research.md`](../product-foundation/research.md))는 제품 원칙을 인프라에서 강제한다.

| 결정 | 선택 | 근거 |
|---|---|---|
| 스토리지 | Supabase Postgres | 규모 대비 최소 운영, Postgres 집계 충분, RLS·auth 로드맵 정합, 기존 adapter 결정 재사용 |
| 파티셔닝 | `received_at` 주 단위 range partition | 90일 보존을 `DROP PARTITION` O(1)로 처리, DELETE 블로트 회피 |
| 세션 저장 | `sessions` 롤업 테이블(주기 갱신) + 열린 세션용 live view | raw 스캔 없이 퍼널·경로 쿼리, 서버측 세션 경계 보정 |
| 쓰기 인증 | 공개 사이트 키(해시 저장) + Origin allowlist | 클라이언트 JS에 노출되는 토큰은 비밀이 아님 — 범위·폐기·rate로 방어 |
| rate limit | durable store(Upstash Redis 등) | 기존 in-memory limiter는 serverless 다중 인스턴스에서 무력 |
| 배포 | Vercel Route Handler + Supabase, 필요 시 ingest만 분리 배포 | 현행 배포 유지, 트래픽 급증 시 경로 격리 |

---

## 1. 배경 — 저장소 최초의 서버 영속성

### 1.1 무엇이 바뀌고 무엇이 유지되는가

현재 아키텍처([`../../docs/architecture.md`](../../docs/architecture.md))의 명시적 전제는 "서버 DB, 인증, background worker와 자체 event collector는 없다"이다. 이 설계는 그 전제 중 **event collector와 그 저장소만** 연다. 나머지는 유지한다.

```text
유지 (무결성 계층 · 결정적)
├─ Project/KPI/Funnel/Hypothesis/Experiment/Decision  → localStorage schema v1 + JSON backup
├─ 전환율·delta·guardrail·verdict 계산                → 서버 밖 pure TypeScript
└─ human Decision                                     → 사람이 소유

신규 (증거 계층 · 손실 허용)
├─ 자체 SDK가 보내는 raw 행동 이벤트                  → Supabase Postgres (events)
├─ 세션·퍼널·경로 집계                                → sessions 롤업 + 뷰
└─ 사이트 키 ↔ 프로젝트 연결                          → sites 테이블
```

두 계층의 연결점은 **하나뿐**이다: 증거 계층의 집계 결과(퍼널 단계별 사용자 수 등)가, 사용자가 지금 CSV로 수동 업로드하는 것과 **동일한 evidence 스키마**로 정규화되어 결정적 계층에 입력된다. 즉 이 설계는 [`../../README.md`](../../README.md) 방향 표의 "Source adapter 계약"이 소비할 **또 하나의 source**를 만드는 것이지, 결정 로직을 서버로 옮기는 것이 아니다.

### 1.2 데이터 등급 분리 원칙

| | 무결성 계층 | 증거 계층 (이 설계) |
|---|---|---|
| 예시 | verdict, Decision, 사전 등록 threshold | pageview, click, rage click, 세션 |
| 정확성 요구 | 정확·재계산 가능 | 근사·표본·손실 허용 |
| 유실 시 영향 | 결정 무결성 훼손 | 집계 추정치 소폭 변동 |
| 저장 | localStorage + JSON backup | 서버 DB, 90일 보존 후 삭제 |
| 신뢰 | schema-before-write, invariant | untrusted-by-default, bounded, 부분 드롭 |

이 표는 운영 정책의 근거다: 증거 계층은 과부하 시 **버려도 되는** 데이터이므로 백프레셔에서 손실을 허용한다(§7.1). 반대로 무결성 계층은 이 파이프라인을 절대 통과하지 않는다.

---

## 2. 스토리지 선택

### 2.1 워크로드 특성

- **볼륨:** 월 10만~100만 이벤트. 100만/월 ≈ 3.3만/일 ≈ 평균 0.4 events/sec. 피크를 20배로 잡아도 ~8 events/sec. 쓰기 부하는 작다.
- **주 쿼리:** 퍼널(단계별 도달 사용자), 경로(entry→exit 시퀀스, 이탈 지점), 세션 집계(세션 수·길이·bounce·이벤트 수), 마찰 신호 카운트(rage/dead click). 전부 `site_id` + 기간으로 스코프된 **집계** 쿼리이며, 단건 조회나 트랜잭션 정합성은 필요 없다.
- **읽기 빈도:** 낮다. 대시보드를 열 때만 집계하며 실시간 스트리밍 대시보드는 범위 밖.
- **보존:** 기본 90일. 그 이후 자동 삭제.

이 워크로드는 "쓰기 적음 + 기간 스코프 집계 + 짧은 보존"이다. 컬럼 지향 OLAP의 강점(초당 수십만 행 스캔)이 필요한 지점에 아직 도달하지 않는다.

### 2.2 후보 비교

| 기준 | Supabase Postgres | 자체 호스팅 Postgres | ClickHouse 계열(ClickHouse Cloud·Tinybird) |
|---|---|---|---|
| 100만/월 집계 성능 | 인덱스·롤업으로 충분 | 동일 | 과잉 — 이 규모에서 이점 미미 |
| 운영 부담 | 관리형(백업·업그레이드·풀러 포함) | VM·패치·백업·모니터링 직접 | 관리형이나 스키마·머지·TTL 개념 학습 필요 |
| 멀티테넌시 | RLS 내장, auth 로드맵 정합 | 직접 구현 | 테넌트 격리 별도 설계 |
| 트랜잭션·제약 | 완전한 관계형 | 완전한 관계형 | 제약·업데이트 취약(append 최적) |
| 기존 결정 정합 | **adapter 이미 계획됨** | 계획 없음 | 계획 없음 |
| 개인 규모 비용 | Free~$25/mo 기반 | VM 최소 + 운영 시간 | 사용량제, 소규모엔 상대적 고비용 |
| 에스컬레이션 여지 | 커지면 CH로 미러링 가능 | 동일 | 대규모의 종착지 |

### 2.3 공식 요금·한도 Source table

> 요금·쿼터는 자주 바뀐다. 아래는 공식 페이지 URL과 접근일 기준이며, **실제 청구·프로비저닝 전 각 항목을 재확인**한다. 확신하지 못하는 구체 단가는 `NOT_CHECKED`로 둔다.

| Source | 유형 | 접근일 | 확인 시도한 사실 | 제한 / NOT_CHECKED |
|---|---|---:|---|---|
| https://supabase.com/pricing | 공식 요금 | 2026-07-14 | Free plan과 Pro plan(기본 월정액) 구조, 포함 DB 용량 이후 사용량 과금 | Pro 월정액 기본가·포함 DB GB·초과 $/GB·egress 단가는 `NOT_CHECKED` (청구 전 재확인) |
| https://supabase.com/docs/guides/database/partitions | 공식 문서 | 2026-07-14 | Postgres 선언적 파티셔닝 지원, `pg_partman` 사용 가능 | 인스턴스 tier별 커넥션·CPU 한도는 `NOT_CHECKED` |
| https://supabase.com/docs/guides/database/extensions/pg_cron | 공식 문서 | 2026-07-14 | `pg_cron`으로 보존·롤업 스케줄 실행 가능 | 최소 실행 주기·동시성 제한 `NOT_CHECKED` |
| https://neon.com/pricing | 공식 요금 | 2026-07-14 | Free plan + 유료 plan, 사용량제 compute·storage 분리 과금 | 구체 단가·포함 쿼터 `NOT_CHECKED` (자체 호스팅 대안 후보) |
| https://clickhouse.com/pricing | 공식 요금 | 2026-07-14 | ClickHouse Cloud 사용량제(compute+storage), 개발용 서비스 tier 존재 | 최소 과금·시간당 단가 `NOT_CHECKED` |
| https://www.tinybird.co/pricing | 공식 요금 | 2026-07-14 | ClickHouse 기반 관리형, 무료/유료 plan, processed·stored 기준 과금 | 무료 쿼터·초과 단가 `NOT_CHECKED` |
| https://vercel.com/pricing | 공식 요금 | 2026-07-14 | Hobby(무료)/Pro 구독, Function 호출·실행시간 사용량 과금 | 호출·GB-hr 단가·포함량 `NOT_CHECKED` (ingest route 실행 비용) |
| https://upstash.com/pricing | 공식 요금 | 2026-07-14 | Redis pay-per-request, 무료 tier 존재 | 요청 단가·무료 쿼터 `NOT_CHECKED` (durable rate limit·dedup 후보) |

### 2.4 저장 규모 추정

> 추정치다. 실제 행 크기는 `props` jsonb 크기와 인덱스 수에 따라 달라진다.

```text
가정: 이벤트 1건 heap ≈ 250–400 B (타입 컬럼 + 소형 jsonb)
      인덱스 3–4개 오버헤드 포함 all-in ≈ 1 KB/event (보수적)

100만/월  → 신규 ~1 GB/월  → 90일 보존 정상상태 ~3 GB
10만/월   → 신규 ~0.1 GB/월 → 90일 보존 정상상태 ~0.3 GB
```

두 시나리오 모두 Supabase Pro의 포함 DB 용량 안에 들어갈 것으로 **추정**한다(정확한 포함 GB는 §2.3에서 `NOT_CHECKED`). 10만/월은 Free plan 한도에 근접할 수 있으나 보존·롤백 여유를 위해 Pro를 기준선으로 잡는다.

### 2.5 결정

**F-ING-001 — 스토리지는 Supabase Postgres.**
- `fact`: 100만/월은 평균 1 events/sec 미만이고 주 쿼리는 기간 스코프 집계다. Postgres가 인덱스·파티션·롤업으로 충분히 처리한다.
- `fact`: 저장소는 이미 "browser storage를 versioned repository interface 뒤에 둬 추후 Supabase adapter로 교체 가능하게 한다"고 결정했다([`../personal-product-v1/research.md`](../personal-product-v1/research.md)).
- `inference`: Supabase RLS·Auth는 [`../../docs/data-model.md`](../../docs/data-model.md)의 "Deferred server model"(User·membership·tenant·RLS)과 직접 연결되어, 인증 도입 시 읽기 경계를 재설계 없이 확장한다.
- `inference`: ClickHouse 계열은 이 규모에서 운영·학습 비용만 추가한다. 대규모의 종착지로는 유효하나 지금 도입할 근거가 없다.
- `applicability`: 채택. 관계형 제약·RLS·관리형 운영·기존 결정 정합의 합이 가장 크다.

### 2.6 에스컬레이션 임계

다음 중 하나가 관측되면 ClickHouse Cloud 또는 Tinybird로의 **미러링**(Postgres는 최근 데이터·관계형 소스로 유지, CH는 대량 스캔 전용)을 재검토한다.

- 월 이벤트가 **약 1,000만**을 넘어 집계 쿼리 p95가 대시보드 UX를 해친다.
- 90일보다 긴 보존이 제품 요구가 되어 Postgres 스토리지 비용이 CH 대비 열위가 된다.
- 세션 replay·초 단위 실시간 대시보드가 로드맵으로 승격된다.

---

## 3. 스키마 설계

> 개념 스키마다. 실제 마이그레이션은 별도 spec에서 확정하며, 컬럼 길이·enum은 runtime validator(§4.6)와 반드시 일치시킨다.

### 3.1 sites — 사이트(수집원) 테이블

```sql
create table sites (
  id               uuid primary key default gen_random_uuid(),
  project_ref      text        not null,          -- dogfood 단계: 로컬 project id 문자열
  name             text        not null,
  key_hash         text        not null unique,   -- 사이트 키의 해시. raw 키는 저장하지 않음
  key_prefix       text        not null,          -- 식별·회전 UI용 앞자리 (예: "umlk_ab12")
  allowed_origins  text[]      not null default '{}',  -- 이 사이트가 전송 허용된 Origin allowlist
  retention_days   int         not null default 90,
  is_bot_dropped   boolean     not null default true,  -- 명백한 봇 이벤트를 ingest에서 버릴지
  created_at       timestamptz not null default now(),
  disabled_at      timestamptz                       -- 폐기·정지 시각 (null이면 활성)
);
```

- **키는 해시로만 저장**한다([`../../docs/security.md`](../../docs/security.md)의 "secret server env" 원칙 연장). 검증 시 요청 키를 해시해 `key_hash`와 대조한다.
- `allowed_origins`가 CORS 경계의 데이터 소스다(§4.4). 사이트마다 다르며 ux-measure-lab 자신의 host와 무관하다.
- `key_prefix`는 UI에서 어떤 키인지 식별하고 회전(rotate)할 때만 쓰며 인증에는 쓰지 않는다.

### 3.2 events — 이벤트 테이블 (파티셔닝)

```sql
create table events (
  id            bigint      generated always as identity,
  site_id       uuid        not null,
  event_id      text        not null,     -- 클라이언트 생성 멱등키 (dedup용)
  session_id    text        not null,     -- 클라이언트 제공 세션 id (신뢰하되 재검증)
  anon_id       text        not null,     -- 1차 pseudonymous 방문자 id (해시 저장)
  type          text        not null,     -- pageview|click|rage_click|dead_click|scroll|custom
  path          text,                     -- 정규화된 경로 (기본적으로 query string 제외)
  referrer_host text,                     -- referrer의 host만 (full URL 아님)
  props         jsonb,                    -- 이벤트 타입별 bounded 속성
  ua_family     text,                     -- 파싱된 UA 계열 (raw UA 저장 안 함)
  is_bot        boolean     not null default false,
  ts            timestamptz not null,     -- 서버 권위 이벤트 시각 (skew 보정 후)
  client_ts     timestamptz,              -- 클라이언트 주장 시각 (skew 분석용 보존)
  received_at   timestamptz not null default now(),
  primary key (received_at, id)           -- 파티션 키(received_at)를 PK에 포함
) partition by range (received_at);
```

**파티셔닝: `received_at` 기준 주(week) 단위 range partition.**

- 90일 보존 → 정상상태 약 13개 파티션. 보존 만료는 오래된 파티션을 `DETACH` 후 `DROP TABLE` — **O(1)**이며 대량 `DELETE`의 dead tuple·VACUUM 블로트를 회피한다.
- 파티션 생성은 `pg_cron` + `pg_partman`(또는 직접 스케줄 함수)으로 사전 생성한다.
- `received_at`을 파티션 키로 쓰는 이유: 서버가 통제하는 값이라 미래·과거로 위조된 `ts`가 파티션 배치를 흔들지 못한다. `ts`는 쿼리·정렬용이고 파티션 경계는 수신 시각이 결정한다.

**인덱스 전략 (파티션마다 상속):**

```sql
-- 테넌트 + 시간 지역성: 대부분의 집계가 site_id + 기간으로 스코프됨
create index on events (site_id, ts);
-- 세션화: 세션 롤업이 site_id + session/anon 정렬로 gap 계산
create index on events (site_id, anon_id, ts);
-- 퍼널·마찰: 타입별 카운트
create index on events (site_id, type, ts);
```

**멱등성·dedup의 현실:** Postgres 파티션 테이블의 unique 인덱스는 **파티션 키를 포함**해야 한다. 따라서 `(site_id, event_id)` 전역 unique 제약은 불가능하다. 두 가지로 처리한다.

1. 기본: **at-least-once 수용 + 쿼리 시 dedup.** 롤업·집계에서 `distinct on (site_id, event_id)`로 중복을 접는다. 추가 인프라 없음. 손실 허용 계층이므로 소수 중복은 집계 오차로 흡수된다.
2. 선택: 짧은 TTL의 durable dedup 캐시(Upstash Redis)에 `event_id`를 기록해 ingest 시점에 최근 중복을 거른다. 재시도 폭주 시 쓰기량을 줄이는 최적화이며 필수는 아니다.

### 3.3 sessions — 세션 롤업

live view로 raw `events`를 매 쿼리 스캔하는 대신, **주기 갱신 롤업 테이블**을 둔다(집계 성능 + 서버측 세션 경계 보정, §5).

```sql
create table sessions (
  site_id          uuid        not null,
  server_session_id text       not null,   -- 서버가 gap 규칙으로 재도출한 세션 id
  anon_id          text        not null,
  started_at       timestamptz not null,
  ended_at         timestamptz not null,
  duration_ms      bigint      not null,
  event_count      int         not null,
  pageview_count   int         not null,
  entry_path       text,
  exit_path        text,
  is_bounce        boolean     not null,   -- pageview 1개 이하
  is_bot           boolean     not null,
  primary key (site_id, server_session_id)
);
```

- `pg_cron`으로 N분마다(예: 5분) 최근 미확정 구간을 증분 갱신한다.
- 아직 **열려 있는(진행 중) 세션**은 롤업에 확정 반영되지 않으므로, "지금 활성 세션 수" 같은 실시간 지표가 필요하면 raw `events` 위의 얇은 live view로 보조한다. 대시보드 대부분은 확정 롤업으로 충분하다.
- 퍼널·경로 쿼리는 `sessions` + 필요한 이벤트 조인으로 수행해 raw 풀스캔을 피한다.

### 3.4 보존 정책 구현 (기본 90일)

```text
① 파티션 만료 (공통 경로)
   pg_cron 일 1회 → retention_days 기본값(90) 넘긴 주 파티션 DETACH → DROP
   → O(1), 블로트 없음, 대부분의 사이트를 커버

② 사이트별 짧은 보존 override
   sites.retention_days < 90 인 사이트만 대상으로
   pg_cron이 해당 site_id의 오래된 행을 배치 DELETE (파티션보다 세밀)
   → 소수 사이트만 해당하므로 DELETE 비용 허용

③ 삭제 요청 (개별 사이트/방문자)
   사이트 폐기: disabled_at 설정 → ingest 거부 → 다음 만료 사이클에 데이터 소거
   방문자 삭제 요청: anon_id 기준 DELETE (consent-first 원칙의 운영 대응)
```

`anon_id` 기준 삭제 경로를 처음부터 두는 이유는 [`../../README.md`](../../README.md)·[`../../docs/security.md`](../../docs/security.md)의 "consent-first collection"과 "짧은 보존" 출시 조건 때문이다. 수집 계층은 삭제 가능해야 출시할 수 있다.

---

## 4. Ingest 엔드포인트 계약

### 4.1 개요

```text
POST /api/ingest        (Vercel Route Handler, runtime=nodejs, dynamic)
OPTIONS /api/ingest     (CORS preflight — 압축·커스텀 헤더 경로에서만 발생)
```

기존 두 route와 **재사용하는 것**과 **의도적으로 바꾸는 것**을 먼저 못박는다.

| 요소 | 기존 route | Ingest | 이유 |
|---|---|---|---|
| bounded body | `readBoundedBody` | **재사용** | untrusted 입력 크기 상한 |
| `no-store` 응답 | `jsonResponse` | **재사용** | 캐시 금지 |
| runtime schema 검증 | 있음 | **재사용(강화)** | untrusted-by-default |
| same-origin 요구 | `hasAllowedOrigin` | **제거** | 수집은 cross-origin이 정상 (§4.4) |
| `sec-fetch-site=cross-site` 거부 | `isCrossSite` | **제거** | 위와 동일 |
| Origin 정책 | 자기 host 고정 | **사이트별 allowlist** | 테넌트마다 다른 도메인에서 전송 |
| rate limit | in-memory | **durable store** | serverless 다중 인스턴스 (§4.5) |
| content-type | `application/json` 고정 | **`text/plain` 허용** | preflight 회피 (§4.4) |

### 4.2 배치 payload 스키마

```jsonc
// 요청 본문 (JSON. text/plain으로 전송해 preflight 회피 — §4.4)
{
  "k": "umlk_ab12...",        // 사이트 키 (공개 write 토큰)
  "sent_at": "2026-07-14T...", // 클라이언트 배치 전송 시각 (skew 보정 기준)
  "sid": "s_9f...",            // 세션 id (클라이언트)
  "aid": "a_3c...",            // anon id (클라이언트, 이미 pseudonymous)
  "events": [
    {
      "eid": "e_01...",        // 이벤트 멱등키
      "t": "pageview",          // 허용 enum
      "ts": "2026-07-14T...",   // 클라이언트 이벤트 시각
      "p": "/pricing",          // 경로 (query 제외)
      "ref": "google.com",      // referrer host
      "props": { }              // 타입별 bounded 속성
    }
    // ... 배치당 최대 이벤트 수 제한
  ]
}
```

**한도:**

| 항목 | 값(초안) | 근거 |
|---|---|---|
| 요청 본문 최대 | 64 KB (`readBoundedBody`) | 기존 route(4KB·32KB)보다 크되 상한 유지 |
| 압축 해제 후 최대 | 256 KB | decompression bomb 방지 — 해제 바이트도 bound |
| 배치당 이벤트 수 | ≤ 50 | 한 이벤트 위조가 배치 전체를 키우지 못하게 |
| 문자열 필드 길이 | path ≤ 2KB, props 직렬화 ≤ 4KB 등 | 타입별 상한, 초과분 클립 또는 드롭 |

### 4.3 압축

- SDK는 `CompressionStream('gzip')`이 가능한 환경에서 본문을 gzip으로 보내고 `Content-Encoding: gzip`을 붙인다. 불가하면 평문 JSON.
- 서버는 두 경우를 모두 받되 **해제 후 바이트 수를 다시 bound**한다(§4.2). `readBoundedBody`는 압축된 원본 스트림에 상한을 걸고, 해제 단계에서 별도 상한을 재적용한다.
- 페이지 이탈 시 전송은 `navigator.sendBeacon`을 우선한다(언로드에도 발사됨). sendBeacon은 헤더·gzip 제어가 제한적이므로 이 경로는 **평문 text/plain**으로 보내고 preflight를 피한다.

### 4.4 CORS — 기존 same-origin 가드와의 의도적 분기 (핵심)

> 이 절은 이 설계에서 가장 중요한 경계 판단이다.

기존 두 route는 브라우저 워크스페이스(ux-measure-lab 자신)에서만 호출되므로 `hasAllowedOrigin`(Origin == 자기 host) + `isCrossSite` 거부가 **정확한** 방어다([`../../src/shared/server/request-guards.ts`](../../src/shared/server/request-guards.ts)). 하지만 Ingest는 다르다.

```text
기존 route:  워크스페이스(https://ux-measure-lab...) → 자기 서버      = same-origin (정상)
Ingest:      고객 제품(https://고객도메인) 위의 SDK → ux-measure-lab 서버 = cross-origin (정상)
```

수집은 **본질적으로 cross-origin**이다. same-origin 가드를 그대로 쓰면 정상 트래픽을 100% 차단한다. 따라서 Ingest는 same-origin 가드를 **재사용하지 않고**, 다음으로 대체한다.

1. 요청 본문의 사이트 키로 `sites` 행을 찾는다(§4.6 순서상 키 검증 후).
2. 요청 `Origin`이 그 사이트의 `allowed_origins`에 있으면 허용, 아니면 거부.
3. 응답에 CORS 헤더를 **반사(reflect)** 한다.

```text
Access-Control-Allow-Origin: <검증 통과한 Origin>   // '*' 아님 — 사이트 allowlist와 대조한 값만
Vary: Origin
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: content-type, content-encoding
Access-Control-Max-Age: 600
```

**Preflight 최소화:** `text/plain` + 단순 헤더로 보내면 CORS "simple request"라 preflight(OPTIONS)가 발생하지 않는다. 서버는 기존 `product-context` route처럼 본문을 텍스트로 읽고 `JSON.parse`한다(그 route가 이미 쓰는 패턴 재사용). gzip·커스텀 헤더 경로에서만 OPTIONS가 발생하며, 이때 `OPTIONS` 핸들러가 위 헤더로 응답한다.

**경계 요약:** ux-measure-lab의 same-origin은 여전히 워크스페이스↔서버에 유효하다. Ingest는 그와 **분리된 두 번째 경계**이며, 신뢰 기준이 "내 host냐"가 아니라 "이 사이트 키가 이 Origin에서 쓰도록 등록됐냐"다.

### 4.5 사이트 키 검증과 rate limit

**사이트 키의 성격:** 클라이언트 JS 번들에 노출되는 **공개 write 토큰**이다(GA measurement id·PostHog project key와 동일 계열). 비밀이 아니므로 "탈취 방지"가 아니라 **범위 제한·폐기·rate로 남용을 억제**하는 것이 방어의 본질이다.

- 키는 append-to-one-site 권한만 부여한다. **읽기 권한 없음.** 대시보드 읽기는 완전히 다른(인증) 경계다(§6).
- 검증: 요청 키 해시 → `sites.key_hash` 대조 → `disabled_at` null 확인. 미등록·정지 키는 401/403.
- 회전: 새 키 발급 → 두 키 동시 허용 기간 → 구 키 폐기(`disabled_at`). `key_prefix`로 UI 식별.

**Rate limit — in-memory limiter의 한계를 명시한다.** 기존 `createRateLimiter`는 주석 그대로 "단일 프로세스 메모리 기반이며 여러 인스턴스에 걸친 전역 quota가 아니다". Vercel serverless에서는 호출마다 다른 인스턴스일 수 있어 in-memory 카운터가 **거의 무력**하다. 공개 쓰기 엔드포인트에는 durable store가 필수다.

```text
rate limit 키:  site_id + 클라이언트 IP (x-real-ip / x-forwarded-for 첫 값)
저장:           durable store (Upstash Redis 등) — 인스턴스 간 공유
정책:           사이트별 분당 상한 + IP별 분당 상한 (이중)
초과:           429 + Retry-After (기존 route 응답 형태 재사용)
사이트 총량:    sites별 월 이벤트 상한 옵션 (초과 시 드롭 + 경고)
```

기존 `createRateLimiter`의 인터페이스(키 추출, 창 계산, `RateLimitResult`)는 그대로 두되 **백엔드만 durable로 교체**하는 형태로 재사용한다.

### 4.6 검증 순서와 오류 계약

untrusted-by-default를 유지하되, **손실 허용**을 위해 배치 전체를 거부하지 않고 개별 이벤트를 드롭한다.

```text
1. content-type 확인 (application/json 또는 text/plain)
2. content-length 사전 확인 → 초과 시 413
3. readBoundedBody (압축이면 해제 후 재-bound) → 초과 시 413
4. JSON.parse → 실패 시 400
5. 사이트 키 해시 대조 + disabled_at 확인 → 실패 시 401/403
6. Origin ∈ allowed_origins 확인 → 실패 시 403
7. durable rate limit (site+IP) → 초과 시 429 + Retry-After
8. 봇 필터 (§5.3) → 명백한 봇이면 사이트 정책에 따라 드롭 또는 is_bot 플래그
9. 이벤트별 runtime validation:
     - type ∈ 허용 enum
     - 필드 길이·props 크기 bound → 초과분 클립
     - 유효하지 않은 개별 이벤트는 드롭 (배치는 계속)
10. 세션 보정 값 부여 (§5) → insert
11. 202 Accepted { accepted: n, dropped: m }
```

| 상황 | 상태 | 본문 |
|---|---|---|
| 정상(부분 드롭 포함) | 202 | `{ accepted, dropped }` |
| 본문/해제 초과 | 413 | `{ error: "request_too_large" }` |
| content-type 불일치 | 415 | `{ error: "unsupported_media_type" }` |
| JSON 파싱 실패 | 400 | `{ error: "invalid_request" }` |
| 미등록·정지 키 | 401/403 | `{ error: "invalid_site_key" }` |
| Origin 불허 | 403 | `{ error: "origin_not_allowed" }` |
| rate 초과 | 429 | `{ error: "rate_limited" }` + `Retry-After` |
| 서버 과부하 | 503 | `{ error: "unavailable" }` (SDK가 재시도 후 드롭) |

부분 드롭에 202를 쓰는 이유: 하나의 잘못된 이벤트가 정상 이벤트의 수집을 막지 않아야 하며(손실 허용 계층), 이는 CSV 파서가 "행 오류를 표시하되 기존 유효 데이터는 유지"하는 [`../../docs/architecture.md`](../../docs/architecture.md) 패턴과 같은 철학이다.

---

## 5. 세션화

### 5.1 클라이언트 세션 id를 신뢰하되 서버에서 재검증

- SDK는 방문자별 `anon_id`(1차 pseudonymous, 로컬 저장)와 30분 비활동 창의 `session_id`를 생성한다. 서버는 이를 **그룹핑 힌트로 신뢰**하되 권위로 삼지 않는다.
- 서버는 세션 롤업(§3.3) 계산 시 `(site_id, anon_id, ts)` 정렬로 **gap-and-islands** 규칙을 적용해 `server_session_id`를 재도출한다.

```text
서버 세션 경계 규칙 (롤업에서 적용)
- 같은 anon_id에서 직전 이벤트와의 gap > 30분  → 새 세션 시작
- 세션 총 길이 > 상한(예: 24h)                → 강제 분할 (runaway 세션 방지)
- 클라이언트 session_id는 참고·디버그용으로 보존하되 집계 기준은 server_session_id
```

이렇게 하면 조작·시계 오차·SDK 버그로 인한 비정상 `session_id`가 집계를 오염시키지 못한다.

### 5.2 시계 오차(skew) 보정

- `client_ts`(이벤트)와 `sent_at`(배치)·`received_at`(서버)의 관계로 오프셋을 추정한다: `offset ≈ received_at − sent_at`. 각 이벤트의 서버 권위 시각 `ts = client_ts + offset`(합리 범위로 clamp).
- 미래로 과도하게 앞선 `ts`, 또는 보존 기간보다 오래된 `ts`는 clamp하거나 드롭한다. 파티션 배치는 항상 `received_at` 기준이므로 위조된 `ts`가 파티션을 흔들지 못한다(§3.2).

### 5.3 봇 필터 (UA·헤더 휴리스틱)

```text
드롭/플래그 신호 (초안)
- UA 부재 또는 알려진 봇 substring (bot|crawler|spider|headless|preview 등)
- Accept-Language 부재 + 자동화 시그니처 조합
- 단일 anon_id/IP가 초당 수십 건 발사 (durable rate 카운터 재사용)
- 데이터센터 IP 대역 (별도 목록 필요 → 초기엔 NOT_CHECKED, 후속)
```

- 정책은 사이트 설정 `is_bot_dropped`로 제어한다. 기본은 **명백한 봇은 ingest에서 드롭**(저장 절약), 경계 사례는 `is_bot=true` 플래그로 저장해 집계에서 제외하되 감사 가능하게 남긴다.
- 자연어·UA 휴리스틱은 완전한 증명이 아니다([`../../docs/security.md`](../../docs/security.md)의 injection 필터 한계와 같은 성격). 오탐·미탐을 전제로 플래그 기반으로 운영한다.

---

## 6. 멀티테넌시 최소 단위

### 6.1 사이트 키 ↔ 프로젝트 연결

```text
sites.project_ref  →  dogfood 단계: 로컬 워크스페이스의 project id 문자열
                      인증 도입 후: sites.owner_id / org_id (아래 마이그레이션)
```

**dogfood(로그인 도입 전) 임시 운영:**

- 사용자·인증 UI가 아직 없으므로 사이트는 **수동 프로비저닝**한다: 관리 SQL/시드 스크립트로 `sites` 행을 1개 삽입하고 키를 발급해 개인 제품의 SDK에 넣는다. 이 단계는 Power-xc 개인 dogfood 1개 제품이 대상이다.
- 읽기(대시보드)는 이 단계에서 인증이 없으므로, **집계 결과를 서버에 공개 노출하지 않는다.** 두 가지 중 하나로 운영한다.
  1. 집계 쿼리를 로컬 개발/신뢰 환경에서만 실행하고 결과를 evidence로 워크스페이스에 수동 반입(현재 CSV 업로드와 동형).
  2. 또는 읽기 API에 `service_role` 수준의 서버 전용 키를 두고 same-origin 워크스페이스에서만 호출(기존 `hasAllowedOrigin` 경계 재사용) — 단, 인증 전까지 사이트 간 격리는 코드 레벨 필터에만 의존하므로 개인 단일 사용 범위로 제한한다.
- 이 임시성은 [`../../docs/data-model.md`](../../docs/data-model.md)가 "Personal v1 모델을 그대로 multi-tenant schema로 간주하지 않는다"고 못박은 것과 일치한다.

### 6.2 공개 write 경계 vs 인증 read 경계 분리

이 설계의 멀티테넌시 핵심은 **쓰기와 읽기의 경계를 다르게** 두는 것이다.

```text
쓰기 (ingest):  공개 사이트 키 + Origin allowlist + rate + 봇필터
                → 익명·cross-origin·append-only·site 스코프
읽기 (대시보드): 인증된 사용자 세션 (로그인 도입 후) + RLS
                → same-origin·조회·tenant 스코프
```

쓰기 경계가 공개일 수밖에 없는 이유(클라이언트 JS 노출)와, 읽기 경계는 반드시 인증이어야 하는 이유가 분리되므로, 공개 키가 유출돼도 **데이터 읽기는 불가능**하다.

### 6.3 인증 도입 시 마이그레이션 경로

```text
현재:  sites(project_ref)  +  공개 write 키만
         ↓ 인증 도입 (Supabase Auth 등)
추가:  users, memberships, organizations
       sites += owner_id(uuid) / org_id(uuid)   -- project_ref는 보존·백필
확장:  읽기 경로에 RLS 정책 (auth.uid() 기준 site 소유·멤버십 확인)
불변:  쓰기(ingest) 경로는 계속 공개 사이트 키 기반. RLS는 읽기만 지배.
```

- Supabase RLS를 쓰기에까지 적용하지 않는 이유: ingest는 인증된 사용자 세션이 없는 익명 append이므로, RLS 대신 사이트 키·Origin·rate가 방어를 담당한다. 삽입은 `service_role` 또는 사이트 키를 검증한 서버 route가 수행한다.
- 이 경로는 [`../../docs/data-model.md`](../../docs/data-model.md)의 "Deferred server model"(actor, tenant boundary, retention, deletion, audit, migration 별도 설계)을 그대로 채우며, retention·deletion은 이미 §3.4에서 선반영했다.

---

## 7. 운영

### 7.1 백프레셔·유실 허용 정책

증거 계층은 손실 허용이다(§1.2). 이 사실을 정책으로 명문화한다.

```text
SDK 측 (at-least-once 시도)
- 이벤트를 로컬 큐에 모아 배치 전송, 지수 백오프 재시도
- 페이지 언로드 시 sendBeacon으로 마지막 배치 발사
- 429/503 수신 시 Retry-After만큼 대기, N회 초과 재시도 실패분은 드롭
- 로컬 큐 상한 초과분도 드롭 (무한 성장 방지)

서버 측 (best-effort)
- 과부하 시 503으로 빠르게 거부 (DB를 막지 않음)
- durable rate·사이트 월 상한 초과분은 드롭 + 카운터 기록
- 개별 무효 이벤트는 배치 내 드롭 (§4.6)

명문 규칙: 행동 스트림 유실은 허용되며, 집계는 근사·표본으로 취급한다.
결정 무결성이 필요한 값(verdict·Decision)은 이 파이프라인을 통과하지 않는다.
```

### 7.2 모니터링 최소셋

| 지표 | 목적 | 위치(초안) |
|---|---|---|
| accepted / dropped / rejected (사이트별) | 수집 건전성·남용 탐지 | ingest 카운터 테이블 또는 로그 |
| p95 insert latency | DB 부하·백프레셔 판단 | Supabase 관측 + route 타이밍 |
| DB 용량 vs 포함 쿼터 | 비용·보존 건전성 | Supabase 대시보드 |
| 가장 오래된 파티션 age | 보존 잡 정상 동작 | `pg_cron` 결과 점검 |
| rate-limit hit 수 | 남용·오설정 | durable store 카운터 |
| bot-drop 비율 | 필터 오탐·미탐 감시 | ingest 카운터 |
| 사이트별 월 이벤트 | 쿼터·비용 예측 | 집계 잡 |

[`../../docs/security.md`](../../docs/security.md)의 "server audit·abuse telemetry 없음" 잔여 위험을 이 최소셋이 부분적으로 닫는다. 비밀·원본 UA·전체 IP는 로그에 남기지 않는다(pseudonymous·host만).

### 7.3 예상 월 비용

> 구독 기본가만 §2.3 URL 기준으로 인용하고, 사용량 단가는 `NOT_CHECKED`(청구 전 재확인)로 둔다. 아래는 **추정 구조**이며 실제 청구가 아니다.

| 구성 | 10만/월 | 100만/월 | 근거 |
|---|---|---|---|
| Supabase | Free 또는 Pro 기본가 | Pro 기본가 | 저장 규모 §2.4가 포함 쿼터 내로 추정; 정확 단가 `NOT_CHECKED` |
| Vercel Functions (ingest 호출) | Hobby/Pro 포함분 내 추정 | Pro + 소량 사용량 추정 | 호출·GB-hr 단가 `NOT_CHECKED` |
| Upstash Redis (durable rate/dedup) | 무료 tier 내 추정 | 무료~소액 추정 | 요청 단가 `NOT_CHECKED` |
| 합계(추정) | ~Free~$25 대 | ~$25 + 소액 | 정밀 합계는 단가 확정 후 산출 |

핵심 판단: **100만/월에서도 관리형 Postgres 한 대 + 서버리스 함수 + 소형 durable store로 소규모 개인 비용 범위**에 든다는 것이 스토리지 결정(§2.5)의 비용 측 근거다. 정확한 금액은 §2.3의 `NOT_CHECKED` 항목을 청구 전 확정한다.

---

## 8. 배포 형상

```text
기본 (현행 유지)
Web/runtime : Next.js App Router (기존과 동일)
Ingest      : POST/OPTIONS /api/ingest — Vercel Node Route Handler
Storage     : Supabase Postgres (events/sessions/sites) + pg_cron + pg_partman
Rate/dedup  : Upstash Redis (durable)
Hosting     : Vercel production (현행) + Supabase 프로젝트

분리 옵션 (트래픽 급증 시)
- ingest 경로만 별도 배포/리전으로 격리해 워크스페이스 앱과 장애·비용을 분리.
- 대시보드 읽기 앱과 공개 쓰기 앱을 서로 다른 배포 단위로 분리 (경계 §6.2와 정합).
```

[`../../docs/architecture.md`](../../docs/architecture.md)의 "서버 DB나 조직 기능을 추가할 때는 별도 spec과 migration·authorization 설계가 필요하다"는 조건에 따라, 실제 마이그레이션·RLS·시드 스크립트는 이 리서치 뒤의 spec 단계에서 확정한다.

---

## 9. 위험

- **공개 쓰기 남용:** 사이트 키가 클라이언트에 노출된다. 방어는 Origin allowlist·durable rate·봇 필터·사이트 월 상한의 합이며, 어느 하나도 단독으로 완전하지 않다. edge rate limit 추가를 출시 전 게이트로 둔다([`../../docs/security.md`](../../docs/security.md)의 "외부 공개 배포 전 인증 또는 edge rate limit" 규칙).
- **in-memory limiter 오용:** 기존 limiter를 그대로 serverless ingest에 쓰면 사실상 무제한이 된다. durable 백엔드 교체가 구현 필수 조건이다(§4.5).
- **CORS 과다 허용:** `Access-Control-Allow-Origin: *`로 넓히면 사이트 격리가 깨진다. 반드시 사이트 allowlist와 대조한 Origin만 반사한다(§4.4).
- **decompression bomb:** 압축 본문은 해제 후 크기를 재차 bound하지 않으면 메모리 폭증 위험. 해제 상한을 명시했다(§4.2).
- **파티션 유니크 제약:** 전역 `event_id` unique가 불가하므로 멱등성은 쿼리 dedup/선택적 캐시로 처리한다. 정확 카운트가 필요한 지표에 중복 유입 오차를 문서화한다(§3.2).
- **PII 유입:** `props`·`path`에 사용자가 민감정보를 넣을 수 있다. 기본 query string 제외·필드 길이 bound·입력 마스킹 가이드를 SDK 계약에 둔다(consent-first 원칙). raw UA·전체 URL·credential은 저장하지 않는다.
- **dogfood 격리:** 인증 전 단계는 사이트 간 격리가 코드 필터에만 의존한다. 개인 단일 사용으로 범위를 제한하고, 다중 사용자 전에 RLS를 반드시 도입한다(§6.3).
- **집계 신뢰 과장:** 손실 허용 스트림을 무결성 데이터처럼 제시하면 결정을 오도한다. 대시보드는 표본·근사·기간을 함께 표기한다(제품 원칙 "Hypothesis, not conclusion").

## 10. 열린 질문 / NOT_CHECKED

- Supabase Pro 월정액 기본가, 포함 DB GB, 초과 $/GB, egress 단가 — 청구 전 재확인.
- Vercel Function 호출·GB-hr 단가와 포함량, ingest 예상 호출 수 대비 비용.
- Upstash Redis 요청 단가·무료 쿼터.
- ClickHouse Cloud·Tinybird 최소 과금(에스컬레이션 시점 비교용).
- `pg_cron` 최소 실행 주기·동시성, `pg_partman` 자동 파티션 생성 설정.
- 데이터센터 IP 대역 목록(봇 필터 IP 신호) 확보 방법.
- 이벤트 1건 실제 온디스크 크기(인덱스 포함) — §2.4 추정 검증.
- SDK 배치 주기·큐 상한·재시도 횟수 구체값(별도 SDK spec에서 확정).

## 11. 다음 단계

1. §2.3·§10의 `NOT_CHECKED` 요금·한도를 공식 문서로 확정하고 §7.3 비용 표를 수치화한다.
2. Ingest spec을 작성한다: `events`/`sessions`/`sites` 마이그레이션, `pg_cron` 보존·롤업 잡, durable rate limit 어댑터, `/api/ingest` route 계약과 검증 순서(§4.6)를 실행 가능한 수준으로 확정.
3. 자체 SDK spec(배치·sendBeacon·gzip·session/anon 생성·큐 정책)을 이 계약에 맞춰 별도로 설계한다.
4. Source adapter 계약이 이 증거 계층 집계를 기존 CSV와 동일한 evidence 스키마로 정규화하도록 연결한다.
5. dogfood: Power-xc 개인 제품 1개에 사이트 1개를 수동 프로비저닝해 수집→집계→evidence 반입 경로를 실측한다.
