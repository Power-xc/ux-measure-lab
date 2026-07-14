"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ProductStage, Project, ProjectContext } from "../../../entities/project/model";
import type { ProductPageContext } from "../../../features/product-context/lib/product-context";
import { analyzeProductUrl } from "../../../features/product-context/model/analyze-product-url";
import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH, MAX_URL_LENGTH, validateProductUrl } from "../../../shared/lib/input-policy";
import { ErrorSummary, Field, PanelHeader } from "./PanelPrimitives";
import styles from "./panels.module.css";

type ContextPanelProps = {
  project: Project;
  onSave(context: ProjectContext): boolean;
  onNext(): void;
};

type AnalysisState = "idle" | "loading" | "success" | "error";

type AnalysisStatusProps = {
  state: AnalysisState;
  error: string;
  canAnalyze: boolean;
  onAnalyze(): void;
  onViewDetails(): void;
};

type ContextFieldSetter = <K extends keyof ProjectContext>(key: K, value: ProjectContext[K]) => void;

const statusCopy: Record<AnalysisState, { label: string; title: string; description: string }> = {
  idle: {
    label: "분석 전",
    title: "제품 URL 분석 준비",
    description: "공개 HTTP(S) 제품 URL을 입력하면 참고용 페이지 맥락을 추출합니다.",
  },
  loading: {
    label: "분석 중",
    title: "공개 페이지를 읽고 있습니다",
    description: "정적 HTML에서 제목·설명·주요 제목·내비게이션을 확인합니다.",
  },
  success: {
    label: "분석 완료",
    title: "페이지 맥락을 확인할 수 있습니다",
    description: "공개 HTML을 읽었습니다. 비어 있거나 누락된 항목은 직접 보완하세요.",
  },
  error: {
    label: "분석 실패",
    title: "제품 페이지를 분석하지 못했습니다",
    description: "URL을 확인하거나 제품 프로필을 직접 입력해 주세요.",
  },
};

function validateContext(context: ProjectContext): string[] {
  const errors: string[] = [];
  if (!context.productName.trim()) errors.push("제품 이름을 입력하세요.");
  if (context.productName.length > MAX_NAME_LENGTH) errors.push(`제품 이름은 ${MAX_NAME_LENGTH}자 이하여야 합니다.`);
  if (!context.audience.trim()) errors.push("핵심 사용자를 입력하세요.");
  if (!context.valueAction.trim()) errors.push("핵심 가치 행동을 입력하세요.");
  if (!context.goal.trim()) errors.push("이번 측정 목표를 입력하세요.");
  if ([context.audience, context.valueAction, context.goal].some((value) => value.length > MAX_TEXT_LENGTH)) errors.push(`텍스트 입력은 ${MAX_TEXT_LENGTH.toLocaleString("ko-KR")}자 이하여야 합니다.`);
  const urlValidation = validateProductUrl(context.productUrl);
  if (!urlValidation.ok) errors.push(urlValidation.message);
  return errors;
}

function analysisStateClass(state: AnalysisState): string {
  if (state === "loading") return styles.analysisLoading;
  if (state === "success") return styles.analysisSuccess;
  if (state === "error") return styles.analysisError;
  return styles.analysisIdle;
}

function AnalysisStatusCard(props: AnalysisStatusProps) {
  const copy = statusCopy[props.state];
  const description = props.state === "error" && props.error ? props.error : copy.description;
  return (
    <section
      aria-busy={props.state === "loading"}
      className={`${styles.analysisStatusCard} ${analysisStateClass(props.state)}`}
    >
      <div aria-atomic="true" className={styles.analysisStatusBody} role={props.state === "error" ? "alert" : "status"}>
        <span className={styles.analysisStatusLabel}>{copy.label}</span>
        {props.state === "loading" ? <span aria-hidden="true" className={styles.analysisSpinner} /> : null}
        <div className={styles.analysisStatusCopy}><h3>{copy.title}</h3><p>{description}</p></div>
      </div>
      {props.state === "idle" ? <button className={styles.secondaryButton} disabled={!props.canAnalyze} onClick={props.onAnalyze} type="button">분석 시작</button> : null}
      {props.state === "success" ? <button className={styles.secondaryButton} onClick={props.onViewDetails} type="button">추출 결과 보기</button> : null}
      {props.state === "error" ? <button className={styles.secondaryButton} disabled={!props.canAnalyze} onClick={props.onAnalyze} type="button">다시 시도</button> : null}
    </section>
  );
}

