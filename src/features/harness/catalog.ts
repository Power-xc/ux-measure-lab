import type { SourceCapability, SourceKind } from "../../entities/project/model.ts";

export type HarnessSkillId =
  | "funnel"
  | "interaction"
  | "paths"
  | "comparison"
  | "kpi"
  | "segments"
  | "replay"
  | "fleet";

export type HarnessSkill = {
  id: HarnessSkillId;
  name: string;
  exampleQuestions: readonly string[];
  requiredCapabilities: readonly SourceCapability[];
  alternativeCapabilities?: readonly SourceCapability[];
  optionalCapabilities?: readonly SourceCapability[];
  sourceKind: SourceKind;
  observationTemplate: string;
  available: boolean;
};

export const HARNESS_SKILLS: readonly HarnessSkill[] = [
  {
    id: "funnel",
    name: "퍼널 이탈",
    exampleQuestions: ["가입 퍼널에서 사용자가 가장 많이 이탈하는 구간은 어디인가요?"],
    requiredCapabilities: ["funnel"],
    sourceKind: "calculated",
    observationTemplate: "{fromStep}에서 {toStep} 사이의 이탈률은 {dropOffRate}%로 관찰되었습니다.",
    available: true,
  },
  {
    id: "interaction",
    name: "마찰 신호",
    exampleQuestions: ["연동 방식 선택 화면에서 반복 클릭 신호가 관찰되나요?"],
    requiredCapabilities: ["interaction"],
    optionalCapabilities: ["sessions"],
    sourceKind: "measured",
    observationTemplate: "{target}에서 {signalName} 신호 {signalCount}건이 관찰되었습니다.",
    available: true,
  },
  {
    id: "paths",
    name: "여정 연속성",
    exampleQuestions: ["가입한 사용자가 첫 핵심 행동까지 이어지나요?"],
    requiredCapabilities: ["paths"],
    optionalCapabilities: ["funnel"],
    sourceKind: "calculated",
    observationTemplate: "{startEvent} 표본 중 {endEvent}에 도달한 비율은 {reachRate}%입니다.",
    available: true,
  },
  {
    id: "comparison",
    name: "전후 비교",
    exampleQuestions: ["변경 전후의 결제 전환율은 얼마나 달라졌나요?"],
    requiredCapabilities: [],
    alternativeCapabilities: ["funnel", "events"],
    sourceKind: "calculated",
    observationTemplate: "{baselinePeriod} 대비 {comparisonPeriod}의 {metricName} 변화는 {delta}입니다.",
    available: false,
  },
  {
    id: "kpi",
    name: "KPI 추적",
    exampleQuestions: ["이번 주 활성 사용자 추세는 어떻게 달라졌나요?"],
    requiredCapabilities: ["events"],
    sourceKind: "measured",
    observationTemplate: "{period}의 {metricName} 값은 {metricValue}로 관찰되었습니다.",
    available: false,
  },
  {
    id: "segments",
    name: "세그먼트 격차",
    exampleQuestions: ["신규 사용자와 재방문 사용자의 가입 이탈 차이는 얼마인가요?"],
    requiredCapabilities: ["funnel", "segments"],
    sourceKind: "calculated",
    observationTemplate: "{segmentA}와 {segmentB}의 {metricName} 차이는 {gap}입니다.",
    available: false,
  },
  {
    id: "replay",
    name: "재현 맥락",
    exampleQuestions: ["이탈 구간에서 관찰할 수 있는 세션 맥락은 무엇인가요?"],
    requiredCapabilities: ["sessions"],
    optionalCapabilities: ["recordings"],
    sourceKind: "qualitative",
    observationTemplate: "{filter} 조건에 해당하는 세션 표본 {sampleCount}개가 확인되었습니다.",
    available: false,
  },
  {
    id: "fleet",
    name: "함대 판독",
    exampleQuestions: ["동시에 실험 중인 12개 변형 가운데 성공 기준을 넘은 변형은 무엇인가요?"],
    requiredCapabilities: ["funnel", "segments"],
    sourceKind: "calculated",
    observationTemplate: "{variantCount}개 변형 중 {advancedCount}개가 성공 기준 이상, {culledCount}개가 컷 기준으로 관찰되었습니다.",
    available: false,
  },
];

export function getAvailableHarnessSkills(): readonly HarnessSkill[] {
  return HARNESS_SKILLS.filter((skill) => skill.available);
}

export function getHarnessSkill(id: string): HarnessSkill | undefined {
  return HARNESS_SKILLS.find((skill) => skill.id === id);
}

export function supportsHarnessSkill(skill: HarnessSkill, supports: (capability: SourceCapability) => boolean): boolean {
  return skill.requiredCapabilities.every(supports)
    && (!skill.alternativeCapabilities || skill.alternativeCapabilities.some(supports));
}
