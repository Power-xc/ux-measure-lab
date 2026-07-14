# Measurement Harness — First-party SDK v1 설계 리서치

> **작성일:** 2026-07-14
> **상태:** 설계 (로드맵 `First-party SDK` 항목, README.md:23) · 미구현
> **근거:** README 로드맵(README.md:17,23,27), `features/personal-product-v1/spec.md`, `docs/architecture.md`·`docs/security.md`·`docs/data-model.md`, 외부 공식 문서
> **범위 고지:** 이벤트 수집만 설계한다. 세션 녹화(replay)는 v1 범위 밖이며 [§10](#10-후속-단계)에서 후속으로만 다룬다.

## 1. 결정 배경과 범위

현재 제품은 CSV export를 수동 연결하는 evidence-to-decision 워크스페이스이고, 자체 event collector는 아직 없다(`docs/architecture.md:44`). README의 최종형은 "스크립트 한 줄을 붙이면 전체 사용 여정이 수집되는 measurement harness"다(`README.md:17`). 이 문서는 그 harness의 첫 조각인 수집 SDK v1을 설계한다.

### v1 수집 대상

```text
pageview · click · rage click · dead click · scroll depth
· SPA route change · session stitching
```

### v1 제외 (후속 단계로만 언급)

```text
session replay · heatmap 집계 · feature flag · traffic allocation
· form-field 분석 · web vitals · 외부 도구 실시간 동기화
```

`features/personal-product-v1/spec.md:66`은 자체 event SDK·replay·feature flag를 Personal v1 제외로 명시했다. 이 SDK는 그 제외를 로드맵 단계로 승격시키는 설계이며, replay는 여전히 별도 단계로 남긴다(`README.md:27`).

### 제품 원칙 정합

| 원칙 (출처) | SDK v1에서의 반영 |
|---|---|
| Local-first (`README.md:116`) | 수집 엔드포인트는 **자기 도메인 same-origin `/api/ingest`** 기본. 브라우저 밖으로의 자동 전송은 사용자가 스니펫을 설치한 자기 사이트에 한정 |
| Untrusted by default (`README.md:117`) | 클라이언트가 보낸 모든 이벤트는 ingest 서버에서 재검증. 봇·노이즈 필터의 authoritative 판정은 서버 몫([§7](#7-봇노이즈-필터링)) |
| Consent-first collection (`README.md:118`) | `requireConsent: true`가 기본값. 동의 granted 이전에는 어떤 이벤트도 큐잉·전송하지 않음 |
| Human-in-the-loop (`README.md:115`) | SDK는 raw signal만 수집. rage/dead click을 "원인"이 아닌 "관찰"로 스키마에 표기하고 판정은 워크스페이스·사람에게 남김 |
| 민감 데이터 비저장 (`docs/security.md:10`, `spec.md:79`) | 입력값·credential·결제 필드는 **수집 자체를 금지**. 마스킹은 옵션이 아니라 기본값([§3.3](#33-개인정보-비수집-기본값-하드-규칙)) |

## 2. 근거 사실

### 2.1 본 설계 라운드 외부 제공 (재조사하지 않음, 통합 단계 재확인 대상)

| 사실 | 값 | 재확인 필요 |
|---|---|---|
| rage click 업계 기준 | 30px·1초 내 연속 3클릭 (PostHog `$rageclick`) | 아래 §2.2에서 공식 문서 교차 확인함 |
| 참고 구현 라이선스 | posthog-js 코어 MIT(참고·포크 합법). OpenReplay·Matomo는 AGPL이라 임베드 부적합 | 통합 전 각 저장소 LICENSE 재확인 |
| 참고 번들 크기 | posthog-js gzip 번들 ≈ 52.4KB. v1 목표는 이보다 작게 | 실측은 빌드 후([§4.4](#44-번들-예산과-달성-전략)) |
| 세션 통념 | 30분 무활동 타임아웃 기준 세션 분리 | §2.2에서 교차 확인함 |
| 법적 요건 | 한국 PIPA·EU 기준 이벤트 수집도 고지 필요, 입력값(텍스트) 수집 금지가 기본, 마스킹 기본 | 법률 검토는 별도. 본 문서는 법률 자문이 아님 |
| 애드블로커 | 알려진 애널리틱스 도메인 차단 → first-party 엔드포인트(자기 도메인 `/api/ingest`)가 기본이어야 함 | — |

### 2.2 본 라운드 교차 확인한 공식 문서 (접근일 2026-07-14)

| Source | 확인한 사실 | 제한 |
|---|---|---|
| [PostHog Autocapture](https://posthog.com/docs/product-analytics/autocapture) / [Heatmaps](https://posthog.com/docs/toolbar/heatmaps) | `$rageclick`은 각각 이전 클릭과 **30px·1초 이내인 클릭이 3회 연속**일 때 발생. navigation 컨트롤·수량 stepper·텍스트 선택 표면은 기본 무시 | 공급자 정의이며 UX 인과를 증명하지 않음 |
| [PostHog Sessions](https://posthog.com/docs/data/sessions) | 세션은 **30분 무활동** 또는 **최대 24시간**에서 분리. activity는 클라이언트가 보낸 모든 이벤트. 세션은 같은 브라우저·기기의 여러 탭에 걸침 | "자정 리셋"은 PostHog 문서에 없음 → [§5.4](#54-일-경계자정-롤오버) 참고 |
| [MDN `Navigator.sendBeacon()`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon) | 페이지 종료 시 분석 데이터를 비동기 POST로 전송하는 용도. `XMLHttpRequest` 기반 legacy 기법의 문제를 회피 | 요청 큐 실패 시 `false` 반환, 재시도·응답 없음(fire-and-forget) |
| [MDN `visibilitychange`](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event) / [Working with the History API](https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API) | `unload`/`beforeunload`는 특히 모바일에서 신뢰 불가하며 bfcache와 비호환. `visibilitychange`(+ 대체로 `pagehide`) 조합이 종료 시 전송 권장 방식 | 어떤 조합도 100% 전달을 보장하지 않음 |
| [MDN `popstate` event](https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event) | `history.pushState()`/`replaceState()` 호출은 `popstate`를 **발생시키지 않음**. `popstate`는 back/forward에서만 발생 | SPA 라우트 감지는 pushState/replaceState 래핑이 필요([§5.3](#53-spa-라우트-감지)) |
| [MDN `Event.composed`](https://developer.mozilla.org/en-US/docs/Web/API/Event/composed) / [`composedPath()`](https://developer.mozilla.org/en-US/docs/Web/API/Event/composedPath) | `click`은 `composed: true`라 shadow 경계를 넘어 전파되나 **retargeting**으로 `target`이 host로 바뀜. `composedPath()[0]`으로 원 target 복원 가능(단, closed shadow root는 은닉) | closed shadow root·cross-origin iframe은 한계([§5.5](#55-shadow-dom과-iframe-한계)) |
| [MDN `Navigator.webdriver`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver) | 자동화 제어(WebDriver, `--headless` 등) 여부를 나타냄. 2018-05부터 전 브라우저 지원 | 스푸핑 가능 → 서버 필터의 보조 신호일 뿐 |
| [MDN `Crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) | secure context에서 암호학적으로 강한 v4 UUID 생성 | 익명 식별자 생성용. 개인정보 아님 |
| [Snowplow: Cookies and local storage](https://docs.snowplow.io/docs/sources/web-trackers/cookies-and-local-storage/configuring-cookies/) / [MDN `Set-Cookie`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) | localStorage는 요청에 실리지 않고 origin 단위. 쿠키는 매 요청 전송되며 `.domain.com`으로 서브도메인 공유·`SameSite` 제어 가능 | 저장소 선택은 트레이드오프([§5.1](#51-식별자-생성과-저장)) |

## 3. 이벤트 스키마

### 3.1 공통 envelope

모든 이벤트는 짧은 wire key를 쓴다(payload·번들 바이트 절약). 서버는 수신 시각을 별도 스탬프하고 클라이언트 값을 신뢰하지 않는다.

```text
t     이벤트 타입 (enum: pv|click|rage|dead|scroll|route|s_start|s_end)
ts    클라이언트 타임스탬프(ms). 서버가 received_at을 별도 기록
sid   세션 ID (익명, §5)
vid   방문자 ID (익명, §5)
pvid  pageview ID (한 페이지/라우트 체류를 묶는 키)
seq   세션 내 단조 증가 시퀀스 (순서 복원·중복 제거)
p     정규화된 pathname (쿼리 기본 제거, §3.3)
sc    스키마·collector 버전
```

`sid`/`vid`/`pvid`는 랜덤 식별자이며 사용자 신원·이메일·IP를 담지 않는다. IP는 클라이언트가 보내지 않고, 필요하면 ingest 서버가 정책에 따라 처리한다(서버 스펙 소관).

### 3.2 타입별 필드

| 타입 | 고유 필드 | 관찰/파생 구분 |
|---|---|---|
| `pv` pageview | `title`(bounded), `ref`(referrer origin만), `vw`/`vh` viewport, `dpr`, `nav`(navigation\|spa) | 관찰 |
| `click` | `sel`(CSS 셀렉터, §3.4), `tag`, `role`/`aria`(있으면), `has_text`(불리언), `x`/`y`(viewport 상대), `btn` | 관찰 |
| `rage` | `sel`, `n`(클러스터 클릭 수), `t0`(첫 클릭 ts) | **파생 관찰** — 원인 아님 |
| `dead` | `sel`, `waited`(무반응 대기 ms) | **파생 관찰** — 원인 아님 |
| `scroll` | `pct`(도달 최대 %), `ms`(25\|50\|75\|100 마일스톤) | 관찰 |
| `route` | `from`, `to`, `kind`(push\|replace\|pop\|hash) | 관찰 |
| `s_start`/`s_end` | `reason`(new\|timeout\|maxdur), `dur`(세션 길이) | 관찰 |

`rage`/`dead`는 스키마 상 "관찰(observation)"로 라벨링해 워크스페이스가 이를 friction candidate의 **근거**로만 쓰고 원인으로 단정하지 않게 한다(`README.md:113`, `spec.md:39`).

### 3.3 개인정보 비수집 기본값 (하드 규칙)

`docs/security.md:10`("credential과 민감한 form payload는 저장하지 않는다")과 `spec.md:79`를 클라이언트 수집 시점의 하드 규칙으로 승격한다. 마스킹은 켜고 끄는 옵션이 아니라 기본 동작이다(`README.md:118`).

```text
절대 수집 안 함 (설정으로도 켤 수 없음)
- 모든 입력 요소의 값: input.value, textarea.value, select.value
- [type=password], [contenteditable]의 텍스트
- 결제/민감 필드: [autocomplete^=cc-], [name*=card|cvc|cvv|ssn], data-ml-mask

기본 제거·정규화
- 쿼리스트링: p에서 제거. capturePathQueryParams 화이트리스트로만 개별 허용
- path 세그먼트: 이메일·UUID·긴 hex 토큰 패턴은 :masked로 치환(maskPathPattern 기본값)
- referrer: origin까지만 (경로·쿼리 제거)
- 클릭 텍스트: 기본 미수집. has_text 불리언만. captureText:true 옵트인 시에도
  입력·contenteditable·마스킹 대상은 제외하고 128자 truncate

동의·프라이버시 신호
- requireConsent:true 기본. consent!=granted면 큐잉조차 안 함
- respectGPC/DNT 설정 시 Global Privacy Control·Do-Not-Track 신호를 수집 차단으로 해석
```

호스트 페이지의 동의 배너 UI는 SDK 책임이 아니다. SDK는 `ml('consent','granted'|'denied')` API만 노출하고, 상태는 §5.1 저장소에 보존한다.

### 3.4 셀렉터·요소 식별 정책

클릭 대상을 안정적으로 식별하되 개인정보와 auto-generated 노이즈를 배제한다.

```text
우선순위
1. data-ml-name / data-attr 명시 속성이 있으면 그대로 사용(권장, 안정적)
2. 없으면: tag + #id + 화이트리스트 class + :nth-of-type로 최대 depth 5의 CSS path
제외
- 해시성 class(예: css-1ab2c3, sc-xxxxx 정규식 매칭)는 셀렉터에서 배제
- id/class가 이메일·토큰 형태면 :masked
- text는 셀렉터에 넣지 않음(§3.3)
```

`data-ml-*` 속성 규약은 통합 시 최소 침습으로 안정적 셀렉터를 얻는 escape hatch다. 해시성 class 판별은 휴리스틱이므로 오탐 가능성을 `NOT_CHECKED`로 남긴다([§9](#9-위험과-미해결)).

## 4. 스니펫 아키텍처

### 4.1 async 로더 스텁

`<head>`에 인라인으로 넣는 ~1KB 스텁은 큐만 만들고 메인 스크립트를 async 로드한다. 메인 로드 전 호출은 큐에 버퍼링된다.

```html
<script>
  (function(w,d,s,k){
    w.ml=w.ml||function(){(w.ml.q=w.ml.q||[]).push(arguments)};
    w.ml.k=k;                          // 사이트 키
    var e=d.createElement(s);e.async=1;e.src="/ml.js";  // same-origin
    var f=d.getElementsByTagName(s)[0];f.parentNode.insertBefore(e,f);
  })(window,document,"script","SITE_KEY");
  ml('init',{ requireConsent:true });
</script>
```

`e.src`는 **자기 도메인 상대경로**다. 애드블로커가 차단하는 known-analytics 도메인을 쓰지 않으므로 first-party로 로드·전송된다(§2.1). 스크립트가 same-origin이라 현재 CSP(`script-src 'self'`, `connect-src 'self'`, `docs/security.md:55`)를 바꾸지 않고 자기 제품(예: 워크스페이스 dogfooding)에 붙일 수 있다.

### 4.2 사이트 키 주입

`SITE_KEY`는 **공개 식별자**(비밀 아님)로 목적지 프로젝트를 지정한다. 클라이언트에 노출되므로 인증 토큰이 아니며, 남용 방지는 서버(레이트리밋·오리진 검증)가 담당한다. 주입 방식은 (a) 스텁 인자, (b) `<script data-ml-key>` 속성 둘 다 지원한다.

### 4.3 초기화 설정

```text
ml('init', {
  key, host,                       // 목적지(기본 same-origin)
  requireConsent: true,            // 동의 게이트(기본 on)
  mask: { selectors:[], patterns:[] },   // 추가 마스킹
  capture: { click:true, rage:true, dead:true, scroll:true, route:true,
             text:false },         // 세밀 토글, text는 기본 off
  sample: 1.0,                     // 방문자 단위 샘플링
  respectGPC: true,
  sessionIdleMs: 1_800_000,        // 30분(§5.2)
  batch: { maxEvents:20, maxWaitMs:5000 },
  debug: false
})
```

### 4.4 번들 예산과 달성 전략

목표는 참고 번들(posthog-js gzip ≈52.4KB, §2.1)보다 작게. replay·flag·survey·web-vitals가 없으므로 공격적으로 잡는다.

| 모듈 | gzip 예산 |
|---|---:|
| 로더 스텁(인라인) | ≤ 1.0KB |
| core(init·lifecycle·consent) | ≤ 2.5KB |
| autocapture(click·rage·dead·selector) | ≤ 3.0KB |
| scroll + routing | ≤ 1.5KB |
| session + storage | ≤ 1.5KB |
| transport(batch·retry·beacon) | ≤ 1.5KB |
| **core 합계(로더 제외)** | **≤ 10KB gzip 목표** |

전략: 외부 런타임 의존성 0(§8), evergreen 브라우저 타깃으로 polyfill 없음, 기능별 모듈을 옵트아웃 가능한 tree-shakeable 구조로, esbuild minify + brotli. 실측 KB는 빌드 후 검증 대상이라 지금은 예산이며 `NOT_CHECKED`.

## 5. 수집 동작과 세션 연결

### 5.1 식별자 생성과 저장

`vid`/`sid`는 `crypto.randomUUID()`로 생성한다(secure context, §2.2). 저장소는 트레이드오프가 있다.

| 저장소 | 장점 | 단점 |
|---|---|---|
| **first-party 쿠키** (`.domain.com`, `SameSite=Lax`, `Secure`) | 서브도메인 공유, 서버가 `Set-Cookie`로 갱신·수명 관리 가능, 요청에 자동 동봉 | 매 요청 바이트, JS가 읽으려면 `HttpOnly` 불가, Safari ITP가 script 설정 쿠키 수명 제한 |
| **localStorage** | 요청에 안 실림, 용량 여유, JS 접근 쉬움 | origin 단위(서브도메인 미공유), 서버가 못 읽음, 프라이빗 모드·정책으로 차단 가능 |

**결정:** `vid`는 first-party 쿠키를 1순위로, localStorage를 미러/폴백으로 둔다(cookie가 서브도메인 스티칭과 서버 가시성에 유리). 가능하면 ingest 응답의 `Set-Cookie`로 서버가 수명을 관리해 클라이언트 설정 쿠키에 대한 ITP 단기 만료를 완화한다. Safari ITP의 현재 정확한 상한(서버 설정 vs 스크립트 설정)은 정책이 자주 바뀌므로 통합 시 재측정 대상 `NOT_CHECKED`.

### 5.2 세션 규칙 (30분 타임아웃)

세션은 여러 탭에 걸쳐야 하므로(§2.2) 탭 로컬인 `sessionStorage`가 아니라 쿠키/localStorage에 `{sid, startedAt, lastActivityAt}`를 공유한다.

```text
이벤트 발생 시:
  now - lastActivityAt > sessionIdleMs(기본 30분)  → 새 sid, s_end(timeout)+s_start
  now - startedAt      > 24h(최대 지속)            → 새 sid, s_end(maxdur)+s_start
  그 외                                            → lastActivityAt = now
```

30분 무활동·24시간 상한은 PostHog 정의와 일치한다(§2.2). activity 정의는 "전송된 모든 이벤트"다.

### 5.3 SPA 라우트 감지

`pushState`/`replaceState`는 `popstate`를 발생시키지 않으므로(§2.2) 세 경로를 모두 건다.

```text
- history.pushState / replaceState를 래핑 → 원본 호출 후 route(push|replace) 발행
- window 'popstate' → route(pop)  (back/forward)
- window 'hashchange' → route(hash)  (해시 라우팅)
라우트 변경마다: 새 pvid 발급, scroll depth 트래커 리셋, pv 이벤트 발행
동일 URL 중복은 debounce로 억제
```

원본 `history` 메서드는 보존 후 호출해 호스트 앱 라우터 동작을 깨지 않는다.

### 5.4 일 경계(자정 롤오버)

일부 도구(GA 계열)는 리포팅 타임존 자정에 세션을 리셋하는 관행이 있으나 PostHog 문서에는 없다(§2.2). **결정:** 클라이언트에서 자정 롤오버를 하지 않는다. 이유: (a) 클라이언트 타임존과 리포팅 타임존이 갈리면 세션 경계가 비결정적이 되어 "결정적 지표" 원칙(`README.md:114`)과 충돌하고, (b) local-first에서 클라이언트가 리포팅 타임존을 알 수 없다. 대신 24시간 하드캡(§5.2)으로 세션 폭주를 막고, **일 단위 버킷팅은 ingest/리포팅 레이어가 프로젝트 타임존으로 수행**한다. 이 분리는 서버 스펙 소관으로 넘긴다(`docs/data-model.md:130`).

### 5.5 배칭·재시도·오프라인 버퍼

```text
flush 조건 (OR)
  - 큐 길이 ≥ batch.maxEvents(기본 20)
  - 경과 ≥ batch.maxWaitMs(기본 5s)
  - visibilitychange→hidden 또는 pagehide  → 즉시 flush

전송 수단
  - 일반 flush: fetch(POST, keepalive:true)  (JSON 배열)
  - 종료 시 flush: navigator.sendBeacon(§2.2)  (fire-and-forget, 재시도 없음)
  - 폴백: XHR(sync 금지)

재시도
  - fetch 실패(네트워크/5xx): 지수 백오프(상한 있음)로 재큐, 최대 재시도·버퍼 크기 제한
  - sendBeacon 최종 flush 실패는 손실 수용(재시도 불가)

오프라인 버퍼
  - 온라인 전송 실패분을 hidden 시점에 localStorage로 bounded 영속(TTL·용량 상한)
  - 다음 로드 시 replay 후 삭제
  - local-first·quota 고려로 영속 버퍼는 옵트인(기본 메모리 버퍼)
```

`unload`/`beforeunload`는 신뢰 불가·bfcache 비호환이라 쓰지 않고 `visibilitychange`+`pagehide`를 쓴다(§2.2). 어떤 조합도 100% 전달을 보장하지 않으므로 종료 시 손실 가능성을 명시한다.

### 5.6 Shadow DOM·iframe 한계

문서 레벨에서 위임 청취하면 `click.target`이 retargeting으로 host로 바뀐다(§2.2). `event.composedPath()[0]`로 원 target을 복원하되:

```text
- open shadow root: composedPath로 내부 요소·셀렉터 복원 가능
- closed shadow root: 내부 은닉 → 셀렉터가 host까지만. 한계로 기록
- cross-origin iframe: 별도 browsing context라 미포착. 프레임 내부는 별도 스니펫 필요
```

이 한계들은 은폐하지 않고 수집 커버리지 문서와 스키마 주석에 남긴다.

## 6. 이벤트 검출 알고리즘 (결정적)

지표 계산은 코드가 소유한다는 원칙(`README.md:114`)에 맞춰 검출 규칙을 결정적으로 고정한다.

```text
rage click (PostHog 정의, §2.2)
  최근 클릭 버퍼 유지. 클릭 i가 클릭 i-1과 30px·1000ms 이내면 연속 카운트.
  연속 3회 도달 시 rage 1회 발행 후 윈도우 리셋(중복 방지).
  navigation 컨트롤·수량 stepper·입력/선택 표면은 대상 제외(PostHog와 동일).

dead click
  primary 클릭 후 waited(기본 3000ms) 안에 다음이 없으면 dead 발행:
    URL 변경 · 클릭 subtree DOM mutation · scroll · selection 변경.
  (PostHog의 정확한 임계값은 재확인 안 함 → 우리 기본값 명시, NOT_CHECKED)

scroll depth
  pct = (scrollTop + viewport) / scrollHeight. rAF/250ms 스로틀.
  25·50·75·100% 마일스톤을 pageview당 1회 발행, pageview 종료 시 최대 pct 기록.
```

## 7. 봇·노이즈 필터링

클라이언트 필터는 스푸핑 가능하고 번들을 늘리므로 **최소**만 두고, authoritative 판정은 서버가 한다("untrusted by default", `README.md:117`, `docs/architecture.md` trust boundary).

| 위치 | 처리 | 근거 |
|---|---|---|
| **클라이언트(경량)** | `navigator.webdriver===true` 드롭·플래그(§2.2), prerender(`document.visibilityState==='prerender'`) 무시, 0-size viewport 무시, GPC/DNT 존중, 방문자 샘플링 | 명백·저렴한 케이스만. 번들·스푸핑 고려 |
| **서버(authoritative)** | known-bot UA 리스트, 데이터센터·평판 IP, 볼륨·레이트 이상, `(sid,seq)` 중복 제거, 이벤트 형태 스키마 검증, 오리진·사이트 키 검증 | 클라이언트 입력을 신뢰하지 않음. ingest 스펙 소관 |

클라이언트는 힌트만 부착하고 폐기 결정은 서버가 내린다. `navigator.webdriver`는 스푸핑 가능하므로 단독 차단 근거로 쓰지 않는다.

## 8. TypeScript 구현 계획

### 8.1 제안 파일 구조 (설계안, 본 문서에서 생성하지 않음)

```text
packages/collector/
  src/
    loader.ts        async 스텁·전역 큐
    core.ts          init·config·lifecycle·consent 게이트
    consent.ts       consent 상태·GPC/DNT 해석
    session.ts       vid/sid 생성·타임아웃·24h 캡(§5)
    storage.ts       cookie/localStorage 추상화·폴백
    autocapture.ts   click·rage·dead·셀렉터 빌더(§3.4,§6)
    scroll.ts        스크롤 깊이(§6)
    routing.ts       history 래핑·popstate·hashchange(§5.3)
    mask.ts          PII 마스킹·민감 셀렉터(§3.3)
    schema.ts        이벤트 타입·envelope·wire key(§3)
    transport.ts     배칭·재시도·beacon(§5.5)
  test/              jsdom 단위
  e2e/               Playwright 통합
```

패키지 배치·`package.json`·빌드 배선은 통합 단계 결정이며, 본 라운드에서는 이 문서 외 어떤 파일도 만들지 않는다.

### 8.2 외부 의존성 0 원칙

런타임 의존성 0으로 간다. 셀렉터 빌더·UUID(`crypto.randomUUID`)·transport 모두 표준 웹 API로 손수 구현한다. 이는 저장소가 이미 지키는 "새 test library 추가 없이 `node:test`로 구성"(`features/personal-product-v1/research.md:67`) 및 supply-chain 최소화(`docs/security.md:83`) 기조와 일치한다.

### 8.3 테스트 전략

| 층 | 도구 | 검증 |
|---|---|---|
| 단위 | jsdom + `node:test` | 셀렉터 빌더(해시성 class 배제·depth·마스킹), 세션 타임아웃 산술(합성 타임스탬프 주입), rage/dead 검출(제어된 ts로 결정적), 배칭 트리거, path/referrer 정규화, 동의 게이트가 미동의 시 큐잉 차단 |
| 통합 | Playwright(저장소 기존 E2E 재사용, `README.md:43`) | 실제 3연타 → rage, SPA 라우트 변경 → route+pv, 스크롤 → 마일스톤, 탭 hidden → `sendBeacon` 네트워크 관찰, 동의 grant 전후 전송 유무, 입력값 미수집 확인 |

검출·산술 테스트는 합성 입력과 고정 타임스탬프로 결정적으로 구성해 "지표는 코드가 계산" 원칙과 정렬한다(`README.md:114`).

## 9. 위험과 미해결

- **셀렉터 안정성:** 해시성 class 판별은 휴리스틱이라 오탐·미탐 가능. `data-ml-*` 규약을 권장 경로로 두되 자동 판별 정확도는 `NOT_CHECKED`.
- **dead click 임계값:** PostHog의 정확한 무반응 임계값은 본 라운드 미확인. 우리 기본 3000ms를 명시값으로 쓰고 튜닝은 dogfood 데이터로.
- **Safari ITP 쿠키 수명:** 스크립트 설정 vs 서버 설정 first-party 쿠키의 현재 상한은 정책 변동성이 커 `NOT_CHECKED`. 통합 시 재측정.
- **전달 신뢰성:** `visibilitychange`+`pagehide`+`sendBeacon`도 100% 전달을 보장하지 않음(§2.2). 종료 flush 손실은 수용값.
- **번들 실측:** §4.4는 예산이며 gzip 실측은 빌드 후 검증 `NOT_CHECKED`.
- **cross-origin 수집:** 자기 사이트 외(고객 외부 도메인) 측정은 사이트 키 + CORS 허용목록 + first-party proxy/CNAME 모델이 필요. v1은 same-origin 자가 측정으로 한정하고 cross-origin은 ingest 서버 스펙으로 이연.
- **커버리지 공백:** closed shadow root·cross-origin iframe 미포착(§5.6).
- **법적 검토:** PIPA·EU 고지·동의 요건은 법률 자문 대상이며 본 문서는 자문이 아님. 동의 배너 UI는 호스트 앱 책임.

## 10. 후속 단계

- **Ingest 서버 스펙:** wire 계약(§3), 사이트 키·오리진 검증, 서버측 봇 필터(§7), 세션화·일 버킷팅(§5.4), 보존 정책. `docs/data-model.md:130`의 deferred server model과 `docs/architecture.md:126`의 same-origin·rate-limit·`no-store` 계약을 확장한다.
- **Source adapter 계약:** 수집 이벤트를 기존 evidence 스키마로 정규화(README 로드맵).
- **Session replay:** v1 범위 밖. 사전 동의·기본 마스킹·짧은 보존을 전제로 별도 단계에서 설계한다(`README.md:27`).
- 이후 heatmap 집계·feature flag·web vitals·외부 커넥터는 각각 별도 스펙으로 승격 검토.

## Source table

| Source | Type | 접근일 | 확인한 사실 | 제한 |
|---|---|---:|---|---|
| https://posthog.com/docs/product-analytics/autocapture | 공식 문서 | 2026-07-14 | `$rageclick` 30px·1s·3연속, navigation/stepper/입력 표면 무시 | 공급자 정의, UX 인과 미증명 |
| https://posthog.com/docs/toolbar/heatmaps | 공식 문서 | 2026-07-14 | rage click 임계값 교차 확인 | 상동 |
| https://posthog.com/docs/data/sessions | 공식 문서 | 2026-07-14 | 30분 무활동·24h 상한·멀티탭 세션, activity=전송 이벤트 | 자정 리셋 문서 없음 |
| https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon | 공식 문서 | 2026-07-14 | 종료 시 분석 POST 용도, fire-and-forget | 실패 시 재시도 없음 |
| https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event | 공식 문서 | 2026-07-14 | 종료 감지에 `unload` 대신 사용 권장 | 100% 전달 미보장 |
| https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API | 공식 문서 | 2026-07-14 | History API·bfcache·unload 비권장 | — |
| https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event | 공식 문서 | 2026-07-14 | pushState/replaceState는 popstate 미발생 | SPA 감지 래핑 필요 |
| https://developer.mozilla.org/en-US/docs/Web/API/Event/composed | 공식 문서 | 2026-07-14 | click은 composed, shadow 경계 통과·retargeting | closed root 은닉 |
| https://developer.mozilla.org/en-US/docs/Web/API/Event/composedPath | 공식 문서 | 2026-07-14 | `composedPath()[0]`로 원 target 복원 | closed root 예외 |
| https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver | 공식 문서 | 2026-07-14 | 자동화 제어 여부 신호 | 스푸핑 가능 |
| https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID | 공식 문서 | 2026-07-14 | secure context v4 UUID 생성 | — |
| https://docs.snowplow.io/docs/sources/web-trackers/cookies-and-local-storage/configuring-cookies/ | 공식 문서 | 2026-07-14 | 쿠키 vs localStorage 저장 트레이드오프, 서브도메인 쿠키 | 구현체별 상이 |
| https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie | 공식 문서 | 2026-07-14 | `SameSite`·domain 속성 의미 | — |

> 본 라운드 외부 제공 사실(posthog-js 번들 52.4KB, 라이선스 MIT/AGPL, PIPA 요건)은 §2.1에 별도 기록하며, 통합 단계에서 각 1차 출처로 재확인한다.
