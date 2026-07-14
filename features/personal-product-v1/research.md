# Personal Product v1 리서치 및 구현 기록

> **작성일:** 2026-07-14
> **상태:** 완료

## 구현 시작 기준선

다음 항목은 2026-07-14 리서치를 시작했을 때의 repository snapshot이다. 현재 구현 상태가 아니며, 고정 fixture prototype에서 Personal Product v1로 전환해야 했던 근거로 보존한다.

- `src/widgets/measure-workspace/MeasureWorkspace.tsx`는 fixture와 화면 상태를 한 컴포넌트가 소유한다.
- `handleCsv`는 확장자만 검사하고 파일 내용을 읽지 않는다.
- `calculateFunnel`과 `findLargestDropOff`는 존재하지만 test script와 실제 import 연결이 없다.
- 총 전환율, 가설, 실험 정보, Decision은 UI 문자열로 고정되어 있다.
- 좌측 navigation은 heading 문자열만 바꾸며 실제 기능 영역을 전환하지 않는다.
- `package.json`에는 test script가 없고 별도 test dependency도 없다.
- conceptual data model은 Project부터 Decision까지 정의했지만 구현 type은 FunnelStep과 EvidenceItem뿐이다.
- Next.js, React, TypeScript, Tailwind와 생성된 design token은 이미 설치·검증되어 재사용한다.

## 확인·재사용·신규

```text
확인: app route, MeasureWorkspace, funnel calculator, design tokens, product spec, data model
재사용: Next.js shell, token artifact, FunnelStep 개념, deterministic calculation 원칙
신규: versioned local repository, domain model, CSV parser, experiment evaluator,
      project workspace UI, URL context endpoint, optional AI adapter, tests
```

신규 모듈은 현재 구현에 같은 책임이 없고, 고정 fixture를 실제 데이터 흐름으로 교체하기 위해 필요하다.

## Gap 요약

| 영역 | 현재 | 목표 |
|---|---|---|
| Project | 고정 이름 | 여러 프로젝트와 local persistence |
| Context | 고정 copy | URL·목표·사용자 입력과 제한적 extraction |
| KPI | 고정 North Star | 완전한 metric definition과 confirm |
| CSV | 확장자 검사 | size/type/schema/row validation과 preview |
| Metrics | fixture 계산 | import 기반 단일 analysis result |
| Diagnose | 고정 Evidence | provenance가 있는 friction candidate |
| Hypothesis | 고정 문장 | 필수 필드 validation과 편집 |
| Experiment | 세 필드 표시 | 사전 등록 invariant |
| Validate | 없음 | delta, practical threshold, guardrail, verdict |
| Decide | success banner | recommendation과 human decision 분리 |
| Report | 없음 | 저장·재열람·export |
| AI | 없음 | optional server adapter와 deterministic fallback |
| Quality | type/lint/build | unit/integration/browser/security evidence |

## 아키텍처 결정

- Personal v1은 local-first 단일 사용자 제품으로 구현한다.
- browser storage는 versioned repository interface 뒤에 둬 추후 Supabase adapter로 교체 가능하게 한다.
- app state는 한 개의 Project aggregate를 source of truth로 사용한다.
- 외부 입력 parser와 결정적 계산은 React 밖의 pure TypeScript에 둔다.
- UI 의존 방향은 `app → widgets → features → entities → shared`를 유지한다.
- 서버 route는 URL extraction과 AI provider만 담당하며 metric 계산을 소유하지 않는다.

## 위험

- localStorage quota와 브라우저 종속성: 저장 크기를 제한하고 JSON backup을 제공한다.
- URL fetch SSRF: public address 검증, manual redirect, timeout, byte limit을 강제한다.
- CSV dialect: Personal v1은 UTF-8 comma-separated RFC4180 subset과 명시적 header만 지원한다.
- 통계 과장: 표본·분산이 없는 before/after input은 statistical significance를 계산하지 않고 practical threshold만 판정한다.
- AI hallucination: evidence ID allowlist, causal language check, schema validator, fallback을 둔다.

## 테스트 기반선

Node 26은 TypeScript type stripping과 `node:test`를 제공한다. 새 test library를 추가하지 않고 실제 production module을 import하는 unit/integration test를 구성할 수 있다. Browser E2E framework는 현재 없으므로 먼저 runtime UI 검증을 수행하고, 자동 browser dependency 도입은 별도 필요성을 증명한 뒤 결정한다.

## 구현 결과 delta

Personal Product v1 구현 후 기준선의 주요 gap은 다음과 같이 닫혔다.

| 기준선 gap | 구현 결과 |
|---|---|
| 고정 project·fixture | 여러 local project와 versioned JSON backup |
| 확장자만 확인하는 CSV | 실제 RFC4180 subset parser와 row-level validation |
| 고정 계산 문자열 | import 기반 funnel과 experiment pure function |
| 고정 evidence·hypothesis | provenance, friction candidate, editable hypothesis |
| 표시용 navigation | 8개 실제 workflow panel과 completion state |
| 결과·Decision 없음 | deterministic verdict, human Decision, Markdown report |
| URL context 없음 | SSRF 방어가 있는 제한적 public-page extraction |
| AI 없음 | evidence-grounded optional advisory와 deterministic fallback |
| test script 없음 | parser·metric·workflow·storage·URL·AI contract test suite |

서버 DB, 인증, 실시간 analytics integration, 자체 heatmap/replay와 통계적 유의성은 의도적으로 범위 밖에 남겼다. live AI provider는 user-owned key와 명시적 opt-in이 있어야 별도 검증할 수 있다.
