# Security

> **대상:** Personal Product v1 · 로컬 개인 사용 기준

이 문서는 구현된 trust boundary와 남은 위험을 기록한다. 침투 테스트나 규정 준수 인증을 의미하지 않는다.

## Data boundary

- project, CSV에서 정규화한 퍼널, evidence, experiment와 decision은 브라우저 `localStorage`에 저장된다.
- raw CSV 파일, raw HTML, session replay, credential과 민감한 form payload는 저장하지 않는다.
- JSON backup은 사용자가 직접 내려받고 복원한다. 파일 자체는 암호화되지 않으므로 안전한 위치에 보관해야 한다.
- 제품 데이터는 서버 DB로 자동 전송되지 않는다.
- AI 요청에는 제품 URL, raw HTML, raw CSV, 사용자 식별자와 secret을 넣지 않는다.

## Trust boundaries

| 입력 | 구현된 방어 | 실패 동작 |
|---|---|---|
| Context form | 길이·URL 형식 검증 | 저장 거부, 오류 표시 |
| Funnel CSV | 1MB, type·header·행·정수·순서 검증 | 기존 유효 상태 유지, 행 오류 표시 |
| JSON restore | 1MB UI limit, parse·version·전체 schema·cross-record invariant | import 거부 |
| Product URL | public HTTP(S), credential·port·host·DNS·IP·redirect 검증 | 수동 입력으로 계속 |
| Remote HTML | status·content type·encoding·512KB·timeout, inert bounded text extraction | snapshot 생성 안 함 |
| AI request | 32KB, same-origin, runtime schema, evidence 5개 제한 | 400 또는 fallback |
| AI output | strict JSON schema, unknown field·evidence allowlist·인과 단정 검증 | 출력 폐기, deterministic draft |
| Browser storage | schema-before-write, compare-before-write, storage event | 경고·재시도·backup 안내 |

## URL fetch controls

- `http:`와 `https:`의 기본 포트만 허용한다.
- URL credential, localhost 계열 host와 private·loopback·link-local·reserved IP range를 차단한다.
- DNS의 모든 응답이 public인지 확인하고 선택한 resolved IP에 직접 연결한다.
- HTTPS는 원래 hostname을 TLS SNI로 사용하고 `Host` header를 보존한다.
- redirect는 최대 3회이며 목적지를 매번 처음부터 재검증한다.
- 요청당 5초, 전체 10초, HTML 512KB를 넘으면 중단한다.
- 압축 응답을 요청하지 않으며 HTML/XHTML 이외 content type은 거부한다.
- script, style, template, noscript, SVG를 제거한 뒤 제한된 text만 반환한다.
- 추출 결과는 UI에서 **신뢰하지 않은 페이지 텍스트**로 표시하고 사용자가 적용한다.

## AI controls

- `NODE_ENV=development`, `UX_MEASURE_AI_ENABLED=true`, `OPENAI_API_KEY`를 모두 만족해야 외부 호출한다.
- `npm run dev`는 `127.0.0.1`에만 bind한다. production runtime과 공개 배포는 항상 fallback이다.
- key와 model 설정은 server environment에서만 읽는다.
- `store: false`, tool 없음, strict structured output, 1,200 output token, 10초 timeout, retry 없음.
- system instruction은 사용자 payload를 데이터로만 취급하고 내부 문자열의 명령을 무시하도록 고정한다.
- 모델은 기존 evidence ID만 참조할 수 있다. 각 원인 후보는 근거와 불확실성 표현을 가져야 한다.
- 응답 계약에 KPI 수치, threshold, p-value, verdict와 decision 필드가 없다.
- 제안은 transient advisory이며 사용자의 명시적 적용 전에는 Project를 수정하지 않는다.
- 응답 중 project ID나 `updatedAt`이 바뀌면 stale 결과를 폐기한다.
- provider가 없거나 timeout·HTTP·refusal·JSON·schema 검증이 실패하면 결정적 초안으로 복구한다.

## Web controls

