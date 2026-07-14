import type { Evidence } from "../../../entities/project/model";
import type { AiDiagnosisResult } from "../../../features/ai-diagnosis/lib/ai-diagnosis";
import styles from "./panels.module.css";

function fallbackMessage(result: AiDiagnosisResult): string {
  if (result.source === "model") return "모델 제안은 원인 진단이 아니라 기존 근거를 바탕으로 만든 검토용 초안입니다.";
  if (result.fallbackReason === "not_configured") return "AI 키가 설정되지 않아 기존 결정론적 초안을 표시합니다.";
  if (result.fallbackReason === "timeout") return "AI 응답 시간이 초과되어 기존 결정론적 초안을 표시합니다.";
  if (result.fallbackReason === "invalid_output") return "AI 출력이 근거 규칙을 통과하지 못해 기존 결정론적 초안을 표시합니다.";
  return "AI 공급자 오류로 기존 결정론적 초안을 표시합니다.";
}

export function AiSuggestionCard(props: { result: AiDiagnosisResult; evidence: Evidence[]; onApply(): void }) {
  const evidenceById = new Map(props.evidence.map((item) => [item.id, item.observation]));
  const suggestion = props.result.suggestion;
  return (
    <aside className={styles.aiSuggestionCard} aria-labelledby="ai-suggestion-title">
      <div className={styles.contextSnapshotHeader}>
        <div><span>{props.result.source === "model" ? "MODEL ADVISORY" : "DETERMINISTIC FALLBACK"}</span><h3 id="ai-suggestion-title">근거에 연결된 대안 초안</h3></div>
        <button className={styles.textButton} onClick={props.onApply} type="button">가설 초안에 적용</button>
      </div>
      <p>{suggestion.summary}</p>
      <div className={styles.aiSuggestionGrid}>
        <section><strong>가능한 원인</strong><ul>{suggestion.possibleCauses.map((cause) => <li key={`${cause.statement}:${cause.evidenceIds.join(":")}`}><span>{cause.statement}</span><small>근거: {cause.evidenceIds.map((id) => evidenceById.get(id) ?? id).join(" · ")}</small></li>)}</ul></section>
        <section><strong>변경 가설</strong><p>{suggestion.hypothesisChange}</p><small>{suggestion.expectedBehavior}</small></section>
        <section><strong>대안 설명·누락 근거</strong><p>{suggestion.alternativeExplanation}</p><small>{suggestion.missingEvidence}</small></section>
        <section><strong>권장 검증</strong><p>{suggestion.recommendedValidation}</p></section>
      </div>
      <small>{fallbackMessage(props.result)} 적용 후에도 Hypothesis 단계에서 직접 검토하고 확정해야 합니다.</small>
    </aside>
  );
}
