// Replay → qualitative Evidence 변환. spec.md (session-replay) §10·SR-10·SR-11:
// raw recording은 Project로 복사되지 않고, 참조는 사용자가 명시적으로 적용해야 저장되며,
// 원본이 만료되면 관찰문과 provenance만 남는다. 수치·원인 표현은 만들지 않는다.

import type { Evidence } from "../../../entities/project/model.ts";
import type { ReplayRecordingMeta } from "../server/store.ts";

export const REPLAY_ADAPTER_ID = "replay";

export type ReplayReferenceInput = {
  id: string;
  meta: ReplayRecordingMeta;
  observedAt: string; // 주입된 시각 (ISO)
};

export function buildReplayEvidence(input: ReplayReferenceInput): Evidence {
  const period = `${input.meta.startedAt} ~ ${input.meta.endedAt}`;
  return {
    id: input.id,
    sourceKind: "qualitative",
    direction: "context",
    observation: `세션 녹화 ${input.meta.recordingId}에서 상호작용 순서가 관찰되었습니다.`,
    detail: `chunk ${input.meta.chunkCount}개 · 보존 만료 ${input.meta.expiresAt} · 원인 판정이 아닌 정성 맥락입니다.`,
    provenance: {
      source: "Session replay",
      observedAt: input.observedAt,
      period,
      segment: "동의한 방문자 1명",
    },
    sourceRef: {
      adapterId: REPLAY_ADAPTER_ID,
      capability: "recordings",
      queryHash: input.meta.recordingId,
      sampleSize: 1,
      confidence: "low",
    },
  };
}

// 원본 만료 후에도 Evidence는 남는다. 수치나 원인으로 대체하지 않고 만료를 명시한다.
export function markReplayEvidenceExpired(evidence: Evidence): Evidence {
  if (evidence.sourceRef?.adapterId !== REPLAY_ADAPTER_ID) return evidence;
  if (evidence.detail.includes("원본 녹화가 만료")) return evidence;
  return {
    ...evidence,
    detail: `${evidence.detail} 원본 녹화가 만료되어 재생은 불가하며 관찰 기록만 남습니다.`,
  };
}

export function isReplayEvidence(evidence: Evidence): boolean {
  return evidence.sourceRef?.adapterId === REPLAY_ADAPTER_ID && evidence.sourceRef.capability === "recordings";
}
