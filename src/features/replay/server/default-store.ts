import { InMemoryReplayStore, type ReplayStore } from "./store.ts";

// Ingest와 read 라우트가 같은 개발 프로세스 안에서 동일 저장소를 봐야 한다. dev의
// 모듈 HMR·라우트별 격리로 모듈 싱글턴이 재생성되면 두 라우트가 서로 다른 인스턴스를
// 보게 되므로, 저장소를 globalThis에 한 번만 만들어 HMR·라우트 경계와 무관하게 공유한다.
// in-memory 저장은 loopback dogfood 전용이며, Supabase 백엔드는 프로비저닝과 함께 붙인다.
const globalRef = globalThis as typeof globalThis & { __uxReplayStore?: ReplayStore };

export const defaultReplayStore: ReplayStore = globalRef.__uxReplayStore ?? new InMemoryReplayStore();
globalRef.__uxReplayStore = defaultReplayStore;