function ExtractedDetails(props: { context: ProductPageContext; onApply(): void }) {
  const context = props.context;
  return (
    <section className={styles.extractedDetailsCard} id="page-context-details" tabIndex={-1} aria-labelledby="page-context-title">
      <header className={styles.extractedDetailsHeader}>
        <div><h3 id="page-context-title">추출된 페이지 정보</h3><span className={styles.untrustedBadge}>검증되지 않은 참고 정보</span></div>
        <button className={styles.textButton} onClick={props.onApply} type="button">제품명·최종 URL 적용</button>
      </header>
      <dl className={styles.contextDetailsList}>
        <div><dt>페이지 제목</dt><dd>{context.title || "찾지 못함"}</dd></div>
        <div><dt>설명</dt><dd>{context.description || "찾지 못함"}</dd></div>
        <div><dt>최종 URL</dt><dd>{context.finalUrl}</dd></div>
        <div><dt>주요 제목</dt><dd>{context.headings.length > 0 ? context.headings.join(" · ") : "찾지 못함"}</dd></div>
        <div><dt>내비게이션</dt><dd>{context.navigation.length > 0 ? context.navigation.join(" · ") : "찾지 못함"}</dd></div>
      </dl>
      <small className={styles.untrustedNotice}>외부 페이지의 정적 HTML에서 추출한 참고 텍스트입니다. 사실이나 사용자 의도를 의미하지 않으며 저장 전 직접 검토하세요.</small>
    </section>
  );
}

function ReviewChecklist({ context }: { context: ProjectContext }) {
  const items = [
    { complete: Boolean(context.productName.trim()), completeText: "제품 이름 입력됨", pendingText: "제품 이름을 입력하세요" },
    { complete: Boolean(context.audience.trim()), completeText: "핵심 사용자 입력됨", pendingText: "핵심 사용자를 입력하세요" },
    { complete: Boolean(context.valueAction.trim()), completeText: "핵심 가치 행동 입력됨", pendingText: "핵심 가치 행동을 입력하세요" },
    { complete: Boolean(context.goal.trim()), completeText: "측정 목표 입력됨", pendingText: "측정 목표를 입력하세요" },
  ];
  return (
    <aside className={styles.reviewChecklist} aria-labelledby="review-checklist-title">
      <h4 id="review-checklist-title">저장 전 확인</h4>
      <ul>{items.map((item) => <li className={item.complete ? styles.reviewComplete : styles.reviewPending} key={item.completeText}><span aria-hidden="true">{item.complete ? "✓" : "○"}</span>{item.complete ? item.completeText : item.pendingText}</li>)}</ul>
      <small>입력 여부만 확인합니다. 내용의 정확성과 적합성은 직접 검토하세요.</small>
    </aside>
  );
}

function ProductProfile(props: { context: ProjectContext; errors: string[]; onSet: ContextFieldSetter }) {
  return (
    <section className={styles.productProfileCard} aria-labelledby="product-profile-title">
      <header className={styles.productProfileHeader}><h3 id="product-profile-title">제품 프로필</h3><p>분석과 KPI 정의에 사용할 제품 기준을 직접 확인하세요.</p></header>
      <ErrorSummary errors={props.errors} />
      <div className={styles.productProfileLayout}>
        <div className={styles.productProfileFields}>
          <Field htmlFor="product-name" label="제품 이름"><input maxLength={MAX_NAME_LENGTH} onChange={(event) => props.onSet("productName", event.target.value)} value={props.context.productName} /></Field>
          <Field htmlFor="value-action" label="핵심 가치 행동"><input maxLength={MAX_TEXT_LENGTH} onChange={(event) => props.onSet("valueAction", event.target.value)} placeholder="예: 첫 분석 리포트 생성" value={props.context.valueAction} /></Field>
          <Field htmlFor="product-stage" label="제품 단계"><select onChange={(event) => props.onSet("productStage", event.target.value as ProductStage)} value={props.context.productStage}><option value="idea">Idea</option><option value="alpha">Alpha</option><option value="beta">Beta</option><option value="live">Live</option><option value="growth">Growth</option></select></Field>
          <Field htmlFor="goal" label="이번 측정 목표"><textarea maxLength={MAX_TEXT_LENGTH} onChange={(event) => props.onSet("goal", event.target.value)} rows={3} value={props.context.goal} /></Field>
          <Field htmlFor="audience" label="핵심 사용자"><input maxLength={MAX_TEXT_LENGTH} onChange={(event) => props.onSet("audience", event.target.value)} placeholder="예: 첫 분석을 만드는 Product Designer" value={props.context.audience} /></Field>
        </div>
        <ReviewChecklist context={props.context} />
      </div>
    </section>
  );
}

