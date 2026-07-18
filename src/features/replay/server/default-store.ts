import { InMemoryReplayStore } from "./store.ts";

// Ingest와 read 라우트가 같은 개발 프로세스 안에서 동일 저장소를 봐야 한다.
// in-memory 저장은 loopback dogfood 전용이며, Supabase 백엔드는 프로비저닝과 함께 붙인다.
export const defaultReplayStore = new InMemoryReplayStore();
