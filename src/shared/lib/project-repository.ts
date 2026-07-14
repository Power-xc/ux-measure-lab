import { WORKSPACE_SCHEMA_VERSION, type WorkspaceState } from "../../entities/project/model.ts";
import { isWorkspaceState } from "./project-schema.ts";

// 저장 key는 최초 배포 이름을 유지한다. 이름의 v1은 스키마 version이 아니라 key 식별자이며,
// 바꾸면 기존 사용자의 데이터가 고아가 되므로 승격해도 그대로 둔다.
export const WORKSPACE_STORAGE_KEY = "ux-measure-lab.workspace.v1";
export const WORKSPACE_BACKUP_KEY = "ux-measure-lab.workspace.backup";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type RepositoryErrorCode = "invalid_json" | "unsupported_version" | "invalid_schema" | "storage_read_failed" | "storage_write_failed" | "storage_conflict";

export type RepositoryError = {
  code: RepositoryErrorCode;
  message: string;
};

export type WorkspaceResult =
  | { ok: true; workspace: WorkspaceState }
  | { ok: false; workspace: WorkspaceState; error: RepositoryError; raw: string | null };

export type SaveResult =
  | { ok: true }
  | { ok: false; error: RepositoryError };

export function createEmptyWorkspace(): WorkspaceState {
  return { schemaVersion: WORKSPACE_SCHEMA_VERSION, activeProjectId: null, projects: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// v1 → v2: 값을 변형하지 않고 schemaVersion만 승격한다. sourceRef 등 신규 필드는 전부 optional 가산이라
// v1 데이터는 필드 부재로 그대로 유효하다. 미래 version(>2)은 승격 대상이 아니므로 이후 검증에서 거부된다.
function migrateRaw(value: unknown): unknown {
  return isRecord(value) && value.schemaVersion === 1 ? { ...value, schemaVersion: WORKSPACE_SCHEMA_VERSION } : value;
}

function parseWorkspace(text: string): WorkspaceResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, workspace: createEmptyWorkspace(), error: { code: "invalid_json", message: "저장 데이터가 올바른 JSON이 아닙니다." }, raw: text };
  }

  const migrated = migrateRaw(value);
  if (isRecord(migrated) && "schemaVersion" in migrated && migrated.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    return { ok: false, workspace: createEmptyWorkspace(), error: { code: "unsupported_version", message: "지원하지 않는 저장 데이터 버전입니다." }, raw: text };
  }
  if (!isWorkspaceState(migrated)) {
    return { ok: false, workspace: createEmptyWorkspace(), error: { code: "invalid_schema", message: "저장 데이터 구조가 올바르지 않습니다." }, raw: text };
  }
  return { ok: true, workspace: migrated };
}

function isV1Raw(raw: string): boolean {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) && value.schemaVersion === 1;
  } catch {
    return false;
  }
}

// 마이그레이션 전 원본 raw를 백업 슬롯에 보존한 뒤에만 주 key를 v2로 승격한다.
// 백업 쓰기가 실패하면 원본 v1이 주 key에 그대로 남아 손실이 없다.
function persistMigration(storage: StorageLike, originalRaw: string, migrated: WorkspaceState): void {
  try {
    storage.setItem(WORKSPACE_BACKUP_KEY, originalRaw);
  } catch {
    return;
  }
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(migrated));
  } catch {
    // 승격 쓰기 실패는 다음 저장에서 재시도된다. 원본 백업은 이미 보존됨.
  }
}

export function loadWorkspace(storage: StorageLike): WorkspaceResult {
  let raw: string | null;
  try {
    raw = storage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return { ok: false, workspace: createEmptyWorkspace(), error: { code: "storage_read_failed", message: "브라우저 저장소를 읽을 수 없습니다." }, raw: null };
  }
  if (raw === null) return { ok: true, workspace: createEmptyWorkspace() };
  const result = parseWorkspace(raw);
  if (result.ok && isV1Raw(raw)) persistMigration(storage, raw, result.workspace);
  return result;
}

export function saveWorkspace(storage: StorageLike, workspace: WorkspaceState): SaveResult {
  if (!isWorkspaceState(workspace)) {
    return { ok: false, error: { code: "invalid_schema", message: "올바르지 않은 workspace는 저장하지 않았습니다." } };
  }
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
    return { ok: true };
  } catch {
    return { ok: false, error: { code: "storage_write_failed", message: "브라우저 저장 공간이 부족하거나 사용할 수 없습니다." } };
  }
}

export function exportWorkspace(workspace: WorkspaceState): string {
  if (!isWorkspaceState(workspace)) throw new Error("올바르지 않은 workspace는 export할 수 없습니다.");
  return JSON.stringify(workspace, null, 2);
}

export function importWorkspace(text: string): WorkspaceResult {
  return parseWorkspace(text);
}
