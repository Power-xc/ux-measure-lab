"use client";

import { type ChangeEvent, useMemo, useRef, useState } from "react";
import type { FunnelImport, Project } from "../../../entities/project/model";
import { parseFunnelCsv, validateFunnelCsvFile, type FunnelCsvIssue } from "../../../features/funnel-import/lib/parse-funnel-csv";
import { analyzeFunnel } from "../../../features/measure-loop/lib/calculate-funnel";
import { LockedPanel, PanelHeader } from "./PanelPrimitives";
import styles from "./panels.module.css";

const SAMPLE_CSV = "step_id,step_name,users\nlanding,랜딩 방문,2480\nsignup,가입 시작,1590\nconnect,데이터 연결,842\nreport,첫 리포트,611\nretain,7일 재방문,421";

type FunnelPanelProps = {
  project: Project;
  onSave(funnelImport: FunnelImport): boolean;
  onBack(): void;
  onNext(): void;
};

function downloadCsv(): void {
  const url = URL.createObjectURL(new Blob(["step_id,step_name,users\nlanding,랜딩 방문,1000\nsignup,가입 완료,600"], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "ux-measure-lab-funnel-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function FunnelPanel(props: FunnelPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [issues, setIssues] = useState<FunnelCsvIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const analysis = useMemo(
    () => props.project.funnelImport ? analyzeFunnel(props.project.funnelImport.steps) : null,
    [props.project.funnelImport],
  );
  const entryUsers = analysis?.steps[0]?.users ?? 0;
  const completedUsers = analysis?.steps.at(-1)?.users ?? 0;
  const largestDropIndex = analysis?.largestDropOff
    ? analysis.steps.findIndex((step) => step.id === analysis.largestDropOff?.id)
    : -1;
  const largestDropPrevious = largestDropIndex > 0 ? analysis?.steps[largestDropIndex - 1] : null;

  if (props.project.metric?.status !== "confirmed") return <LockedPanel message="KPI를 확정한 뒤 퍼널 데이터를 연결하세요." onBack={props.onBack} />;

  function saveCsv(text: string, fileName: string, mediaType: string, size: number, source: "csv" | "sample") {
    const result = parseFunnelCsv({ fileName, mediaType, size, text });
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    if (!props.onSave({ fileName, source, importedAt: new Date().toISOString(), steps: result.steps })) return;
    setIssues([]);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const fileIssue = validateFunnelCsvFile({ fileName: file.name, mediaType: file.type, size: file.size });
    if (fileIssue) {
      setIssues([fileIssue]);
      return;
    }
    setBusy(true);
    try {
      saveCsv(await file.text(), file.name, file.type, file.size, "csv");
    } catch {
      setIssues([{ code: "malformed_csv", message: "파일을 읽지 못했습니다. UTF-8 CSV인지 확인하세요." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-busy={busy}>
      <PanelHeader kicker="03 · MEASURE" title="실제 순차 퍼널을 연결하세요" description="지원 스키마는 step_id, step_name, users입니다. 사용자는 다음 단계로 갈수록 같거나 줄어야 합니다." status={props.project.funnelImport ? `${props.project.funnelImport.source === "sample" ? "Demo" : "CSV"} · ${props.project.funnelImport.fileName}` : undefined} />
      <div className={`${styles.uploadBox} ${styles.dataSourceCard}`}>
        <div><strong>{busy ? "CSV를 검증하는 중입니다" : "퍼널 CSV 업로드"}</strong><p>최대 1MB · 2~100단계 · UTF-8 comma-separated</p></div>
        <div className={styles.inlineActions}>
          <button className={styles.primaryButton} disabled={busy} onClick={() => inputRef.current?.click()} type="button">CSV 선택</button>
          <button className={styles.secondaryButton} onClick={() => saveCsv(SAMPLE_CSV, "ux-measure-lab-demo.csv", "text/csv", SAMPLE_CSV.length, "sample")} type="button">샘플 사용</button>
          <button className={styles.textButton} onClick={downloadCsv} type="button">템플릿 받기</button>
          <input accept=".csv,text/csv" className={styles.visuallyHidden} onChange={handleFile} ref={inputRef} tabIndex={-1} type="file" />
        </div>
      </div>
      {issues.length > 0 ? <div className={styles.errorSummary} role="alert"><strong>CSV를 연결하지 않았습니다</strong><ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.row ? `${issue.row}행 · ` : ""}{issue.message}</li>)}</ul></div> : null}
      {analysis ? <p className={styles.visuallyHidden} role="status">퍼널 분석이 완료되었습니다. {analysis.steps.length}개 단계, 전체 전환율 {analysis.totalConversion}%입니다.</p> : null}
      {analysis ? (
        <div className={`${styles.analysisBlock} ${styles.funnelOverview}`}>
          <div className={styles.measurementKpiGrid}>
            <article className={styles.measurementKpiCard}>
              <div><span>전체 전환율</span><small>관찰 데이터</small></div>
              <strong>{analysis.totalConversion}%</strong>
              <p>{completedUsers.toLocaleString("ko-KR")} / {entryUsers.toLocaleString("ko-KR")}명 완료</p>
            </article>
            <article className={styles.measurementKpiCard} data-tone="critical">
              <div><span>가장 큰 이탈</span><small>관찰 데이터</small></div>
              <strong>{analysis.largestDropOff?.dropOffFromPrevious ?? 0}%</strong>
              <p>{largestDropPrevious?.label ?? "이전 단계"} → {analysis.largestDropOff?.label}</p>
              <p>{analysis.largestDropOff?.dropOffUsers?.toLocaleString("ko-KR")}명 이탈</p>
            </article>
            <article className={styles.measurementKpiCard}>
              <div><span>분석 표본</span><small>관찰 데이터</small></div>
              <strong>{entryUsers.toLocaleString("ko-KR")}</strong>
              <p>{analysis.steps.length}개 순차 퍼널 단계</p>
            </article>
          </div>
          <div className={`${styles.tableWrap} ${styles.funnelTableCard}`}>
            <table>
              <caption className={styles.visuallyHidden}>업로드한 순차 퍼널의 단계별 사용자, 전환과 이탈</caption>
              <thead><tr><th scope="col">단계</th><th scope="col">사용자</th><th scope="col">이전 단계 전환</th><th scope="col">이탈</th></tr></thead>
              <tbody>{analysis.steps.map((step, index) => (
                <tr className={step.id === analysis.largestDropOff?.id ? styles.riskRow : undefined} key={step.id}>
                  <th scope="row"><span className={styles.stepIndex}>{index + 1}</span>{step.label}</th>
                  <td>{step.users.toLocaleString("ko-KR")}</td>
                  <td><progress className={styles.funnelProgress} max="100" value={step.conversionFromPrevious ?? 100} /> <span>{step.conversionFromPrevious === null ? "기준" : `${step.conversionFromPrevious}%`}</span></td>
                  <td>{step.dropOffFromPrevious === null ? "—" : `${step.dropOffUsers?.toLocaleString("ko-KR")}명 · ${step.dropOffFromPrevious}%`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className={styles.dataSourceMeta}>
            <span>출처 · {props.project.funnelImport?.fileName}</span>
            <span>연결일 · {props.project.funnelImport?.importedAt.slice(0, 10)}</span>
            <span>{props.project.funnelImport?.source === "sample" ? "샘플 데이터" : "업로드 데이터"}</span>
          </div>
          <p className={styles.observationNote}>가장 큰 이탈은 관찰 신호이며 UX 원인을 의미하지 않습니다.</p>
        </div>
      ) : <div className={styles.emptyBlock}><strong>아직 연결된 퍼널이 없습니다</strong><p>샘플로 흐름을 확인하거나 실제 export CSV를 업로드하세요.</p></div>}
      <div className={styles.formActions}><button className={styles.secondaryButton} onClick={props.onBack} type="button">← KPI</button><button className={styles.primaryButton} disabled={!analysis} onClick={props.onNext} type="button">이탈 진단하기 →</button></div>
    </section>
  );
}
