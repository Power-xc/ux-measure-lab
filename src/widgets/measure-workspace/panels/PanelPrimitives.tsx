"use client";

import { cloneElement, type AriaAttributes, type ReactElement, useEffect, useRef } from "react";
import styles from "./panels.module.css";

type PanelHeaderProps = {
  kicker: string;
  title: string;
  description: string;
  status?: string;
};

export function PanelHeader(props: PanelHeaderProps) {
  return (
    <header className={styles.panelHeader}>
      <div><span>{props.kicker}</span><h2 data-panel-heading id="active-panel-title" tabIndex={-1}>{props.title}</h2><p>{props.description}</p></div>
      {props.status ? <strong>{props.status}</strong> : null}
    </header>
  );
}

type FieldProps = {
  label: string;
  htmlFor: string;
  helper?: string;
  error?: string;
  required?: boolean;
  children: ReactElement<FieldControlProps>;
};

type FieldControlProps = {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

export function Field(props: FieldProps) {
  const required = props.required ?? true;
  const helperId = props.helper ? `${props.htmlFor}-helper` : null;
  const errorId = props.error ? `${props.htmlFor}-error` : null;
  const describedBy = [props.children.props["aria-describedby"], helperId, errorId].filter((value): value is string => Boolean(value)).join(" ") || undefined;
  const control = cloneElement(props.children, {
    id: props.htmlFor,
    required,
    "aria-describedby": describedBy,
    "aria-invalid": props.error ? true : props.children.props["aria-invalid"],
  });
  return (
    <div className={styles.field}>
      <label htmlFor={props.htmlFor}>{props.label}{required ? <span className={styles.requiredLabel}>필수</span> : null}</label>
      {control}
      {props.helper ? <small id={helperId ?? undefined}>{props.helper}</small> : null}
      {props.error ? <small className={styles.fieldError} id={errorId ?? undefined}>{props.error}</small> : null}
    </div>
  );
}

export function ErrorSummary({ errors }: { errors: string[] }) {
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length > 0) summaryRef.current?.focus();
  }, [errors]);
  if (errors.length === 0) return null;
  return <div className={styles.errorSummary} ref={summaryRef} role="alert" tabIndex={-1}><strong>입력을 확인하세요</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>;
}

export function LockedPanel({ message, onBack }: { message: string; onBack(): void }) {
  return (
    <section className={styles.lockedPanel}>
      <span>PREVIOUS STEP REQUIRED</span><h2 data-panel-heading id="active-panel-title" tabIndex={-1}>아직 이 단계를 시작할 수 없습니다</h2><p>{message}</p>
      <button className={styles.secondaryButton} onClick={onBack} type="button">이전 단계로 이동</button>
    </section>
  );
}
