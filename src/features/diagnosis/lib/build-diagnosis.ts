import type { FunnelAnalysis } from "../../measure-loop/lib/calculate-funnel.ts";
import type { Evidence, FrictionCandidate, Hypothesis } from "../../../entities/project/model.ts";

export type DiagnosisInput = {
  analysis: FunnelAnalysis;
  evidenceId: string;
  hypothesisId: string;
  primaryMetricId: string;
  sourceName: string;
  observedAt: string;
};

export type DiagnosisDraft = {
  evidence: Evidence[];
  frictionCandidate: FrictionCandidate;
  hypothesis: Hypothesis;
};

export class DiagnosisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagnosisError";
  }
}

export function buildDiagnosisFromFunnel(input: DiagnosisInput): DiagnosisDraft {
  const largest = input.analysis.largestDropOff;
  if (!largest || largest.dropOffFromPrevious === null || largest.dropOffUsers === null) {
    throw new DiagnosisError("관찰 가능한 이탈이 없어 마찰 후보를 만들 수 없습니다.");
  }
  const index = input.analysis.steps.findIndex((step) => step.id === largest.id);
  const previous = input.analysis.steps[index - 1];
  if (!previous) throw new DiagnosisError("이탈 이전 단계를 찾을 수 없습니다.");

  const observation = `${previous.label} → ${largest.label} 구간에서 ${largest.dropOffUsers.toLocaleString("ko-KR")}명, ${largest.dropOffFromPrevious}%가 이탈했다.`;
  const evidence: Evidence = {
    id: input.evidenceId,
    sourceKind: "calculated",
    direction: "supports",
    observation,
    detail: "이 값은 순차 퍼널의 인접 단계 사용자 수로 계산한 관찰이며 원인을 의미하지 않는다.",
    provenance: {
      source: input.sourceName,
      observedAt: input.observedAt,
      period: "업로드 데이터의 관찰 기간",
      segment: "전체 사용자",
    },
  };
  const frictionCandidate: FrictionCandidate = {
    phenomenon: `${largest.label} 도달 전 가장 큰 상대 이탈이 관찰됨`,
    relatedEvidenceIds: [evidence.id],
    possibleCauses: ["정보 또는 선택 부담", "기능 필요성 차이", "유입 의도와 다음 단계의 불일치"],
    strength: "medium",
    strengthRationale: "정량 퍼널 신호 1개는 있으나 행동 관찰이나 인터뷰 근거가 아직 없다.",
    missingEvidence: "해당 구간의 행동 관찰, 오류 이벤트 또는 사용자 인터뷰가 필요하다.",
    recommendedValidation: "세션 표본 검토와 5명 내외의 task-based 사용성 테스트로 가능한 원인을 구분한다.",
  };
  const hypothesis: Hypothesis = {
    id: input.hypothesisId,
    observation,
    change: `${largest.label} 전 단계의 정보와 선택 부담을 줄인다.`,
    expectedBehavior: `${largest.label} 도달률이 개선될 것이다.`,
    primaryMetricId: input.primaryMetricId,
    guardrailMetric: "오류율 또는 지원 요청률",
    alternativeExplanation: "사용자는 UX가 아니라 기능 필요성 또는 낮은 유입 의도 때문에 이탈했을 수 있다.",
    missingEvidence: frictionCandidate.missingEvidence,
    evidenceIds: [evidence.id],
    status: "draft",
  };
  return { evidence: [evidence], frictionCandidate, hypothesis };
}
