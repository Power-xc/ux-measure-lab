import type { Evidence } from "../../../entities/project/model.ts";
import type { NormalizedMeasurement } from "../contract.ts";

function formatValues(values: Record<string, number>): string {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

export function measurementsToEvidence(measurements: readonly NormalizedMeasurement[]): Evidence[] {
  if (measurements.some((measurement) => measurement.confidence.sampleSize <= 0)) {
    throw new RangeError("실제 표본이 있는 측정 결과만 Evidence로 변환할 수 있습니다.");
  }
  return measurements.map((measurement, index) => ({
    id: `harness-${measurement.provenance.adapterId}-${measurement.provenance.queryHash}-${index}`,
    sourceKind: measurement.sourceKind,
    direction: measurement.direction,
    observation: measurement.observation,
    detail: `${measurement.metricLabel} · ${formatValues(measurement.values)} · 근거: ${measurement.confidence.basis} · 한계: ${measurement.confidence.limits}`,
    provenance: {
      source: measurement.provenance.source,
      observedAt: measurement.provenance.observedAt,
      period: measurement.provenance.period,
      segment: measurement.provenance.segment,
    },
    sourceRef: {
      adapterId: measurement.provenance.adapterId,
      capability: measurement.provenance.capability,
      queryHash: measurement.provenance.queryHash,
      sampleSize: measurement.confidence.sampleSize,
      confidence: measurement.confidence.level,
    },
  }));
}

export function applyMeasurementEvidence(
  measurements: readonly NormalizedMeasurement[],
  apply: (evidence: Evidence[]) => boolean,
): boolean {
  return apply(measurementsToEvidence(measurements));
}
