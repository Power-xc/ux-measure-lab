"use client";

import { type FormEvent, useState } from "react";
import type { MetricDefinition, Project, SourceKind } from "../../../entities/project/model";
import { MAX_TEXT_LENGTH } from "../../../shared/lib/input-policy";
import { ErrorSummary, Field, LockedPanel, PanelHeader } from "./PanelPrimitives";
import styles from "./panels.module.css";

type MetricPanelProps = {
  project: Project;
  contextComplete: boolean;
  onSave(metric: MetricDefinition): boolean;
  onBack(): void;
  onNext(): void;
};

function draftMetric(project: Project): MetricDefinition {
  return project.metric ?? {
    id: crypto.randomUUID(),
    name: "",
    definition: "",
    formula: "",
    window: "최근 30일",
    sourceKind: "calculated",
    status: "draft",
  };
}

export function MetricPanel(props: MetricPanelProps) {
  const [form, setForm] = useState<MetricDefinition>(() => draftMetric(props.project));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(props.project.metric?.status === "confirmed");

  if (!props.contextComplete) return <LockedPanel message="제품 맥락의 필수 항목을 먼저 저장하세요." onBack={props.onBack} />;

  function set<K extends keyof MetricDefinition>(key: K, value: MetricDefinition[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = [
      !form.name.trim() ? "KPI 이름을 입력하세요." : "",
      !form.definition.trim() ? "KPI 정의를 입력하세요." : "",
      !form.formula.trim() ? "계산식을 입력하세요." : "",
      !form.window.trim() ? "측정 기간을 입력하세요." : "",
    ].filter(Boolean);
    setErrors(nextErrors);
    if (nextErrors.length > 0) return;
    if (!props.onSave({ ...form, status: "confirmed" })) return;
    setSaved(true);
  }

  return (
    <section className={styles.panel}>
      <PanelHeader kicker="02 · KPI DEFINITION" title="성공을 한 문장과 한 계산식으로 고정하세요" description="AI가 숫자를 만들지 않도록 지표 정의, 분모·분자, 기간과 출처를 사용자가 확정합니다." status={saved ? "확정됨" : "Draft"} />
      <form className={styles.form} onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <div className={styles.twoColumns}>
          <Field htmlFor="metric-name" label="KPI 이름"><input id="metric-name" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("name", event.target.value)} placeholder="예: 첫 리포트 생성률" value={form.name} /></Field>
          <Field htmlFor="metric-window" label="측정 기간"><input id="metric-window" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("window", event.target.value)} value={form.window} /></Field>
        </div>
        <Field htmlFor="metric-definition" label="정의"><textarea id="metric-definition" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("definition", event.target.value)} rows={2} value={form.definition} /></Field>
        <Field htmlFor="metric-formula" label="계산식"><input id="metric-formula" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("formula", event.target.value)} placeholder="완료 사용자 / 시작 사용자 × 100" value={form.formula} /></Field>
        <Field htmlFor="metric-source" label="Source kind"><select id="metric-source" onChange={(event) => set("sourceKind", event.target.value as SourceKind)} value={form.sourceKind}><option value="measured">Measured</option><option value="calculated">Calculated</option><option value="benchmark">Benchmark</option><option value="assumed">Assumed</option></select></Field>
        <div className={styles.formActions}><button className={styles.primaryButton} type="submit">KPI 확정</button><button className={styles.secondaryButton} disabled={!saved} onClick={props.onNext} type="button">퍼널 연결하기 →</button></div>
      </form>
    </section>
  );
}
