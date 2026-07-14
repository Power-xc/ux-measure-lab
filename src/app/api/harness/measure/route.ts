import { createDefaultHarnessRegistry } from "../../../../features/harness/server/default-registry.ts";
import { createHarnessPost } from "../../../../features/harness/server/route-handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const post = createHarnessPost({ registry: createDefaultHarnessRegistry() });

export async function POST(request: Request): Promise<Response> {
  return post(request);
}
