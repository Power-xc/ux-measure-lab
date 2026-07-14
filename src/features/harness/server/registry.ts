import type { SourceAdapter, SourceCapability } from "../contract.ts";

export type AdapterRegistry = {
  register(adapter: SourceAdapter): void;
  get(adapterId: string): SourceAdapter | undefined;
  list(): readonly SourceAdapter[];
  findByCapability(capability: SourceCapability): readonly SourceAdapter[];
};

export function createAdapterRegistry(initialAdapters: readonly SourceAdapter[] = []): AdapterRegistry {
  const adapters = new Map<string, SourceAdapter>();

  const register = (adapter: SourceAdapter): void => {
    const adapterId = adapter.meta().adapterId.trim();
    if (!adapterId) throw new Error("어댑터 ID는 필수입니다.");
    if (adapters.has(adapterId)) throw new Error(`어댑터 '${adapterId}'는 이미 등록되어 있습니다.`);
    adapters.set(adapterId, adapter);
  };

  for (const adapter of initialAdapters) register(adapter);

  return {
    register,
    get: (adapterId) => adapters.get(adapterId),
    list: () => [...adapters.values()],
    findByCapability: (capability) => [...adapters.values()].filter((adapter) => adapter.supports(capability)),
  };
}
