"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Evidence, Project } from "../../../entities/project/model";
import { createFirstPartyClientAdapter, createPostHogClientAdapter } from "../../../features/harness/adapters/http-client";
import { getAvailableHarnessSkills, getHarnessSkill, supportsHarnessSkill, type HarnessSkillId } from "../../../features/harness/catalog";
import type { MeasurementOutcome, MeasurementQuery, NormalizedMeasurement, TimeWindow } from "../../../features/harness/contract";
import { getHarnessSessionCache } from "../../../features/harness/model/harness-session-cache";
import { applyMeasurementEvidence } from "../../../features/harness/model/measurement-evidence";
import { Field } from "./PanelPrimitives";
import styles from "./panels.module.css";

type Signal = "rage" | "dead" | "error";
type WindowInput = { from: string; to: string };
type SectionProps = { project: Project; onApplyEvidence(evidence: Evidence[]): boolean };

const SIGNALS: readonly { id: Signal; label: string }[] = [
  { id: "rage", label: "반복 클릭" },
  { id: "dead", label: "반응 없는 클릭" },
  { id: "error", label: "오류" },
];
const skills = getAvailableHarnessSkills();
const sessionCache = getHarnessSessionCache();

function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function initialWindow(): WindowInput {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1_000);
  return { from: localDateTime(from), to: localDateTime(to) };
}

function parseWindow(input: WindowInput): TimeWindow | string {
  if (!input.from || !input.to) return "측정 기간을 입력하세요.";
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) return "종료 시각은 시작 시각보다 늦어야 합니다.";
  return { from: from.toISOString(), to: to.toISOString() };
}

function buildQuery(input: {
  skillId: HarnessSkillId;
  project: Project;
  window: WindowInput;
  signals: Signal[];
  target: string;
  startEvent: string;
  endEvent: string;
  dimension: string;
}): MeasurementQuery | string {
  const window = parseWindow(input.window);
  if (typeof window === "string") return window;
  if (input.skillId === "funnel" || input.skillId === "fleet") {
    const steps = input.project.funnelImport?.steps.map((step) => step.id) ?? [];
    if (steps.length < 2) return "퍼널 단계가 두 개 이상 필요합니다.";
    if (input.skillId === "funnel") return { capability: "funnel", steps, window };
    const dimension = input.dimension.trim();
    return dimension ? { capability: "segments", steps, dimension, window } : "변형 배정 속성 키를 입력하세요.";
  }
  if (input.skillId === "interaction") {
    if (input.signals.length === 0) return "마찰 신호를 하나 이상 선택하세요.";
    const target = input.target.trim();
    return target ? { capability: "interaction", signals: input.signals, target, window } : { capability: "interaction", signals: input.signals, window };
  }
  if (input.skillId === "paths") {
    if (!input.startEvent || !input.endEvent) return "시작과 도달 이벤트를 선택하세요.";
    if (input.startEvent === input.endEvent) return "시작과 도달 이벤트는 달라야 합니다.";
    return { capability: "paths", startEvent: input.startEvent, endEvent: input.endEvent, window };
  }
  return "아직 실행할 수 없는 질문 유형입니다.";
}

function WindowFields(props: { value: WindowInput; onChange(value: WindowInput): void }) {
  return <div className={styles.twoColumns}>
    <Field htmlFor="harness-window-from" label="측정 시작"><input onChange={(event) => props.onChange({ ...props.value, from: event.target.value })} type="datetime-local" value={props.value.from} /></Field>
    <Field htmlFor="harness-window-to" label="측정 종료"><input onChange={(event) => props.onChange({ ...props.value, to: event.target.value })} type="datetime-local" value={props.value.to} /></Field>
  </div>;
}

