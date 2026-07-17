import type { FleetPlan, FleetPolicy, FleetVariant } from "../../../entities/fleet/model.ts";

export class FleetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FleetValidationError";
  }
}

function requireText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new FleetValidationError(`${label}은(는) 비어 있을 수 없습니다.`);
  }
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FleetValidationError(`${label}은(는) 1 이상의 정수여야 합니다.`);
  }
}

function validateThresholds(policy: FleetPolicy): void {
  if (!Number.isFinite(policy.successThresholdPp) || policy.successThresholdPp < 0) {
    throw new FleetValidationError("성공 기준은 0 이상의 숫자여야 합니다.");
  }
  if (!Number.isFinite(policy.failureThresholdPp) || policy.failureThresholdPp > policy.successThresholdPp) {
    throw new FleetValidationError("실패 기준은 성공 기준보다 클 수 없습니다.");
  }
  if (!Number.isFinite(policy.maxGuardrailIncreasePp) || policy.maxGuardrailIncreasePp < 0) {
    throw new FleetValidationError("Guardrail 허용 증가는 0 이상의 숫자여야 합니다.");
  }
}

function validateAllocation(policy: FleetPolicy): void {
  requirePositiveInteger(policy.minimumSampleSizePerVariant, "변형별 최소 표본");
  requirePositiveInteger(policy.plannedDaysPerWave, "웨이브 기간");
  requirePositiveInteger(policy.sampleBudget, "표본 예산");
  if (!Number.isSafeInteger(policy.maxActiveVariants) || policy.maxActiveVariants < 2) {
    throw new FleetValidationError("동시 변형 상한은 2 이상의 정수여야 합니다.");
  }
  if (!Number.isFinite(policy.keepShare) || policy.keepShare <= 0 || policy.keepShare > 1) {
    throw new FleetValidationError("생존 비율은 0 초과 1 이하여야 합니다.");
  }
  if (policy.holdoutShare !== undefined
    && (!Number.isFinite(policy.holdoutShare) || policy.holdoutShare <= 0 || policy.holdoutShare > 0.5)) {
    throw new FleetValidationError("Holdout 비율은 0 초과 0.5 이하여야 합니다.");
  }
}

// holdout으로 예약된 몫은 어떤 변형에도 배정되지 않으므로 배분 가능한 예산에서 제외한다.
export function holdoutReserve(policy: FleetPolicy): number {
  return policy.holdoutShare ? Math.ceil(policy.sampleBudget * policy.holdoutShare) : 0;
}

// 첫 웨이브(기준선 1개 + 동시 변형)를 최소 표본으로 채우지 못하는 예산은 사전 등록 단계에서 거부한다.
function validateBudget(policy: FleetPolicy, variantCount: number): void {
  const firstWaveArms = Math.min(policy.maxActiveVariants, variantCount) + 1;
  const minimumBudget = firstWaveArms * policy.minimumSampleSizePerVariant;
  if (policy.sampleBudget - holdoutReserve(policy) < minimumBudget) {
    throw new FleetValidationError(`표본 예산은 holdout 몫을 제외하고 첫 웨이브를 감당할 수 있는 ${minimumBudget} 이상이어야 합니다.`);
  }
}

function validateVariants(variants: FleetVariant[]): void {
  if (variants.length < 2) {
    throw new FleetValidationError("함대는 2개 이상의 변형이 필요합니다.");
  }
  const ids = new Set<string>();
  for (const variant of variants) {
    requireText(variant.id, "변형 ID");
    requireText(variant.name, "변형 이름");
    requireText(variant.changeDescription, "변형 변경 내용");
    if (ids.has(variant.id)) {
      throw new FleetValidationError(`변형 ID가 중복되었습니다: ${variant.id}`);
    }
    ids.add(variant.id);
  }
}

export function validateFleetPlan(plan: FleetPlan): void {
  requireText(plan.id, "함대 ID");
  requireText(plan.name, "함대 이름");
  requireText(plan.primaryMetricId, "주 지표");
  requireText(plan.policy.guardrailMetricName, "Guardrail 지표 이름");
  requireText(plan.policy.stopRule, "종료 규칙");
  validateThresholds(plan.policy);
  validateAllocation(plan.policy);
  validateVariants(plan.variants);
  validateBudget(plan.policy, plan.variants.length);
}
