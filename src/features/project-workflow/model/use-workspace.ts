"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createProject,
  deleteProject,
  replaceProject,
  type Project,
  type WorkspaceState,
} from "../../../entities/project/model";
import { MAX_NAME_LENGTH } from "../../../shared/lib/input-policy";
import {
  createEmptyWorkspace,
  exportWorkspace,
  importWorkspace,
  loadWorkspace,
  saveWorkspace,
  WORKSPACE_STORAGE_KEY,
  type RepositoryError,
} from "../../../shared/lib/project-repository";

type WorkspaceController = {
  workspace: WorkspaceState;
  activeProject: Project | null;
  hydrated: boolean;
  storageError: RepositoryError | null;
  corruptedBackup: string | null;
  retrySave(): boolean;
  createNewProject(name: string): boolean;
  selectProject(projectId: string): boolean;
  updateProject(projectId: string, update: (project: Project) => Project): boolean;
  removeProject(projectId: string): boolean;
  recoverStorage(): boolean;
  importBackup(text: string): { ok: true } | { ok: false; message: string };
  exportBackup(): string;
};

type WorkspaceTransition = (current: WorkspaceState) => WorkspaceState;

function emptyContext(productName: string) {
  return {
    productName,
    productUrl: "",
    productStage: "beta" as const,
    audience: "",
    valueAction: "",
    goal: "",
  };
}

function conflictError(): RepositoryError {
  return { code: "storage_conflict", message: "다른 탭에서 워크스페이스가 변경되었습니다. 현재 상태를 백업한 뒤 새로고침하세요." };
}

export function useWorkspace(): WorkspaceController {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createEmptyWorkspace());
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState<RepositoryError | null>(null);
  const [corruptedBackup, setCorruptedBackup] = useState<string | null>(null);
  const [persistenceEnabled, setPersistenceEnabled] = useState(true);
  const workspaceRef = useRef(workspace);
  const persistedRawRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = loadWorkspace(window.localStorage);
      workspaceRef.current = loaded.workspace;
      setWorkspace(loaded.workspace);
      if (loaded.ok) {
        try {
          persistedRawRef.current = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
        } catch {
          persistedRawRef.current = null;
        }
      } else {
        persistedRawRef.current = loaded.raw;
        setCorruptedBackup(loaded.raw);
        setStorageError(loaded.error);
        setPersistenceEnabled(false);
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const commit = useCallback((transition: WorkspaceTransition): boolean => {
    if (!persistenceEnabled) return false;
    let currentRaw: string | null;
    try {
      currentRaw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    } catch {
      setStorageError({ code: "storage_read_failed", message: "브라우저 저장소를 읽을 수 없습니다." });
      return false;
    }
    if (currentRaw !== persistedRawRef.current) {
      setStorageError(conflictError());
      return false;
    }

    let next: WorkspaceState;
    try {
      next = transition(workspaceRef.current);
    } catch {
      setStorageError({ code: "invalid_schema", message: "변경 내용이 올바르지 않아 저장하지 않았습니다." });
      return false;
    }
    const saved = saveWorkspace(window.localStorage, next);
    if (!saved.ok) {
      if (saved.error.code === "storage_write_failed") {
        workspaceRef.current = next;
        setWorkspace(next);
      }
      setStorageError(saved.error);
      return false;
    }
    persistedRawRef.current = JSON.stringify(next);
    workspaceRef.current = next;
    setWorkspace(next);
    setStorageError(null);
    return true;
  }, [persistenceEnabled]);

  const activeProject = useMemo(
    () => workspace.projects.find((project) => project.id === workspace.activeProjectId) ?? null,
    [workspace],
  );

  const createNewProject = useCallback((name: string): boolean => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return false;
    return commit((current) => createProject(current, {
      id: crypto.randomUUID(),
      name: trimmed,
      now: new Date().toISOString(),
      context: emptyContext(trimmed),
    }));
  }, [commit]);

  const selectProject = useCallback((projectId: string): boolean => commit((current) => {
    if (!current.projects.some((project) => project.id === projectId)) throw new Error("missing_project");
    return { ...current, activeProjectId: projectId };
  }), [commit]);

  const updateProject = useCallback((projectId: string, update: (project: Project) => Project): boolean => commit((current) => {
    const project = current.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("missing_project");
    return replaceProject(current, projectId, update(project));
  }), [commit]);

  const removeProject = useCallback((projectId: string): boolean => commit((current) => deleteProject(current, projectId)), [commit]);

  const recoverStorage = useCallback((): boolean => {
    const next = createEmptyWorkspace();
    const saved = saveWorkspace(window.localStorage, next);
    if (!saved.ok) {
      setStorageError(saved.error);
      return false;
    }
    persistedRawRef.current = JSON.stringify(next);
    workspaceRef.current = next;
    setWorkspace(next);
    setCorruptedBackup(null);
    setStorageError(null);
    setPersistenceEnabled(true);
    return true;
  }, []);

  const importBackup = useCallback((text: string) => {
    const imported = importWorkspace(text);
    if (!imported.ok) return { ok: false as const, message: imported.error.message };
    const saved = saveWorkspace(window.localStorage, imported.workspace);
    if (!saved.ok) {
      setStorageError(saved.error);
      return { ok: false as const, message: saved.error.message };
    }
    persistedRawRef.current = JSON.stringify(imported.workspace);
    workspaceRef.current = imported.workspace;
    setWorkspace(imported.workspace);
    setCorruptedBackup(null);
    setStorageError(null);
    setPersistenceEnabled(true);
    return { ok: true as const };
  }, []);

  const retrySave = useCallback((): boolean => {
    let currentRaw: string | null;
    try {
      currentRaw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    } catch {
      setStorageError({ code: "storage_read_failed", message: "브라우저 저장소를 읽을 수 없습니다." });
      return false;
    }
    if (currentRaw !== persistedRawRef.current) {
      setStorageError(conflictError());
      return false;
    }
    const saved = saveWorkspace(window.localStorage, workspaceRef.current);
    setStorageError(saved.ok ? null : saved.error);
    if (saved.ok) persistedRawRef.current = JSON.stringify(workspaceRef.current);
    return saved.ok;
  }, []);

  useEffect(() => {
    function detectExternalChange(event: StorageEvent) {
      if (event.storageArea === window.localStorage && event.key === WORKSPACE_STORAGE_KEY && event.newValue !== persistedRawRef.current) {
        setStorageError(conflictError());
      }
    }
    window.addEventListener("storage", detectExternalChange);
    return () => window.removeEventListener("storage", detectExternalChange);
  }, []);

  useEffect(() => {
    if (!storageError || !["storage_write_failed", "storage_conflict"].includes(storageError.code)) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [storageError]);

  const exportBackup = useCallback(() => exportWorkspace(workspaceRef.current), []);

  return {
    workspace,
    activeProject,
    hydrated,
    storageError,
    corruptedBackup,
    retrySave,
    createNewProject,
    selectProject,
    updateProject,
    removeProject,
    recoverStorage,
    importBackup,
    exportBackup,
  };
}
