"use client";

import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { MAX_NAME_LENGTH } from "../../shared/lib/input-policy";
import type { RepositoryError } from "../../shared/lib/project-repository";
import styles from "./measure-workspace.module.css";

type WorkspaceEmptyProps = {
  hydrated: boolean;
  storageError: RepositoryError | null;
  corruptedBackup: string | null;
  onCreate(name: string): boolean;
  onRecover(): boolean;
  onImport(text: string): { ok: true } | { ok: false; message: string };
};

function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function WorkspaceEmpty(props: WorkspaceEmptyProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || name.length > MAX_NAME_LENGTH) {
      setMessage(`프로젝트 이름은 1~${MAX_NAME_LENGTH}자여야 합니다.`);
      return;
    }
    if (!props.onCreate(name)) {
      setMessage("프로젝트를 저장하지 못했습니다. 저장소 상태를 확인하세요.");
      return;
    }
    setMessage("");
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 1_048_576) {
      setMessage("백업 파일은 1MB 이하여야 합니다.");
      return;
    }
    try {
      const result = props.onImport(await file.text());
      setMessage(result.ok ? "백업을 복원했습니다." : result.message);
    } catch {
      setMessage("백업 파일을 읽지 못했습니다.");
    }
  }

  function recover() {
    if (!window.confirm("손상된 저장 원본을 비우고 새 워크스페이스를 시작할까요? 먼저 원본을 내려받는 것을 권장합니다.")) return;
    if (!props.onRecover()) setMessage("새 워크스페이스를 저장하지 못했습니다.");
  }

  if (!props.hydrated) return <main className={styles.centeredState} aria-busy="true"><p>워크스페이스를 불러오는 중입니다.</p></main>;
  const recovering = props.corruptedBackup !== null || props.storageError?.code === "storage_read_failed";

  if (recovering) {
    return (
      <main className={styles.centeredState}>
        <span className={styles.stateKicker}>STORAGE RECOVERY</span>
        <h1>저장 데이터를 안전하게 열지 못했습니다</h1>
        <p>{props.storageError?.message} 기존 원본은 자동으로 덮어쓰지 않았습니다.</p>
        <div className={styles.emptyActions}>
          {props.corruptedBackup ? <button className={styles.secondaryButton} onClick={() => downloadText("ux-measure-lab-corrupted-backup.txt", props.corruptedBackup ?? "", "text/plain;charset=utf-8")} type="button">손상 원본 다운로드</button> : null}
          <button className={styles.secondaryButton} onClick={() => inputRef.current?.click()} type="button">정상 백업 복원</button>
          <button className={styles.primaryButton} onClick={recover} type="button">새 워크스페이스 시작</button>
        </div>
        <input accept="application/json,.json" className={styles.visuallyHidden} onChange={handleImport} ref={inputRef} tabIndex={-1} type="file" />
        {message ? <p role="status">{message}</p> : null}
      </main>
    );
  }

  return (
    <main className={styles.centeredState}>
      <span className={styles.stateKicker}>PERSONAL MEASUREMENT WORKSPACE</span>
      <h1>첫 제품 측정 루프를 시작하세요</h1>
      <p>제품 맥락과 CSV 퍼널을 연결해 이탈 관찰부터 실험 결정까지 한곳에 기록합니다.</p>
      {props.storageError ? <p role="alert">{props.storageError.message}</p> : null}
      <form className={styles.createForm} onSubmit={submit}>
        <label htmlFor="new-project-name">프로젝트 이름</label>
        <div><input id="new-project-name" maxLength={MAX_NAME_LENGTH} onChange={(event) => setName(event.target.value)} placeholder="예: UX MeasureLab Dogfood" value={name} /><button className={styles.primaryButton} type="submit">프로젝트 만들기</button></div>
        {message ? <p role="status">{message}</p> : null}
      </form>
      <button className={styles.secondaryButton} onClick={() => inputRef.current?.click()} type="button">기존 JSON 백업 복원</button>
      <input accept="application/json,.json" className={styles.visuallyHidden} onChange={handleImport} ref={inputRef} tabIndex={-1} type="file" />
    </main>
  );
}
