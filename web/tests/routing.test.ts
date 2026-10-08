import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHash, hashFor, ROUTE_IDS } from "../src/lib/routing.ts";

test("parseHash valid", () => {
  assert.equal(parseHash("#logs"), "logs");
  assert.equal(parseHash("#wizard"), "wizard");
});
test("parseHash strip slash", () => assert.equal(parseHash("#/jadwal"), "jadwal"));
test("parseHash wizard slash", () => assert.equal(parseHash("#/wizard"), "wizard"));
test("parseHash invalid/empty -> dashboard", () => {
  assert.equal(parseHash("#nope"), "dashboard");
  assert.equal(parseHash(""), "dashboard");
  assert.equal(parseHash("#%%"), "dashboard");
});
test("hashFor roundtrip", () => assert.equal(parseHash(hashFor("links")), "links"));
test("ROUTE_IDS complete", () =>
  assert.deepEqual(
    [...ROUTE_IDS],
    ["dashboard", "wizard", "links", "konten", "sosmed", "jadwal", "logs"],
  ));
