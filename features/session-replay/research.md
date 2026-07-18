# Session Replay — 리서치와 결정

> **작성일:** 2026-07-18 · **작성자:** Power-xc
> **질문:** spec의 launch gate와 open decision 중 지금 닫을 수 있는 것은 무엇이고, 무엇이 남는가?

## 1. rrweb 현황 (2026-07 조사)

- **버전:** rrweb 2.1.0 (2026-06-27) — v2 안정, scoped 패키지(`@rrweb/record` 등)로 분리. — [npm](https://www.npmjs.com/package/rrweb), [GitHub releases](https://github.com/rrweb-io/rrweb/releases)
- **rrweb-player는 v2 안정판이 없다** — npm 안정판은 1.0.0-alpha.4(2022)이고 v2 player는 alpha 진행 중. — [GitHub](https://github.com/rrweb-io/rrweb)
- **라이선스:** MIT 유지. — [LICENSE](https://github.com/rrweb-io/rrweb/blob/master/LICENSE)
- **보안:** Snyk 기준 알려진 CVE 없음(2.1.0). — [Snyk](https://security.snyk.io/package/npm/rrweb)
- **번들:** record 모듈 minified 약 81KB(alpha.15 기준), 특정 alpha에서 PostCSS 동반 비대(#1742) 사례 — 번들 예산 확정은 vendoring 시점에 잠근다. — [issue #1742](https://github.com/rrweb-io/rrweb/issues/1742), [Sentry 최적화 사례](https://blog.sentry.io/session-replay-sdk-bundle-size-optimizations)
- **privacy 옵션 표면:** `maskAllInputs`, `maskInputOptions`, `maskTextClass/Selector`, `blockClass/Selector`, `ignoreClass/Selector`. 기본값은 마스킹이 아니라 **수집**이므로(예: maskAllInputs 기본 false) 옵션에 의존하지 않는 자체 하드 새니타이저가 필요하다. — [rrweb guide](https://github.com/rrweb-io/rrweb/blob/main/guide.md)

## 2. 업계 사고 사례 — 게이트의 근거

- 2024–25년 session replay 도구의 입력값·카드번호 수집이 GDPR 제재와 미국 도청(CIPA) 집단소송으로 이어졌다: 18개월간 약 1,500건 소송, Old Navy $1.4M 합의. — [Seresa 분석](https://seresa.io/blog/privacy-compliance/session-replay-tools-are-the-next-cipa-wave-on-woocommerce)
- 사고는 라이브러리 자체가 아니라 **설정 실수**에서 발생했다. 그래서 본 구현은 엔진 설정과 무관하게 동작하는 서버·클라이언트 이중 하드 마스킹(값 키 제거, 전체 텍스트 마스킹, 위험 URL 거부)을 계약으로 강제한다.

## 3. Open decisions (spec §13) 정리

| 결정 | v1 확정 |
|---|---|
| Payload 저장소·리전 | Postgres(`replay_chunks`) + 30일 hard delete. Object storage 이관은 실사용량 확인 후 별도 결정 |
| 암호화 키 관리 | Supabase 저장 시 provider server-side encryption. 자체 키 관리는 object storage 이관과 함께 |
| Consent proof 보존 | 동의 metadata는 녹화와 분리 저장, 문구·UI version은 배포 기록으로 보존 |
| Text allowlist | **없음** — v1은 all-text masking 고정 |
| 공개 배포 재개 시 인증 | 로드맵 — 그 전까지 read는 loopback 전용 |
| Replay Evidence schema | 기존 `sourceRef` 재사용: adapterId `replay`, capability `recordings`, sampleSize 1, 만료는 detail에 명시 |
| Recording quota | 청크 200이벤트·256KB, 녹화 300청크·20MB·30분, ingest 압축 256KB·해제 1MB |
| 녹화 엔진 | **주입 계약**(`RecordingEngine`) — rrweb 2.x를 번들 예산·감사 확정 후 바인딩. player는 v2 안정판 출시 전 미탑재 |

## 4. Launch gate 원장 (spec §2)

| 게이트 | 상태 | 근거 |
|---|---|---|
| 1 별도 opt-in·철회 | 코드 구현 | `ReplayConsentGate` — 행동 수집 동의와 분리, withdrawn 상태 |
| 2 동의 전 0건 | 코드 구현 | SR-01 테스트 — 엔진 로드·ID·전송 전무 |
| 3 input value 강제 제외 | 코드 구현 | SR-02 — 클라이언트 새니타이저 + 서버 privacy_violation 전체 거부 |
| 4 기본 마스킹·host 지정 | 코드 구현 | SR-03 — all-text masking, host는 강화만 가능 |
| 5 30일 hard delete | 코드 구현 | SR-06 — expires_at purge + `replay_purge_expired` SQL |
| 6 단위 삭제 경로 | 코드 구현 | SR-07 — recording·visitor 삭제, read 전 만료 purge |
| 7 owner-only read | 코드 구현 | SR-08 — loopback flag + same-origin + no-store |
| 8 재생 sandbox | **미구현** | player 미탑재(rrweb-player v2 alpha) — player 탑재 시 §9 제약과 함께 구현 |
| 9 영향평가·법률 검토 | **열림** | 코드로 닫을 수 없음 — 운영자 절차 |

**녹화 활성화 조건:** 게이트 8·9와 rrweb vendoring(번들 예산·보안 감사)이 닫히기 전에는 `UX_MEASURE_REPLAY_ENABLED`를 켜지 않고, `sessions`·`recordings` capability도 registry·catalog에 등록하지 않는다.
