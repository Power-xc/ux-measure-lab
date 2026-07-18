# Session Replay — 개인정보 영향평가

> **상태:** **loopback dogfood 범위 서명 완료** (2026-07-19) · 공개 cohort 확대 범위는 서명 전
> **범위:** [session-replay spec](../features/session-replay/spec.md)의 launch gate 9. 아래 §6에서 서명 범위를 **owner 1인의 loopback dogfood**로 한정한다.
> **성격:** 이 문서는 제품 팀이 구현된 통제와 잔여 위험을 정리한 **운영 준비 자료**다. 법률 자문, 침투 테스트, 규정 준수 인증이 아니다.

launch gate 9(개인정보 영향평가·법률·조직 정책 검토)는 코드로 닫을 수 없다. 이 문서는 서명권자가 판단할 수 있도록 데이터 흐름, 근거, 남은 결정을 한곳에 모은다. 게이트 1~8은 코드로 구현·검증되었다([research.md](../features/session-replay/research.md) §4, [verification.md](verification.md)).

**서명 범위 (2026-07-19):** owner(제품 소유자) 본인이 자신의 loopback 개발 런타임(`127.0.0.1`/`localhost`)에서 **자기 자신의 워크스페이스 사용 세션**만 녹화·재생하는 dogfood에 한해 gate 9를 승인한다. 이 범위에서는 정보주체가 곧 처리자·소유자 본인이고, 데이터가 로컬 프로세스를 떠나지 않으며(외부 provider·CDN·subprocessor 없음), 30일 hard delete와 owner-only 재생이 코드로 강제된다. **제3자 방문자 녹화·공개 배포·cohort 확대는 이 서명에 포함되지 않으며** §4의 잔여 결정과 별도 서명이 선행되어야 한다.

## 1. 처리 개요

| 항목 | 내용 |
|---|---|
| 처리 목적 | 퍼널 이탈·마찰 신호가 발생한 세션의 상호작용 순서를 사람이 재현해 대안 설명을 찾는 정성 근거 확보 (수치 지표·원인 판정 아님) |
| 법적 근거 후보 | 별도 목적의 사전 동의(opt-in). audience-measurement 예외에 의존하지 않음 |
| 정보주체 | 동의한 대상 제품의 방문자 |
| 데이터 범주 | rrweb DOM snapshot·mutation, 마스킹된 상호작용(마우스·클릭·스크롤·뷰포트·마스킹된 경로) |
| 명시적 제외 | 모든 input value·contenteditable, console·network body·clipboard·keystroke, canvas·media, cross-origin iframe 내용 ([spec](../features/session-replay/spec.md) §4) |
| 보존 | 기본·최대 30일 hard delete, 사이트는 더 짧게만 설정 가능 |
| 저장 위치 | Postgres(`replay_chunks`) + 동의 metadata 분리 저장. object storage 이관은 실사용량 확인 후 별도 결정 |
| 국외 이전 | Supabase·subprocessor 리전 미확정 — **서명 전 결정 필요** |

## 2. 데이터 흐름과 구현된 통제

```text
대상 제품 브라우저
  └─ ReplayRecorder (별도 opt-in 모듈, 미활성)         gate 1·2
     ├─ 동의 전 엔진 로드·ID·전송 0건                   SR-01
     ├─ 엔진 무관 하드 새니타이저 (값 제거·전체 텍스트 마스킹·URL 스크럽)  gate 3·4 / SR-02·03
     └─ bounded chunk → POST /api/replay/ingest
        ├─ site key hash + Origin allowlist + rate + purpose version   SR-05
        ├─ privacy 위반(잔존 값·위험 scheme) chunk 전체 거부            SR-05
        └─ 30일 hard 보존 상한 + anonymous_id·site key SHA-256 저장     gate 5 / SR-06

owner loopback workspace (127.0.0.1 ↔ localhost)
  └─ same-origin owner-only read (no-store, 만료 즉시 차단)            gate 7 / SR-08
     └─ 네트워크 차단 sandbox 재생 (alias origin, CSP default-src none,  gate 8 / SR-09
        스크립트·폼·내비게이션·팝업 차단, 원격 리소스 URL 제거)
        └─ 선택 세션만 명시 적용 시 qualitative Evidence               SR-10·11
```

각 통제의 테스트 증거는 [verification.md](verification.md)의 "Replay 경계" 및 SR-01~11 항목에 있다.

