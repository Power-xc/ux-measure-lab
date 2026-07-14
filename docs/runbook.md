# Runbook

## Local development

이 저장소는 Node 26에서 검증했다. lockfile과 정확히 맞추려면 다음 명령을 사용한다.

```bash
npm ci
npm run dev
```

기본 주소는 `http://127.0.0.1:3000`이며 dev server는 loopback에만 bind한다.

## Production build check

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run start
```

`next start` 전에는 성공한 `.next` production build가 필요하다. 기본적으로 server DB와 migration은 없다.

## Production deployment

Production URL은 [ux-measure-lab.vercel.app](https://ux-measure-lab.vercel.app)이다. GitHub `main`이 Vercel 프로젝트와 연결되어 push 이후 자동 배포된다. 수동 배포가 필요하면 검증 완료 후 다음 명령을 사용한다.

```bash
npx vercel --prod --yes
```

production runtime은 OpenAI provider를 호출하지 않고 결정적 fallback만 사용한다. 공개 AI를 활성화하려면 인증과 durable user quota를 별도 설계해야 한다.

## Optional AI provider

AI는 기본 비활성 상태다. `.env.local`을 만들고 `npm run dev`로 실행했을 때만 외부 provider를 호출할 수 있다.

```env
UX_MEASURE_AI_ENABLED=true
OPENAI_API_KEY=replace_with_server_key
OPENAI_MODEL=gpt-5.6-luna
```

설정 후 dev server를 재시작한다. UI의 AI 요청 결과가 `결정적 초안`이면 다음을 확인한다.

1. `UX_MEASURE_AI_ENABLED`가 정확히 `true`인지 확인한다.
2. key가 server process environment에 있는지 확인한다.
3. provider 응답, quota와 network egress를 확인한다.
4. 잘못된 출력도 의도적으로 fallback되므로 같은 project의 evidence가 유효한지 확인한다.

provider 실패는 workflow를 차단하지 않는다. KPI·verdict·Decision은 provider 상태와 무관하다.

provider는 loopback에 bind된 development server에서만 호출된다. `npm run build && npm run start`와 공개 도메인은 인증과 durable quota가 없으므로 항상 결정적 fallback을 사용한다.

## CSV operation

필수 header는 다음 순서다.

```csv
step_id,step_name,users
```

- UTF-8 comma-separated CSV
- 1MB 이하
- 2~100단계
- 첫 단계 사용자 수는 1 이상
- 이후 사용자 수는 이전 단계보다 증가할 수 없음

오류가 나면 화면의 행·열 메시지를 수정해 다시 업로드한다. 기존에 저장된 유효 퍼널은 새 파일 저장이 성공할 때까지 유지된다.

## Backup and restore

상단 **백업**은 전체 workspace를 `ux-measure-lab-backup.json`으로 저장한다. 다음 시점에는 반드시 백업한다.

- 브라우저 데이터 삭제 전
- 중요한 Decision 기록 후
- 다른 장치나 브라우저로 이동하기 전
- 앱 update 또는 schema 변경 전

**복원**은 현재 workspace를 `ux-measure-lab-before-restore.json`으로 먼저 내려받은 뒤 선택한 JSON으로 전체 상태를 교체한다. import는 schema version과 계산 결과를 재검증한다.

## Corrupted storage recovery

저장 데이터가 잘못된 JSON, 지원하지 않는 version 또는 불가능한 state이면 자동으로 덮어쓰지 않는다.

1. 화면에서 손상 원본을 다운로드한다.
2. 필요하면 파일을 별도로 보관해 수동 복구 자료로 사용한다.
3. **빈 워크스페이스로 복구**를 실행한다.
4. 마지막 정상 JSON backup을 복원한다.

브라우저 개발자 도구에서 storage key를 직접 편집하지 않는다. key는 `ux-measure-lab.workspace.v1`이다.

## Multi-tab conflict

같은 browser profile에서 여러 탭이 workspace를 수정하면 compare-before-write가 오래된 탭의 저장을 거부한다.

1. 각 탭에서 가능한 JSON backup을 받는다.
2. 보존할 최신 탭을 정한다.
3. 다른 탭을 닫고 최신 탭을 새로고침한다.
4. 필요하면 원하는 backup을 복원한다.

현재는 record merge를 자동 수행하지 않는다.

## Product URL analysis failure

- 주소가 공개 HTTP(S)인지 확인한다.
- 로그인·사내망·localhost·비표준 port는 분석할 수 없다.
- HTML이 아니거나 512KB를 넘는 페이지, 느린 페이지는 거부된다.
- 실패해도 Context form을 직접 채워 계속한다.

URL 추출은 페이지의 안전성을 보증하거나 UX 문제를 자동 판정하지 않는다. 표시된 text snapshot을 확인한 뒤 필요한 필드만 적용한다.

## Release checklist

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev
git status --short
```

추가 확인:

- production response의 CSP·COOP·CORP·Permissions-Policy·Referrer-Policy·nosniff·frame headers
- `.env*`, source와 `.next`에 실제 secret이 없는지
- 390px와 desktop에서 Context → Decision 핵심 흐름
- keyboard-only skip link, project dialog, section navigation, form submit, report download
- README capability와 [Verification](verification.md)의 증거 일치

commit, push, deploy는 각각 명시적으로 범위를 확인한 뒤 수행한다.
