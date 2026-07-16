"use client";

import { type FormEvent, useState } from "react";
import type { ExperimentPlan } from "../../../entities/experiment/model";
import type { FleetPlan, FleetWaveRecord } from "../../../entities/fleet/model";
import type { Project } from "../../../entities/project/model";
import { MAX_TEXT_LENGTH } from "../../../shared/lib/input-policy";
import { validateExperimentPlan } from "../../../features/project-workflow/lib/project-workflow";
import { FleetSection } from "./FleetSection";
import { ErrorSummary, Field, LockedPanel, PanelHeader } from "./PanelPrimitives";
import styles from "./panels.module.css";

type ExperimentPanelProps = {
  project: Project;
  onSave(experiment: ExperimentPlan): boolean;
  onSaveFleetPlan(plan: FleetPlan): boolean;
  onRecordFleetWave(record: FleetWaveRecord): boolean;
  onBack(): void;
  onNext(): void;
};

function draft(project: Project): ExperimentPlan {
  return project.experiment ?? {
    id: crypto.randomUUID(),
    hypothesisId: project.hypothesis?.id ?? "",
    primaryMetricId: project.metric?.id ?? "",
    successThresholdPp: 3,
    failureThresholdPp: 0,
    minimumSampleSize: 500,
    plannedDays: 14,
    guardrailMetricName: project.hypothesis?.guardrailMetric ?? "",
    maxGuardrailIncreasePp: 1,
    stopRule: "계획 기간과 최소 표본을 모두 충족한 뒤 종료",
    status: "draft",
  };
}

export function ExperimentPanel(props: ExperimentPanelProps) {
  const [form, setForm] = useState(() => draft(props.project));
  const [errors, setErrors] = useState<string[]>([]);
  const registered = form.status !== "draft";

  if (props.project.hypothesis?.status !== "ready") return <LockedPanel message="가설을 확정한 뒤 실험 기준을 등록하세요." onBack={props.onBack} />;

  function set<K extends keyof ExperimentPlan>(key: K, value: ExperimentPlan[K]) {
    setForm((current) => ({ ...current, [key]: value, status: "draft" }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate: ExperimentPlan = { ...form, status: "ready" };
    const validation = validateExperimentPlan(candidate);
    setErrors(validation.errors);
    if (!validation.ok) return;
    if (!props.onSave(candidate)) return;
    setForm(candidate);
  }

  return (
    <section className={styles.panel}>
      <PanelHeader kicker="06 · EXPERIMENT" title="결과를 보기 전에 판정 기준을 잠그세요" description="표본 수만으로 통계적 유의성을 주장하지 않습니다. 이 버전은 사용자가 정한 practical threshold와 guardrail을 판정합니다." status={registered ? "Preregistered" : "Draft"} />
      <form className={styles.form} onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <div className={styles.threeColumns}>
          <Field helper="percentage point" htmlFor="success-threshold" label="성공 기준"><input id="success-threshold" min="0" onChange={(event) => set("successThresholdPp", Number(event.target.value))} step="0.1" type="number" value={form.successThresholdPp} /></Field>
          <Field helper="이 값 이하이면 미지원" htmlFor="failure-threshold" label="실패 기준"><input id="failure-threshold" onChange={(event) => set("failureThresholdPp", Number(event.target.value))} step="0.1" type="number" value={form.failureThresholdPp} /></Field>
          <Field helper="각 variant" htmlFor="minimum-sample" label="최소 표본"><input id="minimum-sample" min="1" onChange={(event) => set("minimumSampleSize", Number(event.target.value))} type="number" value={form.minimumSampleSize} /></Field>
        </div>
        <div className={styles.twoColumns}>
          <Field htmlFor="planned-days" label="계획 기간 (일)"><input id="planned-days" min="1" onChange={(event) => set("plannedDays", Number(event.target.value))} type="number" value={form.plannedDays} /></Field>
          <Field htmlFor="guardrail-name" label="Guardrail metric"><input id="guardrail-name" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("guardrailMetricName", event.target.value)} value={form.guardrailMetricName} /></Field>
        </div>
        <Field helper="Variant가 baseline보다 증가해도 허용할 범위" htmlFor="guardrail-limit" label="Guardrail 최대 증가 (pp)"><input id="guardrail-limit" min="0" onChange={(event) => set("maxGuardrailIncreasePp", Number(event.target.value))} step="0.1" type="number" value={form.maxGuardrailIncreasePp} /></Field>
        <Field htmlFor="stop-rule" label="종료 규칙"><textarea id="stop-rule" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("stopRule", event.target.value)} rows={2} value={form.stopRule} /></Field>
        <div className={styles.formActions}><button className={styles.secondaryButton} onClick={props.onBack} type="button">← Hypothesis</button><button className={styles.primaryButton} type="submit">실험 사전 등록</button><button className={styles.secondaryButton} disabled={!registered} onClick={props.onNext} type="button">결과 입력하기 →</button></div>
      </form>
      <FleetSection onRecordWave={props.onRecordFleetWave} onSavePlan={props.onSaveFleetPlan} project={props.project} />
    </section>
  );
}
