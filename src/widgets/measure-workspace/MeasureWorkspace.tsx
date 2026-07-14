"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Decision } from "../../entities/decision/model";
import type { ExperimentPlan, ExperimentResult } from "../../entities/experiment/model";
import type {
  Evidence,
  FrictionCandidate,
  FunnelImport,
  Hypothesis,
  MetricDefinition,
  Project,
  ProjectContext,
} from "../../entities/project/model";
import { getProjectProgress, type WorkflowSection } from "../../features/project-workflow/lib/project-workflow";
import { useWorkspace } from "../../features/project-workflow/model/use-workspace";
import {
  applyContext,
  applyDecision,
  applyExperiment,
  applyFunnel,
  applyHypothesis,
  applyMetric,
  applyResult,
  contextChanged,
  experimentChanged,
  funnelChanged,
  hypothesisChanged,
  metricChanged,
  resultChanged,
} from "../../features/project-workflow/lib/project-updates";
import { NewProjectDialog } from "./NewProjectDialog";
import { WorkspaceEmpty } from "./WorkspaceEmpty";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { ContextPanel } from "./panels/ContextPanel";
import { DecisionPanel } from "./panels/DecisionPanel";
import { DiagnosisPanel } from "./panels/DiagnosisPanel";
import { ExperimentPanel } from "./panels/ExperimentPanel";
import { FunnelPanel } from "./panels/FunnelPanel";
import { HypothesisPanel } from "./panels/HypothesisPanel";
import { MetricPanel } from "./panels/MetricPanel";
import { ValidationPanel } from "./panels/ValidationPanel";
import styles from "./measure-workspace.module.css";