## 3. 위험과 완화

| 위험 | 완화(구현됨) | 잔여 |
|---|---|---|
| 입력값·민감 텍스트 수집 | 이중 하드 마스킹(클라이언트 새니타이저 + 서버 전체 거부), all-text masking 고정, host는 강화만 가능 | host 페이지에 마스킹 클래스가 필요한 신규 위험 영역이 생기면 정책 재점검 |
| 동의 없는 수집 | 별도 opt-in 게이트, GPC/DNT 무조건 차단, 철회 시 즉시 중단·버퍼 삭제 | 동의 UI 문구·버전은 배포 절차로 관리 — 문안 법률 검토 필요 |
| 재생 화면에서의 스크립트·네트워크 실행 | opaque가 아닌 alias-origin sandbox(allow-scripts·allow-same-origin만), 문서 CSP `default-src 'none'`, 재생 전 payload 스크럽으로 원격 리소스 URL·위험 scheme·능동 태그 제거 | 재생은 loopback owner 환경 전용. 공개 배포 재개 시 인증·서명 URL·audit 선행 |
| 원본 재식별 | pseudonymous ID를 익명으로 전제하지 않음, 30일 hard delete, visitor 단위 삭제 | 화면 구조+행동 연속성 결합의 재식별 가능성은 상존 — 보존 최소화로만 완화 |
| 국외 이전 | — | Supabase·subprocessor 리전·계약 미확정 |
| 삭제 이행 | expires_at purge + `replay_purge_expired` SQL, recording·visitor 삭제 경로, 목표 SLA 24h | 실운영 cron·실패 재시도 큐 실행 증거는 프로비저닝 후 |

## 4. 남은 결정 — cohort 확대·공개 배포 전 (서명 범위 밖)

아래는 loopback dogfood 서명에 **포함되지 않은** 항목이다. 제3자 방문자 녹화·공개 배포로 확대하려면 각 항목을 확정하고 별도 서명해야 한다.

- [ ] 대상 국가와 적용 법률 확정, 동의 문구·거부·철회 UI의 법률 검토.
- [ ] Supabase 리전·subprocessor·국외 이전 근거와 계약(DPA) 확정, Supabase replay store 구현.
- [ ] 암호화 키 관리·회전 정책(자체 키 관리는 object storage 이관과 함께).
- [ ] 동의 증명 보존 기간과 삭제 요청의 관계 확정.
- [ ] 공개 배포 재개 시 owner 인증·서명 URL·audit·tenant authorization.
- [ ] opt-in cohort 대상과 표본 수동 감사 담당자 지정.

## 5. 활성화 조건과 현재 상태

**loopback dogfood(서명 범위):** 아래를 모두 만족할 때만 켠다 — 코드가 강제한다.

- `NODE_ENV=development`이고 `UX_MEASURE_REPLAY_ENABLED=true`이며 loopback(`127.0.0.1`/`localhost`) 런타임일 것.
- `UX_MEASURE_REPLAY_SITE_KEY`가 설정된 loopback 전용 사이트일 것(공개 origin은 코드에서 거부).
- read·player 경계가 same-origin owner-only이고 `no-store`이며 재생은 네트워크 차단 sandbox일 것.

이 조건은 2026-07-19 로컬에서 실측·검증되었다([verification.md](verification.md)의 REPLAY-LIVE 증거). 공개 데모 배포는 `NODE_ENV=production`이라 read·player·ingest가 모두 닫힌다.

**cohort 확대·공개 배포:** §4가 확정·서명되기 전에는 여전히 열지 않는다. `recordings` capability를 registry·catalog에 등록하지 않고, 제3자 방문자 페이지에 recorder를 심지 않는다.

rollout 순서는 [spec](../features/session-replay/spec.md) §12를 따른다: 내부 dogfood(완료) → payload 표본 수동 감사(완료, [verification.md](verification.md)) → opt-in cohort 제한 확대(서명 대기).

## 서명란

| 역할 | 이름 | 서명 | 일자 | 범위 |
|---|---|---|---|---|
| 제품 책임자 / owner | Power-xc | ✔ (loopback dogfood 한정) | 2026-07-19 | owner 본인 loopback 세션 |
| 개인정보/법무 검토자 | | | | cohort 확대 시 필요 |
| 보안 검토자 | | | | cohort 확대 시 필요 |
