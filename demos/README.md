# README 데모 레코더

실행 중인 실제 앱을 Playwright로 조작해 `assets/demos/`의 GIF와 소셜 프리뷰 이미지를 만듭니다. 프레임마다 스크린샷을 찍고 ffmpeg(`palettegen` + `paletteuse`)로 합치므로 실행할 때마다 같은 프레임 수가 나옵니다. harness 측정 API는 `page.route`로 모킹하므로 외부 네트워크가 필요 없습니다.

## 준비물

- Node 26, `npm ci`로 설치한 의존성 (`@playwright/test`, Chromium)
- ffmpeg (기본 `/opt/homebrew/bin/ffmpeg`)
- production 빌드 서버. dev 서버는 개발 오버레이가 화면에 찍히므로 쓰지 않습니다.

```bash
npm run build
npx next start --hostname 127.0.0.1 -p 3100
```

## 실행

```bash
export DEMO_BASE_URL=http://127.0.0.1:3100

node demos/record.mjs            # 모든 장면 + social
node demos/record.mjs hero       # 한 장면만
node demos/record.mjs fleet social
```

| 장면 | 출력 | 내용 |
| --- | --- | --- |
| `hero` | `assets/demos/hero.gif` | 8단계 Measure Loop 전체 |
| `harness` | `assets/demos/harness.gif` | 질문 → 측정 → 초안 Evidence → 적용 |
| `fleet` | `assets/demos/fleet.gif` | 함대 모드 웨이브 판정과 승격 확정 |
| `validate` | `assets/demos/validate.gif` | 전후 입력 → verdict → 결정 → 리포트 |
| `social` | `assets/demos/social-preview.png` | 1280x640 소셜 프리뷰 (`demos/social.html`) |

`replay` 장면은 만들지 않았습니다. 리플레이 샌드박스는 개발 모드 전용이고 서로 다른 두 loopback origin(`127.0.0.1`/`localhost`)이 필요해 production 서버 하나로는 재생할 수 없습니다.

## 옵션

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `DEMO_BASE_URL` | `http://127.0.0.1:3000` | 앱 주소. 연결되지 않으면 안내 메시지를 내고 종료합니다. |
| `FFMPEG_PATH` | `/opt/homebrew/bin/ffmpeg` | ffmpeg 실행 파일 |
| `DEMO_DEBUG` | 없음 | 설정하면 hero 단계별 프레임 수를 출력합니다. |
| `DEMO_REPORT_PATH` | 없음 | 설정하면 hero · validate 장면에서 내려받은 Markdown 리포트를 이 경로에 저장합니다. README 예시를 갱신할 때 씁니다. |

## 구조

- `record.mjs` 진입점: 서버 확인, 장면 실행, 인코딩
- `lib/stage.mjs` 가짜 커서, 부드러운 스크롤, 타이핑, 프레임 캡처 (기본 viewport 960x620, 배율 1.5)
- `lib/flows.mjs` 장면이 공유하는 단계별 동작과 이야기 데이터(독서 기록 앱, 첫 노트 작성률)
- `lib/mock-harness.mjs` harness 측정 응답 모킹
- `lib/encode.mjs` ffmpeg GIF 인코딩 (10fps)
- `scenes/*.mjs` 장면 정의, `funnel.csv` 업로드용 퍼널 데이터
- `.frames/` 중간 프레임 (git 제외)
