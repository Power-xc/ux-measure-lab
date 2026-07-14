"use client";

import { useEffect, useRef, useState } from "react";
import type { Evidence, FrictionCandidate, Hypothesis, Project } from "../../../entities/project/model";
import { buildAiSuggestionRequest, type AiDiagnosisResult } from "../../../features/ai-diagnosis/lib/ai-diagnosis";
import { requestDiagnosisSuggestion } from "../../../features/ai-diagnosis/model/request-diagnosis-suggestion";
import { buildDiagnosisFromFunnel } from "../../../features/diagnosis/lib/build-diagnosis";
import { analyzeFunnel } from "../../../features/measure-loop/lib/calculate-funnel";
import { AiSuggestionCard } from "./AiSuggestionCard";
import { HarnessEvidenceSection } from "./HarnessEvidenceSection";
import { LockedPanel, PanelHeader } from "./PanelPrimitives";
import styles from "./panels.module.css";

type DiagnosisPanelProps = {
  project: Project;
  onSave(evidence: Evidence[], friction: FrictionCandidate, hypothesis: Hypothesis): boolean;
  onApplyEvidence(evidence: Evidence[]): boolean;
  onBack(): void;
  onNext(): void;
};

export function DiagnosisPanel(props: DiagnosisPanelProps) {
  const [aiResult, setAiResult] = useState<AiDiagnosisResult | null>(null);
  const [aiError, setAiError] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  if (!props.project.funnelImport || !props.project.metric) return <LockedPanel message="유효한 퍼널 CSV를 먼저 연결하세요." onBack={props.onBack} />;
  const analysis = analyzeFunnel(props.project.funnelImport.steps);

  if (!analysis.largestDropOff) {
    return (
      <section className={styles.panel}>
        <PanelHeader kicker="04 · DIAGNOSE" title="관찰 가능한 이탈이 없습니다" description="모든 단계의 사용자 수가 같아 현재 데이터만으로는 마찰 후보를 만들 수 없습니다." status="No drop-off" />
        <HarnessEvidenceSection onApplyEvidence={props.onApplyEvidence} project={props.project} />
        <div className={styles.emptyBlock}><strong>다른 데이터 범위를 확인하세요</strong><p>이 결과도 유효한 관찰입니다. 원인을 만들어내지 않고 기간이나 퍼널 범위를 바꿔 다시 측정하세요.</p></div>
        <div className={styles.formActions}><button className={styles.secondaryButton} onClick={props.onBack} type="button">← Measure</button></div>
      </section>
    );
  }

  function diagnose() {
    const draft = buildDiagnosisFromFunnel({
      analysis,
      evidenceId: crypto.randomUUID(),
      hypothesisId: crypto.randomUUID(),
      primaryMetricId: props.project.metric?.id ?? "",
      sourceName: props.project.funnelImport?.fileName ?? "",
      observedAt: new Date().toISOString(),
    });
    const evidence = [...props.project.evidence.filter((item) => item.sourceRef), ...draft.evidence];
    const evidenceIds = evidence.map((item) => item.id);
    props.onSave(
      evidence,
      { ...draft.frictionCandidate, relatedEvidenceIds: evidenceIds },
      { ...draft.hypothesis, evidenceIds },
    );
  }

  async function requestAiSuggestion() {
    const input = buildAiSuggestionRequest(props.project);
    if (!input) {
      setAiError("확정된 KPI, 근거와 가설 초안이 필요합니다.");
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setAiBusy(true);
    setAiResult(null);
    setAiError("");
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const result = await requestDiagnosisSuggestion(input, { signal: controller.signal });
      if (requestRef.current === controller) setAiResult(result);
    } catch (error) {
      if (requestRef.current === controller) setAiError(controller.signal.aborted ? "AI 제안 요청 시간이 초과되었습니다." : error instanceof Error ? error.message : "AI 제안을 요청하지 못했습니다.");
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setAiBusy(false);
      }
    }
  }

  function applyAiSuggestion() {
    const friction = props.project.frictionCandidate;
    const hypothesis = props.project.hypothesis;
    if (!aiResult || !friction || !hypothesis) return;
    const suggestion = aiResult.suggestion;
    props.onSave(
      props.project.evidence,
      {
        ...friction,
        relatedEvidenceIds: suggestion.evidenceIds,
        possibleCauses: suggestion.possibleCauses.map((cause) => cause.statement),
        missingEvidence: suggestion.missingEvidence,
        recommendedValidation: suggestion.recommendedValidation,
      },
      {
        ...hypothesis,
        change: suggestion.hypothesisChange,
        expectedBehavior: suggestion.expectedBehavior,
        alternativeExplanation: suggestion.alternativeExplanation,
        missingEvidence: suggestion.missingEvidence,
        evidenceIds: suggestion.evidenceIds,
        status: "draft",
      },
    );
  }

  const friction = props.project.frictionCandidate;
  const entryUsers = analysis.steps[0]?.users ?? 0;
  const completedUsers = analysis.steps.at(-1)?.users ?? 0;
  const largestDropIndex = analysis.steps.findIndex((step) => step.id === analysis.largestDropOff?.id);
  const largestDropPrevious = largestDropIndex > 0 ? analysis.steps[largestDropIndex - 1] : null;
  const linkedEvidence = friction
    ? props.project.evidence.filter((item) => friction.relatedEvidenceIds.includes(item.id))
    : [];

  return (
    <section className={styles.panel}>
      <PanelHeader kicker="04 · DIAGNOSE" title="관찰과 가능한 원인을 분리하세요" description="퍼널은 어디서 이탈했는지 보여줄 뿐 왜 이탈했는지는 말하지 않습니다. 가능한 원인은 다음 검증 대상으로 둡니다." status={friction ? `${friction.strength} evidence` : undefined} />
      {friction ? <p className={styles.visuallyHidden} role="status">근거에 연결된 UX 마찰 후보가 준비되었습니다.</p> : null}
      <div className={styles.diagnosisSummaryGrid}>
        <article className={styles.diagnosisKpiCard}><span>전체 전환율</span><strong>{analysis.totalConversion}%</strong><small>{completedUsers.toLocaleString("ko-KR")} / {entryUsers.toLocaleString("ko-KR")}명 완료</small></article>
        <article className={styles.diagnosisKpiCard} data-tone="critical"><span>가장 큰 이탈</span><strong>{analysis.largestDropOff.dropOffFromPrevious}%</strong><small>{largestDropPrevious?.label ?? "이전 단계"} → {analysis.largestDropOff.label} · {analysis.largestDropOff.dropOffUsers?.toLocaleString("ko-KR")}명</small></article>
        <article className={styles.diagnosisKpiCard}><span>분석 표본</span><strong>{entryUsers.toLocaleString("ko-KR")}</strong><small>{analysis.steps.length}개 단계 · {props.project.funnelImport.fileName}</small></article>
      </div>
      <HarnessEvidenceSection onApplyEvidence={props.onApplyEvidence} project={props.project} />
      <div className={styles.diagnosisWorkspace}>
        <article className={styles.diagnosisFunnelCard}>
          <div className={styles.cardHeader}><div><span>OBSERVED DATA</span><h3>Funnel performance</h3></div><small>이전 단계 대비</small></div>
          <div className={styles.tableWrap}>
            <table>
              <caption className={styles.visuallyHidden}>진단에 사용한 순차 퍼널의 단계별 사용자와 이탈</caption>
              <thead><tr><th scope="col">단계</th><th scope="col">사용자</th><th scope="col">전환</th><th scope="col">이탈</th></tr></thead>
              <tbody>{analysis.steps.map((step, index) => (
                <tr className={step.id === analysis.largestDropOff?.id ? styles.riskRow : undefined} key={step.id}>
                  <th scope="row"><span className={styles.stepIndex}>{index + 1}</span>{step.label}</th>
                  <td>{step.users.toLocaleString("ko-KR")}</td>
                  <td><progress className={styles.funnelProgress} max="100" value={step.conversionFromPrevious ?? 100} /> <span>{step.conversionFromPrevious === null ? "기준" : `${step.conversionFromPrevious}%`}</span></td>
                  <td>{step.dropOffFromPrevious === null ? "—" : `${step.dropOffUsers?.toLocaleString("ko-KR")}명 · ${step.dropOffFromPrevious}%`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className={styles.observationNote}>행동 데이터는 이탈 위치를 보여주지만 원인을 확정하지 않습니다.</p>
        </article>
        {!friction ? (
          <aside className={`${styles.emptyBlock} ${styles.frictionEmptyState}`}>
            <span>UX FRICTION CANDIDATE</span>
            <strong>정량 신호에서 검증 대상을 만듭니다</strong>
            <p>가장 큰 상대 이탈을 근거로 현상과 누락 근거를 구조화합니다.</p>
            <button className={styles.primaryButton} onClick={diagnose} type="button">마찰 후보 만들기</button>
          </aside>
        ) : (
          <aside className={styles.frictionRail}>
            <article className={styles.frictionCandidateCard}>
              <div className={styles.cardHeader}>
                <div><span>UX FRICTION CANDIDATE</span><h3>{friction.phenomenon}</h3></div>
                <strong className={styles.strengthBadge}>{friction.strength} evidence</strong>
              </div>
              <section className={styles.candidateSection}>
                <h4>연결된 근거</h4>
                <div className={styles.evidenceList}>{linkedEvidence.map((evidence) => (
                  <article key={evidence.id}>
                    <span className={styles.dataBadge}>{evidence.sourceKind}</span>
                    <p>{evidence.observation}</p>
                    <small>{evidence.detail}</small>
                    <small>{evidence.provenance.source} · {evidence.provenance.segment}</small>
                  </article>
                ))}</div>
              </section>
              <section className={styles.candidateSection}>
                <h4>가능한 원인 · 미검증</h4>
                <ul>{friction.possibleCauses.map((cause) => <li key={cause}>{cause}</li>)}</ul>
              </section>
              <section className={styles.candidateSection}>
                <h4>근거 강도</h4>
                <p>{friction.strengthRationale}</p>
              </section>
              <section className={styles.candidateSection}>
                <h4>추가로 필요한 근거</h4>
                <p>{friction.missingEvidence}</p>
                <strong>{friction.recommendedValidation}</strong>
              </section>
              <div className={styles.frictionActions}><button aria-busy={aiBusy} className={styles.secondaryButton} disabled={aiBusy} onClick={requestAiSuggestion} type="button">{aiBusy ? "AI 검토 중…" : "AI로 대안 확장"}</button><small>근거 ID를 인용한 원인 후보만 별도 초안으로 표시합니다.</small></div>
            </article>
          </aside>
        )}
      </div>
      {friction ? <>
        {aiError ? <p className={styles.contextError} role="alert">{aiError}</p> : null}
        {aiResult ? <><p className={styles.visuallyHidden} role="status">AI advisory 초안이 준비되었습니다. 적용 전에 내용을 검토하세요.</p><AiSuggestionCard evidence={props.project.evidence} onApply={applyAiSuggestion} result={aiResult} /></> : null}
      </> : null}
      <div className={styles.formActions}><button className={styles.secondaryButton} onClick={props.onBack} type="button">← Measure</button><button className={styles.primaryButton} disabled={!friction} onClick={props.onNext} type="button">가설 편집하기 →</button></div>
    </section>
  );
}
