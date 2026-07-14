"use client";

import { type FormEvent, useState } from "react";
import type { Decision, HumanDecision } from "../../../entities/decision/model";
import type { ExperimentVerdict } from "../../../entities/experiment/model";
import type { Project } from "../../../entities/project/model";
import { buildExperimentReport } from "../../../features/report/lib/build-experiment-report";
import { MAX_TEXT_LENGTH } from "../../../shared/lib/input-policy";
import { ErrorSummary, Field, LockedPanel, PanelHeader } from "./PanelPrimitives";
import styles from "./panels.module.css";

type DecisionPanelProps = {
  project: Project;
  onSave(decision: Decision): boolean;
  onBack(): void;
};

const VERDICT_LABELS: Record<ExperimentVerdict, string> = {
  support: "가설 지지",
  partial_support: "부분 지지",
  not_supported: "가설을 지지하지 않음",
  insufficient_evidence: "근거 부족",
};

const HUMAN_DECISION_OPTIONS: { value: HumanDecision; title: string; description: string }[] = [
  { value: "adopt", title: "Adopt", description: "변경안을 적용합니다." },
  { value: "iterate", title: "Iterate", description: "변경안을 수정해 재실험합니다." },
  { value: "collect_more_data", title: "Collect more data", description: "근거를 더 수집합니다." },
  { value: "stop", title: "Stop", description: "현재 변경안을 중단합니다." },
];

function fallbackRecommendation(project: Project): string {
  const verdict = project.experimentResult?.evaluation.verdict;
  if (verdict === "support") return "사전 기준을 충족했습니다. 적용 범위를 정하고 guardrail을 계속 관찰하세요.";
  if (verdict === "partial_support") return "일부 근거가 있으나 기준 또는 guardrail 이슈가 있습니다. 변경안을 좁혀 재실험하세요.";
  if (verdict === "not_supported") return "현재 결과는 가설을 지지하지 않습니다. 대안 설명을 검토하고 변경안을 재설계하세요.";
  return "근거가 부족합니다. 사전 등록한 표본과 기간을 충족한 뒤 다시 판단하세요.";
}

