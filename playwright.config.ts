import { defineConfig, devices } from "@playwright/test";

// E2E는 외부 백엔드가 없는 기본 동작을 검증한다. Next는 이미 정의된 환경 변수를
// .env 파일로 덮지 않으므로, 빈 값으로 고정해 로컬 .env.local의 실연결을 차단한다.
const BACKEND_ENV_KEYS = [
  "UX_MEASURE_AI_ENABLED",
  "OPENAI_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SITE_ID",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "POSTHOG_HOST",
  "POSTHOG_PROJECT_ID",
  "POSTHOG_API_KEY",
  "UX_MEASURE_REPLAY_ENABLED",
  "UX_MEASURE_REPLAY_SITE_KEY",
  "NEXT_PUBLIC_UX_MEASURE_REPLAY_SITE_KEY",
] as const;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: Object.fromEntries(BACKEND_ENV_KEYS.map((key) => [key, ""])),
  },
});
