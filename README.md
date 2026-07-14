# UX MeasureLab

> Test experiences. Measure impact.

**Live:** [ux-measure-lab.vercel.app](https://ux-measure-lab.vercel.app) · **Repository:** [Power-xc/ux-measure-lab](https://github.com/Power-xc/ux-measure-lab)

UX MeasureLab은 제품 링크와 사용자 행동 데이터를 연결해 핵심 KPI, 퍼널 이탈, UX 마찰을 분석하고, 검증 가능한 디자인 가설과 실험 결과를 도출하는 AI UX Measurement & Experimentation 도구입니다.

```text
Product → Measure → Diagnose → Hypothesize → Experiment → Validate → Decide
```

복잡한 분석 도구를 직접 다루지 않아도 행동 데이터에서 중요한 문제 구간을 찾고, 이를 실제 변경안과 측정 가능한 실험으로 연결하는 것이 목표입니다. AI는 의사결정을 대신하지 않고 근거에 연결된 원인 후보와 가설 대안을 제안합니다. 계산 가능한 지표와 verdict는 TypeScript가 결정하며 최종 결정은 사람이 기록합니다.

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
| 근거 기반 AI 진단·가설 제안 | 선택 기능, loopback development에서 명시적 활성화 필요 |
| 인증·팀 workspace·서버 DB | 범위 밖 |
| 실시간 analytics·heatmap·session replay | 범위 밖 |

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
npm run build
npm audit --omit=dev
```

현재 53개 테스트는 CSV, 퍼널 계산, 실험 판정, 저장소·workflow invariant, 공개 URL trust boundary, AI 계약과 fallback을 다룹니다. 실제 검증 결과와 브라우저 시나리오는 [Verification](docs/verification.md)에 기록합니다.

## 데이터·보안 원칙

- Evidence before opinion: 일반론보다 실제 행동 데이터와 provenance를 우선합니다.
- Hypothesis, not conclusion: 상관관계를 원인으로 단정하지 않습니다.
- Deterministic metrics: 전환율, delta, guardrail, verdict는 코드가 계산합니다.
- Human-in-the-loop: AI 제안은 사용자가 검토하고 적용해야 저장됩니다.
- Local-first: 브라우저 저장과 JSON 백업이 기본이며 서버 DB로 자동 전송하지 않습니다.
- Untrusted by default: CSV, JSON, URL, HTML, AI 출력은 모두 외부 입력으로 검증합니다.

상세 위협 모델과 운영 제한은 [Security](docs/security.md)를 참고하세요.

## 현재 한계

- 통계적 유의성이나 인과관계를 자동 판정하지 않습니다. 현재 verdict는 사전 등록한 practical threshold, 표본, 기간과 guardrail 규칙에 기반합니다.
- URL 분석은 공개 HTML 한 페이지의 제한된 텍스트 맥락만 추출합니다. 로그인 페이지, 전체 사이트 크롤링, 자동 UX 평가는 지원하지 않습니다.
- 브라우저 데이터를 지우면 local workspace도 삭제됩니다. JSON 백업이 복구 수단입니다.
- 회사용 권한, 협업, 감사 로그, 서버 동기화는 아직 없습니다.
- 실제 OpenAI provider 호출은 사용자의 키와 opt-in 설정이 있어야 별도로 검증할 수 있습니다.

## 문서

- [Product Brief](docs/product-brief.md)
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
