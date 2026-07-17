"use client";

import { type FormEvent, useRef, useState } from "react";
import type { FleetPlan, FleetVariantObservation, FleetWaveRecord } from "../../../entities/fleet/model";
import { evaluateFleetWave } from "../../../features/experiment-fleet/lib/evaluate-fleet-wave";
import { FleetValidationError } from "../../../features/experiment-fleet/lib/validate-fleet-plan";
import { buildWavePrefill } from "../../../features/experiment-fleet/lib/wave-prefill";
import { createFirstPartyClientAdapter } from "../../../features/harness/adapters/http-client";
import { getHarnessSessionCache } from "../../../features/harness/model/harness-session-cache";
import { ErrorSummary, Field } from "./PanelPrimitives";
import styles from "./panels.module.css";

type VariantRow = {
  converted: number;
  total: number;
  guardrailConverted: number;
  guardrailTotal: number;
};

type FleetWaveFormProps = {
  plan: FleetPlan;
  wave: number;
  sampleUsedBefore: number;
  activeVariantIds: string[];
  funnelStepIds: string[];
  confirmation: boolean;
  onRecord(record: FleetWaveRecord): boolean;
};

function emptyRow(): VariantRow {
  return { converted: 0, total: 400, guardrailConverted: 0, guardrailTotal: 400 };
}

function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function initialPrefillWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1_000);
  return { from: localDateTime(from), to: localDateTime(to) };
}

