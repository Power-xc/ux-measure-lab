import type { ExperimentEvaluation, RateCount } from "../experiment/model.ts";

export type FleetVariantOrigin = "human" | "ai_candidate";
export type FleetVariantStatus = "registered" | "active" | "culled" | "promoted";

export type FleetVariant = {
  id: string;
  name: string;
  changeDescription: string;
  origin: FleetVariantOrigin;
  relatedEvidenceIds: string[];
  status: FleetVariantStatus;
};

// 함대 전체가 공유하는 사전 등록 정책. 변형별 기준을 따로 두지 않는 것이 대량화의 전제다.
export type FleetPolicy = {
  successThresholdPp: number;
  failureThresholdPp: number;
  minimumSampleSizePerVariant: number;
  plannedDaysPerWave: number;
  maxActiveVariants: number;
  keepShare: number; // 웨이브 생존 비율 (0, 1]. 1이면 순위 컷 없이 verdict 컷만 적용된다
  sampleBudget: number; // 함대가 소비할 수 있는 전체 표본 예산 (기준선 포함)
  guardrailMetricName: string;
  maxGuardrailIncreasePp: number;
  stopRule: string;
};

export type FleetPlanStatus = "draft" | "ready" | "running" | "completed" | "decided";

export type FleetPlan = {
  id: string;
  name: string;
  primaryMetricId: string;
  policy: FleetPolicy;
  variants: FleetVariant[];
  status: FleetPlanStatus;
};

export type FleetVariantObservation = {
  variantId: string;
  variant: RateCount;
  guardrailVariant?: RateCount;
  observedDays: number;
};

// 하나의 웨이브는 공유 기준선 하나와 변형 관찰 여러 개로 구성된다.
export type FleetWaveObservations = {
  wave: number;
  baseline: RateCount;
  guardrailBaseline?: RateCount;
  observations: FleetVariantObservation[];
  sampleUsedBefore: number;
};

export type FleetWaveInput = FleetWaveObservations & { plan: FleetPlan };

export type FleetVariantAction = "advance" | "cull" | "needs_sample";

export type FleetVariantOutcome = {
  variantId: string;
  evaluation: ExperimentEvaluation;
  rank: number | null; // 순위는 판정 가능한 변형에만 부여된다
  action: FleetVariantAction;
};

export type FleetWaveResult = {
  wave: number;
  outcomes: FleetVariantOutcome[];
  advanced: string[];
  culled: string[];
  needsSample: string[];
  promotionCandidateId: string | null;
  sampleUsed: number;
  sampleBudgetRemaining: number; // 음수면 예산 초과를 그대로 드러낸다
  exposureWarnings: string[]; // 배분 이상 신호: 표본이 웨이브 중앙값의 절반 미만·2배 초과인 변형. 판정은 바꾸지 않는다
};

export type NextWaveDecision =
  | { proceed: true; wave: number; activeVariantIds: string[]; perVariantSampleTarget: number }
  | { proceed: false; reason: "no_survivors" | "converged" | "budget_exhausted"; survivors: string[] };

// 저장용 웨이브 기록. 입력을 함께 보존해 판정을 언제든 재계산·검증할 수 있게 한다.
export type FleetWaveRecord = {
  recordedAt: string;
  input: FleetWaveObservations;
  result: FleetWaveResult;
};

export type FleetState = {
  plan: FleetPlan;
  waves: FleetWaveRecord[];
};
