export type FunnelStep = {
  id: string;
  label: string;
  users: number;
};

export type EvidenceItem = {
  id: string;
  signal: string;
  source: "Measured" | "Observed" | "Assumed";
  detail: string;
};

export type MeasureLoopStage = "context" | "measure" | "diagnose" | "test" | "decide";

export const funnelFixture: FunnelStep[] = [
  { id: "landing", label: "랜딩 방문", users: 2480 },
  { id: "start", label: "가입 시작", users: 1590 },
  { id: "connect", label: "데이터 연결", users: 842 },
  { id: "report", label: "첫 리포트 생성", users: 611 },
];

export const evidenceFixture: EvidenceItem[] = [
  {
    id: "funnel-drop",
    signal: "가입 → 데이터 연결 구간 이탈",
    source: "Measured",
    detail: "748명 이탈 · 이전 단계 대비 47.0%",
  },
  {
    id: "clarity-rage",
    signal: "연동 방식 선택 영역 Rage click",
    source: "Observed",
    detail: "Clarity 세션 표본에서 반복 클릭 패턴 확인",
  },
  {
    id: "copy-risk",
    signal: "API 키 안내 문구가 어렵다",
    source: "Assumed",
    detail: "인터뷰 또는 사용성 테스트로 검증 필요",
  },
];