export function ContextPanel({ project, onSave, onNext }: ContextPanelProps) {
  const [form, setForm] = useState(project.context);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(() => validateContext(project.context).length === 0);
  const [pageContext, setPageContext] = useState<ProductPageContext | null>(null);
  const [contextError, setContextError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  function set<K extends keyof ProjectContext>(key: K, value: ProjectContext[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function setProductUrl(value: string) {
    requestRef.current?.abort();
    requestRef.current = null;
    setAnalyzing(false);
    setPageContext(null);
    setContextError("");
    set("productUrl", value);
  }

  async function analyzeUrl() {
    const validation = validateProductUrl(form.productUrl);
    if (!validation.ok || !validation.url) {
      setContextError(validation.ok ? "분석할 제품 URL을 입력하세요." : validation.message);
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setAnalyzing(true);
    setPageContext(null);
    setContextError("");
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 12_000);
    try {
      const context = await analyzeProductUrl(validation.url, { signal: controller.signal });
      if (requestRef.current === controller) setPageContext(context);
    } catch (error) {
      if (requestRef.current !== controller) return;
      if (timedOut) setContextError("제품 분석 시간이 초과되었습니다. URL을 확인하거나 직접 입력해 주세요.");
      else if (!controller.signal.aborted) setContextError(error instanceof Error ? error.message : "제품 페이지를 분석하지 못했습니다.");
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) { requestRef.current = null; setAnalyzing(false); }
    }
  }

  function applyPageContext() {
    if (!pageContext) return;
    setForm((current) => ({
      ...current,
      productName: current.productName === project.name && pageContext.title ? pageContext.title.slice(0, MAX_NAME_LENGTH) : current.productName,
      productUrl: pageContext.finalUrl,
    }));
    setSaved(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateContext(form);
    setErrors(nextErrors);
    if (nextErrors.length > 0 || !onSave(form)) return;
    setSaved(true);
  }

  const analysisState: AnalysisState = analyzing ? "loading" : pageContext ? "success" : contextError ? "error" : "idle";
  return (
    <section className={`${styles.panel} ${styles.contextPanel}`}>
      <PanelHeader kicker="01 · PRODUCT CONTEXT" title="Product Context / URL Analysis" description="제품 링크와 목표·핵심 행동을 함께 검토해 측정 기준을 만듭니다. 링크만으로 사용자 의도나 문제 원인을 단정하지 않습니다." status={saved ? "저장됨" : undefined} />
      <form className={`${styles.form} ${styles.contextForm}`} onSubmit={submit}>
        <section className={styles.urlAnalysisSection} aria-labelledby="url-analysis-title">
          <div className={styles.urlAnalysisHeading}><h3 id="url-analysis-title">제품 URL 분석</h3><p>공개 페이지에서 참고용 맥락을 가져옵니다.</p></div>
          <div className={styles.field}>
            <label htmlFor="product-url">제품 URL (선택)</label>
            <div className={styles.urlFieldRow}>
              <input aria-describedby="product-url-helper" id="product-url" maxLength={MAX_URL_LENGTH} onChange={(event) => setProductUrl(event.target.value)} placeholder="https://" type="url" value={form.productUrl} />
              <button aria-busy={analyzing} className={`${styles.primaryButton} ${styles.contextAnalyzeButton}`} disabled={analyzing || !form.productUrl.trim()} onClick={analyzeUrl} type="button">{analyzing ? "분석 중…" : "제품 분석하기"}</button>
            </div>
            <small id="product-url-helper">공개 HTTP(S) 페이지만 읽습니다. 로그인·사설 주소·스크립트 실행은 지원하지 않습니다.</small>
          </div>
        </section>

        <AnalysisStatusCard canAnalyze={Boolean(form.productUrl.trim()) && !analyzing} error={contextError} onAnalyze={analyzeUrl} onViewDetails={() => document.getElementById("page-context-details")?.focus()} state={analysisState} />
        {pageContext ? <ExtractedDetails context={pageContext} onApply={applyPageContext} /> : null}

        <ProductProfile context={form} errors={errors} onSet={set} />

        <div className={`${styles.formActions} ${styles.contextFormActions}`}><button className={styles.primaryButton} type="submit">Context 저장</button><button className={styles.secondaryButton} disabled={!saved} onClick={onNext} type="button">KPI 정의하기 →</button></div>
      </form>
    </section>
  );
}
