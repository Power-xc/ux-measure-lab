import { SessionMeasurementCache } from "./measurement-cache.ts";

const cache = new SessionMeasurementCache();

export function getHarnessSessionCache(): SessionMeasurementCache {
  return cache;
}
