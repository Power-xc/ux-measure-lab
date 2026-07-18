"use client";

// Owner-only replay screen. spec.md (session-replay) §1·§5·§9: replay is qualitative
// context for Diagnose, the list/payload comes from the loopback read boundary (the
// section stays hidden when that boundary is closed), playback happens inside a
// network-blocked sandbox iframe, and a reference becomes Evidence only through the
// user's explicit apply action (SR-10).

import { useCallback, useEffect, useRef, useState } from "react";
import type { Evidence } from "../../../entities/project/model";
import { buildReplayEvidence } from "../../../features/replay/lib/replay-evidence";
import {
  isReplayStatusMessage,
  REPLAY_SANDBOX_ATTRIBUTE,
  replayFrameOrigin,
  scrubReplayEventsForPlayback,
} from "../../../features/replay/lib/player-sandbox";
import type { ReplayRecordingMeta } from "../../../features/replay/server/store";
import styles from "./panels.module.css";
import replayStyles from "./replay.module.css";

type SectionProps = { onApplyEvidence(evidence: Evidence[]): boolean };
type PlayingState = { meta: ReplayRecordingMeta; frameOrigin: string; events: unknown[] };
type PlayerStatus = "waiting" | "playing" | "error";

const STATUS_LABELS: Record<PlayerStatus, string> = {
  waiting: "sandbox 준비 중…",
  playing: "재생 준비 완료 — 아래 컨트롤러로 재생하세요.",
  error: "이 녹화는 재생할 수 없어 중단했습니다. 원본 내용은 표시되지 않습니다.",
};

function formatDate(iso: string): string {
  const time = new Date(iso);
  return Number.isFinite(time.getTime()) ? time.toLocaleString("ko-KR") : iso;
}

function formatKilobytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("ko-KR")}KB`;
}

function SandboxedReplayPlayer(props: { frameOrigin: string; events: unknown[]; onStatus(status: PlayerStatus): void }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.origin !== props.frameOrigin || !isReplayStatusMessage(event.data)) return;
      if (event.data.type === "replay:ready") {
        frame.contentWindow?.postMessage({ type: "replay:load", events: props.events }, props.frameOrigin);
        return;
      }
      props.onStatus(event.data.type === "replay:playing" ? "playing" : "error");
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [props]);

  return (
    <iframe
      className={replayStyles.replayFrame}
      onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: "replay:load", events: props.events }, props.frameOrigin)}
      ref={frameRef}
      sandbox={REPLAY_SANDBOX_ATTRIBUTE}
      src={`${props.frameOrigin}/api/replay/player-frame`}
      title="세션 녹화 재생 (네트워크 차단 sandbox)"
    />
  );
}

export function ReplaySection({ onApplyEvidence }: SectionProps) {
  const [recordings, setRecordings] = useState<ReplayRecordingMeta[] | null>(null);
  const [playing, setPlaying] = useState<PlayingState | null>(null);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>("waiting");
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [appliedNotice, setAppliedNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/replay/recordings", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { recordings?: ReplayRecordingMeta[] } | null) => {
        if (data && Array.isArray(data.recordings)) setRecordings(data.recordings);
      })
      .catch(() => undefined); // closed boundary or offline: the section simply stays hidden
    return () => controller.abort();
  }, []);

  const handleStatus = useCallback((status: PlayerStatus) => setPlayerStatus(status), []);

  if (recordings === null) return null;

  async function play(meta: ReplayRecordingMeta): Promise<void> {
    // The sandbox document lives on the loopback ALIAS origin so the browser itself
    // isolates it from this workspace. Outside a loopback runtime there is no frame.
    const frameOrigin = replayFrameOrigin(window.location);
    if (!frameOrigin) {
      setNotice("재생은 loopback owner 환경에서만 가능합니다.");
      return;
    }
    setBusyId(meta.recordingId);
    setNotice("");
    try {
      const response = await fetch(`/api/replay/recordings?recording=${encodeURIComponent(meta.recordingId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("recording_unavailable");
      const data = await response.json() as { chunks?: { sequence: number; events: unknown[] }[] };
      const raw = (data.chunks ?? []).flatMap((chunk) => (Array.isArray(chunk.events) ? chunk.events : []));
      const events = scrubReplayEventsForPlayback(raw);
      if (events.length < 2) {
        setNotice("재생할 수 있는 녹화 데이터가 아닙니다.");
        return;
      }
      setPlayerStatus("waiting");
      setPlaying({ meta, frameOrigin, events });
    } catch {
      setNotice("녹화를 불러오지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(meta: ReplayRecordingMeta): Promise<void> {
    setBusyId(meta.recordingId);
    setNotice("");
    try {
      const response = await fetch(`/api/replay/recordings?recording=${encodeURIComponent(meta.recordingId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete_failed");
      setPlaying((current) => (current?.meta.recordingId === meta.recordingId ? null : current));
      setRecordings((current) => (current ?? []).filter((item) => item.recordingId !== meta.recordingId));
    } catch {
      setNotice("녹화를 삭제하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  function applyReference(meta: ReplayRecordingMeta): void {
    const evidence = buildReplayEvidence({ id: crypto.randomUUID(), meta, observedAt: new Date().toISOString() });
    try {
      if (onApplyEvidence([evidence])) {
        setApplied((current) => ({ ...current, [meta.recordingId]: true }));
        setNotice("");
        setAppliedNotice("녹화 참조가 프로젝트 Evidence에 적용되었습니다.");
      } else setNotice("녹화 참조를 Evidence로 적용하지 못했습니다.");
    } catch {
      setNotice("녹화 참조를 Evidence로 적용하지 못했습니다.");
    }
  }

  return (
    <section aria-labelledby="replay-title" className={styles.harnessSection}>
      <header>
        <span>SESSION REPLAY</span>
        <h3 id="replay-title">동의된 세션 녹화 다시 보기</h3>
        <p>owner 전용 loopback 화면입니다. 재생은 네트워크가 차단된 sandbox 안에서만 실행되고, 참조는 명시적으로 적용해야 정성 Evidence로 저장됩니다. 수치나 원인 판정은 만들지 않습니다.</p>
      </header>
      {recordings.length === 0
        ? <p className={replayStyles.replayEmpty}>보존 중인 녹화가 없습니다. 동의된 녹화가 수집되면 여기에 표시됩니다.</p>
        : <ul className={replayStyles.replayList}>
          {recordings.map((meta) => (
            <li key={meta.recordingId}>
              <div>
                <strong>{meta.recordingId}</strong>
                <small>{formatDate(meta.startedAt)} ~ {formatDate(meta.endedAt)} · chunk {meta.chunkCount}개 · {formatKilobytes(meta.byteSize)} · 만료 {formatDate(meta.expiresAt)}</small>
              </div>
              <div className={styles.inlineActions}>
                <button className={styles.secondaryButton} disabled={busyId === meta.recordingId} onClick={() => play(meta)} type="button">재생</button>
                <button className={styles.secondaryButton} disabled={Boolean(applied[meta.recordingId])} onClick={() => applyReference(meta)} type="button">{applied[meta.recordingId] ? "Evidence 참조 완료" : "Evidence로 참조"}</button>
                <button className={styles.textButton} disabled={busyId === meta.recordingId} onClick={() => remove(meta)} type="button">삭제</button>
              </div>
            </li>
          ))}
        </ul>}
      {notice ? <p className={styles.contextError} role="alert">{notice}</p> : null}
      {appliedNotice ? <p role="status">{appliedNotice}</p> : null}
      {playing ? (
        <div className={replayStyles.replayPlayer}>
          <div className={replayStyles.replayPlayerHeader}>
            <strong>녹화 {playing.meta.recordingId}</strong>
            <span role="status">{STATUS_LABELS[playerStatus]}</span>
            <button className={styles.textButton} onClick={() => setPlaying(null)} type="button">재생 닫기</button>
          </div>
          <SandboxedReplayPlayer events={playing.events} frameOrigin={playing.frameOrigin} onStatus={handleStatus} />
        </div>
      ) : null}
    </section>
  );
}
