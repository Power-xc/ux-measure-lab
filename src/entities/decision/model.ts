import type { ExperimentVerdict } from "../experiment/model.ts";

export type HumanDecision = "adopt" | "iterate" | "stop" | "collect_more_data";

export type Decision = {
  id: string;
  verdict: ExperimentVerdict;
  aiRecommendation: string;
  humanDecision: HumanDecision;
  rationale: string;
  nextAction: string;
  evidenceIds: string[];
  decidedAt: string;
};
