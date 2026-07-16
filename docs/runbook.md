# Runbook

## Operating scope

현재 운영 형태는 owner가 직접 사용하는 local-first personal workspace다. 인증·RLS·조직 기능이 없으므로 public multi-tenant 운영은 지원하지 않는다. 프로덕션 데모와 자동 배포는 동결되어 있다.

## Local development

이 저장소는 Node 26 기준으로 검증한다.

```bash
npm ci
npm run dev
```

기본 주소는 `http://127.0.0.1:3000`이며 dev server는 loopback에만 bind한다. 외부 backend 없이도 UI와 결정적 workflow가 동작한다.

## Environment configuration

`.env.example`을 기준으로 `.env.local`을 만든다. 실제 secret은 source, browser storage와 log에 넣지 않는다.

| 기능 | 필수 env | 없을 때 |
|---|---|---|
| Supabase ingest | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | 빈 InMemory site/event store; ingest `401` |
| First-party aggregate | 위 두 값 + `SUPABASE_SITE_ID` | 빈 InMemory aggregate; `insufficient_sample` |
| Durable ingest limit | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | process-local limiter |
| PostHog connector | `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, `POSTHOG_API_KEY` | `not_configured` |
| Optional diagnosis provider | `UX_MEASURE_AI_ENABLED=true`, `OPENAI_API_KEY`, `OPENAI_MODEL` | 결정적 초안 |

각 backend는 필수 값이 모두 있을 때만 활성화된다. 원격 Supabase·Upstash URL은 HTTPS여야 하며 HTTP는 loopback 개발 주소만 허용한다. 일부만 설정하면 해당 backend는 안전 기본값을 사용한다. 설정 변경 후 server를 재시작한다.

PostHog host는 현재 다음 cloud base URL만 지원한다.

```text
https://us.posthog.com
https://eu.posthog.com
```

Personal API key는 연결할 project의 read 범위만 허용한다. 실제 Query API endpoint와 HogQL event 이름은 운영 호출 전에 해당 project의 현재 공식 schema로 재확인한다.

## Supabase setup

저장소의 SQL은 자동 적용되지 않는다. 새 project에서는 다음 순서로 Supabase SQL editor에서 실행한다.

1. `supabase/migrations/0001_ingest.sql`: sites, partitioned events, sessions.
2. `supabase/migrations/0002_aggregates.sql`: service-role aggregate RPC.
3. `supabase/migrations/0003_segmented_funnel.sql`: 변형별 퍼널 RPC (experiment fleet).
3. `supabase/jobs.sql`: partition, retention, session rollup, visitor deletion 함수.
4. `jobs.sql` 하단의 cron 등록문을 운영 환경에 맞게 검토한 뒤 활성화한다.

적용 전 database backup과 복구 방법을 확인한다. 적용 후 다음을 점검한다.

```sql
select to_regclass('public.sites'), to_regclass('public.events'), to_regclass('public.sessions');

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('funnel_counts', 'interaction_counts', 'path_reach');
```

`jobs.sql`의 session rollup은 30분 gap을 구현하지만 24시간 강제 분할은 아직 없다. 기본 partition retention은 90일이며, 사이트별 `retention_days < 90` 세밀한 delete도 아직 없다.

## Dogfood site provisioning

사이트 키와 insert SQL을 로컬 stdout으로 만든다.

```bash
node scripts/provision-site.mjs \
  --name "My Product" \
  --project "local-project-id" \
  --origin "https://product.example.com"
