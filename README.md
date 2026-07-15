# UX MeasureLab

> Test experiences. Measure impact.

**Demo:** [ux-measure-lab.vercel.app](https://ux-measure-lab.vercel.app) · **Repository:** [Power-xc/ux-measure-lab](https://github.com/Power-xc/ux-measure-lab)

> 데모는 서버 수집 없이 동작하는 공개 빌드입니다. CSV·샘플 데이터로 8단계 Measure Loop와 harness UI 전체를 체험할 수 있고, first-party 수집·어댑터 측정은 자신의 환경에 배포해 사용합니다.

UX를 데이터로 개선하려면 오늘은 배워야 할 도구가 너무 많습니다. 퍼널은 분석 도구에, 클릭과 마찰 신호는 히트맵 도구에, 세션 맥락은 녹화 도구에, A/B 테스트는 또 다른 도구에 흩어져 있습니다. 각 도구의 개념·설정·권한을 익혀야 하고, 그렇게 얻은 조각난 결과를 사람이 직접 이어 붙여야 비로소 결정이 나옵니다.

UX MeasureLab은 이 전체 과정을 하나의 workspace로 모읍니다. "가입 퍼널 어디서 사용자가 새는가", "결제 직전 화면에서 왜 마찰이 생기는가" 같은 질문을 입력하면 필요한 측정이 자동으로 구성되고 — measurement harness — 그 결과는 검증 가능한 가설, 사전 등록된 실험, 사람이 기록하는 결정으로 이어집니다.

```text
질문 → 측정 자동 구성 → Evidence → 가설 → 실험 → 검증 → 사람의 결정
```

AI는 의사결정을 대신하지 않고 근거에 연결된 원인 후보와 가설 대안만 제안합니다. 전환율, delta, guardrail, verdict 같은 계산 가능한 값은 전부 TypeScript 코드가 결정하며 최종 결정은 사람이 기록합니다.

## 전체 여정을 본다

페이지 한 장의 스냅샷으로는 사용성을 판단할 수 없습니다. UX MeasureLab이 다루는 관찰 단위는 운영 중인 제품 전체에서 벌어지는 실제 사용 여정입니다.

- 사용자가 어떤 요소를 클릭하고 어느 단계에서 이탈하는지
- 세션이 페이지를 넘어 어떻게 이어지고 어디서 끊기는지
- rage click, dead click 같은 마찰 신호가 어느 화면에 쌓이는지
- 필요하면 사전 동의 기반 세션 녹화로 해당 맥락을 재생하는지

행동 데이터는 스크립트 한 줄로 설치되는 first-party SDK가 수집하고, 이미 사용 중인 분석 도구는 read-only 어댑터로 연결합니다. 소스가 무엇이든 동일한 evidence 스키마로 정규화되어 같은 결정 루프에 공급됩니다.

## Measurement harness

측정 능력과 데이터 소스를 하나의 생태계로 등록해 두고, 질문이 들어오면 필요한 조합만 발동시키는 실행 구조입니다.

```text
질문 유형 판정
→ 측정 스킬 선택 (퍼널 이탈 · 마찰 신호 · 여정 연속성 · 전후 비교 …)
→ 스킬이 요구하는 데이터 능력 ↔ 어댑터 capability 자동 매칭
→ 결정적 측정 실행 → 정규화 Evidence (provenance·표본·기간 포함)
→ 기존 Measure Loop의 진단·가설·실험·결정 단계로 공급
```

- **선언과 매칭** — 측정 스킬은 필요한 데이터 능력을 선언하고, 어댑터는 제공 가능한 능력을 선언합니다. 조합은 자동으로 구성되며 실행 전 사용자가 확인합니다.
- **계약 기반 확장** — first-party SDK, PostHog 커넥터, 이후 추가되는 어떤 소스든 같은 어댑터 계약을 구현하면 기존 스킬이 재작성 없이 그대로 동작합니다.
- **버전과 마이그레이션** — evidence 스키마는 버전 관리되고, 스키마가 진화해도 기존 프로젝트 데이터는 마이그레이션으로 호환을 유지합니다. 현재 저장소가 이미 versioned schema 검증 위에서 동작하며 같은 원칙을 확장합니다.
- **성장하는 생태계** — 스킬과 어댑터가 추가될수록 같은 질문이 더 풍부한 증거로 답해집니다. 도구를 갈아탈 때마다 제품을 재설계하는 것이 아니라, 생태계에 어댑터 하나를 더하는 방식으로 성장합니다.

## 방향

현재 버전은 분석 export(CSV)를 수동으로 연결하는 evidence-to-decision 워크스페이스이며, 위 harness 구조를 다음 단계들로 구현합니다.

| 단계 | 내용 | 상태 |
|---|---|---|
| Evidence-to-decision 루프 | 8단계 Measure Loop, 결정적 지표 계산, 사전 등록 실험, human decision | **구현** |
| Source adapter 계약 | 모든 행동 데이터 소스를 동일한 evidence 스키마로 정규화하는 인터페이스 | **구현** |
| First-party SDK | 스크립트 한 줄로 페이지뷰·클릭·rage/dead click·스크롤·세션 수집 | **구현** · 실수집은 사이트 프로비저닝 후 |
| Ingest 서버 | 자체 이벤트 수신, 세션화, 90일 보존 | **구현** · Supabase/Upstash 연결 대기 |
| Measurement harness | 질문을 입력하면 퍼널 이탈·마찰 신호·여정 연속성 측정이 구성 | **구현** (스킬 3종) |
| External connectors | PostHog read-only 어댑터 | **구현** · 실계정 검증 대기 |
| Session replay | 사전 동의, 기본 마스킹, 짧은 보존을 전제로 한 세션 녹화 | spec 확정 · 로드맵 |

상태는 [Verification](docs/verification.md)의 실행 증거를 따릅니다. "대기" 표기는 코드·테스트가 완료되었고 외부 계정 연결만 남았다는 뜻입니다.

## 현재 구현

| Capability | 상태 |
|---|---|
| 여러 개인 프로젝트와 브라우저 자동 저장 | 구현 |
| versioned JSON 백업·복원과 손상 데이터 복구 | 구현 |
| 제품 URL의 안전한 metadata·heading·navigation 추출 | 구현 |
| KPI 정의·확정 | 구현 |
| 실제 CSV 검증·퍼널 전환·이탈 계산 | 구현 |
| UX 마찰 후보·근거·가설 편집 | 구현 |
| 실험 사전 등록과 Before/After·guardrail 판정 | 구현 |
| Human Decision·Markdown 리포트 | 구현 |
| Playwright E2E — 8단계 루프·복구·키보드·모바일·harness | 구현 |
| 질문 → 측정 → Evidence 적용 (퍼널 이탈·마찰 신호·여정 연속성) | 구현 |
| First-party SDK와 ingest 파이프라인 (동의 게이트·마스킹 기본) | 구현, 실수집은 프로비저닝 후 |
| PostHog read-only 어댑터 | 구현, 실계정 검증 대기 |
| 근거 기반 AI 진단·가설 제안 | 선택 기능, loopback development에서 명시적 활성화 필요 |
| Session replay | spec만 확정, 미구현 |
| 인증·팀 workspace | 범위 밖, 다중 사용자 전 RLS 전제 |

## 제품 흐름

1. 공개 제품 URL과 대상 사용자, 핵심 가치 행동, 목표를 입력합니다.
2. KPI 정의, 계산 방식, 측정 기간과 데이터 출처를 확정합니다.
3. 퍼널 CSV를 업로드해 전환율, 이탈률과 최대 이탈 구간을 계산합니다.
4. 관찰·근거·가능한 원인·누락 근거를 구분해 UX 마찰 후보를 만듭니다.
5. 변경안, 예상 행동, 대안 설명이 포함된 가설을 확정합니다.
6. 성공·실패·guardrail·표본·기간·종료 규칙을 사전 등록합니다.
7. 변경 전후 값을 입력해 practical threshold 기반 verdict를 계산합니다.
8. 사람의 결정과 다음 행동을 기록하고 Markdown 리포트를 내보냅니다.

## 빠른 시작

현재 품질 게이트는 Node 26에서 검증했습니다.

```bash
npm ci
npm run dev
```

브라우저에서 `http://127.0.0.1:3000`을 열면 됩니다. 개발·로컬 production 명령은 서버를 loopback에만 바인딩합니다. 모든 프로젝트 데이터는 기본적으로 현재 브라우저의 `localStorage`에만 저장됩니다. 중요한 작업은 상단의 **백업**으로 JSON 파일을 보관하세요.

### 퍼널 CSV

UTF-8 comma-separated CSV와 다음 헤더 순서를 사용합니다. 한 파일은 1MB·100단계 이하이며, 사용자 수는 첫 단계부터 감소하거나 같아야 합니다.

```csv
step_id,step_name,users
landing,랜딩 방문,1000
signup,가입 완료,540
core_action,핵심 행동,210
```

앱의 **샘플 데이터 사용**과 **CSV 템플릿 다운로드**로 바로 시작할 수도 있습니다.

## 선택적 AI 설정

AI가 없어도 전체 Measure Loop를 완료할 수 있습니다. 실제 provider는 loopback에 바인딩된 `npm run dev`에서만 사용할 수 있습니다. `.env.local`에 서버 전용 값을 설정하고 명시적으로 활성화합니다.

```bash
UX_MEASURE_AI_ENABLED=true
OPENAI_API_KEY=your_server_key
OPENAI_MODEL=gpt-5.6-luna
```

`OPENAI_API_KEY`는 서버 route에서만 읽습니다. 제품 URL, raw HTML, raw CSV는 AI 요청에 포함하지 않습니다. AI 출력은 기존 evidence ID만 참조할 수 있고 KPI 수치, threshold, verdict와 human decision을 수정할 수 없습니다. 키가 없거나 timeout·provider·출력 검증에 실패하면 결정적 초안으로 복구합니다.

Personal v1은 인증 없는 유료 API proxy가 되지 않도록 provider를 `NODE_ENV=development`에서만 활성화하고, `npm run dev`를 `127.0.0.1`에 고정합니다. production build와 공개 배포에서는 설정값이 있어도 결정적 fallback을 사용합니다. 공개 AI 기능은 인증과 durable user quota를 설계한 후 별도 버전에서 활성화합니다.

## 품질 게이트

```bash
npm run typecheck
npm run lint
npm test
npm run test:sdk
npm run build
npm audit --omit=dev
npm run test:e2e
```

단위 테스트 165개는 CSV·퍼널·실험 판정·저장소 invariant·URL과 AI trust boundary에 더해 harness 계약, 측정 스킬, PostHog 어댑터, ingest 검증 파이프라인과 백엔드를 다루고, SDK 테스트 69개는 동의 게이트·마스킹·검출 규칙·세션·전송을 다룹니다. Playwright E2E 8종은 8단계 golden loop, 복구, 키보드, 390px reflow와 harness 측정 흐름을 production build 기준으로 검증합니다. 실제 검증 결과는 [Verification](docs/verification.md)에 기록합니다.

## 데이터·보안 원칙

- Evidence before opinion: 일반론보다 실제 행동 데이터와 provenance를 우선합니다.
- Hypothesis, not conclusion: 상관관계를 원인으로 단정하지 않습니다.
- Deterministic metrics: 전환율, delta, guardrail, verdict는 코드가 계산합니다.
- Human-in-the-loop: AI 제안은 사용자가 검토하고 적용해야 저장됩니다.
- Local-first: 브라우저 저장과 JSON 백업이 기본이며 서버 DB로 자동 전송하지 않습니다.
- Untrusted by default: CSV, JSON, URL, HTML, AI 출력은 모두 외부 입력으로 검증합니다.
- Consent-first collection: 자체 수집 단계는 사전 동의, 기본 입력 마스킹, 짧은 보존 기간을 출시 조건으로 설계합니다.

상세 위협 모델과 운영 제한은 [Security](docs/security.md)를 참고하세요.

## 현재 한계

- 통계적 유의성이나 인과관계를 자동 판정하지 않습니다. 현재 verdict는 사전 등록한 practical threshold, 표본, 기간과 guardrail 규칙에 기반합니다.
- URL 분석은 공개 HTML 한 페이지의 제한된 텍스트 맥락만 추출합니다. 운영 중인 제품 전체의 사용 여정을 이해하려면 행동 데이터가 필요하며, 이 간극을 메우는 것이 위 로드맵(first-party SDK와 measurement harness)의 핵심입니다.
- 브라우저 데이터를 지우면 local workspace도 삭제됩니다. JSON 백업이 복구 수단입니다.
- 회사용 권한, 협업, 감사 로그, 서버 동기화는 아직 없습니다.
- 실제 OpenAI provider 호출은 사용자의 키와 opt-in 설정이 있어야 별도로 검증할 수 있습니다.

## 문서

- [Product Brief](docs/product-brief.md)
- [Measurement Harness Spec](features/measurement-harness/spec.md)
- [Session Replay Spec](features/session-replay/spec.md)
- [Personal Product v1 Spec](features/personal-product-v1/spec.md)
- [Architecture](docs/architecture.md)
- [Data Model](docs/data-model.md)
- [Security](docs/security.md)
- [Runbook](docs/runbook.md)
- [Verification](docs/verification.md)
- [Dogfood Template](docs/dogfood-template.md)
- [Decision Layer ADR](docs/adrs/0001-decision-layer.md)
- [Research Evidence Registry](research/evidence-registry.md)
- [Research Claim Audit](research/claim-audit.md)

## 개발

프로젝트별 구현 규칙, 스택, 보안 경계는 위 문서와 각 `features/` 스펙에 정리되어 있습니다. 변경 전 관련 문서를 확인하고, 아래 품질 게이트를 통과한 뒤 커밋합니다.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
