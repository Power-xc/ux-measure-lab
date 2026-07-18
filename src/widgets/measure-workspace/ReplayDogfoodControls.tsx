"use client";

// Owner dogfood recording consent. spec.md (session-replay) §2 gate 1: replay is a
// separate purpose with explicit opt-in and an equally accessible withdraw. The bar
// renders only when the loopback read boundary is open AND a dogfood site key is
// configured — public deployments never see it. Recording is driven entirely by the
// collector's recorder, so every hard privacy rule applies unchanged.

import { useEffect, useState } from "react";
import {
  createBrowserDogfoodRecorder,
  type DogfoodRecorder,
} from "../../features/replay/lib/dogfood-recorder";
import styles from "./measure-workspace.module.css";
import replayStyles from "./panels/replay.module.css";

const SITE_KEY = process.env.NEXT_PUBLIC_UX_MEASURE_REPLAY_SITE_KEY ?? "";

// The workspace swaps between the empty and the project shell, remounting this bar.
// The active recorder lives at module level so an in-flight recording survives.
let activeRecorder: DogfoodRecorder | null = null;

type Phase = "idle" | "recording" | "saved" | "withdrawn" | "blocked";

const PHASE_LABELS: Record<Phase, string> = {
  idle: "녹화 없음",
  recording: "녹화 중 — 입력값·텍스트는 항상 마스킹됩니다.",
  saved: "녹화가 저장되었습니다. Diagnose 화면에서 재생할 수 있습니다.",
  withdrawn: "동의를 철회했습니다. 자동으로 다시 시작되지 않습니다.",
  blocked: "브라우저 프라이버시 신호(GPC/DNT)가 켜져 있어 녹화할 수 없습니다.",
};

export function ReplayDogfoodControls() {
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<Phase>(() => (activeRecorder?.state() === "consented" ? "recording" : "idle"));

  useEffect(() => {
    if (!SITE_KEY) return;
    // A mounted flag, not an AbortController: aborting an in-flight fetch on unmount
    // leaves the request without a finished/failed event, which stalls Playwright's
    // networkidle. This is a one-shot availability probe, so letting it complete is fine.
    let active = true;
    fetch("/api/replay/recordings", { cache: "no-store" })
      .then(async (response) => {
        // Drain the body even when we only need ok-ness: an unread response stream
        // stays "in-flight" and stalls networkidle (and leaks a stream).
        await response.text().catch(() => undefined);
        if (active && response.ok) setAvailable(true);
      })
      .catch(() => undefined); // closed boundary: the bar simply never appears
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!available) return;
    const flush = () => activeRecorder?.end();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [available]);

  if (!available) return null;

  async function start(): Promise<void> {
    // A fresh recorder per recording: ended recordings never silently resume.
    const recorder = createBrowserDogfoodRecorder(SITE_KEY);
    activeRecorder = recorder;
    const state = await recorder.grant();
    setPhase(state === "consented" ? "recording" : "blocked");
  }

  function stopAndSave(): void {
    activeRecorder?.end();
    activeRecorder = null;
    setPhase("saved");
  }

  function withdraw(): void {
    if (activeRecorder) activeRecorder.withdraw();
    else createBrowserDogfoodRecorder(SITE_KEY).withdraw();
    activeRecorder = null;
    setPhase("withdrawn");
  }

  return (
    <aside aria-label="세션 녹화 dogfood" className={replayStyles.dogfoodBar}>
      <div>
        <strong>세션 녹화 (dogfood)</strong>
        <small>
          목적: 이 워크스페이스 사용 흐름의 정성 관찰 · 수집: 마스킹된 화면 구조와 클릭·스크롤(입력값·텍스트 원문 제외) ·
          보존: 최대 30일, 로컬 개발 프로세스 안 · 철회: 언제든, 즉시 중단·미전송 삭제
        </small>
      </div>
      <div className={replayStyles.dogfoodActions}>
        <span role="status">{PHASE_LABELS[phase]}</span>
        {phase === "recording"
          ? <button className={styles.secondaryButton} onClick={stopAndSave} type="button">녹화 종료·저장</button>
          : <button className={styles.secondaryButton} onClick={start} type="button">동의하고 녹화 시작</button>}
        <button className={styles.secondaryButton} disabled={phase === "withdrawn"} onClick={withdraw} type="button">동의 철회</button>
      </div>
    </aside>
  );
}
