import assert from "node:assert/strict";
import test from "node:test";
import { getAvailableHarnessSkills, getHarnessSkill, HARNESS_SKILLS, supportsHarnessSkill } from "./catalog.ts";

test("catalog keeps all eight measurement skills and exposes only the executable four", () => {
  assert.equal(HARNESS_SKILLS.length, 8);
  assert.deepEqual(
    getAvailableHarnessSkills().map((skill) => skill.id),
    ["funnel", "interaction", "paths", "fleet"],
  );
});

test("catalog binds each skill to capabilities, source kind, questions, and an observational template", () => {
  for (const skill of HARNESS_SKILLS) {
    assert.ok(skill.name.length > 0);
    assert.ok(skill.exampleQuestions.length > 0);
    assert.ok(skill.requiredCapabilities.length > 0 || (skill.alternativeCapabilities?.length ?? 0) > 0);
    assert.ok(skill.observationTemplate.length > 0);
    assert.doesNotMatch(skill.observationTemplate, /원인|때문|유발/);
  }

  assert.deepEqual(getHarnessSkill("funnel")?.requiredCapabilities, ["funnel"]);
  assert.deepEqual(getHarnessSkill("comparison")?.alternativeCapabilities, ["funnel", "events"]);
  assert.deepEqual(getHarnessSkill("replay")?.optionalCapabilities, ["recordings"]);
  assert.deepEqual(getHarnessSkill("fleet")?.requiredCapabilities, ["funnel", "segments"]);
  assert.equal(getHarnessSkill("unknown"), undefined);
});

test("catalog capability matching preserves required AND alternative OR semantics", () => {
  const comparison = getHarnessSkill("comparison");
  const segments = getHarnessSkill("segments");
  assert.ok(comparison && segments);
  assert.equal(supportsHarnessSkill(comparison, (capability) => capability === "events"), true);
  assert.equal(supportsHarnessSkill(comparison, () => false), false);
  assert.equal(supportsHarnessSkill(segments, (capability) => capability === "funnel"), false);
  assert.equal(supportsHarnessSkill(segments, (capability) => ["funnel", "segments"].includes(capability)), true);
});
