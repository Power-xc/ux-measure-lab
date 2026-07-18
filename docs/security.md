# Security

> **대상:** Personal Product · local workspace + optional measurement backends · 2026-07-15

이 문서는 구현된 trust boundary와 남은 위험을 기록한다. 침투 테스트, 법률 자문 또는 규정 준수 인증을 의미하지 않는다.

## Data separation

- Project, KPI, Evidence, experiment, verdict와 Decision은 browser `localStorage` schema v2와 사용자 JSON backup에 남는다.
- 행동 이벤트는 별도 ingest 경로를 통해 선택적 Supabase 증거 계층에 저장된다.
- 무결성 데이터는 ingest에 보내지 않는다.
- raw CSV, raw HTML, input value, credential, full referrer URL, raw user agent는 저장하지 않는다. replay 녹화는 gate 9 서명 전까지 활성화하지 않는다([PIA 초안](replay-privacy-impact.md)).
- 행동 스트림은 손실 허용 표본이다. 결과에는 기간·표본·순서형 신뢰 한계를 함께 표시한다.

## Boundary map

| 경계 | 정상 호출 | 인증·검증 | 실패 동작 |
|---|---|---|---|
| Collector → `/api/ingest` | cross-origin | site key hash, per-site Origin allowlist, reflected CORS, bounded body, event schema, site+IP rate | 401/403/429/503 또는 event drop |
| Workspace → `/api/harness/measure` | same-origin | Origin, `Sec-Fetch-Site`, bounded JSON, exact query keys, adapter capability | 400/404 또는 typed adapter error |
| Harness → Supabase | server-to-server | service role env, site ID, RPC response validation | `upstream_error`·`invalid_response` |
| Harness → PostHog | server-to-server, read-only | server API key, allowed cloud host, local quota, response validation | typed error, Project 불변 |
| Browser → local persistence | local | schema-before-write, invariant, compare-before-write | 경고·재시도·backup |

수집과 측정 API는 서로 다른 경계다. `/api/ingest`에 workspace의 same-origin guard를 적용하면 정상 수집을 차단한다. `/api/harness/measure`에 cross-origin access를 열면 server connector와 aggregate read 권한이 노출된다.

## Collector privacy controls

- `requireConsent: true`가 기본이며 명시적 `granted` 전에는 큐잉과 전송을 모두 막는다.
- GPC 또는 DNT를 존중하도록 설정된 기본 상태에서는 해당 신호가 수집을 차단한다.
- input, textarea, select, password, contenteditable, payment autocomplete와 민감한 name을 가진 요소는 설정과 무관하게 수집하지 않는다.
- click text는 기본 비활성이고, 활성화해도 민감 target에서 반환하지 않는다.
- query string은 기본 제거하며 email, UUID, 긴 token과 숫자 식별자로 보이는 path segment를 마스킹한다.
- referrer는 origin으로 축소한다.
- browser 식별자는 pseudonymous이며 ingest가 `anon_id`를 다시 SHA-256 hash로 저장한다.

Host 제품이 동의 UI와 고지, 철회 처리를 책임진다. SDK의 consent gate만으로 조직의 법적 의무가 완료되는 것은 아니다.

## Ingest controls

검증 순서는 content type·크기 → bounded body·압축 해제 → envelope → site → Origin → rate → bot filter → 개별 event → insert다.

- site key는 browser에 노출되는 공개 write key이며 secret으로 취급하지 않는다.
- database에는 raw key 대신 SHA-256 hash와 관리용 prefix만 저장한다.
- 허용된 Origin만 그대로 반사하고 `Access-Control-Allow-Origin: *`를 사용하지 않는다.
- 요청은 압축 64KB, 해제 후 256KB, batch 50개로 제한한다.
- 유효하지 않은 이벤트는 batch 안에서 드롭하고 나머지는 저장한다.
- Supabase insert가 실패하면 `503`으로 빠르게 종료한다.
- Upstash 장애 시 프로세스별 in-memory limiter로 강등해 무제한 fail-open을 피한다.
- env가 없으면 빈 site store가 모든 수집을 거부한다.

현재 인증·RLS가 없으므로 개인 단일 사이트 범위를 벗어나 운영하지 않는다. 공개 제품으로 전환하기 전에 read authorization, tenant isolation, abuse telemetry와 edge quota가 필요하다.

## Harness controls

- request parser는 capability별 필수 필드와 허용 필드가 정확히 일치해야 통과시킨다.
- registry는 adapter가 선언한 capability와 query가 맞을 때만 실행한다.
- same-session cache는 종료된 과거 기간에만 정규화 query의 SHA-256 `queryHash`를 사용한다.
- server 응답도 client에서 `MeasurementOutcome`과 `NormalizedMeasurement`로 다시 검증한다.
- `insufficient_sample`은 수치 없는 오류 outcome이며 임의 수치로 대체하지 않는다.
- ConfidenceBand는 표본 기반 `low | medium | high`다. p-value나 성공 확률이 아니다.
- 결과 수신만으로 Project를 바꾸지 않고 사용자의 **Evidence로 적용** 동작이 있어야 저장한다.
- Evidence `sourceRef`는 양의 sample size, adapter, capability, query hash와 confidence를 보존한다.