```

출력에는 다음이 포함된다.

- 한 번만 확인할 수 있는 `umlk_` site key
- SHA-256 hash를 저장하는 `sites` insert SQL
- collector 설치 snippet 예시

Insert SQL을 Supabase SQL editor에서 실행하고 생성된 site ID를 확인한다.

```sql
select id, name, project_ref, key_prefix, allowed_origins, disabled_at
from sites
where project_ref = 'local-project-id'
order by created_at desc
limit 1;
```

그 ID를 server의 `SUPABASE_SITE_ID`로 설정한다. Raw site key는 제품의 collector 초기화에만 사용하고 별도 source file에 저장하지 않는다. Provision script의 `/ml.js`는 배포 경로 예시이므로 실제 collector bundle을 제공하는 경로와 일치시켜야 한다.

## Collector consent integration

Collector의 기본 설정은 동의 전 수집을 차단한다. Host 제품은 목적·항목·보존 기간을 고지하는 consent UI를 제공하고 사용자의 선택을 전달한다.

```javascript
ml("consent", "granted");
ml("consent", "denied");
```

동의 전에는 pageview도 큐잉하지 않는다. GPC/DNT 신호는 기본적으로 hard block이다. input과 결제 필드는 설정으로 수집을 켤 수 없다.

## Ingest smoke check

1. Site의 `allowed_origins`와 browser request의 `Origin`이 정확히 같은지 확인한다.
2. 제품에서 동의 전 Network에 ingest 요청이 없는지 확인한다.
3. 동의 후 `/api/ingest`가 `202`와 `{ accepted, dropped }`를 반환하는지 확인한다.
4. Supabase `events`의 `site_id`, type, masked path와 timestamp를 확인한다.
5. Raw input value, full URL, raw user agent가 저장되지 않았는지 확인한다.

상태별 의미:

| 상태 | 의미 | 점검 |
|---|---|---|
| `401 invalid_site_key` | env 미설정 또는 key hash 불일치 | site row와 Supabase env |
| `403 origin_not_allowed` | Origin allowlist 불일치 | scheme, host, port 정확성 |
| `429 rate_limited` | site 또는 IP window 초과 | Retry-After, Upstash 상태 |
| `503 unavailable` | store 또는 backend 실패 | Supabase status·key·REST 응답 |

Upstash 장애 시 limiter는 process-local fallback을 사용한다. 이 상태가 지속되면 분산된 전역 quota가 아니므로 장애를 복구한 뒤 abuse 지표를 확인한다.

## Harness smoke check

1. Context와 confirmed KPI, funnel을 준비한다.
2. Diagnosis의 행동 데이터 섹션에서 질문과 실행 가능한 스킬을 선택한다.
3. 기간과 스킬 파라미터를 입력하고 capability가 맞는 adapter를 선택한다.
4. **측정 실행** 후 표본, provenance, confidence와 한계를 검토한다.
5. 수치가 타당할 때만 **Evidence로 적용**한다.

Supabase env가 없거나 선택 기간에 표본이 없거나 시작·종료 시각이 같으면 `insufficient_sample`이 정상이다. 이 outcome에는 수치가 없어야 한다. Adapter를 바꿔도 `MeasurementOutcome`과 provenance 구조는 동일해야 한다.

First-party RPC 실패 시 다음을 확인한다.

- `SUPABASE_SITE_ID`가 실제 site UUID인지
- `0002_aggregates.sql`·`0003_segmented_funnel.sql`이 적용됐는지
- service role에 RPC execute 권한이 있는지
- 요청 window가 event `ts` 범위와 겹치는지
- funnel step이 event type 또는 normalized path와 일치하는지

PostHog의 `not_configured`, `unauthorized`, `rate_limited`, `invalid_response`는 Project를 변경하지 않는다. `429`이면 outcome의 retry delay 이후 다시 실행한다.

현재 first-party는 rage/dead interaction만 측정한다. `error` 신호와 segment가 붙은 funnel은 수집·집계 경로가 추가되기 전까지 `unsupported_capability`가 정상이다.

## Retention and deletion operations

Cron을 활성화한 뒤 정기적으로 다음을 확인한다.

```sql
select jobname, schedule, active from cron.job order by jobname;

select inhrelid::regclass as partition
from pg_inherits
where inhparent = 'events'::regclass
order by 1;
```

방문자 삭제 요청은 raw anon ID를 ingest와 같은 SHA-256 방식으로 hash한 뒤 관리 함수에 전달한다.

```sql
select delete_visitor('site-uuid'::uuid, 'sha256-anon-id');
```

삭제 후 `events`와 `sessions` 모두에서 해당 hash가 없는지 확인한다. 현재 public deletion endpoint와 UI는 없으므로 운영자가 요청자 확인과 실행 기록을 별도로 관리한다.

## Backup and recovery

Workspace 상단 **백업**은 schema v2 전체 상태를 JSON으로 저장한다. 브라우저 데이터 삭제, 중요한 Decision, schema 변경 전 백업한다.

복원은 현재 workspace를 먼저 다운로드한 뒤 선택한 JSON으로 전체 상태를 교체한다. Import는 version, record schema, 계산 결과와 cross-record invariant를 재검증한다. v1·v2 workspace를 읽을 때는 원본을 migration backup slot에 보존한 뒤 v3로 승격한다.

손상된 storage는 자동 덮어쓰지 않는다. 원본을 내려받고 빈 workspace로 복구한 뒤 마지막 정상 backup을 복원한다. storage key 이름은 `ux-measure-lab.workspace.v1`이지만 payload version은 2다.

## Full verification gate

```bash
npm run typecheck
npm run lint
npm test
npm run test:sdk
npm run build
npm run test:e2e
```

추가 수동 확인:

- 390px와 desktop에서 Context → Decision 전체 흐름
- 동의 전 collector request 0건과 민감 input 미수집
- ingest의 Origin 거부·rate limit·Supabase failure
- harness insufficient sample에 수치가 없는지
- 측정 실행만으로 Project가 바뀌지 않고 명시 적용 후에만 Evidence가 추가되는지
- server secret이 client bundle과 response에 없는지
- cron의 가장 오래된 partition age와 visitor deletion 결과

## Known operational gaps

- Supabase migration과 cron은 운영자가 적용해야 한다.
- Site key 회전, deletion request와 retention alert UI가 없다.
- PostHog 실계정 endpoint·HogQL schema 검증은 별도 운영 확인이 필요하다.
- 인증·RLS·public read API가 없다.
- Session Replay는 구현되지 않았으며 별도 출시 조건을 따른다.
