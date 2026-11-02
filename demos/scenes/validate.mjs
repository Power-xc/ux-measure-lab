import { TEMPO } from "../lib/stage.mjs";
import { enterResults, prepare, recordDecision, openReport } from "../lib/flows.mjs";

export const validate = {
  name: "validate",
  async run(s) {
    await prepare(s, "validate");
    await s.show(0.8);
    await enterResults(s);
    s.tempo = TEMPO.quick;
    await recordDecision(s);
    await openReport(s);
    await s.scrollTo(await s.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight));
    await s.hold(2.5);
  },
};