## Server secrets

다음 값은 server environment에서만 읽는다.

```text
SUPABASE_SERVICE_ROLE_KEY
UPSTASH_REDIS_REST_TOKEN
POSTHOG_API_KEY
OPENAI_API_KEY
```

`SUPABASE_URL`, `SUPABASE_SITE_ID`, Upstash URL, PostHog host/project ID도 server backend 선택에 사용한다. 원격 backend URL은 HTTPS만 허용하고 HTTP는 loopback 개발 주소에서만 허용한다. `NEXT_PUBLIC_` prefix를 붙이지 않으며 request body, response, client state와 log에 secret을 넣지 않는다.

Supabase service role은 sites/events/RPC에 강한 권한을 가진다. key가 노출되면 즉시 회전하고, database log와 deployment environment history도 확인한다. PostHog adapter는 read-only personal API key와 필요한 최소 project scope를 사용한다.

## Retention and deletion

이벤트 schema는 90일 기본 보존을 의도한다. `jobs.sql`은 만료 partition drop과 `delete_visitor(site_id, anon_id_hash)`를 정의하지만 자동 실행되지 않는다.

- migration과 cron을 적용하지 않은 환경에는 90일 자동 삭제 보장이 없다.
- cron은 운영자가 명시적으로 활성화하고 가장 오래된 partition age를 점검해야 한다.
- 방문자 삭제는 현재 관리 SQL 함수이며 public API나 사용자 UI가 아니다.
- `retention_days < 90`의 사이트별 세밀한 삭제는 아직 구현되지 않았다.
- JSON backup과 localStorage 삭제는 사용자가 별도로 관리한다.

## URL and advisory controls

Product URL 분석은 public HTTP(S), credential·port·host·DNS·IP·redirect를 검증하고 선택한 public IP에 연결한다. status, content type, encoding, 512KB와 timeout을 제한한 뒤 active markup을 제거한 text만 반환한다.

선택적 diagnosis provider는 개발 환경의 명시적 opt-in에서만 호출한다. key는 server env에 있고, output은 strict schema와 evidence allowlist를 통과해야 한다. 실패하거나 stale하면 결정적 초안을 사용한다. 수치, threshold, verdict와 Decision은 provider가 정하지 않는다.

## Web controls

- production CSP는 script, connect와 form을 same-origin 중심으로 제한한다. `frame-src`는 loopback replay sandbox(`http://127.0.0.1:*`·`http://localhost:*`)만 허용하며, 그 sandbox 문서는 라우트에서 더 엄격한 자체 CSP(`default-src 'none'`)와 loopback 전용 `frame-ancestors`를 강제한다.
- `frame-ancestors 'none'`, `X-Frame-Options: DENY`(replay sandbox 라우트 제외), `object-src 'none'`, COOP, CORP, `nosniff`와 no-referrer를 사용한다.
- API JSON 응답은 `Cache-Control: no-store`다.
- 외부 text는 React text node로 렌더링하고 `dangerouslySetInnerHTML`을 사용하지 않는다.
- request body와 in-memory rate key map에 상한이 있다.

## Residual risks

| 영역 | 현재 상태 | 남은 위험 |
|---|---|---|
| Access control | 개인 사용, same-origin read route | 인증·RLS·tenant authorization 없음 |
| Secret management | server env | 운영 host의 env access·회전 절차 검증 필요 |
| Collector abuse | Origin, public key, dual rate, bot hint | Origin 위조가 가능한 non-browser client와 key abuse |
| Data minimization | hard input exclusion, path masking | DOM text·custom props를 확장할 때 PII 재평가 필요 |
| Integrity | strict parser, invariant, deterministic recalculation | backup 서명과 audit log 없음 |
| Availability | bounded queue/body, 503, local limiter fallback | serverless instance별 fallback은 전역 quota가 아님 |
| Retention | SQL asset 존재 | migration·cron 미적용 환경은 자동 보존 미보장 |
| Connector | read-only adapter, strict response | 실제 project 권한과 upstream schema를 운영 전 확인해야 함 |
| Replay | 코어·sandbox player 구현, 녹화 비활성 | 활성화는 영향평가·법률 서명(gate 9) 후 — [PIA 초안](replay-privacy-impact.md) |

## Operational rules

- 실제 `.env.local`과 site key 출력물을 저장소에 넣지 않는다.
- 회사 데이터를 연결하기 전 해당 조직의 수집, 외부 connector와 보존 정책을 확인한다.
- Supabase migration과 cron 적용 전 백업·복구 절차를 준비한다.
- 외부 공개 전 인증, read authorization, edge rate limit과 deletion request workflow를 추가한다.
- dependency audit, secret scan, client bundle scan, production header와 retention job을 release gate에서 확인한다.
