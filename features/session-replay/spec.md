# Session Replay — Wave 5 Spec

> **상태:** 코어·엔진 바인딩·sandbox player·loopback dogfood 활성화 · 2026-07-19 갱신 (초안 2026-07-15)
> **범위:** rrweb 기반 녹화 수집·짧은 보존·owner-only 재생의 최소셋
> **구현 현황:** 수집 게이트·마스킹·chunk quota·ingest·30일 보존·삭제·owner-only read·Evidence 참조·녹화 엔진 바인딩(rrweb 2.1.0)·sandboxed player(게이트 8, SR-09)가 구현·검증되었고, gate 9가 **loopback dogfood 범위로 서명**되어 owner 본인 세션 녹화·재생이 활성화되었다([plan.md](plan.md) Wave R4, [PIA](../../docs/replay-privacy-impact.md) §6). 공개 cohort 확대·제3자 방문자 녹화는 PIA §4 확정·서명 전까지 열지 않는다([research.md](research.md) §4 게이트 원장).

## 1. Purpose and goal

퍼널 이탈이나 마찰 신호가 발생한 세션의 실제 상호작용 순서를 사람이 재현해 볼 수 있게 한다. Replay는 원인 판정이나 수치 지표가 아니라 대안 설명을 찾는 정성 근거다.

```text
명시적 사전 동의
  → 기본 마스킹 상태의 rrweb 녹화
    → bounded chunk ingest
      → 최대 30일 보존
        → owner-only local playback
          → 선택한 세션만 qualitative Evidence로 참조
```

Replay는 기존 8단계 Measure Loop에 새 단계를 만들지 않는다. `sessions`와 `recordings` capability를 가진 별도 소스가 Diagnosis에 정성 맥락을 제공한다.

## 2. Non-negotiable launch gates

다음 조건을 모두 자동화 테스트와 운영 증거로 확인하기 전에는 녹화를 켜지 않는다.

1. Replay 목적에 대한 별도 사전 opt-in과 동의 철회 UI.
2. 동의 전 rrweb 초기화, event buffer, identifier 생성과 전송이 모두 0건.
3. 모든 input value와 민감 영역의 강제 제외.
4. text·path·attribute 기본 마스킹과 host 제품의 block/mask 지정 수단.
5. payload와 metadata의 기본 30일 이내 hard delete.
6. site·recording·anonymous visitor 단위 삭제 경로.
7. public playback URL이 없는 owner-only read boundary.
8. 재생 DOM의 script·navigation·network access 차단.
9. 개인정보 영향평가와 적용 지역의 법률·조직 정책 검토.

동의나 삭제 경로가 준비되지 않으면 `recordings` capability를 registry에 등록하지 않는다.

## 3. Legal and policy baseline

이 절은 제품 출시 기준이며 법률 자문이 아니다. 실제 대상 국가, 데이터 흐름, 처리자와 subprocessors에 대한 별도 검토가 필요하다.

### EU

