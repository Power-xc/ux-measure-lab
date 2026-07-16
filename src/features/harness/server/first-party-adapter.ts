import type {
  AdapterContext,
  MeasurementOutcome,
  MeasurementQuery,
  SourceAdapter,
  SourceAdapterMeta,
  SourceCapability,
} from "../contract.ts";
import type { AggregateReader } from "./aggregate-reader.ts";
import { createMeasureService } from "./measure-service.ts";

const META: SourceAdapterMeta = {
  adapterId: "first-party",
  displayName: "UX MeasureLab Events",
  kind: "first_party",
  access: "read_write",
  capabilities: ["funnel", "interaction", "paths", "segments"],
};

export function createFirstPartyAdapter(reader: AggregateReader): SourceAdapter {
  const service = createMeasureService(reader, META);
  return {
    meta: () => ({ ...META, capabilities: [...META.capabilities] }),
    supports: (capability: SourceCapability) => META.capabilities.includes(capability),
    measure: (query: MeasurementQuery, context: AdapterContext): Promise<MeasurementOutcome> => {
      if (query.capability === "funnel" && query.segment) {
        return Promise.resolve({ ok: false, code: "unsupported_capability", message: "자체 수집 퍼널의 세그먼트 분해는 아직 지원하지 않습니다." });
      }
      if (query.capability === "interaction" && query.signals.includes("error")) {
        return Promise.resolve({ ok: false, code: "unsupported_capability", message: "자체 수집에서 오류 신호는 아직 수집하지 않습니다." });
      }
      return service.measure(query, context);
    },
  };
}
