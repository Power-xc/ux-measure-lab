import type { FleetPlan, FleetWaveResult, NextWaveDecision } from "../../../entities/fleet/model.ts";
import { holdoutReserve, validateFleetPlan } from "./validate-fleet-plan.ts";

export type NextWaveInput = {
  plan: FleetPlan;
  lastWave: FleetWaveResult;
  lastWaveConfirmation?: boolean;
};

// 표본이 부족했던 변형은 컷하지 않고 후순위로 재수집한다. 근거 없이 탈락시키지 않는다는 원칙의 연장이다.
function survivorsOf(lastWave: FleetWaveResult): string[] {
  return [...lastWave.advanced, ...lastWave.needsSample];
}

function allocate(input: NextWaveInput, activeVariantIds: string[], confirmation: boolean): NextWaveDecision {
  const { policy } = input.plan;
  const budgetLeft = input.lastWave.sampleBudgetRemaining - holdoutReserve(policy);
  const perVariantSampleTarget = Math.floor(budgetLeft / (activeVariantIds.length + 1));
  if (budgetLeft <= 0 || perVariantSampleTarget < policy.minimumSampleSizePerVariant) {
    return { proceed: false, reason: "budget_exhausted", survivors: survivorsOf(input.lastWave) };
  }
  return { proceed: true, wave: input.lastWave.wave + 1, activeVariantIds, perVariantSampleTarget, confirmation };
}

// 확정 웨이브 통과 기준은 승격 후보 산출과 동일하다: 순위 1 + support + guardrail 미위반.
function decideAfterConfirmation(input: NextWaveInput): NextWaveDecision {
  const survivors = survivorsOf(input.lastWave);
  if (input.lastWave.promotionCandidateId) {
    return { proceed: false, reason: "confirmed", survivors };
  }
  if (input.lastWave.needsSample.length === 1 && input.lastWave.advanced.length === 0) {
    return allocate(input, [...input.lastWave.needsSample], true);
  }
  return { proceed: false, reason: "confirmation_failed", survivors };
}

export function planNextWave(input: NextWaveInput): NextWaveDecision {
  validateFleetPlan(input.plan);
  if (input.lastWaveConfirmation) return decideAfterConfirmation(input);

  const survivors = survivorsOf(input.lastWave);
  if (survivors.length === 0) {
    return { proceed: false, reason: "no_survivors", survivors: [] };
  }
  // 후보가 1개로 수렴하면 같은 표본으로 승격하지 않는다. 신규 표본의 확정 웨이브가 승자의 저주를 완화한다.
  if (input.lastWave.advanced.length === 1 && input.lastWave.needsSample.length === 0) {
    return allocate(input, [...input.lastWave.advanced], true);
  }
  return allocate(input, survivors.slice(0, input.plan.policy.maxActiveVariants), false);
}