- EDPB의 [Guidelines 2/2023](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en)은 terminal의 정보 저장·접근에 Article 5(3) ePrivacy 범위를 기술 중립적으로 적용한다. 예외는 관할법과 목적을 기준으로 사안별 판단해야 한다.
- CNIL은 traceur에 대해 사전 동의, 명확한 목적 고지, 자유롭고 구체적인 선택, 동등하게 쉬운 거부·철회를 요구한다고 설명한다. [CNIL traceur 안내](https://www.cnil.fr/fr/cookies-et-autres-traceurs/que-dit-la-loi)
- CNIL의 [Session Replay 권고 초안 공개 협의](https://www.cnil.fr/en/session-replay-cnil-launches-public-consultation-its-draft-recommendation)는 2026-02에 제시된 초안이며 최종 규범으로 취급하지 않는다. Replay가 mouse, touch, click, scroll과 경우에 따라 form 상호작용을 재구성하는 고위험 관찰이라는 점을 설계 기준으로 반영한다.

제품 정책은 audience-measurement 예외에 의존하지 않는다. Replay는 별도 목적의 사전 opt-in이 있어야 시작한다. 동의는 목적, 수집 범주, 보존 기간, controller·processor, 철회·삭제 방법을 알린 뒤 명확한 affirmative action으로 받는다.

### Korea

- [개인정보 보호법](https://www.law.go.kr/LSW/lsInfoP.do?ancYnChk=0&lsId=011357)의 처리 근거, 최소 수집, 고지, 정보주체 권리와 파기 의무를 적용한다.
- Replay는 화면 구조와 행동 연속성을 결합해 개인을 식별할 가능성이 있으므로 pseudonymous ID만으로 익명 데이터라고 전제하지 않는다.
- 법적 예외 여부와 무관하게 이 제품은 Replay 목적을 분리해 사전 동의를 받고, 거부해도 핵심 서비스를 제한하지 않으며, 철회 이후 새 녹화를 즉시 중단하는 더 엄격한 기준을 사용한다.
- 해외 storage나 subprocessors를 사용하면 국외 이전 고지·동의 또는 다른 적법 근거와 계약 요건을 별도로 검토한다.

### Consent evidence

동의 증명은 원본 개인정보를 늘리지 않는 범위에서 다음 metadata만 남긴다.

```text
site_id
anonymous_id_hash
purpose_version
decision: granted | denied | withdrawn
decided_at
source: host_cmp | host_api
```

동의 문자열과 UI version은 배포 기록으로 보존하고, Replay payload와 분리한다. 개인 식별 계정이나 form 내용은 동의 증명에 복사하지 않는다.

## 4. V1 scope

### Included

- rrweb DOM snapshot과 mutation.
- mouse/touch 위치, click, scroll, viewport resize.
- SPA route 변화의 마스킹된 path.
- recording/session lifecycle과 bounded chunk upload.
- site·기간·마찰 신호로 녹화 목록 조회.
- owner-only player: pause, speed, timeline, event marker.
- 30일 hard retention과 visitor deletion.
- 선택한 replay reference를 `qualitative` Evidence 후보로 변환.

### Excluded

- 모든 input value와 contenteditable text.
- console log, network request/response body, clipboard, keystroke.
- canvas pixel, WebGL, media stream, audio, video와 cross-origin iframe content.
- live co-browsing, remote control과 support takeover.
- heatmap 생성, 자동 UX 원인 판정, transcript와 semantic search.
- public share link, team permission, annotation collaboration.
- mobile native app recording.
- 무기한 보존, legal hold와 backup archive.

## 5. Local-first architecture

현재 인증이 없으므로 Replay read 경로는 기본적으로 loopback owner runtime에서만 활성화한다. 공개 host에서는 인증과 tenant authorization이 추가되기 전까지 목록·payload API를 비활성화한다.

```text
Target product browser
└─ ReplayRecorder (explicit opt-in module)
   └─ POST /api/replay/ingest
      ├─ site key + Origin allowlist
      ├─ consent purpose version
      ├─ size/rate/schema validation
      └─ encrypted object storage + metadata DB

Owner local workspace
└─ same-origin replay screen
   ├─ GET session metadata
   ├─ short-lived chunk access
   └─ sandboxed rrweb player
```

Local-first의 의미는 raw recording을 Project JSON이나 browser `localStorage`에 복제한다는 뜻이 아니다. Read UI와 판단은 owner 환경에 머물고, server storage에는 짧은 보존의 encrypted chunks만 둔다. 외부 playback provider, CDN public URL과 제3자 분석은 사용하지 않는다.

Remote deployment를 다시 열 때는 authenticated owner session, site ownership check, short-lived signed access와 audit log를 먼저 구현한다.

## 6. Recorder contract

Recorder는 기존 collector와 lifecycle을 공유하되 별도 opt-in module로 lazy-load한다. 일반 행동 수집 동의가 Replay 동의를 자동 포함하지 않는다.

```text
disabled     no module load, no replay identifier
consented    load rrweb and begin a new recording
paused       page hidden or quota/backpressure
withdrawn    stop, clear unsent buffer, no automatic restart
ended        flush bounded final chunk
```

필수 rrweb privacy configuration:

- `maskAllInputs: true`와 input hard block을 이중 적용한다.
- text node는 기본 마스킹한다. 공개가 검토된 정적 label만 allowlist할 수 있다.
- `.ml-block` 또는 `[data-ml-block]` subtree는 snapshot에서 제거한다.
- `.ml-mask` 또는 `[data-ml-mask]`는 구조만 남기고 text·attribute를 마스킹한다.
- password, payment, health, account, address, search와 free-form form 영역은 allowlist할 수 없다.
- URL query, hash, email·UUID·긴 token·숫자 identifier path segment를 제거한다.
- iframe, canvas, media, stylesheet text와 custom element의 민감 attribute를 차단한다.

Host override는 마스킹을 강화할 수만 있고 hard block을 약화할 수 없다.

## 7. Wire and storage proposal

Replay wire는 기존 event envelope와 섞지 않는다.

```text
ReplayChunkEnvelope
├─ k: public site key
├─ recording_id: random opaque ID
├─ session_id: collector session hint
├─ anonymous_id: pseudonymous client ID
├─ sequence: non-negative integer
├─ started_at, ended_at: ISO timestamps
├─ purpose_version
├─ encoding: json+gzip
└─ events[]: bounded rrweb event batch
```

Server는 site key와 anonymous ID를 저장 전에 hash한다. `(site_id, recording_id, sequence)`를 idempotency key로 사용한다. Chunk는 압축 후와 해제 후 크기를 모두 제한하고, 한 recording의 총 시간·chunk 수·byte quota를 둔다.

제안 storage:

```text
recordings
├─ site_id, recording_id, server_session_id
├─ anonymous_id_hash
├─ started_at, ended_at, chunk_count, byte_size
├─ purpose_version, mask_policy_version
├─ status: active | completed | deleted | expired
└─ expires_at

recording_chunks
├─ site_id, recording_id, sequence
├─ object_key, byte_size, checksum
└─ started_at, ended_at
```

Payload는 private object storage에 server-side encryption으로 저장한다. Database에는 검색에 필요한 최소 metadata만 둔다. Service-role key나 object storage credential은 server env에서만 읽는다.

## 8. Ingest and read boundaries

Replay ingest는 collector ingest처럼 cross-origin이다.

- Site key hash와 exact Origin allowlist.
- Replay가 활성화된 site와 현재 purpose version 확인.
- site·IP·recording별 durable rate와 월 byte quota.
- content type, compressed/decompressed bytes, event count, duration과 sequence 검증.
- 알려지지 않은 rrweb event·attribute와 위험 URL scheme 거부.
- partial schema failure가 privacy policy를 깨면 chunk 전체 거부.

Read는 same-origin owner-only다.

- 목록과 chunk 모두 site ownership check.
- object key, service credential과 stable public URL 비노출.
- 짧은 TTL의 단일 recording access만 발급.
- response `no-store`, download 금지, 접근 audit metadata 기록.
- 인증 도입 전에는 loopback runtime에서만 enable.

## 9. Safe playback

rrweb player는 원본 사이트를 실행하는 browser가 아니다. 다음 제약을 가진 sandboxed iframe에서 재생한다.

- script, form submit, top navigation, popup과 download 차단.
- replay document의 network request 차단 CSP.
- `javascript:`, `data:` navigation과 event handler attribute 제거.
- link는 비활성 text로 렌더링.
- player frame과 workspace 사이에는 최소 message allowlist만 사용.
- payload parse와 rrweb version 호환 실패 시 재생을 중단하고 raw markup을 노출하지 않는다.

## 10. Retention and deletion

- 기본·최대 retention은 30일이다. Site는 더 짧게만 설정할 수 있다.
- `expires_at` 기준 일 1회 metadata와 object를 hard delete한다.
- 삭제된 object는 backup에 복제하지 않는다. Storage lifecycle rule을 이중 안전망으로 둔다.
- 동의 철회는 새 녹화를 즉시 중단하고 unsent buffer를 지운다.
- 사용자는 site + anonymous ID 기준으로 기존 recording 삭제를 요청할 수 있다.
- Owner는 recording 하나 또는 site 전체를 삭제할 수 있다.
- 삭제는 object와 metadata 모두에 적용하고 완료·실패를 운영 기록에 남긴다.
- 목표 삭제 SLA는 요청 확인 후 24시간이며, 실패 queue를 별도로 재시도한다.

Project에 저장된 qualitative Evidence는 raw recording을 복사하지 않는다. 원본이 만료되면 reference는 `expired`로 표시하고 관찰문과 당시 provenance만 남긴다.

## 11. Acceptance criteria

| ID | 기준 |
|---|---|
| SR-01 | Replay consent `granted` 전 rrweb load, ID, buffer와 network request가 모두 0이다. |
| SR-02 | input, password, payment와 contenteditable의 value/text는 모든 설정에서 payload에 없다. |
| SR-03 | text·path·attribute masking fixture가 raw identifier를 남기지 않는다. |
| SR-04 | 거부·철회가 승인과 같은 접근성으로 가능하고 철회 즉시 새 수집이 멈춘다. |
| SR-05 | Origin, site, purpose version, byte, duration, sequence와 rate 위반을 각각 거부한다. |
| SR-06 | 30일 경과 payload와 metadata가 retention job으로 삭제된다. |
| SR-07 | anonymous visitor 삭제가 recordings, chunks와 object를 모두 제거한다. |
| SR-08 | Public runtime에서 인증 없는 replay read가 닫혀 있다. |
| SR-09 | 재생 payload의 script, form, navigation과 network 요청이 sandbox에서 실행되지 않는다. |
| SR-10 | Replay 선택만으로 Project가 바뀌지 않고 사용자의 Evidence 적용이 필요하다. |
| SR-11 | Expired/deleted recording을 수치나 원인으로 대체하지 않고 unavailable로 표시한다. |
| SR-12 | 기존 collector·ingest·harness·8단계 E2E가 계속 통과한다. |

## 12. Rollout order

1. 개인정보 영향평가, 처리자·subprocessor·국외 이전과 동의 문구 검토.
2. rrweb version, license, security advisory와 bundle budget 확정.
3. recorder privacy fixtures와 consent gate 구현.
4. 별도 replay ingest·private storage·30일 deletion 구현.
5. sandboxed local player와 owner-only read 경계 구현.
6. visitor deletion end-to-end와 retention failure alert 검증.
7. 민감정보가 없는 내부 test page에서 dogfood.
8. 수집 payload 표본을 수동 감사한 뒤 실제 제품의 opt-in cohort로 제한 확대.

## 13. Open decisions

- Private object storage와 region.
- Encryption key 관리와 rotation 방식.
- Consent proof 보존 기간과 삭제 요청 관계.
- Text allowlist를 허용할지, v1은 all-text masking으로 고정할지.
- Public deployment 재개 시 owner authentication 방식.
- Replay Evidence reference의 schema와 expired 상태 표현.
- Recording당 최대 시간·chunk·byte와 site 월 quota.

이 결정과 launch gate가 닫히기 전에는 dependency, route, database table과 `recordings` capability를 추가하지 않는다.
