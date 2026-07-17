"use client";

import { useRef, useState } from "react";
import type { Project } from "../../../entities/project/model";
import { buildAiVariantRequest, MAX_VARIANT_CANDIDATES, type AiVariantsResult } from "../../../features/experiment-fleet/lib/ai-variants";
import { requestVariantCandidates } from "../../../features/experiment-fleet/model/request-variant-candidates";
import { Field } from "./PanelPrimitives";
import styles from "./panels.module.css";

type FleetCandidateAssistProps = {
  project: Project;
  onAdd(line: string): void;
};

const FALLBACK_LABELS: Record<string, string> = {
  not_configured: "AI 미설정 — 결정적 초안",
  timeout: "AI 시간 초과 — 결정적 초안",
  provider_error: "AI 오류 — 결정적 초안",
  invalid_output: "AI 출력 검증 실패 — 결정적 초안",
};

export function FleetCandidateAssist(props: FleetCandidateAssistProps) {
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AiVariantsResult | null>(null);
  const [added, setAdded] = useState<readonly string[]>([]);
  const request = useRef<AbortController | null>(null);

  async function fetchCandidates() {
    setError("");
    const input = buildAiVariantRequest(props.project, count);
    if (!input) {
      setError("확정된 KPI, ready 가설과 근거가 있어야 후보를 요청할 수 있습니다.");
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const next = await requestVariantCandidates(input, { signal: controller.signal });
      if (request.current !== controller) return;
      setResult(next);
      setAdded([]);
    } catch (cause) {
      if (request.current === controller) {
        setError(cause instanceof Error ? cause.message : "AI 변형 후보를 요청하지 못했습니다.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  function add(name: string, changeDescription: string) {
    props.onAdd(`${name} | ${changeDescription}`);
    setAdded((current) => [...current, name]);
  }

  return (
    <details className={styles.resultEditor}>
      <summary>AI 변형 후보 (선택) — 검토 후 목록에 추가</summary>
      <p className={styles.observationNote}>AI는 후보 텍스트만 제안합니다. 여기서 추가한 뒤 함대를 사전 등록해야 변형이 됩니다. 수치·판정은 제안되지 않습니다.</p>
      <div className={styles.twoColumns}>
        <Field helper={`최대 ${MAX_VARIANT_CANDIDATES}개`} htmlFor="fleet-candidate-count" label="후보 개수"><input id="fleet-candidate-count" max={MAX_VARIANT_CANDIDATES} min="1" onChange={(event) => setCount(Number(event.target.value))} type="number" value={count} /></Field>
        <button aria-busy={busy} className={styles.secondaryButton} disabled={busy} onClick={fetchCandidates} type="button">{busy ? "요청 중…" : "AI 후보 받기"}</button>
      </div>
      {error ? <p className={styles.contextError} role="alert">{error}</p> : null}
      {result ? (
        <div aria-live="polite">
          <p className={styles.observationNote} role="status">{result.source === "model" ? "AI 제안" : FALLBACK_LABELS[result.fallbackReason ?? "provider_error"]} · 후보 {result.suggestion.candidates.length}개</p>
          <ul>
            {result.suggestion.candidates.map((candidate) => (
              <li key={candidate.name}>
                <strong>{candidate.name}</strong> — {candidate.changeDescription} <small>근거 {candidate.evidenceIds.join(", ")}</small>{" "}
                <button className={styles.textButton} disabled={added.includes(candidate.name)} onClick={() => add(candidate.name, candidate.changeDescription)} type="button">{added.includes(candidate.name) ? "추가됨" : "목록에 추가"}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  );
}
