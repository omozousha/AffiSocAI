import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initHookLabTable,
  addEvolvedHook,
  listEvolvedHooks,
  evaluateEvolvedHookSurvival,
  pickHookWithEvolved,
  type EvolvedHookRow,
} from "../src/core/hook-lab.ts";
import { DatabaseSync } from "node:sqlite";

describe("Lingkup 2 — AI Hook Lab (Generation + Natural Selection)", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    initHookLabTable(db);
  });

  it("stores and retrieves active evolved hooks", () => {
    const id = addEvolvedHook(db, {
      product_type: "gadget",
      open: "Meja kerja rapi bikin fokus naik dua kali lipat.",
      why: "Kabel berserakan dan adaptor panas sering bikin kerjaan terdistraksi tanpa sadar.",
      cta: "Kamu tipe yang meja kerjanya minimalis atau penuh kabel charger?",
    });

    assert.ok(id > 0);
    const list = listEvolvedHooks(db, "gadget");
    assert.equal(list.length, 1);
    assert.equal(list[0].status, "active");
    assert.equal(list[0].impressions, 0);
  });

  it("natural selection: retires evolved hooks below baseline after 10 impressions", () => {
    const id = addEvolvedHook(db, {
      product_type: "rumah",
      open: "Panci anti lengket bikin masak jadi lebih cepat.",
      why: "Lapisan keramik alami memanaskan makanan merata tanpa perlu banyak minyak.",
      cta: "Menu apa yang paling sering kamu masak di rumah?",
    });

    // 5 impressions with low score -> stays active (not enough sample yet)
    let state = evaluateEvolvedHookSurvival(db, id, { impressions: 5, score: 0.1, baseline_mean: 0.5 });
    assert.equal(state.status, "active");

    // 12 impressions with low score (0.2 < 0.5) -> retired (survival of the fittest)
    state = evaluateEvolvedHookSurvival(db, id, { impressions: 12, score: 0.2, baseline_mean: 0.5 });
    assert.equal(state.status, "retired");

    // active list now excludes it
    const active = listEvolvedHooks(db, "rumah", "active");
    assert.equal(active.length, 0);
  });

  it("natural selection: keeps evolved hooks that outperform or match baseline", () => {
    const id = addEvolvedHook(db, {
      product_type: "sepatu",
      open: "Sepatu basah kehujanan bikin bau dan merusak sol.",
      why: "Pengering angin lembut menjaga lem sepatu tetap rekat tahan lama.",
      cta: "Gimana caramu ngerawat sepatu waktu musim hujan?",
    });

    // 15 impressions with score >= baseline -> stays active
    const state = evaluateEvolvedHookSurvival(db, id, { impressions: 15, score: 0.8, baseline_mean: 0.5 });
    assert.equal(state.status, "active");
  });

  it("integrates with epsilon-greedy: 20% exploration can pick active evolved hook", () => {
    addEvolvedHook(db, {
      product_type: "gadget",
      open: "Evolved hook for gadget",
      why: "Evolved why paragraph",
      cta: "Evolved cta paragraph",
    });

    // Forced random explore (rand = 0.05 < 0.2)
    const picked = pickHookWithEvolved(db, "gadget", {
      staticHooks: ["Static hook 1", "Static hook 2"],
      rand: () => 0.05,
    });
    assert.match(picked.open, /Evolved hook/i);
    assert.equal(picked.source, "evolved");

    // Forced exploit (rand = 0.8 > 0.2)
    const exploitPicked = pickHookWithEvolved(db, "gadget", {
      staticHooks: ["Static hook 1", "Static hook 2"],
      rand: () => 0.8,
    });
    assert.match(exploitPicked.open, /Static hook/i);
    assert.equal(exploitPicked.source, "static");
  });
});