function QueryParameters(props: {
  skillId: HarnessSkillId; project: Project; window: WindowInput; signals: Signal[]; target: string;
  startEvent: string; endEvent: string; dimension: string; onWindow(value: WindowInput): void; onSignals(value: Signal[]): void;
  onTarget(value: string): void; onStart(value: string): void; onEnd(value: string): void; onDimension(value: string): void;
}) {
  const steps = props.project.funnelImport?.steps ?? [];
  const toggleSignal = (signal: Signal) => props.onSignals(props.signals.includes(signal) ? props.signals.filter((item) => item !== signal) : [...props.signals, signal]);
  return <>
    {props.skillId === "funnel" || props.skillId === "fleet" ? <div className={styles.harnessParameterBlock}><strong>측정할 퍼널 단계</strong><ol>{steps.map((step) => <li key={step.id}>{step.label} <small>({step.id})</small></li>)}</ol></div> : null}
    {props.skillId === "fleet" ? <Field helper="이벤트 props에서 변형 배정을 담는 키" htmlFor="harness-dimension" label="변형 배정 속성 키"><input maxLength={100} onChange={(event) => props.onDimension(event.target.value)} value={props.dimension} /></Field> : null}
    {props.skillId === "interaction" ? <>
      <fieldset className={styles.harnessSignalGroup}><legend>마찰 신호</legend>{SIGNALS.map((signal) => <label key={signal.id}><input checked={props.signals.includes(signal.id)} onChange={() => toggleSignal(signal.id)} type="checkbox" />{signal.label}</label>)}</fieldset>
      <Field htmlFor="harness-target" label="대상 경로 또는 요소" required={false}><input maxLength={500} onChange={(event) => props.onTarget(event.target.value)} placeholder="예: /signup 또는 [data-action=connect]" value={props.target} /></Field>
    </> : null}
    {props.skillId === "paths" ? <div className={styles.twoColumns}>
      <Field htmlFor="harness-start-event" label="시작 이벤트"><select onChange={(event) => props.onStart(event.target.value)} value={props.startEvent}>{steps.map((step) => <option key={step.id} value={step.id}>{step.label}</option>)}</select></Field>
      <Field htmlFor="harness-end-event" label="도달 이벤트"><select onChange={(event) => props.onEnd(event.target.value)} value={props.endEvent}>{steps.map((step) => <option key={step.id} value={step.id}>{step.label}</option>)}</select></Field>
    </div> : null}
    <WindowFields onChange={props.onWindow} value={props.window} />
  </>;
}

function MeasurementCard({ measurement }: { measurement: NormalizedMeasurement }) {
  return <article className={styles.harnessResultCard}>
    <div className={styles.cardHeader}><div><span>OBSERVED DATA</span><h3>{measurement.metricLabel}</h3></div><strong className={styles.strengthBadge}>신뢰 등급 {measurement.confidence.level}</strong></div>
    <p>{measurement.observation}</p>
    <dl className={styles.harnessValueList}>{Object.entries(measurement.values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value.toLocaleString("ko-KR")}</dd></div>)}</dl>
    <div className={styles.candidateSection}><h4>출처와 표본</h4><p>{measurement.provenance.source} · {measurement.provenance.period} · {measurement.provenance.segment}</p><small>표본 {measurement.confidence.sampleSize.toLocaleString("ko-KR")} · {measurement.provenance.adapterId} · {measurement.provenance.capability} · {measurement.provenance.queryHash.slice(0, 12)}</small><small>{new Date(measurement.provenance.observedAt).toLocaleString("ko-KR")}</small></div>
    <div className={styles.candidateSection}><h4>신뢰 등급 근거</h4><p>{measurement.confidence.basis}</p></div>
    <div className={styles.candidateSection}><h4>해석 한계</h4><p>{measurement.confidence.limits}</p></div>
  </article>;
}

