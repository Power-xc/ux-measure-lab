"use client";

import { type FormEvent, useState } from "react";
import type { FleetPlan, FleetVariant, FleetWaveRecord, NextWaveDecision } from "../../../entities/fleet/model";
import type { Project } from "../../../entities/project/model";
import { planNextWave } from "../../../features/experiment-fleet/lib/plan-next-wave";
import { FleetValidationError, validateFleetPlan } from "../../../features/experiment-fleet/lib/validate-fleet-plan";
import { MAX_TEXT_LENGTH } from "../../../shared/lib/input-policy";
import { ErrorSummary, Field } from "./PanelPrimitives";
import { FleetWaveForm } from "./FleetWaveForm";
import styles from "./panels.module.css";

type FleetSectionProps = {
  project: Project;
  onSavePlan(plan: FleetPlan): boolean;
  onRecordWave(record: FleetWaveRecord): boolean;
};

type PlanForm = {
  successThresholdPp: number;
  failureThresholdPp: number;
  minimumSampleSizePerVariant: number;
  plannedDaysPerWave: number;
  maxActiveVariants: number;
  keepShare: number;
  sampleBudget: number;
  guardrailMetricName: string;
  maxGuardrailIncreasePp: number;
  stopRule: string;
  variantsText: string;
};

const ACTION_LABELS = { advance: "승급", cull: "컷", needs_sample: "표본 재수집" } as const;
const VERDICT_LABELS = {
  support: "가설 지지",
  partial_support: "부분 지지",
  not_supported: "지지하지 않음",
  insufficient_evidence: "근거 부족",
} as const;
const STOP_LABELS = {
  converged: "함대가 수렴했습니다. 승격 후보를 검토하고 사람의 결정을 기록하세요.",
  no_survivors: "생존 변형이 없습니다. 가설 공간을 다시 설계하세요.",
  budget_exhausted: "표본 예산이 소진되었습니다. 지금까지의 순위로 사람의 결정을 기록하세요.",
} as const;

function initialPlanForm(project: Project): PlanForm {
  const plan = project.fleet?.plan;
  return {
    successThresholdPp: plan?.policy.successThresholdPp ?? 2,
    failureThresholdPp: plan?.policy.failureThresholdPp ?? 0,
    minimumSampleSizePerVariant: plan?.policy.minimumSampleSizePerVariant ?? 200,
    plannedDaysPerWave: plan?.policy.plannedDaysPerWave ?? 7,
    maxActiveVariants: plan?.policy.maxActiveVariants ?? 4,
    keepShare: plan?.policy.keepShare ?? 0.5,
    sampleBudget: plan?.policy.sampleBudget ?? 10000,
    guardrailMetricName: plan?.policy.guardrailMetricName ?? project.hypothesis?.guardrailMetric ?? "",
    maxGuardrailIncreasePp: plan?.policy.maxGuardrailIncreasePp ?? 0.5,
    stopRule: plan?.policy.stopRule ?? "웨이브 3회 완료 또는 예산 소진 시 종료",
    variantsText: plan ? plan.variants.map((variant) => `${variant.name} | ${variant.changeDescription}`).join("\n") : "",
  };
}

function parseVariants(text: string): FleetVariant[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map((line, index) => {
    const [name, ...rest] = line.split("|");
    return {
      id: `v-${index + 1}`,
      name: name.trim(),
      changeDescription: rest.join("|").trim() || name.trim(),
      origin: "human" as const,
      relatedEvidenceIds: [],
      status: "active" as const,
    };
  });
}

