import type { Project } from "../../entities/project/model";
import {
  WORKFLOW_SECTIONS,
  type ProjectProgress,
  type WorkflowSection,
} from "../../features/project-workflow/lib/project-workflow";
import styles from "./measure-workspace.module.css";

const sectionLabels: Record<WorkflowSection, { title: string; helper: string }> = {
  context: { title: "Context", helper: "제품 맥락" },
  metric: { title: "KPI", helper: "측정 기준" },
  funnel: { title: "Measure", helper: "퍼널 데이터" },
  diagnosis: { title: "Diagnose", helper: "마찰 후보" },
  hypothesis: { title: "Hypothesis", helper: "검증 가설" },
  experiment: { title: "Experiment", helper: "사전 등록" },
  result: { title: "Validate", helper: "결과 판정" },
  decision: { title: "Decide", helper: "결정·리포트" },
};

type WorkspaceSidebarProps = {
  projects: Project[];
  activeProjectId: string | null;
  activeSection: WorkflowSection;
  progress: ProjectProgress | null;
  onSelectProject(projectId: string): void;
  onSelectSection(section: WorkflowSection): void;
  onNewProject(): void;
};

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span aria-label="UX MeasureLab" className={styles.brandWordmark} role="img">
          <span className={styles.brandUx}>UX</span>
          <span className={styles.brandMeasure}>Measure</span>
          <span className={styles.brandLab}>Lab</span>
        </span>
      </div>
      <label className={styles.projectLabel} htmlFor="project-switcher">PROJECT</label>
      <select
        className={styles.projectSelect}
        id="project-switcher"
        onChange={(event) => props.onSelectProject(event.target.value)}
        value={props.activeProjectId ?? ""}
      >
        {props.projects.length === 0 ? <option value="">프로젝트 없음</option> : null}
        {props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <button className={styles.newProjectButton} onClick={props.onNewProject} type="button">+ 새 프로젝트</button>

      <nav aria-label="Measure Loop" className={styles.sectionNav}>
        {WORKFLOW_SECTIONS.map((section, index) => {
          const label = sectionLabels[section];
          const complete = props.progress?.sections[section] ?? false;
          return (
            <button
              aria-current={props.activeSection === section ? "step" : undefined}
              className={props.activeSection === section ? styles.sectionActive : styles.sectionButton}
              key={section}
              onClick={() => props.onSelectSection(section)}
              type="button"
            >
              <span className={complete ? styles.stepDone : styles.stepNumber}>{complete ? "✓" : index + 1}</span>
              <span><strong>{label.title}</strong><small>{label.helper}</small></span>
            </button>
          );
        })}
      </nav>

      <div className={styles.localBadge}><span>Local-first</span><small>이 브라우저에 자동 저장</small></div>
    </aside>
  );
}
