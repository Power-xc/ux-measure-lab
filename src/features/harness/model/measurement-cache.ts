import type { MeasurementCache, NormalizedMeasurement } from "../contract.ts";

function copy(measurements: readonly NormalizedMeasurement[]): NormalizedMeasurement[] {
  return measurements.map((measurement) => ({
    ...measurement,
    values: { ...measurement.values },
    provenance: { ...measurement.provenance, window: { ...measurement.provenance.window } },
    confidence: { ...measurement.confidence },
  }));
}

export class SessionMeasurementCache implements MeasurementCache {
  private readonly entries = new Map<string, NormalizedMeasurement[]>();
  private readonly maxEntries: number;

  constructor(maxEntries = 100) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError("캐시 크기는 1 이상의 정수여야 합니다.");
    this.maxEntries = maxEntries;
  }

  get(queryHash: string): readonly NormalizedMeasurement[] | undefined {
    const measurements = this.entries.get(queryHash);
    return measurements ? copy(measurements) : undefined;
  }

  set(queryHash: string, measurements: readonly NormalizedMeasurement[]): void {
    this.entries.delete(queryHash);
    this.entries.set(queryHash, copy(measurements));
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
