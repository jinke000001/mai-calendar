"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const Demo = require("../activity-data.js");
const State = require("../subscription-state.cjs");
const { writePrepared } = require("../manual-update.cjs");
const { createServer } = require("../server.cjs");
const real = require("./fixtures/snapshot.cjs");
const now = new Date("2026-12-30T08:00:00+08:00");
const unfold = (s) => s.replace(/\r\n /g, "");

test("fictional first-run dates work across year boundaries and stay clearly marked in ICS", () => {
  const demo = Demo.createDemo(now), catalog = require("../campaigns.js").build(demo, now);
  assert.equal(catalog.stats.ready, 2); assert.equal(catalog.stats.mergedEntries, 2);
  const state = State.setPreferences(State.initialState(demo, now), { revision: 0, selected: ["mcd-demo-star"], reminder: "none" }, now);
  const ics = unfold(State.feed(state));
  assert.match(ics, /DTSTART:20270101T024500Z/); assert.match(ics, /虚构演示，不代表任何官方活动/);
  const next = State.applySnapshot(state, Demo.rescheduleDemo(demo, now), state.revision, now);
  assert.deepEqual(Object.keys(next.entries), ["mcd-demo-star"]);
  assert.match(unfold(State.feed(next)), /DTSTART:20270102T024500Z/);
  assert.equal((unfold(State.feed(next)).match(/BEGIN:VEVENT/g) || []).length, 1);
});

test("switching between demo and real data cannot silently overwrite existing choices", () => {
  const demo = Demo.createDemo(now);
  let state = State.setPreferences(State.initialState(demo, now), { revision: 0, selected: ["mcd-demo-star"], reminder: "none" }, now);
  assert.throws(() => State.applySnapshot(state, real, state.revision, now), /取消/);
  state = State.setPreferences(state, { revision: state.revision, selected: [], reminder: "none" }, now);
  assert.equal(State.applySnapshot(state, real, state.revision, now).snapshot.source.mode, "real");
  assert.throws(() => Demo.rescheduleDemo(real, now), /真实/);
});

test("preparing sanitizes public fields, writes atomically and leaves the pending file after malformed input", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mai-import-")); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "latest.json"), input = structuredClone(real);
  input.member = { phone: "REDACTED_TEST" }; input.source.authorization = "REDACTED_TEST";
  await writePrepared(input, file);
  const before = await fs.readFile(file, "utf8"); assert.doesNotMatch(before, /member|authorization|REDACTED_TEST/);
  await assert.rejects(writePrepared({}, file)); assert.equal(await fs.readFile(file, "utf8"), before);
  assert.deepEqual((await fs.readdir(dir)).sort(), ["latest.json"]);
});

test("snapshot import and demo preparation require a deliberate apply action and protect real mode", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mai-api-import-"));
  const preparedFile = path.join(dir, "latest.json"), snapshot = Demo.createDemo(now);
  const server = await createServer({ stateDir: dir, preparedFile, snapshot, now: () => now });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async () => (await fetch(base + "/api/state")).json();
  const post = (route, input, origin = base) => fetch(base + route, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  let state = await (await post("/api/preferences", { revision: 0, selected: ["mcd-demo-star"], reminder: "none" })).json();
  assert.equal((await post("/api/demo-updates", { revision: state.revision })).status, 200);
  assert.equal((await get()).snapshot.source.queriedAt, snapshot.source.queriedAt);
  state = await (await post("/api/updates", { revision: state.revision })).json();
  assert.deepEqual(state.selected, ["mcd-demo-star"]);
  const pending = await fs.readFile(preparedFile, "utf8");
  assert.equal((await post("/api/snapshots", { revision: state.revision, snapshot: real })).status, 409);
  assert.equal(await fs.readFile(preparedFile, "utf8"), pending);
  assert.equal((await post("/api/snapshots", { revision: state.revision, snapshot: real }, "https://example.com")).status, 403);
  state = await (await post("/api/preferences", { revision: state.revision, selected: [], reminder: "none" })).json();
  assert.equal((await post("/api/snapshots", { revision: state.revision, snapshot: { ...real, member: "REDACTED_TEST" } })).status, 200);
  assert.equal((await get()).snapshot.source.mode, "demo");
  state = await (await post("/api/updates", { revision: state.revision })).json();
  assert.equal(state.snapshot.source.mode, "real");
  assert.equal((await post("/api/demo-updates", { revision: state.revision })).status, 409);
  assert.equal((await post("/api/snapshots", { revision: 0, snapshot: real })).status, 409);
  assert.equal((await post("/api/snapshots", { revision: state.revision, snapshot: {} })).status, 422);
});

test("CLI prepares a snapshot without network credentials and malformed input preserves it", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mai-cli-")); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, "input.json"); await fs.writeFile(input, JSON.stringify(real));
  const script = path.resolve(__dirname, "../scripts/prepare-update.cjs"), env = { ...process.env, MAI_CALENDAR_DATA_DIR: dir };
  execFileSync(process.execPath, [script, input], { env });
  const before = await fs.readFile(path.join(dir, "latest.json"), "utf8");
  await fs.writeFile(input, "bad-json");
  assert.throws(() => execFileSync(process.execPath, [script, input], { env, stdio: "pipe" }));
  assert.equal(await fs.readFile(path.join(dir, "latest.json"), "utf8"), before);
});
