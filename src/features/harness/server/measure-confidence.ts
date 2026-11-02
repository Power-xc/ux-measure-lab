import type { AdapterContext, ConfidenceBand, SourceAdapterMeta } from "../contract.ts";
import type { AggregateReader } from "./aggregate-reader.ts";

export const MINIMUM_SAMPLE_SIZE = 30;
export const CONFIDENCE_MEDIUM_MINIMUM = 100;
export const CONFIDENCE_HIGH_MINIMUM = 1_000;

export type MeasureDependencies = {
  reader: AggregateReader;
  meta: SourceAdapterMeta;
  context: AdapterContext;
  queryHash: string;
};

export function createConfidenceBand(sampleSize: number): ConfidenceBand {
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 0) throw new RangeError("표본 수는 0 이상의 안전한 정수여야 합니다.");
  const level = sampleSize >= CONFIDENCE_HIGH_MINIMUM
    ? "high"
    : sampleSize >= CONFIDENCE_MEDIUM_MINIMUM ? "medium" : "low";
  return {
    level,
    sampleSize,
    basis: `관찰 표본 ${sampleSize}개를 기준으로 한 순서형 등급입니다.`,
    limits: "표본 규모만 반영하며 인과관계나 통계적 유의성을 나타내지 않습니다.",
  };
}