export function FleetSection(props: FleetSectionProps) {
  const fleet = props.project.fleet;
  const [form, setForm] = useState(() => initialPlanForm(props.project));
  const [errors, setErrors] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);

  function set<K extends keyof PlanForm>(key: K, value: PlanForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { variantsText, ...policy } = form;
    const plan: FleetPlan = {
      id: fleet?.plan.id ?? crypto.randomUUID(),
      name: `${props.project.name} 함대`,
      primaryMetricId: props.project.metric?.id ?? "",
      policy,
      variants: parseVariants(variantsText),
      status: "running",
    };
    try {
      validateFleetPlan(plan);
    } catch (error) {
      setErrors([error instanceof FleetValidationError ? error.message : "사전 등록을 검증하지 못했습니다."]);
      return;
    }
    if (!props.onSavePlan(plan)) return;
    setErrors([]);
    setEditing(false);
  }

  const lastWave = fleet && fleet.waves.length > 0 ? fleet.waves[fleet.waves.length - 1] : null;
  const nextWave: NextWaveDecision | null = fleet
    ? lastWave
      ? planNextWave({ plan: fleet.plan, lastWave: lastWave.result })
      : { proceed: true, wave: 1, activeVariantIds: fleet.plan.variants.slice(0, fleet.plan.policy.maxActiveVariants).map((variant) => variant.id), perVariantSampleTarget: 0 }
    : null;
  const names = fleet ? new Map(fleet.plan.variants.map((variant) => [variant.id, variant.name])) : new Map<string, string>();

  const planForm = (
    <form className={styles.form} onSubmit={submitPlan}>
      <ErrorSummary errors={errors} />
      <Field helper="한 줄에 하나 — 「이름 | 변경 내용」" htmlFor="fleet-variants" label="변형 목록"><textarea id="fleet-variants" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("variantsText", event.target.value)} rows={4} value={form.variantsText} /></Field>
      <div className={styles.threeColumns}>
        <Field helper="pp · 함대 공통" htmlFor="fleet-success" label="성공 임계값"><input id="fleet-success" min="0" onChange={(event) => set("successThresholdPp", Number(event.target.value))} step="0.1" type="number" value={form.successThresholdPp} /></Field>
        <Field helper="pp" htmlFor="fleet-failure" label="실패 임계값"><input id="fleet-failure" onChange={(event) => set("failureThresholdPp", Number(event.target.value))} step="0.1" type="number" value={form.failureThresholdPp} /></Field>
        <Field htmlFor="fleet-min-sample" label="변형별 표본 하한"><input id="fleet-min-sample" min="1" onChange={(event) => set("minimumSampleSizePerVariant", Number(event.target.value))} type="number" value={form.minimumSampleSizePerVariant} /></Field>
      </div>
      <div className={styles.threeColumns}>
        <Field htmlFor="fleet-wave-days" label="웨이브 기간 (일)"><input id="fleet-wave-days" min="1" onChange={(event) => set("plannedDaysPerWave", Number(event.target.value))} type="number" value={form.plannedDaysPerWave} /></Field>
        <Field htmlFor="fleet-max-active" label="동시 변형 상한"><input id="fleet-max-active" min="2" onChange={(event) => set("maxActiveVariants", Number(event.target.value))} type="number" value={form.maxActiveVariants} /></Field>
        <Field helper="0 초과 1 이하" htmlFor="fleet-keep-share" label="웨이브 생존 비율"><input id="fleet-keep-share" max="1" min="0.05" onChange={(event) => set("keepShare", Number(event.target.value))} step="0.05" type="number" value={form.keepShare} /></Field>
      </div>
      <div className={styles.threeColumns}>
        <Field helper="기준선 포함 전체 사용자" htmlFor="fleet-budget" label="표본 예산"><input id="fleet-budget" min="1" onChange={(event) => set("sampleBudget", Number(event.target.value))} type="number" value={form.sampleBudget} /></Field>
        <Field htmlFor="fleet-guardrail-name" label="함대 guardrail 지표"><input id="fleet-guardrail-name" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("guardrailMetricName", event.target.value)} value={form.guardrailMetricName} /></Field>
        <Field helper="pp" htmlFor="fleet-guardrail-max" label="함대 guardrail 허용 증가"><input id="fleet-guardrail-max" min="0" onChange={(event) => set("maxGuardrailIncreasePp", Number(event.target.value))} step="0.1" type="number" value={form.maxGuardrailIncreasePp} /></Field>
      </div>
      <Field htmlFor="fleet-stop-rule" label="함대 중단 규칙"><textarea id="fleet-stop-rule" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("stopRule", event.target.value)} rows={2} value={form.stopRule} /></Field>
      <button className={styles.primaryButton} type="submit">함대 사전 등록</button>
    </form>
  );

  return (
    <details className={styles.resultEditor} open={Boolean(fleet)}>
      <summary>함대 모드 — 다변형 실험 (선택)</summary>
      <p className={styles.observationNote}>하나의 가설 공간에 여러 변형을 사전 등록하고 웨이브 단위로 컷·승급합니다. 판정은 단일 실험과 동일한 코드가 계산하며 최종 결정은 사람이 기록합니다.</p>
      {!fleet || editing ? planForm : (
        <>
          <article className={styles.experimentSummaryCard}>
            <div><span>PREREGISTERED FLEET</span><h3>{fleet.plan.name}</h3><p>변형 {fleet.plan.variants.length}개 · 동시 상한 {fleet.plan.policy.maxActiveVariants} · 생존 비율 {fleet.plan.policy.keepShare}</p></div>
            <dl><div><dt>성공 기준</dt><dd>+{fleet.plan.policy.successThresholdPp}pp</dd></div><div><dt>변형별 최소 표본</dt><dd>{fleet.plan.policy.minimumSampleSizePerVariant.toLocaleString("ko-KR")}</dd></div><div><dt>표본 예산</dt><dd>{fleet.plan.policy.sampleBudget.toLocaleString("ko-KR")}</dd></div></dl>
          </article>
          <button className={styles.secondaryButton} onClick={() => { setForm(initialPlanForm(props.project)); setEditing(true); }} type="button">사전 등록 수정</button>
          {fleet.waves.length > 0 ? (
            <ul>
              {fleet.waves.map((record) => (
                <li key={record.input.wave}>웨이브 {record.input.wave} — 승급 {record.result.advanced.length} · 컷 {record.result.culled.length} · 재수집 {record.result.needsSample.length} · 잔여 예산 {record.result.sampleBudgetRemaining.toLocaleString("ko-KR")}</li>
              ))}
            </ul>
          ) : null}
          {lastWave ? (
            <article className={styles.resultTableCard}>
              <div className={styles.cardHeader}><div><span>WAVE {lastWave.input.wave} VERDICTS</span><h3>변형별 판정</h3></div><small>{lastWave.result.promotionCandidateId ? `승격 후보 · ${names.get(lastWave.result.promotionCandidateId) ?? lastWave.result.promotionCandidateId}` : "승격 후보 없음"}</small></div>
              <div className={styles.tableWrap}>
                <table>
                  <caption className={styles.visuallyHidden}>웨이브 {lastWave.input.wave}의 변형별 판정</caption>
                  <thead><tr><th scope="col">순위</th><th scope="col">변형</th><th scope="col">delta</th><th scope="col">판정</th><th scope="col">조치</th></tr></thead>
                  <tbody>
                    {lastWave.result.outcomes.map((outcome) => (
                      <tr key={outcome.variantId}>
                        <td>{outcome.rank ?? "—"}</td>
                        <th scope="row">{names.get(outcome.variantId) ?? outcome.variantId}</th>
                        <td>{outcome.evaluation.absoluteDeltaPp > 0 ? "+" : ""}{outcome.evaluation.absoluteDeltaPp}pp</td>
                        <td>{VERDICT_LABELS[outcome.evaluation.verdict]}</td>
                        <td>{ACTION_LABELS[outcome.action]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.observationNote}>동시 판정 {lastWave.result.outcomes.length}건 — 보정 없는 다중 비교입니다. 개별 변형의 기준 충족은 최종 결론이 아니라 다음 웨이브 후보 선별 신호로 읽으세요.</p>
              {lastWave.result.exposureWarnings.length > 0 ? (
                <p className={styles.observationNote} role="alert">배분 이상 신호 — {lastWave.result.exposureWarnings.map((id) => names.get(id) ?? id).join(", ")}의 표본이 웨이브 중앙값에서 크게 벗어났습니다. 수집 경로를 점검하세요.</p>
              ) : null}
            </article>
          ) : null}
          {nextWave?.proceed ? (
            <FleetWaveForm activeVariantIds={nextWave.activeVariantIds} key={nextWave.wave} onRecord={props.onRecordWave} plan={fleet.plan} sampleUsedBefore={lastWave ? lastWave.input.sampleUsedBefore + lastWave.result.sampleUsed : 0} wave={nextWave.wave} />
          ) : nextWave ? (
            <p className={styles.observationNote} role="status">{STOP_LABELS[nextWave.reason]}</p>
          ) : null}
        </>
      )}
    </details>
  );
}
