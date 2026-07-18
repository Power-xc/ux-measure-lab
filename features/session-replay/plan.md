# Session Replay — 실행 계획

> **작성일:** 2026-07-18
> **상태:** 코어(수집 게이트·ingest·보존·삭제·read 경계·Evidence 참조)와 녹화 엔진 바인딩·sandbox player까지 구현 완료 · 녹화 활성화는 gate 9(영향평가·법률 서명)만 잔여
> **전제:** [spec.md](spec.md)의 launch gate·scope와 [research.md](research.md)의 결정을 따른다.

## Wave R0 — 레코더 코어 (완료)

영향 파일:

```text
packages/collector/src/replay-consent.ts    별도 목적 동의 게이트 (행동 수집 동의와 분리, withdrawn 상태)
packages/collector/src/replay-sanitize.ts   엔진 무관 하드 새니타이저 (값 제거·전체 텍스트 마스킹·URL 스크럽)
packages/collector/src/replay-chunk.ts      bounded chunk 빌더 + 녹화 quota
packages/collector/src/replay-recorder.ts   lifecycle 오케스트레이션 (엔진 주입·lazy-load)
```

- [x] SR-01: 동의 전 엔진 로드·recording ID·전송 0건. GPC/DNT는 무조건 차단.
- [x] SR-02: input·password·contenteditable 값은 어떤 설정에서도 payload에 없다 (하드 룰, 엔진 설정 무관).
- [x] SR-03: all-text masking, URL query·식별자 segment 스크럽, 이벤트 핸들러·위험 scheme 제거. host 정책은 강화 전용.
- [x] SR-04: 철회는 즉시 중단·미전송 버퍼 삭제·자동 재시작 금지.
- [x] quota 위반은 프라이버시를 깎는 대신 녹화를 pause.

## Wave R1 — ingest·보존·read 경계 (완료)

영향 파일:

```text
src/features/replay/server/schema.ts        envelope 검증 + privacy 전체 거부 (위험 scheme·잔존 값)
src/features/replay/server/store.ts         저장 계약 + in-memory 구현 (idempotency·quota·purge)
src/features/replay/server/ingest-handler.ts  cross-origin 게이트 체인 (키·Origin·rate·quota·보존 상한)
src/features/replay/server/read-handler.ts  loopback owner-only read/delete (no-store, 만료 즉시 차단)
src/app/api/replay/ingest/route.ts          POST + OPTIONS
src/app/api/replay/recordings/route.ts      GET/DELETE (동일 출처)
supabase/migrations/0004_replay.sql         recordings·chunks 테이블 + replay_purge_expired
```

- [x] SR-05: Origin·site key·purpose version·byte·event 수·sequence·rate 위반을 각각 거부. privacy 위반은 chunk 전체 거부.
- [x] SR-06: 30일 하드 보존 — 사이트는 더 짧게만. purge는 read 경로에서도 선행 적용.
- [x] SR-07: recording·anonymous visitor 단위 삭제 (raw ID는 해시 후 대조).
- [x] SR-08: read는 development + `UX_MEASURE_REPLAY_ENABLED` + same-origin + 단일 사이트에서만, 항상 `no-store`.
- [x] anonymous ID·site key는 저장 전 SHA-256 (ingest 파이프라인과 동일 원칙).
- [x] Supabase 마이그레이션 준비. in-memory 저장은 loopback dogfood 전용이며 Supabase 백엔드는 프로비저닝과 함께 붙인다.

## Wave R2 — Evidence 참조 (완료)

```text
src/features/replay/lib/replay-evidence.ts  qualitative Evidence 변환 + 만료 표시
```

- [x] SR-10: 참조는 기존 harness evidence 적용 규칙(sourceRef·명시 적용)을 그대로 통과해야 저장된다.
- [x] SR-11: 만료된 원본은 수치로 대체하지 않고 만료 문구만 더한다.

## Wave R3 — 녹화 엔진 바인딩 + sandbox player (완료)

영향 파일:

```text
src/features/replay/lib/rrweb-engine.ts     @rrweb/record 2.1.0 주입 바인딩 (하드 privacy 옵션 고정, lazy import)
src/features/replay/lib/player-sandbox.ts   재생 payload 스크럽(네트워크 backstop) + sandbox 문서 빌더 + alias origin 해석
src/features/replay/server/player-frame.ts  loopback owner-only sandbox 문서 라우트 (자체 CSP·frame-ancestors)
src/app/api/replay/player-frame/route.ts    @rrweb/replay 2.1.0 vendored 번들을 문서에 인라인
src/widgets/measure-workspace/panels/ReplaySection.tsx  Diagnose 화면의 owner 재생·삭제·Evidence 참조 UI
```

- [x] rrweb 2.x vendoring: MIT·CVE 0(Snyk)·번들 실측(gzip record ≈ 24KB lazy·replay ≈ 62KB server-only) 확인 후 `RecordingEngine` 바인딩. record는 동적 import라 메인 번들 미포함, replay는 서버에서만 읽어 클라이언트 번들에 미포함 (research.md §1·§3).
- [x] sandboxed player: rrweb-player 2.1.0에 Replayer 배선이 없음을 실측하고 `@rrweb/replay` 코어 위에 최소 컨트롤러(재생·속도·타임라인·클릭 마커)를 자체 구현. spec §9 제약을 alias-origin sandbox(allow-scripts·allow-same-origin만)와 문서 CSP `default-src 'none'`, 재생 전 payload 스크럽으로 강제 — launch gate 8.
- [x] 재생 network backstop: 중첩 rrweb 재구성 iframe은 문서 CSP를 상속하지 않으므로, 재생 스크럽이 원격 리소스 URL·위험 scheme·능동 태그를 제거해 네트워크 요청 0을 보장(실측: hostile payload도 스크럽 후 외부 요청 0·부모 접근 차단·스크립트 미실행).
- [x] 위 통제는 `UX_MEASURE_REPLAY_ENABLED` 미설정·`recordings` capability 미등록 상태에서 구현·검증했다. 녹화 엔진은 라이브 loader에 연결하지 않았다(주입 계약만 준비).

## Wave R4 — 녹화 활성화 전 잔여 게이트 (gate 9만 열림)

- [ ] 개인정보 영향평가·법률·조직 정책 검토 — launch gate 9 (운영자 절차, 코드로 닫을 수 없음). 준비 문서: [../../docs/replay-privacy-impact.md](../../docs/replay-privacy-impact.md).
- [ ] gate 9 서명 전까지 `UX_MEASURE_REPLAY_ENABLED` 미설정 유지, `sessions`·`recordings` capability 미등록 유지, 엔진을 라이브 loader에 미연결 유지.
- [ ] 서명 후: 민감정보 없는 내부 페이지 dogfood → payload 표본 수동 감사 → opt-in cohort 확대 (spec §12).

검증: typecheck·lint·`npm test` 229/229·`npm run test:sdk` 82/82·build·E2E 10/10 green. sandbox 재생은 `e2e/replay-sandbox.spec.ts`가 실제 vendored 번들로 loopback 경계에서 검증한다.