export function MeasureWorkspace() {
  const controller = useWorkspace();
  const [activeSection, setActiveSection] = useState<WorkflowSection>("context");
  const [showNewProject, setShowNewProject] = useState(false);
  const [panelEpoch, setPanelEpoch] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const focusPanelRef = useRef(false);
  const project = controller.activeProject;
  const projectId = project?.id ?? null;
  const progress = useMemo(() => project ? getProjectProgress(project) : null, [project]);

  useEffect(() => {
    if (!projectId || !focusPanelRef.current) return;
    focusPanelRef.current = false;
    mainRef.current?.focus({ preventScroll: true });
  }, [activeSection, panelEpoch, projectId]);

  function selectSection(section: WorkflowSection) {
    focusPanelRef.current = true;
    setActiveSection(section);
  }

  function createProject(name: string): boolean {
    const created = controller.createNewProject(name);
    if (!created) return false;
    setShowNewProject(false);
    selectSection("context");
    return true;
  }

  function restoreBackup(text: string) {
    const result = controller.importBackup(text);
    if (result.ok) {
      focusPanelRef.current = true;
      setPanelEpoch((current) => current + 1);
      setActiveSection("context");
    }
    return result;
  }

  function confirmReset(changed: boolean, hasDescendants: boolean, message: string): boolean {
    return !changed || !hasDescendants || window.confirm(message);
  }

  if (!project || !progress) {
    return <WorkspaceEmpty corruptedBackup={controller.corruptedBackup} hydrated={controller.hydrated} onCreate={createProject} onImport={restoreBackup} onRecover={controller.recoverStorage} storageError={controller.storageError} />;
  }
  const activeProject = project;

  function update(updateProject: (current: Project) => Project): boolean {
    return controller.updateProject(activeProject.id, updateProject);
  }

  function saveContext(context: ProjectContext): boolean {
    const allowed = confirmReset(
      contextChanged(activeProject.context, context),
      activeProject.metric !== null,
      "제품 맥락을 변경하면 KPI부터 Decision까지 초기화됩니다. 계속할까요?",
    );
    if (!allowed) return false;
    return update((current) => applyContext(current, context, new Date().toISOString()));
  }

  function saveMetric(metric: MetricDefinition): boolean {
    const allowed = confirmReset(
      metricChanged(activeProject.metric, metric),
      activeProject.evidence.length > 0 || activeProject.hypothesis !== null,
      "KPI 정의를 변경하면 진단부터 Decision까지 초기화됩니다. 퍼널 원본은 유지됩니다. 계속할까요?",
    );
    if (!allowed) return false;
    return update((current) => applyMetric(current, metric, new Date().toISOString()));
  }

  function saveFunnel(funnelImport: FunnelImport): boolean {
    const allowed = confirmReset(
      funnelChanged(activeProject.funnelImport, funnelImport),
      activeProject.evidence.length > 0 || activeProject.hypothesis !== null,
      "퍼널 데이터를 변경하면 진단부터 Decision까지 초기화됩니다. 계속할까요?",
    );
    if (!allowed) return false;
    return update((current) => applyFunnel(current, funnelImport, new Date().toISOString()));
  }

  function saveDiagnosis(evidence: Evidence[], frictionCandidate: FrictionCandidate, hypothesis: Hypothesis): boolean {
    const hasDescendants = activeProject.experiment !== null || activeProject.experimentResult !== null || activeProject.decision !== null;
    if (hasDescendants && !window.confirm("진단 또는 가설 초안을 변경하면 기존 실험 결과와 Decision이 초기화됩니다. 계속할까요?")) return false;
    return update((current) => ({ ...current, evidence, frictionCandidate, hypothesis, experiment: null, experimentResult: null, decision: null, updatedAt: new Date().toISOString() }));
  }

  function saveHypothesis(hypothesis: Hypothesis): boolean {
    const allowed = confirmReset(
      hypothesisChanged(activeProject.hypothesis, hypothesis),
      activeProject.experiment !== null,
      "가설을 변경하면 실험 결과와 Decision이 초기화됩니다. 계속할까요?",
    );
    if (!allowed) return false;
    return update((current) => applyHypothesis(current, hypothesis, new Date().toISOString()));
  }

  function saveExperiment(experiment: ExperimentPlan): boolean {
    const allowed = confirmReset(
      experimentChanged(activeProject.experiment, experiment),
      activeProject.experimentResult !== null,
      "사전 등록 기준을 변경하면 기존 결과와 Decision이 초기화됩니다. 계속할까요?",
    );
    if (!allowed) return false;
    return update((current) => applyExperiment(current, experiment, new Date().toISOString()));
  }

  function saveResult(experimentResult: ExperimentResult): boolean {
    const allowed = confirmReset(
      resultChanged(activeProject.experimentResult, experimentResult),
      activeProject.decision !== null,
      "실험 결과를 변경하면 기존 Decision이 초기화됩니다. 계속할까요?",
    );
    if (!allowed) return false;
    return update((current) => applyResult(current, experimentResult, new Date().toISOString()));
  }

  function saveDecision(decision: Decision): boolean {
    return update((current) => applyDecision(current, decision, new Date().toISOString()));
  }

  function selectProject(projectId: string) {
    if (controller.selectProject(projectId)) selectSection("context");
  }

  function removeProject() {
    if (controller.removeProject(activeProject.id)) selectSection("context");
  }

  const panelKey = `${activeProject.id}:${panelEpoch}`;
  const panels: Record<WorkflowSection, ReactNode> = {
    context: <ContextPanel key={`${panelKey}:context`} onNext={() => selectSection("metric")} onSave={saveContext} project={activeProject} />,
    metric: <MetricPanel key={`${panelKey}:metric`} contextComplete={progress.sections.context} onBack={() => selectSection("context")} onNext={() => selectSection("funnel")} onSave={saveMetric} project={activeProject} />,
    funnel: <FunnelPanel key={`${panelKey}:funnel`} onBack={() => selectSection("metric")} onNext={() => selectSection("diagnosis")} onSave={saveFunnel} project={activeProject} />,
    diagnosis: <DiagnosisPanel key={`${panelKey}:diagnosis`} onBack={() => selectSection("funnel")} onNext={() => selectSection("hypothesis")} onSave={saveDiagnosis} project={activeProject} />,
    hypothesis: <HypothesisPanel key={`${panelKey}:hypothesis`} onBack={() => selectSection("diagnosis")} onNext={() => selectSection("experiment")} onSave={saveHypothesis} project={activeProject} />,
    experiment: <ExperimentPanel key={`${panelKey}:experiment`} onBack={() => selectSection("hypothesis")} onNext={() => selectSection("result")} onSave={saveExperiment} project={activeProject} />,
    result: <ValidationPanel key={`${panelKey}:result`} onBack={() => selectSection("experiment")} onNext={() => selectSection("decision")} onSave={saveResult} project={activeProject} />,
    decision: <DecisionPanel key={`${panelKey}:decision`} onBack={() => selectSection("result")} onSave={saveDecision} project={activeProject} />,
  };

  return (
    <>
      <a className={styles.skipLink} href="#workspace-content" tabIndex={0}>본문으로 건너뛰기</a>
      <div className={styles.appShell}>
        <WorkspaceSidebar activeProjectId={controller.workspace.activeProjectId} activeSection={activeSection} onNewProject={() => setShowNewProject(true)} onSelectProject={selectProject} onSelectSection={selectSection} progress={progress} projects={controller.workspace.projects} />
        <div className={styles.mainColumn}>
          <WorkspaceHeader activeSection={activeSection} onDelete={removeProject} onExport={controller.exportBackup} onImport={restoreBackup} onSelectSection={selectSection} progress={progress} projectName={activeProject.name} />
          {controller.storageError ? <div className={styles.storageWarning} role="alert"><span>{controller.storageError.message} JSON 백업을 내려받아 데이터를 보존하세요.</span>{controller.storageError.code === "storage_write_failed" ? <button className={styles.secondaryButton} onClick={controller.retrySave} type="button">저장 재시도</button> : null}</div> : null}
          <main aria-labelledby="active-panel-title" className={styles.workspaceContent} id="workspace-content" ref={mainRef} tabIndex={-1}>{panels[activeSection]}</main>
        </div>
        <NewProjectDialog onClose={() => setShowNewProject(false)} onCreate={createProject} open={showNewProject} />
      </div>
    </>
  );
}
