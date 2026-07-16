import type { FleetPlan, FleetWaveResult, NextWaveDecision } from "../../../entities/fleet/model.ts";
import { validateFleetPlan } from "./validate-fleet-plan.ts";

export type NextWaveInput = {
  plan: FleetPlan;
  lastWave: FleetWaveResult;
};

// 표본이 부족했던 변형은 컷하지 않고 후순위로 재수집한다. 근거 없이 탈락시키지 않는다는 원칙의 연장이다.
function survivorsOf(lastWave: FleetWaveResult): string[] {
  return [...lastWave.advanced, ...lastWave.needsSample];
}

export function planNextWave(input: NextWaveInput): NextWaveDecision {
  validateFleetPlan(input.plan);
  const survivors = survivorsOf(input.lastWave);

  if (survivors.length === 0) {
    return { proceed: false, reason: "no_survivors", survivors: [] };
  }
  if (input.lastWave.advanced.length === 1 && input.lastWave.needsSample.length === 0) {
    return { proceed: false, reason: "converged", survivors };
  }

  const { policy } = input.plan;
  const activeVariantIds = survivors.slice(0, policy.maxActiveVariants);
  const perVariantSampleTarget = Math.floor(input.lastWave.sampleBudgetRemaining / (activeVariantIds.length + 1));
  if (input.lastWave.sampleBudgetRemaining <= 0 || perVariantSampleTarget < policy.minimumSampleSizePerVariant) {
    return { proceed: false, reason: "budget_exhausted", survivors };
  }

  return {
    proceed: true,
    wave: input.lastWave.wave + 1,
    activeVariantIds,
    perVariantSampleTarget,
  };
}
