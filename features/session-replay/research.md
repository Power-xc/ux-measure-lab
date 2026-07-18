# Session Replay — 리서치와 결정

> **작성일:** 2026-07-18 · **작성자:** Power-xc
> **질문:** spec의 launch gate와 open decision 중 지금 닫을 수 있는 것은 무엇이고, 무엇이 남는가?

## 1. rrweb 현황 (2026-07 조사)

- **버전:** rrweb 2.1.0 (2026-06-27) — v2 안정, scoped 패키지(`@rrweb/record`·`@rrweb/replay` 등)로 분리. — [npm](https://www.npmjs.com/package/rrweb), [GitHub releases](https://github.com/rrweb-io/rrweb/releases)
- **`rrweb-player` 2.1.0은 존재하지만 Replayer 배선이 빠져 있다** — 2026-07-18 실측: `rrweb-player` 2.1.0 UMD를 sandbox에 로드하면 `.rr-player` 셸은 렌더되지만 내부 `Replayer`가 인스턴스화되지 않아 재구성 iframe이 생성되지 않는다. 따라서 player 위젯 대신 `@rrweb/replay` 2.1.0 코어를 직접 vendoring하고 최소 컨트롤러(재생·일시정지·속도·타임라인·클릭 마커)를 자체 구현했다. — [npm rrweb-player](https://www.npmjs.com/package/rrweb-player), [npm @rrweb/replay](https://www.npmjs.com/package/@rrweb/replay)
- **라이선스:** MIT 유지. — [LICENSE](https://github.com/rrweb-io/rrweb/blob/master/LICENSE)
- **보안:** `npm audit --omit=dev` 0건, Snyk 기준 알려진 CVE 없음(2.1.0). — [Snyk](https://security.snyk.io/package/npm/rrweb)
- **번들 실측(2.1.0):** `@rrweb/record` UMD minified 78KB(gzip ≈ 24KB) — 동적 import라 메인 클라이언트 번들에 미포함. `@rrweb/replay` UMD minified(gzip ≈ 62KB)는 서버 라우트에서만 읽어 sandbox 문서에 인라인하므로 클라이언트 번들에 미포함. — [issue #1742](https://github.com/rrweb-io/rrweb/issues/1742), [Sentry 최적화 사례](https://blog.sentry.io/session-replay-sdk-bundle-size-optimizations)
- **privacy 옵션 표면:** `maskAllInputs`, `maskInputOptions`, `maskTextClass/Selector`, `blockClass/Selector`, `ignoreClass/Selector`. 기본값은 마스킹이 아니라 **수집**이므로(예: maskAllInputs 기본 false) 옵션에 의존하지 않는 자체 하드 새니타이저가 필요하다. 엔진 바인딩(`rrweb-engine.ts`)은 이 옵션들을 하드코딩으로 고정하되, 실제 안전은 엔진 무관 새니타이저·서버 거부·재생 스크럽 3중 계층이 보장한다. — [rrweb guide](https://github.com/rrweb-io/rrweb/blob/main/guide.md)
- **sandbox 아키텍처 실측:** opaque origin(allow-scripts만) sandbox 문서는 자식 iframe의 document에 접근할 수 없어 rrweb 재구성이 실패한다. 그래서 재생 프레임을 loopback **alias origin**(127.0.0.1 워크스페이스 ↔ localhost 프레임)에 두어 브라우저가 프레임↔워크스페이스 간 교차출처 벽을 강제하게 하고, `allow-same-origin`은 프레임이 자기 재구성 iframe만 제어하도록 한다. 중첩 재구성 iframe은 문서 CSP를 상속하지 않으므로 원격 리소스 차단은 재생 스크럽이 담당한다.

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
| 녹화 엔진 | **주입 계약**(`RecordingEngine`)에 rrweb 2.1.0(`@rrweb/record`) 바인딩 완료 — 번들·감사·라이선스 확정. 라이브 loader 연결은 gate 9 서명 후 |
| 재생 player | `@rrweb/replay` 2.1.0 코어 직접 vendoring + 자체 최소 컨트롤러. rrweb-player 위젯은 Replayer 미배선으로 미채택 |

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
| 8 재생 sandbox | 코드 구현 | SR-09 — alias-origin sandbox + 문서 CSP `default-src 'none'` + 재생 스크럽. `e2e/replay-sandbox.spec.ts`가 실제 vendored 번들로 검증 |
| 9 영향평가·법률 검토 | **loopback dogfood 범위 서명** | 2026-07-19 owner 서명(자기 loopback 세션 한정). cohort 확대·공개 배포 범위는 열림. [../../docs/replay-privacy-impact.md](../../docs/replay-privacy-impact.md) |

**녹화 활성화 상태:** loopback dogfood 범위는 gate 1~9가 닫혀 **활성화되었다** — `NODE_ENV=development` + `UX_MEASURE_REPLAY_ENABLED=true` + `UX_MEASURE_REPLAY_SITE_KEY`가 설정된 loopback 런타임에서 owner가 자기 세션을 녹화·재생하고 30일 hard delete·owner-only 재생이 강제된다(2026-07-19 실측). 공개 배포(`NODE_ENV=production`)에서는 read·player·ingest가 모두 닫힌다. **cohort 확대·제3자 방문자 녹화**는 PIA §4 확정·서명 전까지 열지 않으며, `recordings` capability도 registry·catalog에 등록하지 않는다.