function OutcomeView(props: { outcome: MeasurementOutcome; applied: boolean; applyError: string; onApply(): void }) {
  if (!props.outcome.ok) {
    const title = props.outcome.code === "insufficient_sample" ? "표본 부족" : props.outcome.code === "rate_limited" ? "요청 한도 도달" : "측정할 수 없음";
    const retry = props.outcome.code === "rate_limited" && props.outcome.retryAfterMs !== undefined
      ? `${Math.ceil(props.outcome.retryAfterMs / 1_000)}초 후 다시 시도할 수 있습니다.`
      : "";
    return <div className={styles.harnessFailure} data-code={props.outcome.code} role="alert"><strong>{title}</strong><p>{props.outcome.message}</p>{retry ? <small>{retry}</small> : null}</div>;
  }
  if (props.outcome.measurements.some((measurement) => measurement.confidence.sampleSize <= 0)) {
    return <div className={styles.harnessFailure} data-code="insufficient_sample" role="alert"><strong>표본 부족</strong><p>실제 표본이 확인되지 않아 측정값을 표시하거나 Evidence로 적용할 수 없습니다.</p></div>;
  }
  return <div aria-live="polite" className={styles.harnessResults}>
    {props.outcome.measurements.map((measurement) => <MeasurementCard key={`${measurement.provenance.queryHash}:${measurement.metricLabel}`} measurement={measurement} />)}
    {props.outcome.degraded.length > 0 ? <div className={styles.harnessFailure}><strong>일부 결과 제한</strong><ul>{props.outcome.degraded.map((note) => <li key={`${note.capability}:${note.reason}`}>{note.detail}</li>)}</ul></div> : null}
    <div className={styles.inlineActions}><button className={styles.primaryButton} disabled={props.applied} onClick={props.onApply} type="button">{props.applied ? "Evidence 적용 완료" : "Evidence로 적용"}</button><small>이 버튼을 누르기 전에는 프로젝트가 변경되지 않습니다.</small></div>
    {props.applyError ? <p className={styles.contextError} role="alert">{props.applyError}</p> : null}
    {props.applied ? <p role="status">측정 결과가 프로젝트 Evidence에 적용되었습니다.</p> : null}
  </div>;
}

