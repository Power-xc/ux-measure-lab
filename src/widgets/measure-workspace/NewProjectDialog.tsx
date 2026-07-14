"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { MAX_NAME_LENGTH } from "../../shared/lib/input-policy";
import styles from "./measure-workspace.module.css";

type NewProjectDialogProps = {
  open: boolean;
  onCreate(name: string): boolean;
  onClose(): void;
};

export function NewProjectDialog({ open, onCreate, onClose }: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    inputRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  function close() {
    setName("");
    setError("");
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || name.length > MAX_NAME_LENGTH) {
      setError(`프로젝트 이름은 1~${MAX_NAME_LENGTH}자여야 합니다.`);
      return;
    }
    if (!onCreate(name)) {
      setError("프로젝트를 저장하지 못했습니다. 저장소 상태를 확인하세요.");
      return;
    }
    setName("");
    setError("");
  }

  return (
    <dialog
      aria-describedby="new-project-description"
      aria-labelledby="new-project-title"
      className={styles.dialogBackdrop}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      ref={dialogRef}
    >
      <section className={styles.dialog}>
        <span>NEW MEASURE LOOP</span>
        <h2 id="new-project-title">새 프로젝트</h2>
        <p id="new-project-description">제품 맥락부터 Decision까지 독립적으로 저장됩니다.</p>
        <form onSubmit={submit}>
          <label htmlFor="dialog-project-name">프로젝트 이름</label>
          <input id="dialog-project-name" maxLength={MAX_NAME_LENGTH} onChange={(event) => setName(event.target.value)} ref={inputRef} value={name} />
          {error ? <p role="alert">{error}</p> : null}
          <div><button className={styles.secondaryButton} onClick={close} type="button">취소</button><button className={styles.primaryButton} type="submit">만들기</button></div>
        </form>
      </section>
    </dialog>
  );
}
