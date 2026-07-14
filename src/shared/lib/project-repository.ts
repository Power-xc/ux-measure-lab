import { WORKSPACE_SCHEMA_VERSION, type WorkspaceState } from "../../entities/project/model.ts";
import { isWorkspaceState } from "./project-schema.ts";

export const WORKSPACE_STORAGE_KEY = "ux-measure-lab.workspace.v1";

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

function parseWorkspace(text: string): WorkspaceResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, workspace: createEmptyWorkspace(), error: { code: "invalid_json", message: "저장 데이터가 올바른 JSON이 아닙니다." }, raw: text };
  }

  if (typeof value === "object" && value !== null && "schemaVersion" in value && value.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    return { ok: false, workspace: createEmptyWorkspace(), error: { code: "unsupported_version", message: "지원하지 않는 저장 데이터 버전입니다." }, raw: text };
  }
  if (!isWorkspaceState(value)) {
    return { ok: false, workspace: createEmptyWorkspace(), error: { code: "invalid_schema", message: "저장 데이터 구조가 올바르지 않습니다." }, raw: text };
  }
  return { ok: true, workspace: value };
}

export function loadWorkspace(storage: StorageLike): WorkspaceResult {
  let raw: string | null;
  try {
    raw = storage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return { ok: false, workspace: createEmptyWorkspace(), error: { code: "storage_read_failed", message: "브라우저 저장소를 읽을 수 없습니다." }, raw: null };
  }
  return raw === null ? { ok: true, workspace: createEmptyWorkspace() } : parseWorkspace(raw);
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
