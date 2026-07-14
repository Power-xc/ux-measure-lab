"use client";

import { type ChangeEvent, useRef, useState } from "react";
import type {
  ProjectProgress,
  WorkflowSection,
} from "../../features/project-workflow/lib/project-workflow";
import styles from "./measure-workspace.module.css";

type MacroPhase = {
  label: string;
  sections: readonly WorkflowSection[];
};

const MACRO_PHASES: readonly MacroPhase[] = [
  { label: "Product Context", sections: ["context", "metric"] },
  { label: "Funnel Diagnosis", sections: ["funnel", "diagnosis", "hypothesis"] },
  { label: "Experiment Result", sections: ["experiment", "result", "decision"] },
];

type WorkspaceHeaderProps = {
  activeSection: WorkflowSection;
  projectName: string;
  progress: ProjectProgress;
  onSelectSection(section: WorkflowSection): void;
  onExport(): string;
  onImport(text: string): { ok: true } | { ok: false; message: string };
  onDelete(): void;
};

function phaseIncludes(phase: MacroPhase, section: WorkflowSection): boolean {
  return phase.sections.some((candidate) => candidate === section);
}

function getPhaseTarget(phase: MacroPhase, activeSection: WorkflowSection, progress: ProjectProgress): WorkflowSection {
  if (phaseIncludes(phase, activeSection)) return activeSection;
  return phase.sections.find((section) => !progress.sections[section]) ?? phase.sections[0];
}

function isPhaseComplete(phase: MacroPhase, progress: ProjectProgress): boolean {
  return phase.sections.every((section) => progress.sections[section]);
}

function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 1_048_576) {
      setMessage("백업 파일은 1MB 이하여야 합니다.");
      return;
    }
    if (!window.confirm("복원하면 현재 워크스페이스 전체가 교체됩니다. 현재 상태를 자동 백업한 뒤 계속할까요?")) return;
    try {
      downloadText("ux-measure-lab-before-restore.json", props.onExport(), "application/json");
      const result = props.onImport(await file.text());
      setMessage(result.ok ? "백업을 복원했습니다." : result.message);
    } catch {
      setMessage("백업 파일을 읽지 못했습니다. JSON 파일인지 확인하세요.");
    }
  }

  function handleDelete() {
    if (window.confirm(`“${props.projectName}” 프로젝트를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) props.onDelete();
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.headerProject}><p>Personal workspace</p><h1>{props.projectName}</h1></div>
      <nav aria-label="제품 측정 단계" className={styles.phaseNav}>
        {MACRO_PHASES.map((phase, index) => {
          const active = phaseIncludes(phase, props.activeSection);
          const complete = isPhaseComplete(phase, props.progress);
          return (
            <button
              aria-current={active ? "step" : undefined}
              className={active ? styles.phaseActive : styles.phaseButton}
              key={phase.label}
              onClick={() => props.onSelectSection(getPhaseTarget(phase, props.activeSection, props.progress))}
              type="button"
            >
              <span className={complete ? styles.phaseStepDone : styles.phaseStep}>{complete ? "✓" : index + 1}</span>
              <span className={styles.phaseLabel}>{phase.label}</span>
            </button>
          );
        })}
      </nav>
      <div className={styles.headerActions}>
        <span className={styles.progressLabel}>{props.progress.completed}/{props.progress.total} 완료</span>
        <button className={styles.secondaryButton} onClick={() => downloadText("ux-measure-lab-backup.json", props.onExport(), "application/json")} type="button">백업</button>
        <button className={styles.secondaryButton} onClick={() => inputRef.current?.click()} type="button">복원</button>
        <input accept="application/json,.json" className={styles.visuallyHidden} onChange={handleImport} ref={inputRef} tabIndex={-1} type="file" />
        <button className={styles.dangerButton} onClick={handleDelete} type="button">삭제</button>
      </div>
      {message ? <p className={styles.headerMessage} role="status">{message}</p> : null}
    </header>
  );
}
