// 장면들이 공유하는 Measure Loop 단계별 동작. 이야기: 독서 기록 앱의 "첫 노트 작성률".
import { fileURLToPath } from "node:url";

export const STORY = {
  project: "독서 기록 앱 온보딩",
  product: "독서 기록 앱",
  user: "퇴근 후 책을 읽는 직장인",
  action: "읽은 책에 첫 노트를 남긴다",
  goal: "가입 후 첫 노트 작성률을 높인다",
  kpi: "첫 노트 작성률",
  kpiDefinition: "가입한 사용자 중 7일 안에 첫 노트를 작성한 비율",
  kpiFormula: "첫 노트 작성 사용자 / 가입 사용자 × 100",
  question: "가입 퍼널에서 가장 큰 이탈은 어디인가요?",
};
export const FUNNEL_CSV = fileURLToPath(new URL("../funnel.csv", import.meta.url));

const section = (page, text) => page.locator("section").filter({ has: page.getByText(text) }).first();

export async function createProject(s) {
  const { page } = s;
  await s.show(0.1);
  await s.type(page.getByLabel(/프로젝트 이름/), STORY.project);
  await s.click(page.getByRole("button", { name: /프로젝트 만들기/ }), { settle: 0.3 });
  await page.getByText(/제품 프로필/).first().waitFor();
}

export async function fillContext(s) {
  const panel = section(s.page, /제품 프로필/);
  await s.field(panel.getByLabel(/제품 이름/), STORY.product, { first: true });
  await s.field(panel.getByLabel(/핵심 사용자/), STORY.user);
  await s.field(panel.getByLabel(/핵심 가치 행동/), STORY.action);
  await s.field(panel.getByLabel(/측정 목표/), STORY.goal);
  await s.click(panel.getByRole("button", { name: /Context 저장/ }));
  await s.click(s.page.getByRole("button", { name: /KPI 정의하기/ }), { settle: 0.3 });
}

export async function fillMetric(s) {
  const panel = section(s.page, /성공을 한 문장/);
  await s.field(panel.getByLabel(/KPI 이름/), STORY.kpi, { first: true });
  await s.field(panel.getByLabel(/^정의/), STORY.kpiDefinition);
  await s.field(panel.getByLabel(/계산식/), STORY.kpiFormula);
  await s.click(panel.getByRole("button", { name: /KPI 확정/ }));
  await s.click(s.page.getByRole("button", { name: /퍼널 연결하기/ }), { settle: 0.3 });
}

// 내장 샘플 대신 이야기에 맞는 CSV를 파일 선택 동작으로 올린다.
export async function uploadFunnel(s) {
  const { page } = s;
  await s.glideTo(page.getByRole("button", { name: "CSV 선택" }));
  await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles(FUNNEL_CSV);
  await page.getByText(/전체 전환율/).first().waitFor();
  await s.show(1.5);
}

export async function goDiagnose(s) {
  await s.click(s.page.getByRole("button", { name: /이탈 진단하기/ }), { settle: 0.3 });
  await s.page.getByText(/04 · DIAGNOSE/).first().waitFor();
}

export async function makeFriction(s) {
  await s.click(s.page.getByRole("button", { name: /마찰 후보 만들기/ }), { settle: 1.5 });
  await s.click(s.page.getByRole("button", { name: /가설 편집하기/ }), { settle: 0.3 });
}

export async function fillHypothesis(s) {
  const panel = section(s.page, /관찰을 반증 가능한 변화 가설/);
  await s.field(panel.getByLabel(/관찰/), "책을 등록한 사용자의 64%가 첫 노트 없이 이탈한다", { first: true });
  await s.field(panel.getByLabel(/변경안/), "책 등록 직후 한 줄 노트 입력창을 보여준다");
  await s.field(panel.getByLabel(/예상 행동 변화/), "등록 직후 첫 노트 작성이 늘어난다");
  await s.field(panel.getByLabel(/Guardrail metric/), "책 등록 이탈률");
  await s.field(panel.getByLabel(/대안 설명/), "책 등록 UI가 노트 기능을 가린다");
  await s.field(panel.getByLabel(/누락 근거/), "등록 후 화면 체류 시간");
  await s.click(panel.getByRole("button", { name: /가설 확정/ }));
  await s.click(s.page.getByRole("button", { name: /실험 설계하기/ }), { settle: 0.3 });
}

export async function preregister(s) {
  const panel = section(s.page, /결과를 보기 전에 판정 기준/);
  await s.value(panel.getByLabel(/성공 기준/), "5");
  await s.value(panel.getByLabel(/실패 기준/), "0");
  await s.value(panel.getByLabel(/최소 표본/), "500");
  await s.value(panel.getByLabel(/계획 기간 \(일\)/), "14");
  await s.click(panel.getByRole("button", { name: /실험 사전 등록/ }));
  await s.click(s.page.getByRole("button", { name: /결과 입력하기/ }), { settle: 0.3 });
}

// 퍼널의 가입→첫 노트 18.6%와 맞춘 값. 변경 전 465/2500(18.6%) → 변경 후 600/2500(24%), +5.4pp
export async function enterResults(s) {
  const panel = section(s.page, /실험 결과와 판정 근거/);
  const summary = panel.locator("summary").filter({ hasText: /결과 입력/ });
  if (!(await panel.locator("details[open]").isVisible())) await s.click(summary, { settle: 0.3 });
  const converted = panel.getByLabel(/전환 사용자/);
  const total = panel.getByLabel(/전체 사용자/);
  await s.value(converted.first(), 465);
  await s.value(total.first(), 2500);
  await s.value(converted.nth(1), 600);
  await s.value(total.nth(1), 2500);
  await s.value(panel.getByLabel(/실제 관찰 기간 \(일\)/), 14);
  await s.click(panel.getByRole("button", { name: /결과 계산/ }), { settle: 1.5 });
}

export async function recordDecision(s) {
  await s.click(s.page.getByRole("button", { name: /사람의 결정 기록 →/ }), { settle: 0.3 });
  const panel = section(s.page, /실험 판정과 제품 결정/);
  await s.click(panel.getByRole("radio", { name: /Adopt/ }), { settle: 0.3 });
  await s.field(panel.getByLabel(/결정 근거/), "첫 노트 작성률이 5.4%p 올랐고 guardrail은 유지됐다", { first: true });
  await s.field(panel.getByLabel(/다음 행동/), "신규 가입자 10%에게 먼저 배포한다");
  await s.click(panel.getByRole("button", { name: /Decision 저장/ }), { settle: 1.5 });
}

// DEMO_REPORT_PATH를 주면 내려받은 리포트를 그 경로에 저장한다(README 인용용).
export async function openReport(s) {
  const dl = s.page.waitForEvent("download");
  await s.click(s.page.getByRole("button", { name: /Markdown 리포트/ }), { settle: 0.3 });
  const download = await dl;
  if (process.env.DEMO_REPORT_PATH) await download.saveAs(process.env.DEMO_REPORT_PATH);
}

// 장면 시작 전 상태 준비 (녹화하지 않음)
export const PREP = {
  diagnose: [createProject, fillContext, fillMetric, uploadFunnel, goDiagnose],
  experiment: [createProject, fillContext, fillMetric, uploadFunnel, goDiagnose, makeFriction, fillHypothesis],
  validate: [createProject, fillContext, fillMetric, uploadFunnel, goDiagnose, makeFriction, fillHypothesis, preregister],
};

export async function prepare(s, name) {
  await s.silent(async () => {
    for (const step of PREP[name]) await step(s);
    await s.page.evaluate(() => window.scrollTo(0, 0));
  });
}
