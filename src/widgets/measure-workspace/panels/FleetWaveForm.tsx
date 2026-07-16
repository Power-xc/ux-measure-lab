"use client";

import { type FormEvent, useState } from "react";
import type { FleetPlan, FleetVariantObservation, FleetWaveRecord } from "../../../entities/fleet/model";
import { evaluateFleetWave } from "../../../features/experiment-fleet/lib/evaluate-fleet-wave";
import { FleetValidationError } from "../../../features/experiment-fleet/lib/validate-fleet-plan";
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
  onRecord(record: FleetWaveRecord): boolean;
};

function emptyRow(): VariantRow {
  return { converted: 0, total: 400, guardrailConverted: 0, guardrailTotal: 400 };
}

export function FleetWaveForm(props: FleetWaveFormProps) {
  const [baseline, setBaseline] = useState({ converted: 100, total: 1000 });
  const [guardrailBaseline, setGuardrailBaseline] = useState({ converted: 0, total: 1000 });
  const [observedDays, setObservedDays] = useState(props.plan.policy.plannedDaysPerWave);
  const [rows, setRows] = useState<Record<string, VariantRow>>(
    () => Object.fromEntries(props.activeVariantIds.map((id) => [id, emptyRow()])),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const names = new Map(props.plan.variants.map((variant) => [variant.id, variant.name]));

  function setRow(variantId: string, key: keyof VariantRow, value: number) {
    setRows((current) => ({ ...current, [variantId]: { ...(current[variantId] ?? emptyRow()), [key]: value } }));
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
