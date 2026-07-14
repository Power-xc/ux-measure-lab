import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunnel, FunnelValidationError } from "./calculate-funnel.ts";

const validSteps = [
  { id: "landing", label: "랜딩 방문", users: 2480 },
  { id: "start", label: "가입 시작", users: 1590 },
  { id: "connect", label: "데이터 연결", users: 842 },
  { id: "report", label: "첫 리포트", users: 611 },
  { id: "retain", label: "7일 재방문", users: 421 },
];

test("FUNNEL-001 calculates one authoritative five-step analysis", () => {
  const analysis = analyzeFunnel(validSteps);

  assert.equal(analysis.steps[0].conversionFromPrevious, null);
  assert.equal(analysis.steps[1].conversionFromPrevious, 64.1);
  assert.equal(analysis.steps[2].dropOffFromPrevious, 47);
  assert.equal(analysis.steps[2].dropOffUsers, 748);
  assert.equal(analysis.totalConversion, 17);
  assert.equal(analysis.largestDropOff?.id, "connect");
});

test("FUNNEL-002 uses the earliest downstream step for a percentage tie", () => {
  const analysis = analyzeFunnel([
    { id: "a", label: "A", users: 100 },
    { id: "b", label: "B", users: 80 },
    { id: "c", label: "C", users: 64 },
  ]);

  assert.equal(analysis.largestDropOff?.id, "b");
});

test("FUNNEL-003 returns no largest drop when every count is equal", () => {
  const analysis = analyzeFunnel([
    { id: "a", label: "A", users: 100 },
    { id: "b", label: "B", users: 100 },
  ]);

  assert.equal(analysis.largestDropOff, null);
  assert.equal(analysis.totalConversion, 100);
});

test("FUNNEL-004 rejects invalid domain input instead of coercing it", () => {
  const invalidInputs = [
    [],
    [{ id: "a", label: "A", users: 10 }],
    [{ id: "a", label: "A", users: 0 }, { id: "b", label: "B", users: 0 }],
    [{ id: "a", label: "A", users: 10 }, { id: "b", label: "B", users: 11 }],
    [{ id: "a", label: "A", users: 10 }, { id: "a", label: "B", users: 9 }],
    [{ id: "a", label: "", users: 10 }, { id: "b", label: "B", users: 9 }],
    [{ id: "a", label: "A", users: -1 }, { id: "b", label: "B", users: 0 }],
    [{ id: "a", label: "A", users: 10.5 }, { id: "b", label: "B", users: 9 }],
    [{ id: "a", label: "A", users: Number.NaN }, { id: "b", label: "B", users: 9 }],
    [{ id: "a", label: "A", users: Number.POSITIVE_INFINITY }, { id: "b", label: "B", users: 9 }],
    [{ id: "a", label: "A", users: Number.MAX_SAFE_INTEGER + 1 }, { id: "b", label: "B", users: 9 }],
  ];

  for (const steps of invalidInputs) {
    assert.throws(() => analyzeFunnel(steps), FunnelValidationError);
  }
});

test("FUNNEL-005 rounds percentages to one decimal place", () => {
  const analysis = analyzeFunnel([
    { id: "a", label: "A", users: 3 },
    { id: "b", label: "B", users: 2 },
  ]);

  assert.equal(analysis.steps[1].conversionFromPrevious, 66.7);
  assert.equal(analysis.steps[1].dropOffFromPrevious, 33.3);
});
