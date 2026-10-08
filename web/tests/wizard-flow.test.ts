import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  wizardReducer,
  nextStep,
  canRun,
  MAX_REGEN,
  type WizardStep,
} from "../src/routes/wizard/wizard-machine.ts";

const NO_OP: WizardStep = "link"; // placeholder that would never be used

test("initial state is link step, idle, no error", () => {
  const s = initialState();
  assert.equal(s.step, "link");
  assert.equal(s.status.link, "idle");
  assert.equal(s.linkId, null);
  assert.equal(s.error, null);
});

test("nextStep walks the chain and stops at done", () => {
  assert.equal(nextStep("link"), "image");
  assert.equal(nextStep("image"), "caption");
  assert.equal(nextStep("caption"), "publish");
  assert.equal(nextStep("publish"), "done");
  assert.equal(nextStep("done"), "done");
});

test("canRun opens first step without a predecessor", () => {
  const s = initialState();
  assert.equal(canRun(s, "link"), true);
});

test("canRun blocks a step until its predecessor is ok", () => {
  const s = initialState();
  assert.equal(canRun(s, "image"), false);
  assert.equal(canRun(s, "caption"), false);
});

test("link_created unlocks image and moves step forward", () => {
  let s = initialState();
  s = wizardReducer(s, { type: "link_created", linkId: 7, product: "Helm", imageUrl: "/api/images/x.jpg", shortUrl: "https://s.shopee.co.id/abc" });
  assert.equal(s.step, "image");
  assert.equal(s.status.link, "ok");
  assert.equal(s.linkId, 7);
  assert.equal(canRun(s, "image"), true);
});

test("full chain reaches done and persists transitions", () => {
  let s = initialState();
  s = wizardReducer(s, { type: "link_created", linkId: 1, product: "P", imageUrl: "u", shortUrl: "s" });
  s = wizardReducer(s, { type: "start", step: "image" });
  s = wizardReducer(s, { type: "step_ok", step: "image" });
  assert.equal(s.step, "caption");
  s = wizardReducer(s, { type: "start", step: "caption" });
  s = wizardReducer(s, { type: "step_ok", step: "caption", patch: { caption: "Caption OK" } });
  assert.equal(s.step, "publish");
  s = wizardReducer(s, { type: "start", step: "publish" });
  s = wizardReducer(s, { type: "step_ok", step: "publish" });
  assert.equal(s.step, "done");
});

test("step_fail sets error and failed status, keeps step", () => {
  let s = initialState();
  s = wizardReducer(s, { type: "link_created", linkId: 1, product: "P", imageUrl: "u", shortUrl: "s" });
  s = wizardReducer(s, { type: "start", step: "image" });
  s = wizardReducer(s, { type: "step_fail", step: "image", error: "router down" });
  assert.equal(s.status.image, "failed");
  assert.equal(s.error, "router down");
  assert.equal(s.step, "image");
});

test("step_fail re-runnable via start (no deadlock)", () => {
  let s = initialState();
  s = wizardReducer(s, { type: "link_created", linkId: 1, product: "P", imageUrl: "u", shortUrl: "s" });
  s = wizardReducer(s, { type: "start", step: "image" });
  s = wizardReducer(s, { type: "step_fail", step: "image", error: "E" });
  // bug guard: canRun must still allow the same step after a failure
  assert.equal(wizardReducer(s, { type: "start", step: "image" }).status.image, "running");
});

test("start on locked step is ignored", () => {
  const s = initialState();
  assert.equal(wizardReducer(s, { type: "start", step: "caption" }).step, "link");
});

test("regen bounded by MAX_REGEN", () => {
  let s = wizardReducer(initialState(), { type: "regen" });
  assert.equal(s.step, "link"); // regen doesn't move steps, just bumps counter
  assert.equal(s.regenCount, 1);

  // force max regen via repeated regen (pre-existing state)
  let s2 = { ...initialState(), regenCount: MAX_REGEN };
  const after = wizardReducer(s2, { type: "regen" });
  assert.equal(after.regenCount, MAX_REGEN);
});

test("toggle_platform keeps at least current selection mutable", () => {
  let s = initialState();
  s = wizardReducer(s, { type: "toggle_platform", platform: "threads" });
  assert.ok(s.platforms.includes("threads"));
  s = wizardReducer(s, { type: "toggle_platform", platform: "instagram" });
  assert.ok(!s.platforms.includes("instagram"));
});

test("finish marks done ok", () => {
  const s = wizardReducer({ ...initialState(), step: "publish" }, { type: "finish" });
  assert.equal(s.step, "done");
  assert.equal(s.status.done, "ok");
});
