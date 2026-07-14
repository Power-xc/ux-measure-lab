"use client";

import { type FormEvent, useState } from "react";
import type { ExperimentResult, ExperimentVerdict, RateCount } from "../../../entities/experiment/model";
import type { Project } from "../../../entities/project/model";
import { evaluateExperiment, ExperimentValidationError } from "../../../features/experiment/lib/evaluate-experiment";
import { ErrorSummary, Field, LockedPanel, PanelHeader } from "./PanelPrimitives";
import styles from "./panels.module.css";

type ResultForm = {
  baselineConverted: number;
  baselineTotal: number;
  variantConverted: number;
  variantTotal: number;
  guardrailBaselineConverted: number;
  guardrailBaselineTotal: number;
  guardrailVariantConverted: number;
  guardrailVariantTotal: number;
  observedDays: number;
};

type ValidationPanelProps = {
  project: Project;
  onSave(result: ExperimentResult): boolean;
  onBack(): void;
  onNext(): void;
};

const VERDICT_LABELS: Record<ExperimentVerdict, string> = {
  support: "가설 지지",
  partial_support: "부분 지지",
  not_supported: "가설을 지지하지 않음",
  insufficient_evidence: "근거 부족",
};

function initialForm(project: Project): ResultForm {
  const input = project.experimentResult?.input;
  return {
    baselineConverted: input?.baseline.converted ?? 200,
    baselineTotal: input?.baseline.total ?? 1000,
    variantConverted: input?.variant.converted ?? 240,
    variantTotal: input?.variant.total ?? 1000,
    guardrailBaselineConverted: input?.guardrail?.baseline.converted ?? 20,
    guardrailBaselineTotal: input?.guardrail?.baseline.total ?? 1000,
    guardrailVariantConverted: input?.guardrail?.variant.converted ?? 25,
    guardrailVariantTotal: input?.guardrail?.variant.total ?? 1000,
    observedDays: input?.observedDays ?? project.experiment?.plannedDays ?? 14,
  };
}

function rawRate(count: RateCount): number {
  return (count.converted / count.total) * 100;
}

function displayRate(count: RateCount): string {
  return `${Math.round(rawRate(count) * 10) / 10}%`;
}