function downloadReport(project: Project): void {
  const report = buildExperimentReport(project);
  if (!report.ok) return;
  const url = URL.createObjectURL(new Blob([report.markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.replace(/\s+/g, "-").toLowerCase()}-experiment-report.md`;
  link.click();
  URL.revokeObjectURL(url);
}

export function DecisionPanel(props: DecisionPanelProps) {
  const [humanDecision, setHumanDecision] = useState<HumanDecision>(props.project.decision?.humanDecision ?? "iterate");
  const [rationale, setRationale] = useState(props.project.decision?.rationale ?? "");
  const [nextAction, setNextAction] = useState(props.project.decision?.nextAction ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const result = props.project.experimentResult;

  if (!result) return <LockedPanel message="실험 결과를 계산한 뒤 최종 결정을 기록하세요." onBack={props.onBack} />;
  const evaluation = result.evaluation;
  const recommendation = props.project.decision?.aiRecommendation ?? fallbackRecommendation(props.project);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = [!rationale.trim() ? "결정 근거를 입력하세요." : "", !nextAction.trim() ? "다음 행동을 입력하세요." : ""].filter(Boolean);
    setErrors(nextErrors);
    if (nextErrors.length > 0) return;
    const saved = props.onSave({
      id: props.project.decision?.id ?? crypto.randomUUID(),
      verdict: evaluation.verdict,
      aiRecommendation: recommendation,
      humanDecision,
      rationale,
      nextAction,
      evidenceIds: props.project.evidence.map((item) => item.id),
      decidedAt: new Date().toISOString(),
    });
    if (saved) setDirty(false);
  }

  return (
    <section className={styles.panel}>
      <PanelHeader kicker="08 · DECIDE" title="실험 판정과 제품 결정을 분리해 기록하세요" description="코드는 사전 기준을 판정합니다. 제품 맥락을 이해하는 사람이 최종 결정과 다음 행동을 소유합니다." status={props.project.decision ? "Decision recorded" : "Human review"} />
      <div className={styles.decisionEvidenceStrip}>
        <article data-verdict={evaluation.verdict}><span>Deterministic verdict</span><strong>{VERDICT_LABELS[evaluation.verdict]}</strong><small>{evaluation.verdict}</small></article>
        <article><span>Primary KPI</span><strong>{evaluation.absoluteDeltaPp > 0 ? "+" : ""}{evaluation.absoluteDeltaPp}pp</strong><small>{evaluation.baselineRate}% → {evaluation.variantRate}%</small></article>
        <article data-state={evaluation.guardrailOutcome}><span>Guardrail</span><strong>{evaluation.guardrailOutcome}</strong><small>{props.project.experiment?.guardrailMetricName}</small></article>
        <article><span>Sample & duration</span><strong>{(result.input.baseline.total + result.input.variant.total).toLocaleString("ko-KR")}</strong><small>{result.input.observedDays} / {result.input.plannedDays}일 관찰</small></article>
      </div>
      <article className={`${styles.recommendationCard} ${styles.ruleBasedGuidance}`}><span>RULE-BASED GUIDANCE</span><p>{recommendation}</p><small>사전 등록 기준과 deterministic verdict로 만든 참고 문구입니다. 최종 결정이 아닙니다.</small></article>
      <form className={`${styles.form} ${styles.decisionForm}`} onSubmit={submit}>
        <ErrorSummary errors={errors} />
        <fieldset className={styles.decisionChoiceGroup}>
          <legend>사람의 최종 결정</legend>
          <div className={styles.decisionChoiceGrid}>{HUMAN_DECISION_OPTIONS.map((option) => (
            <label className={styles.decisionChoiceCard} data-selected={humanDecision === option.value} key={option.value}>
              <input checked={humanDecision === option.value} className={styles.decisionRadioInput} name="human-decision" onChange={() => { setHumanDecision(option.value); setDirty(true); }} type="radio" value={option.value} />
              <span><strong>{option.title}</strong><small>{option.description}</small></span>
            </label>
          ))}</div>
        </fieldset>
        <div className={styles.decisionTextGrid}>
          <Field htmlFor="decision-rationale" label="결정 근거"><textarea id="decision-rationale" maxLength={MAX_TEXT_LENGTH} onChange={(event) => { setRationale(event.target.value); setDirty(true); }} rows={4} value={rationale} /></Field>
          <Field htmlFor="next-action" label="다음 행동"><textarea id="next-action" maxLength={MAX_TEXT_LENGTH} onChange={(event) => { setNextAction(event.target.value); setDirty(true); }} rows={4} value={nextAction} /></Field>
        </div>
        {dirty && props.project.decision ? <p className={styles.observationNote} role="status">Decision 편집 내용이 아직 저장되지 않아 리포트 다운로드를 잠갔습니다.</p> : null}
        <div className={styles.formActions}><button className={styles.secondaryButton} onClick={props.onBack} type="button">← Validate</button><button className={styles.primaryButton} type="submit">Decision 저장</button><button className={styles.secondaryButton} disabled={!props.project.decision || dirty} onClick={() => downloadReport(props.project)} type="button">Markdown 리포트</button></div>
      </form>
      {props.project.decision && !dirty ? (
        <article className={styles.decisionSummaryCard}>
          <div><span>RECORDED HUMAN DECISION</span><h3>{HUMAN_DECISION_OPTIONS.find((option) => option.value === props.project.decision?.humanDecision)?.title}</h3></div>
          <dl><div><dt>결정 근거</dt><dd>{props.project.decision.rationale}</dd></div><div><dt>다음 행동</dt><dd>{props.project.decision.nextAction}</dd></div><div><dt>연결된 근거</dt><dd>{props.project.decision.evidenceIds.length}개</dd></div></dl>
        </article>
      ) : null}
    </section>
  );
}
