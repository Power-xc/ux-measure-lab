import * as f from "../lib/flows.mjs";
import { TEMPO } from "../lib/stage.mjs";

const STEPS = [f.createProject, f.fillContext, f.fillMetric, f.uploadFunnel, f.goDiagnose, f.makeFriction, f.fillHypothesis, f.preregister, f.enterResults, f.recordDecision, f.openReport];

export const hero = {
  name: "hero",
  async run(s) {
    s.tempo = TEMPO.quick;
    for (const step of STEPS) {
      const before = s.count;
      await step(s);
      if (process.env.DEMO_DEBUG) console.log(step.name, s.count - before);
    }
    await s.scrollTo(await s.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight));
    await s.hold(2.5);
  },
};
