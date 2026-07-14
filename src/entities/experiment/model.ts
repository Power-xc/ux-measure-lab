export type RateCount = {
  converted: number;
  total: number;
};

export type GuardrailInput = {
  baseline: RateCount;
  variant: RateCount;
  maxIncreasePp: number;
};

export type ExperimentEvaluationInput = {
  baseline: RateCount;
  variant: RateCount;
  successThresholdPp: number;
  failureThresholdPp: number;
  minimumSampleSize: number;
  plannedDays: number;
  observedDays: number;
  guardrail?: GuardrailInput;
};

export type ExperimentVerdict = "support" | "partial_support" | "not_supported" | "insufficient_evidence";
export type GuardrailOutcome = "pass" | "fail" | "not_configured";

export type ExperimentEvaluation = {
  baselineRate: number;
  variantRate: number;
  absoluteDeltaPp: number;
  relativeDeltaPercent: number | null;
  guardrailDeltaPp: number | null;
  guardrailOutcome: GuardrailOutcome;
  verdict: ExperimentVerdict;
};

export type ExperimentPlan = {
  id: string;
  hypothesisId: string;
  primaryMetricId: string;
  successThresholdPp: number;
  failureThresholdPp: number;
  minimumSampleSize: number;
  plannedDays: number;
  guardrailMetricName: string;
  maxGuardrailIncreasePp: number;
  stopRule: string;
  status: "draft" | "ready" | "completed" | "decided";
};

export type ExperimentResult = {
  recordedAt: string;
  input: ExperimentEvaluationInput;
  evaluation: ExperimentEvaluation;
};
