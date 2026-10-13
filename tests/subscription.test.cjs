"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const State = require("../subscription-state.cjs");
const snapshot = require("./fixtures/snapshot.cjs");
const { createServer } = require("../server.cjs");
const now = new Date("2026-10-13T09:15:00+08:00");
const later = new Date("2026-10-13T09:16:00+08:00");
const unfold = (ics) => ics.replace(/\r\n /g, "");
function selected() { return State.setPreferences(State.initialState(snapshot, now), { revision: 0, selected: ["mcd-cme8"], reminder: "previous-day" }, now); }
function update(mutator = () => {}) { const next = structuredClone(snapshot); next.source.queriedAt = "2026-10-13 09:16:00"; mutator(next); return next; }

test("a fresh real-format snapshot preserves selection and reminder without adding unchosen events", () => {
  const state = selected(); const next = State.applySnapshot(state, update(), state.revision, later);
  assert.deepEqual(Object.keys(next.entries), ["mcd-cme8"]);
  assert.equal(next.reminder, "previous-day");
  assert.deepEqual(next.lastUpdate, { added: 0, changed: 0, missing: 0, retained: 1 });
  assert.equal((unfold(State.feed(next)).match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(unfold(State.feed(next)), /TRIGGER;VALUE=DATE-TIME:20261014T010000Z/);
});

test("updated card summaries follow current copy instead of keeping a hard-coded price", () => {
  const state = selected();
  const next = State.applySnapshot(state, update((s) => { s.items.find((e) => e.activityCode === "cme8").content = "任意餐品加49.9元\n10月15日10:45开售"; }), state.revision, later);
  assert.equal(State.selectedEvents(next)[0].description, "任意餐品加49.9元");
  assert.match(State.feed(next).replace(/\r\n /g, ""), /49.9元/);
});

test("rescheduling updates the same UID and increments sequence rather than duplicating", () => {
  const state = selected();
  const next = State.applySnapshot(state, update((s) => { const e = s.items.find((e) => e.activityCode === "cme8"); e.content = e.content.replace("10月15日10:45", "10月16日10:45"); }), state.revision, later);
  const before = unfold(State.feed(state)), after = unfold(State.feed(next));
  assert.equal(before.match(/UID:.*/)[0], after.match(/UID:.*/)[0]);
  assert.equal((after.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(after, /DTSTART:20261016T024500Z/);
  assert.match(after, /SEQUENCE:1/);
  assert.match(after, /LAST-MODIFIED:20261013T011600Z/);
  assert.match(after, /TRIGGER;VALUE=DATE-TIME:20261015T010000Z/);
});

test("missing campaigns retain their last verified schedule with a review note", () => {
  const state = selected();
  const next = State.applySnapshot(state, update((s) => { s.items = s.items.filter((e) => e.activityCode !== "cme8"); }), state.revision, later);
  assert.equal(next.entries["mcd-cme8"].syncState, "missing");
  assert.match(unfold(State.feed(next)), /DTSTART:20261015T024500Z/);
  assert.match(unfold(State.feed(next)), /本次快照未出现/);
});

test("new conflicting times preserve the choice but pause the campaign feed until verified", () => {
  const state = selected();
  const next = State.applySnapshot(state, update((s) => { s.items.find((e) => e.activityCode === "cme8").buttonTimeText = "10:30开始"; }), state.revision, later);
  assert.equal(next.entries["mcd-cme8"].syncState, "pending");
  assert.doesNotMatch(State.feed(next), /BEGIN:VEVENT/);
  assert.match(State.selectedEvents(next)[0].syncNote, /保留选择/);
  const recovered = update(); recovered.source.queriedAt = "2026-10-13 09:17:00";
  const active = State.applySnapshot(next, recovered, next.revision, new Date("2026-10-13T09:17:00+08:00"));
  assert.match(State.feed(active), /UID:mcd-cme8/);
});

test("already launched selected events remain in a subscription as history", () => {
  const state = selected(); const historical = update(); historical.source.queriedAt = "2026-10-16 09:16:00";
  const next = State.applySnapshot(state, historical, state.revision, new Date("2026-10-16T09:16:00+08:00"));
  assert.match(State.feed(next), /UID:mcd-cme8/);
});

test("empty subscription is valid and removing a choice removes it from the feed", () => {
  const state = selected(); const next = State.setPreferences(state, { revision: state.revision, selected: [], reminder: "none" }, later);
  assert.match(State.feed(next), /BEGIN:VCALENDAR/);
  assert.doesNotMatch(State.feed(next), /BEGIN:VEVENT/);
});

test("removing and reselecting a campaign keeps its revision increasing", () => {
  const state = selected();
  const removed = State.setPreferences(state, { revision: state.revision, selected: [], reminder: state.reminder }, later);
  const reselected = State.setPreferences(removed, { revision: removed.revision, selected: ["mcd-cme8"], reminder: state.reminder }, later);
  assert.ok(reselected.entries["mcd-cme8"].sequence > state.entries["mcd-cme8"].sequence);
  assert.match(State.feed(reselected), /UID:mcd-cme8@mai-calendar.invalid/);
});

test("failed, empty, malformed or older updates leave the original data intact", () => {
  const state = selected(), before = JSON.stringify(state);
  for (const bad of [null, {}, update((s) => { s.items = []; }), update((s) => { s.source.queriedAt = "2026-02-30 10:00:00"; }), update((s) => { s.items[0].content = 8; }), snapshot]) {
    if (bad === snapshot) {
      const newer = State.applySnapshot(state, update(), state.revision, later);
      assert.throws(() => State.applySnapshot(newer, bad, newer.revision, later), /旧/);
    } else assert.throws(() => State.applySnapshot(state, bad, state.revision, later));
  }
  assert.equal(JSON.stringify(state), before);
});

test("duplicate update is idempotent and stale pages cannot overwrite newer choices", () => {
  const state = selected();
  assert.deepEqual(State.applySnapshot(state, snapshot, state.revision, later), state);
  assert.throws(() => State.setPreferences(state, { revision: 0, selected: [], reminder: "none" }, now), /另一页面/);
});

test("public snapshot sanitizer strips response metadata, member fields and injected keys", () => {
  const extra = structuredClone(snapshot); extra.source.authorization = "REDACTED_TEST"; extra.member = { name: "test" }; extra.items[0].traceId = "test";
  const safe = State.validateSnapshot(extra);
  assert.doesNotMatch(JSON.stringify(safe), /authorization|member|traceId|REDACTED_TEST/);
  assert.throws(() => State.setPreferences(State.initialState(snapshot, now), { revision: 0, selected: ["__proto__"], reminder: "none" }, now));
});

test("loopback API persists state, protects writes and serves a cache-aware subscription", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mai-subscription-"));
  const preparedFile = path.join(dir, "latest.json");
  await fs.writeFile(preparedFile, JSON.stringify(update()));
  const options = { stateDir: dir, preparedFile, snapshot, now: () => now };
  let server = await createServer(options);
  const start = async () => { await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${server.address().port}`; };
  let base = await start();
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const post = (route, body, headers = {}) => fetch(base + route, { method: "POST", headers: { Origin: base, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  let state = await (await fetch(base + "/api/state")).json();
  let response = await post("/api/preferences", { revision: state.revision, selected: ["mcd-cme8"], reminder: "same-day" });
  assert.equal(response.status, 200); state = await response.json();
  assert.equal((await post("/api/preferences", { revision: state.revision, selected: [], reminder: "none" }, { Origin: "https://example.com" })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    http.get(base + "/api/state", { headers: { Host: "example.com" } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(base + "/.local-calendar/state.json")).status, 404);
  assert.equal((await fetch(base + "/output/manual-updates/latest.json")).status, 404);
  assert.equal((await fetch(base + "/server.cjs")).status, 404);
  assert.equal((await post("/api/preferences", { revision: 0, selected: [], reminder: "none" })).status, 409);
  const first = await fetch(base + "/calendar.ics");
  assert.match(first.headers.get("content-type"), /text\/calendar/);
  assert.equal(first.headers.get("access-control-allow-origin"), null);
  assert.match(unfold(await first.text()), /UID:mcd-cme8/);
  assert.equal((await fetch(base + "/calendar.ics", { headers: { "If-None-Match": first.headers.get("etag") } })).status, 304);
  response = await post("/api/updates", { revision: state.revision });
  state = await response.json(); assert.equal(response.status, 200);
  assert.deepEqual(state.selected, ["mcd-cme8"]);
  const saved = await fs.readFile(path.join(dir, "state.json"), "utf8");
  await fs.writeFile(preparedFile, "not-json");
  assert.equal((await post("/api/updates", { revision: state.revision })).status, 422);
  assert.equal(await fs.readFile(path.join(dir, "state.json"), "utf8"), saved);
  await new Promise((resolve) => server.close(resolve));
  server = await createServer(options); base = await start();
  const restored = await (await fetch(base + "/api/state")).json();
  assert.deepEqual(restored.selected, ["mcd-cme8"]); assert.equal(restored.reminder, "same-day");
});