export function ValidationPanel(props: ValidationPanelProps) {
  const [form, setForm] = useState(() => initialForm(props.project));
  const [errors, setErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const experiment = props.project.experiment;

  if (!experiment || experiment.status === "draft") return <LockedPanel message="실험 기준을 사전 등록한 뒤 결과를 입력하세요." onBack={props.onBack} />;

  function set(key: keyof ResultForm, value: number) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!experiment) return;
    const input = {
      baseline: { converted: form.baselineConverted, total: form.baselineTotal },
      variant: { converted: form.variantConverted, total: form.variantTotal },
      successThresholdPp: experiment.successThresholdPp,
      failureThresholdPp: experiment.failureThresholdPp,
      minimumSampleSize: experiment.minimumSampleSize,
      plannedDays: experiment.plannedDays,
      observedDays: form.observedDays,
      guardrail: {
        baseline: { converted: form.guardrailBaselineConverted, total: form.guardrailBaselineTotal },
        variant: { converted: form.guardrailVariantConverted, total: form.guardrailVariantTotal },
        maxIncreasePp: experiment.maxGuardrailIncreasePp,
      },
    };
    try {
      const saved = props.onSave({ input, evaluation: evaluateExperiment(input), recordedAt: new Date().toISOString() });
      if (!saved) return;
      setErrors([]);
      setDirty(false);
    } catch (error) {
      setErrors([error instanceof ExperimentValidationError ? error.message : "결과를 계산하지 못했습니다."]);
    }
  }

  const result = props.project.experimentResult;
  const evaluation = dirty ? null : result?.evaluation;
  const resultInput = evaluation ? result?.input : null;
  const rawDeltaPp = resultInput ? rawRate(resultInput.variant) - rawRate(resultInput.baseline) : 0;
  const thresholdMet = rawDeltaPp + 1e-9 >= experiment.successThresholdPp;
  const sampleMet = resultInput
    ? resultInput.baseline.total >= experiment.minimumSampleSize && resultInput.variant.total >= experiment.minimumSampleSize
    : false;
  const durationMet = resultInput ? resultInput.observedDays >= experiment.plannedDays : false;
  const guardrailInput = resultInput?.guardrail;

  const resultForm = (
    <form className={`${styles.form} ${styles.resultEntryForm}`} onSubmit={submit}>
      <ErrorSummary errors={errors} />
      <div className={styles.resultGrid}>
        <fieldset><legend>Baseline</legend><Field htmlFor="baseline-converted" label="전환 사용자"><input id="baseline-converted" min="0" onChange={(event) => set("baselineConverted", Number(event.target.value))} type="number" value={form.baselineConverted} /></Field><Field htmlFor="baseline-total" label="전체 사용자"><input id="baseline-total" min="1" onChange={(event) => set("baselineTotal", Number(event.target.value))} type="number" value={form.baselineTotal} /></Field></fieldset>
        <fieldset><legend>Variant / After</legend><Field htmlFor="variant-converted" label="전환 사용자"><input id="variant-converted" min="0" onChange={(event) => set("variantConverted", Number(event.target.value))} type="number" value={form.variantConverted} /></Field><Field htmlFor="variant-total" label="전체 사용자"><input id="variant-total" min="1" onChange={(event) => set("variantTotal", Number(event.target.value))} type="number" value={form.variantTotal} /></Field></fieldset>
        <fieldset><legend>{experiment.guardrailMetricName}</legend><div className={styles.miniGrid}><Field htmlFor="guardrail-baseline-converted" label="Before incidents"><input id="guardrail-baseline-converted" min="0" onChange={(event) => set("guardrailBaselineConverted", Number(event.target.value))} type="number" value={form.guardrailBaselineConverted} /></Field><Field htmlFor="guardrail-baseline-total" label="Before total"><input id="guardrail-baseline-total" min="1" onChange={(event) => set("guardrailBaselineTotal", Number(event.target.value))} type="number" value={form.guardrailBaselineTotal} /></Field><Field htmlFor="guardrail-variant-converted" label="After incidents"><input id="guardrail-variant-converted" min="0" onChange={(event) => set("guardrailVariantConverted", Number(event.target.value))} type="number" value={form.guardrailVariantConverted} /></Field><Field htmlFor="guardrail-variant-total" label="After total"><input id="guardrail-variant-total" min="1" onChange={(event) => set("guardrailVariantTotal", Number(event.target.value))} type="number" value={form.guardrailVariantTotal} /></Field></div></fieldset>
      </div>
      <Field htmlFor="observed-days" label="실제 관찰 기간 (일)"><input id="observed-days" min="0" onChange={(event) => set("observedDays", Number(event.target.value))} type="number" value={form.observedDays} /></Field>
      {dirty && result ? <p className={styles.observationNote} role="status">입력값이 변경되었습니다. 기존 판정은 숨겼으며 다시 계산하기 전에는 Decision으로 이동할 수 없습니다.</p> : null}
      <button className={styles.primaryButton} type="submit">결과 계산</button>
    </form>
  );

  return (
    <section className={styles.panel}>
      <PanelHeader kicker="07 · VALIDATE" title="실험 결과와 판정 근거를 함께 검토하세요" description="통계적 유의성을 추정하지 않습니다. 사전 등록한 실무 기준, 표본, 기간과 guardrail만 결정적으로 판정합니다." status={dirty ? "Recalculate required" : evaluation?.verdict} />
      <article className={styles.experimentSummaryCard}>
        <div><span>PREREGISTERED EXPERIMENT</span><h3>{props.project.hypothesis?.change ?? props.project.name}</h3><p>Primary KPI · {props.project.metric?.name ?? "확정된 KPI"}</p></div>
        <dl><div><dt>계획 기간</dt><dd>{experiment.plannedDays}일</dd></div><div><dt>최소 표본</dt><dd>각 {experiment.minimumSampleSize.toLocaleString("ko-KR")}명</dd></div><div><dt>성공 기준</dt><dd>+{experiment.successThresholdPp}pp</dd></div></dl>
      </article>
      {evaluation && resultInput ? (
        <section className={styles.resultDashboard} aria-labelledby="experiment-result-heading">
          <h3 className={styles.visuallyHidden} id="experiment-result-heading">계산된 실험 결과</h3>
          <div className={styles.resultHeroGrid}>
            <article><span>Baseline</span><strong>{evaluation.baselineRate}%</strong><small>{resultInput.baseline.converted.toLocaleString("ko-KR")} / {resultInput.baseline.total.toLocaleString("ko-KR")}</small></article>
            <article><span>Variant / After</span><strong>{evaluation.variantRate}%</strong><small>{resultInput.variant.converted.toLocaleString("ko-KR")} / {resultInput.variant.total.toLocaleString("ko-KR")}</small></article>
            <article data-tone={evaluation.absoluteDeltaPp >= 0 ? "positive" : "critical"}><span>관찰 변화</span><strong>{evaluation.absoluteDeltaPp > 0 ? "+" : ""}{evaluation.absoluteDeltaPp}pp</strong><small>{evaluation.relativeDeltaPercent === null ? "Baseline 0% · 상대 변화 없음" : `${evaluation.relativeDeltaPercent > 0 ? "+" : ""}${evaluation.relativeDeltaPercent}% 상대 변화`}</small></article>
            <article data-state={thresholdMet ? "pass" : "wait"}><span>Practical threshold</span><strong>+{experiment.successThresholdPp}pp</strong><small>{thresholdMet ? "사전 성공 기준 충족" : "사전 성공 기준 미충족"}</small></article>
          </div>
          <div className={styles.resultDetailsGrid}>
            <article className={styles.resultTableCard}>
              <div className={styles.cardHeader}><div><span>PRIMARY KPI</span><h3>{props.project.metric?.name}</h3></div><small>Observed data</small></div>
              <div className={styles.tableWrap}><table><caption className={styles.visuallyHidden}>Primary KPI의 baseline, variant와 변화</caption><thead><tr><th scope="col">Metric</th><th scope="col">Baseline</th><th scope="col">Variant</th><th scope="col">절대 변화</th><th scope="col">상대 변화</th></tr></thead><tbody><tr><th scope="row">{props.project.metric?.name}</th><td>{evaluation.baselineRate}%</td><td>{evaluation.variantRate}%</td><td>{evaluation.absoluteDeltaPp > 0 ? "+" : ""}{evaluation.absoluteDeltaPp}pp</td><td>{evaluation.relativeDeltaPercent === null ? "—" : `${evaluation.relativeDeltaPercent > 0 ? "+" : ""}${evaluation.relativeDeltaPercent}%`}</td></tr></tbody></table></div>
            </article>
            <aside className={styles.resultSideStack}>
              <article className={styles.guardrailCard}>
                <div className={styles.cardHeader}><div><span>GUARDRAIL</span><h3>{experiment.guardrailMetricName}</h3></div><strong data-state={evaluation.guardrailOutcome}>{evaluation.guardrailOutcome}</strong></div>
                {guardrailInput ? <dl><div><dt>Baseline</dt><dd>{displayRate(guardrailInput.baseline)}</dd></div><div><dt>Variant</dt><dd>{displayRate(guardrailInput.variant)}</dd></div><div><dt>변화</dt><dd>{evaluation.guardrailDeltaPp === null ? "—" : `${evaluation.guardrailDeltaPp > 0 ? "+" : ""}${evaluation.guardrailDeltaPp}pp`}</dd></div><div><dt>허용 범위</dt><dd>+{experiment.maxGuardrailIncreasePp}pp 이하</dd></div></dl> : <p>Guardrail 결과가 설정되지 않았습니다.</p>}
              </article>
              <article className={styles.sampleDurationCard}><span>SAMPLE & DURATION</span><dl><div><dt>Baseline 표본</dt><dd>{resultInput.baseline.total.toLocaleString("ko-KR")}</dd></div><div><dt>Variant 표본</dt><dd>{resultInput.variant.total.toLocaleString("ko-KR")}</dd></div><div><dt>관찰 기간</dt><dd>{resultInput.observedDays} / {experiment.plannedDays}일</dd></div></dl></article>
            </aside>
          </div>
          <div className={styles.requirementGrid}>
            <article data-state={sampleMet ? "pass" : "wait"}><span>{sampleMet ? "✓" : "!"}</span><div><strong>최소 표본</strong><small>각 variant {experiment.minimumSampleSize.toLocaleString("ko-KR")}명 이상</small></div></article>
            <article data-state={durationMet ? "pass" : "wait"}><span>{durationMet ? "✓" : "!"}</span><div><strong>관찰 기간</strong><small>{resultInput.observedDays} / {experiment.plannedDays}일</small></div></article>
            <article data-state={thresholdMet ? "pass" : "wait"}><span>{thresholdMet ? "✓" : "!"}</span><div><strong>Practical threshold</strong><small>{evaluation.absoluteDeltaPp}pp / +{experiment.successThresholdPp}pp</small></div></article>
            <article data-state={evaluation.guardrailOutcome}><span>{evaluation.guardrailOutcome === "pass" ? "✓" : "!"}</span><div><strong>Guardrail</strong><small>{evaluation.guardrailOutcome}</small></div></article>
          </div>
          <article className={styles.deterministicVerdictCard} data-verdict={evaluation.verdict}>
            <div><span>DETERMINISTIC VERDICT</span><h3>{VERDICT_LABELS[evaluation.verdict]}</h3><p>사전 등록된 기준을 코드로 적용한 판정입니다. 사람의 제품 결정과는 분리됩니다.</p></div>
            <strong>{evaluation.verdict}</strong>
          </article>
        </section>
      ) : null}
      <details className={styles.resultEditor} open={!evaluation}>
        <summary>{result ? "결과 입력 수정" : "결과 입력"}</summary>
        {resultForm}
      </details>
      <div className={styles.formActions}><button className={styles.secondaryButton} onClick={props.onBack} type="button">← Experiment</button><button className={styles.primaryButton} disabled={!evaluation} onClick={props.onNext} type="button">사람의 결정 기록 →</button></div>
    </section>
  );
}
