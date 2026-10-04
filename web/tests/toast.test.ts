import { test } from "node:test";
import assert from "node:assert/strict";
import { toastReducer, type ToastItem } from "../src/lib/toast-store.ts";

const mk = (id: number, msg = "m" + id): ToastItem => ({ id, msg, kind: "ok", ts: 0 });

test("add appends", () => {
  const s = toastReducer([], { type: "add", item: mk(1) });
  assert.equal(s.length, 1);
  assert.equal(s[0].msg, "m1");
});

test("remove drops by id, keeps order", () => {
  let s = [mk(1), mk(2), mk(3)];
  s = toastReducer(s, { type: "remove", id: 2 });
  assert.deepEqual(s.map((t) => t.id), [1, 3]);
});

test("cap 4 keeps newest", () => {
  let s: ToastItem[] = [];
  for (let i = 1; i <= 6; i++) s = toastReducer(s, { type: "add", item: mk(i) });
  assert.equal(s.length, 4);
  assert.deepEqual(s.map((t) => t.id), [3, 4, 5, 6]);
});

test("unknown id remove is a no-op", () => {
  const s = toastReducer([mk(1)], { type: "remove", id: 99 });
  assert.equal(s.length, 1);
});