export function FleetWaveForm(props: FleetWaveFormProps) {
  const [baseline, setBaseline] = useState({ converted: 100, total: 1000 });
  const [guardrailBaseline, setGuardrailBaseline] = useState({ converted: 0, total: 1000 });
  const [observedDays, setObservedDays] = useState(props.plan.policy.plannedDaysPerWave);
  const [rows, setRows] = useState<Record<string, VariantRow>>(
    () => Object.fromEntries(props.activeVariantIds.map((id) => [id, emptyRow()])),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [prefillWindow, setPrefillWindow] = useState(initialPrefillWindow);
  const [dimension, setDimension] = useState("variant");
  const [baselineValue, setBaselineValue] = useState("baseline");
  const [prefillBusy, setPrefillBusy] = useState(false);
  const [prefillNote, setPrefillNote] = useState("");
  const prefillRequest = useRef<AbortController | null>(null);
  const names = new Map(props.plan.variants.map((variant) => [variant.id, variant.name]));

  function setRow(variantId: string, key: keyof VariantRow, value: number) {
    setRows((current) => ({ ...current, [variantId]: { ...(current[variantId] ?? emptyRow()), [key]: value } }));
  }

  async function prefillFromMeasurement() {
    setPrefillNote("");
    const from = new Date(prefillWindow.from);
    const to = new Date(prefillWindow.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
      setErrors(["측정 기간이 유효하지 않습니다."]);
      return;
    }
    if (!dimension.trim() || !baselineValue.trim()) {
      setErrors(["변형 배정 속성 키와 기준선 값을 입력하세요."]);
      return;
    }
    prefillRequest.current?.abort();
    const controller = new AbortController();
    prefillRequest.current = controller;
    setPrefillBusy(true);
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const outcome = await createFirstPartyClientAdapter().measure(
        { capability: "segments", steps: props.funnelStepIds, dimension: dimension.trim(), window: { from: from.toISOString(), to: to.toISOString() } },
        { signal: controller.signal, now: new Date().toISOString(), cache: getHarnessSessionCache() },
      );
      if (prefillRequest.current !== controller) return;
      if (!outcome.ok) {
        setErrors([outcome.message]);
        return;
      }
      const result = buildWavePrefill({
        measurements: outcome.measurements,
        dimension: dimension.trim(),
        baselineValue: baselineValue.trim(),
        variantIds: props.activeVariantIds,
      });
      if (!result.ok) {
        setErrors([result.error]);
        return;
      }
      setBaseline(result.prefill.baseline);
      setRows((current) => Object.fromEntries(result.prefill.variants.map(({ variantId, count }) => [
        variantId,
        { ...(current[variantId] ?? emptyRow()), converted: count.converted, total: count.total },
      ])));
      setErrors([]);
      setPrefillNote(`측정에서 기준선과 변형 ${result.prefill.variants.length}개의 전환 수치를 채웠습니다. Guardrail 수치는 자동으로 채워지지 않으니 직접 입력하세요.`);
    } catch {
      if (prefillRequest.current === controller) setErrors(["측정 요청을 완료하지 못했습니다."]);
    } finally {
      window.clearTimeout(timeout);
      if (prefillRequest.current === controller) {
        prefillRequest.current = null;
        setPrefillBusy(false);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const observations: FleetVariantObservation[] = props.activeVariantIds.map((variantId) => {
      const row = rows[variantId] ?? emptyRow();
      return {
        variantId,
        variant: { converted: row.converted, total: row.total },
        guardrailVariant: { converted: row.guardrailConverted, total: row.guardrailTotal },
        observedDays,
      };
    });
    const input = {
      wave: props.wave,
      baseline,
      guardrailBaseline,
      observations,
      sampleUsedBefore: props.sampleUsedBefore,
      ...(props.confirmation ? { confirmation: true } : {}),
    };
    try {
      const result = evaluateFleetWave({ ...input, plan: props.plan });
      if (!props.onRecord({ recordedAt: new Date().toISOString(), input, result })) return;
      setErrors([]);
    } catch (error) {
      setErrors([error instanceof FleetValidationError ? error.message : "웨이브를 판정하지 못했습니다."]);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <ErrorSummary errors={errors} />
      {props.confirmation ? (
        <p className={styles.observationNote} role="status">승격 확정 웨이브 — 승격 후보를 신규 표본으로 재검증합니다. 순위 선택에 쓴 표본과 분리해 승자의 저주를 완화합니다.</p>
      ) : null}
      {props.funnelStepIds.length >= 2 ? (
        <details className={styles.resultEditor}>
          <summary>측정에서 채우기 — first-party 변형별 관찰</summary>
          <div className={styles.threeColumns}>
            <Field helper="이벤트 props 키" htmlFor="fleet-prefill-dimension" label="변형 배정 속성 키"><input id="fleet-prefill-dimension" maxLength={100} onChange={(event) => setDimension(event.target.value)} value={dimension} /></Field>
            <Field helper="기준선 arm의 값" htmlFor="fleet-prefill-baseline" label="기준선 값"><input id="fleet-prefill-baseline" maxLength={100} onChange={(event) => setBaselineValue(event.target.value)} value={baselineValue} /></Field>
            <div className={styles.twoColumns}>
              <Field htmlFor="fleet-prefill-from" label="관찰 시작"><input id="fleet-prefill-from" onChange={(event) => setPrefillWindow((current) => ({ ...current, from: event.target.value }))} type="datetime-local" value={prefillWindow.from} /></Field>
              <Field htmlFor="fleet-prefill-to" label="관찰 종료"><input id="fleet-prefill-to" onChange={(event) => setPrefillWindow((current) => ({ ...current, to: event.target.value }))} type="datetime-local" value={prefillWindow.to} /></Field>
            </div>
          </div>
          <button aria-busy={prefillBusy} className={styles.secondaryButton} disabled={prefillBusy} onClick={prefillFromMeasurement} type="button">{prefillBusy ? "측정 중…" : "변형별 관찰 불러오기"}</button>
          {prefillNote ? <p className={styles.observationNote} role="status">{prefillNote}</p> : null}
        </details>
      ) : null}
      <div className={styles.resultGrid}>
        <fieldset>
          <legend>공유 기준선</legend>
          <Field htmlFor="fleet-baseline-converted" label="전환 사용자"><input id="fleet-baseline-converted" min="0" onChange={(event) => setBaseline((current) => ({ ...current, converted: Number(event.target.value) }))} type="number" value={baseline.converted} /></Field>
          <Field htmlFor="fleet-baseline-total" label="전체 사용자"><input id="fleet-baseline-total" min="1" onChange={(event) => setBaseline((current) => ({ ...current, total: Number(event.target.value) }))} type="number" value={baseline.total} /></Field>
        </fieldset>
        <fieldset>
          <legend>{props.plan.policy.guardrailMetricName} 기준선</legend>
          <Field htmlFor="fleet-guardrail-converted" label="발생 수"><input id="fleet-guardrail-converted" min="0" onChange={(event) => setGuardrailBaseline((current) => ({ ...current, converted: Number(event.target.value) }))} type="number" value={guardrailBaseline.converted} /></Field>
          <Field htmlFor="fleet-guardrail-total" label="전체 수"><input id="fleet-guardrail-total" min="1" onChange={(event) => setGuardrailBaseline((current) => ({ ...current, total: Number(event.target.value) }))} type="number" value={guardrailBaseline.total} /></Field>
        </fieldset>
        <fieldset>
          <legend>관찰 기간</legend>
          <Field helper={`계획 ${props.plan.policy.plannedDaysPerWave}일`} htmlFor="fleet-observed-days" label="실제 관찰 (일)"><input id="fleet-observed-days" min="0" onChange={(event) => setObservedDays(Number(event.target.value))} type="number" value={observedDays} /></Field>
        </fieldset>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <caption className={styles.visuallyHidden}>웨이브 {props.wave} 변형별 관찰 입력</caption>
          <thead><tr><th scope="col">변형</th><th scope="col">전환</th><th scope="col">전체</th><th scope="col">Guardrail 발생</th><th scope="col">Guardrail 전체</th></tr></thead>
          <tbody>
            {props.activeVariantIds.map((variantId) => {
              const row = rows[variantId] ?? emptyRow();
              const name = names.get(variantId) ?? variantId;
              return (
                <tr key={variantId}>
                  <th scope="row">{name}</th>
                  <td><input aria-label={`${name} 전환 사용자`} min="0" onChange={(event) => setRow(variantId, "converted", Number(event.target.value))} required type="number" value={row.converted} /></td>
                  <td><input aria-label={`${name} 전체 사용자`} min="1" onChange={(event) => setRow(variantId, "total", Number(event.target.value))} required type="number" value={row.total} /></td>
                  <td><input aria-label={`${name} guardrail 발생`} min="0" onChange={(event) => setRow(variantId, "guardrailConverted", Number(event.target.value))} required type="number" value={row.guardrailConverted} /></td>
                  <td><input aria-label={`${name} guardrail 전체`} min="1" onChange={(event) => setRow(variantId, "guardrailTotal", Number(event.target.value))} required type="number" value={row.guardrailTotal} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button className={styles.primaryButton} type="submit">웨이브 {props.wave} 판정</button>
    </form>
  );
}
