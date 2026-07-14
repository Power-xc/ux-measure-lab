"use client";

import { type FormEvent, useState } from "react";
import type { Hypothesis, Project } from "../../../entities/project/model";
import { MAX_TEXT_LENGTH } from "../../../shared/lib/input-policy";
import { ErrorSummary, Field, LockedPanel, PanelHeader } from "./PanelPrimitives";
import styles from "./panels.module.css";

type HypothesisPanelProps = {
  project: Project;
  onSave(hypothesis: Hypothesis): boolean;
  onBack(): void;
  onNext(): void;
};

export function HypothesisPanel(props: HypothesisPanelProps) {
  const [form, setForm] = useState<Hypothesis | null>(props.project.hypothesis);
  const [errors, setErrors] = useState<string[]>([]);

  if (!form || !props.project.frictionCandidate) return <LockedPanel message="마찰 후보를 먼저 생성하세요." onBack={props.onBack} />;

  function set<K extends keyof Hypothesis>(key: K, value: Hypothesis[K]) {
    setForm((current) => current ? { ...current, [key]: value, status: "draft" } : current);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const required = [form.observation, form.change, form.expectedBehavior, form.primaryMetricId, form.guardrailMetric, form.alternativeExplanation, form.missingEvidence];
    const nextErrors = required.some((value) => !value.trim()) ? ["가설의 모든 필수 항목을 입력하세요."] : [];
    setErrors(nextErrors);
    if (nextErrors.length > 0) return;
    const ready = { ...form, status: "ready" as const };
    if (!props.onSave(ready)) return;
    setForm(ready);
  }

  return (
    <section className={styles.panel}>
      <PanelHeader kicker="05 · HYPOTHESIZE" title="관찰을 반증 가능한 변화 가설로 바꾸세요" description="대안 설명과 누락 근거를 함께 기록해 첫 설명을 정답처럼 취급하지 않습니다." status={form.status === "ready" ? "Ready" : "Draft"} />
      <form className={styles.form} onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <Field htmlFor="hypothesis-observation" label="관찰"><textarea id="hypothesis-observation" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("observation", event.target.value)} rows={2} value={form.observation} /></Field>
        <div className={styles.twoColumns}>
          <Field htmlFor="hypothesis-change" label="변경안"><textarea id="hypothesis-change" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("change", event.target.value)} rows={3} value={form.change} /></Field>
          <Field htmlFor="hypothesis-behavior" label="예상 행동 변화"><textarea id="hypothesis-behavior" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("expectedBehavior", event.target.value)} rows={3} value={form.expectedBehavior} /></Field>
        </div>
        <Field htmlFor="guardrail-metric" label="Guardrail metric"><input id="guardrail-metric" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("guardrailMetric", event.target.value)} value={form.guardrailMetric} /></Field>
        <Field htmlFor="alternative" label="대안 설명"><textarea id="alternative" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("alternativeExplanation", event.target.value)} rows={2} value={form.alternativeExplanation} /></Field>
        <Field htmlFor="missing-evidence" label="누락 근거"><textarea id="missing-evidence" maxLength={MAX_TEXT_LENGTH} onChange={(event) => set("missingEvidence", event.target.value)} rows={2} value={form.missingEvidence} /></Field>
        <div className={styles.formActions}><button className={styles.secondaryButton} onClick={props.onBack} type="button">← Diagnose</button><button className={styles.primaryButton} type="submit">가설 확정</button><button className={styles.secondaryButton} disabled={form.status !== "ready"} onClick={props.onNext} type="button">실험 설계하기 →</button></div>
      </form>
    </section>
  );
}
