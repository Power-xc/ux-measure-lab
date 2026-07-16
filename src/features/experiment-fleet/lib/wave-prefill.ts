import type { RateCount } from "../../../entities/experiment/model.ts";
import type { NormalizedMeasurement } from "../../harness/contract.ts";

export type WavePrefillInput = {
  measurements: readonly NormalizedMeasurement[];
  dimension: string;
  baselineValue: string;
  variantIds: readonly string[];
};

export type WavePrefill = {
  baseline: RateCount;
  variants: readonly { variantId: string; count: RateCount }[];
};

export type WavePrefillResult =
  | { ok: true; prefill: WavePrefill }
  | { ok: false; error: string };

function toRateCount(measurement: NormalizedMeasurement): RateCount | null {
  const total = measurement.values.enteredUsers;
  const converted = measurement.values.completedUsers;
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(converted)) return null;
  if (total <= 0 || converted < 0 || converted > total) return null;
  return { converted, total };
}

// 변형별 측정 결과를 웨이브 관찰 입력으로 변환한다. 값을 만들어내지 않고, 빠진 변형은 그대로 실패로 알린다.
export function buildWavePrefill(input: WavePrefillInput): WavePrefillResult {
  const prefix = `${input.dimension}=`;
  const byValue = new Map<string, RateCount>();
  for (const measurement of input.measurements) {
    if (measurement.provenance.capability !== "segments" || !measurement.provenance.segment.startsWith(prefix)) {
      return { ok: false, error: "변형별 측정 결과가 아닙니다. 함대 판독으로 다시 측정하세요." };
    }
    const value = measurement.provenance.segment.slice(prefix.length);
    if (byValue.has(value)) return { ok: false, error: `중복된 변형 값이 있습니다: ${value}` };
    const count = toRateCount(measurement);
    if (!count) return { ok: false, error: `${value}의 관찰 수치가 유효하지 않습니다.` };
    byValue.set(value, count);
  }

  const baseline = byValue.get(input.baselineValue);
  if (!baseline) return { ok: false, error: `기준선 값(${input.baselineValue})의 측정이 없습니다.` };

  const variants: { variantId: string; count: RateCount }[] = [];
  const missing: string[] = [];
  for (const variantId of input.variantIds) {
    const count = byValue.get(variantId);
    if (count) variants.push({ variantId, count });
    else missing.push(variantId);
  }
  if (missing.length > 0) {
    return { ok: false, error: `측정에서 관찰되지 않은 변형이 있습니다: ${missing.join(", ")}` };
  }
  return { ok: true, prefill: { baseline, variants } };
}