export function HarnessEvidenceSection({ project, onApplyEvidence }: SectionProps) {
  const adapters = useMemo(() => [createFirstPartyClientAdapter(), createPostHogClientAdapter()], []);
  const request = useRef<AbortController | null>(null);
  const questionDirty = useRef(false);
  const [question, setQuestion] = useState("");
  const [skillId, setSkillId] = useState<HarnessSkillId>("funnel");
  const [adapterId, setAdapterId] = useState("first-party");
  const [windowInput, setWindowInput] = useState<WindowInput>(initialWindow);
  const [signals, setSignals] = useState<Signal[]>(["rage"]);
  const [target, setTarget] = useState("");
  const [dimension, setDimension] = useState("variant");
  const steps = project.funnelImport?.steps ?? [];
  const [startEvent, setStartEvent] = useState(steps[0]?.id ?? "");
  const [endEvent, setEndEvent] = useState(steps.at(-1)?.id ?? "");
  const [outcome, setOutcome] = useState<MeasurementOutcome | null>(null);
  const [error, setError] = useState("");
  const [applyError, setApplyError] = useState("");
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const skill = getHarnessSkill(skillId) ?? skills[0];
  const matchingAdapters = adapters.filter((adapter) => skill && supportsHarnessSkill(skill, (capability) => adapter.supports(capability)));

  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    questionDirty.current = false;
    const frame = window.requestAnimationFrame(() => {
      if (questionDirty.current) return;
      try { setQuestion((sessionStorage.getItem(`ux-measure-lab:harness-question:${project.id}`) ?? "").slice(0, 500)); } catch { setQuestion(""); }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [project.id]);

  function invalidateMeasurement() {
    request.current?.abort();
    request.current = null;
    setBusy(false); setOutcome(null); setApplied(false); setError(""); setApplyError("");
  }

  function changeMeasurement(change: () => void) { invalidateMeasurement(); change(); }

  function updateQuestion(value: string) {
    questionDirty.current = true;
    invalidateMeasurement();
    setQuestion(value);
    try { sessionStorage.setItem(`ux-measure-lab:harness-question:${project.id}`, value); } catch { return; }
  }

  function selectSkill(value: string) {
    const next = getHarnessSkill(value);
    if (!next?.available) return;
    const availableAdapters = adapters.filter((adapter) => supportsHarnessSkill(next, (capability) => adapter.supports(capability)));
    if (!availableAdapters.some((adapter) => adapter.meta().adapterId === adapterId)) {
      setAdapterId(availableAdapters[0]?.meta().adapterId ?? "");
    }
    invalidateMeasurement();
    setSkillId(next.id);
  }

  async function execute() {
    setOutcome(null); setApplied(false); setApplyError(""); setError("");
    if (!question.trim()) { setError("측정 질문을 입력하세요."); return; }
    const query = buildQuery({ skillId, project, window: windowInput, signals, target, startEvent, endEvent, dimension });
    if (typeof query === "string") { setError(query); return; }
    const adapter = matchingAdapters.find((item) => item.meta().adapterId === adapterId);
    if (!adapter) { setError("질문 유형을 지원하는 측정 소스를 선택하세요."); return; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller; setBusy(true);
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const nextOutcome = await adapter.measure(query, { signal: controller.signal, now: new Date().toISOString(), cache: sessionCache });
      if (request.current === controller) setOutcome(nextOutcome);
    } catch {
      if (request.current === controller) setError("측정 요청을 완료하지 못했습니다.");
    }
    finally { window.clearTimeout(timeout); if (request.current === controller) { request.current = null; setBusy(false); } }
  }

  function applyEvidence() {
    if (!outcome?.ok) return;
    try {
      if (applyMeasurementEvidence(outcome.measurements, onApplyEvidence)) { setApplied(true); setApplyError(""); }
      else setApplyError("Evidence를 적용하지 못했습니다.");
    } catch { setApplyError("Evidence를 적용하지 못했습니다."); }
  }

  return <section aria-labelledby="harness-title" className={styles.harnessSection}>
    <header><span>MEASUREMENT HARNESS</span><h3 id="harness-title">행동 데이터로 증거 추가</h3><p>질문을 검증 가능한 행동 측정으로 바꿉니다. 결과는 검토 후 명시적으로 적용해야 저장됩니다.</p></header>
    <div className={styles.form}>
      <Field htmlFor="harness-question" label="측정 질문"><textarea maxLength={500} onChange={(event) => updateQuestion(event.target.value)} placeholder="예: 가입 퍼널에서 가장 큰 이탈은 어디인가요?" rows={3} value={question} /></Field>
      {skill?.exampleQuestions[0] ? <button className={styles.textButton} onClick={() => updateQuestion(skill.exampleQuestions[0] ?? "")} type="button">예시 질문 사용: {skill.exampleQuestions[0]}</button> : null}
      <Field htmlFor="harness-skill" label="질문 유형"><select onChange={(event) => selectSkill(event.target.value)} value={skillId}>{skills.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <QueryParameters dimension={dimension} endEvent={endEvent} onDimension={(value) => changeMeasurement(() => setDimension(value))} onEnd={(value) => changeMeasurement(() => setEndEvent(value))} onSignals={(value) => changeMeasurement(() => setSignals(value))} onStart={(value) => changeMeasurement(() => setStartEvent(value))} onTarget={(value) => changeMeasurement(() => setTarget(value))} onWindow={(value) => changeMeasurement(() => setWindowInput(value))} project={project} signals={signals} skillId={skillId} startEvent={startEvent} target={target} window={windowInput} />
      <Field htmlFor="harness-adapter" label="측정 소스"><select onChange={(event) => changeMeasurement(() => setAdapterId(event.target.value))} value={adapterId}>{matchingAdapters.map((adapter) => { const meta = adapter.meta(); return <option key={meta.adapterId} value={meta.adapterId}>{meta.displayName}</option>; })}</select></Field>
      {error ? <p className={styles.contextError} role="alert">{error}</p> : null}
      <div className={styles.formActions}><button aria-busy={busy} className={styles.primaryButton} disabled={busy || matchingAdapters.length === 0} onClick={execute} type="button">{busy ? "측정 중…" : "측정 실행"}</button><small>종료된 과거 기간의 동일 조건은 현재 세션 캐시를 재사용합니다.</small></div>
    </div>
    {outcome ? <OutcomeView applied={applied} applyError={applyError} onApply={applyEvidence} outcome={outcome} /> : null}
  </section>;
}