- production CSP는 script·connect·form·frame을 same-origin 중심으로 제한한다.
- `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `object-src 'none'`을 사용한다.
- COOP, CORP, `nosniff`, `no-referrer`, 제한된 Permissions Policy를 적용한다.
- API는 필수 same-origin `Origin`과 `Sec-Fetch-Site`를 확인하고 응답을 `no-store`로 반환한다.
- request body와 rate-limit key map을 제한한다.
- UI는 외부 HTML과 AI text를 React text node로 렌더링하며 `dangerouslySetInnerHTML`을 사용하지 않는다.

## OWASP Top 10 mapping

| Risk area | 현재 대응 | 남은 위험 |
|---|---|---|
| Access control | Personal v1은 인증·공유 API 없음, same-origin POST | multi-user 출시 전 auth·tenant authorization 필요 |
| Cryptographic failures | secret server env, provider TLS | localStorage·backup은 암호화되지 않음 |
| Injection | typed parser, inert text, no HTML injection, structured AI output | 새 connector마다 별도 validator 필요 |
| Insecure design | deterministic metric boundary, human decision, downstream invalidation | history·audit log 없음 |
| Security misconfiguration | headers, CSP, powered-by 제거, env template | 실제 host의 proxy/header 설정 검증 필요 |
| Vulnerable components | lockfile, dependency audit gate | 지속적인 dependency update 필요 |
| Authentication failures | 인증 자체가 범위 밖 | public team product로 그대로 사용 불가 |
| Integrity failures | JSON schema, forged evaluation 재계산, invariant checks | backup 작성자 서명 없음 |
| Logging/monitoring | client에 secret 로그 없음 | server audit·abuse telemetry 없음 |
| SSRF | DNS all-answer 검증, IP pinning, redirect 재검증 | 배포 네트워크 egress policy가 추가 방어로 필요 |

## OWASP LLM risk mapping

| Risk area | 현재 대응 | 남은 위험 |
|---|---|---|
| Prompt injection | untrusted payload 경계, no tools·browse·actions, injection fixture | 자연어 필터는 완전한 증명이 아님 |
| Sensitive disclosure | 최소 필드 전송, URL/raw data/secret 제외, `store:false` | 사용자가 form에 민감정보를 직접 쓰지 않아야 함 |
| Supply chain | SDK 없이 단일 HTTPS endpoint, lockfile | provider 모델 변경과 운영 정책 모니터링 필요 |
| Data/model poisoning | 모델 학습·fine-tuning 없음 | external benchmark 도입 시 provenance 필요 |
| Improper output handling | strict runtime validation, React text rendering | 새 downstream action 추가 시 재설계 필요 |
| Excessive agency | 도구·자동 action 없음, 명시적 apply | 향후 integration에 최소 권한 필요 |
| System prompt leakage | 응답 계약에 prompt·secret 없음 | provider 자체 보장은 별도 검토 대상 |
| Vector/embedding weakness | RAG·vector store 없음 | 해당 기능 도입 전 별도 threat model 필요 |
| Misinformation | evidence ID, uncertainty, alternative·missing evidence, human review | 모델 제안은 여전히 틀릴 수 있음 |
| Unbounded consumption | request/output/time/rate limits, explicit opt-in | in-memory rate limit은 distributed quota가 아님 |

## Operational rules

- `.env.local`과 실제 key를 commit하지 않는다.
- 회사 데이터 사용 전 해당 조직의 데이터 처리·AI 전송 정책을 확인한다.
- live provider 활성화 전 비용 한도, abuse protection과 provider retention 정책을 확인한다.
- 외부 공개 배포 전 인증 또는 edge rate limit을 추가한다.
- dependency audit, secret scan, client bundle scan과 production header 확인을 release gate로 반복한다.

## Residual risk

Personal v1은 단일 사용자의 로컬 실험 workspace다. XSS가 가능한 동일 origin 코드나 브라우저 확장은 localStorage를 읽을 수 있고, JSON backup을 받은 사람은 내용을 볼 수 있다. 민감한 원본 데이터 저장소로 사용하지 말고 필요 최소한의 집계값만 입력한다.
