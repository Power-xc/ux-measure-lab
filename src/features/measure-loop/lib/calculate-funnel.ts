import type { FunnelStep } from "../../../entities/measurement/model.ts";

export type FunnelMetric = FunnelStep & {
  conversionFromPrevious: number | null;
  dropOffFromPrevious: number | null;
  dropOffUsers: number | null;
};

export type FunnelAnalysis = {
  steps: FunnelMetric[];
  totalConversion: number;
  largestDropOff: FunnelMetric | null;
};

export class FunnelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FunnelValidationError";
  }
}

function percentage(part: number, whole: number): number {
  return Math.round((part / whole) * 1000) / 10;
}

function validateSteps(steps: readonly FunnelStep[]): void {
  if (steps.length < 2) throw new FunnelValidationError("퍼널은 최소 2개 단계가 필요합니다.");
  const ids = new Set<string>();
  for (const [index, step] of steps.entries()) {
    if (!step.id.trim() || !step.label.trim()) throw new FunnelValidationError("단계 ID와 이름은 비어 있을 수 없습니다.");
    if (ids.has(step.id)) throw new FunnelValidationError("단계 ID는 중복될 수 없습니다.");
    if (!Number.isSafeInteger(step.users) || step.users < 0) throw new FunnelValidationError("사용자 수는 0 이상의 안전한 정수여야 합니다.");
    if (index === 0 && step.users === 0) throw new FunnelValidationError("첫 단계 사용자 수는 0보다 커야 합니다.");
    if (index > 0 && step.users > steps[index - 1].users) throw new FunnelValidationError("순차 퍼널은 이전 단계보다 사용자 수가 증가할 수 없습니다.");
    ids.add(step.id);
  }
}

export function findLargestDropOff(steps: readonly FunnelMetric[]): FunnelMetric | null {
  let largest: FunnelMetric | null = null;
  for (const step of steps.slice(1)) {
    const rate = step.dropOffFromPrevious ?? 0;
    const largestRate = largest?.dropOffFromPrevious ?? 0;
    if (rate > largestRate) largest = step;
  }
  return largest;
}

export function analyzeFunnel(steps: readonly FunnelStep[]): FunnelAnalysis {
  validateSteps(steps);
  const metrics = steps.map<FunnelMetric>((step, index) => {
    const previous = steps[index - 1];
    if (!previous) return { ...step, conversionFromPrevious: null, dropOffFromPrevious: null, dropOffUsers: null };
    const dropOffUsers = previous.users - step.users;
    return {
      ...step,
      conversionFromPrevious: percentage(step.users, previous.users),
      dropOffFromPrevious: percentage(dropOffUsers, previous.users),
      dropOffUsers,
    };
  });

  return {
    steps: metrics,
    totalConversion: percentage(steps.at(-1)?.users ?? 0, steps[0].users),
    largestDropOff: findLargestDropOff(metrics),
  };
}

export function calculateFunnel(steps: readonly FunnelStep[]): FunnelMetric[] {
  return analyzeFunnel(steps).steps;
}
