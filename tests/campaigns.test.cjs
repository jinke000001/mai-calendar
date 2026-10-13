const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ TextEncoder, Date, ActivitySnapshot: require("./fixtures/snapshot.cjs") });
for (const file of ["campaigns.js", "calendar.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const api = vm.runInContext("({ CampaignCatalog, ActivitySnapshot, CalendarFile })", context);
const now = new Date("2026-10-13T08:00:00+08:00");
const clone = (value) => JSON.parse(JSON.stringify(value));
const item = (content, extra = {}) => ({ activityCode: "sample", title: "测试活动", content, displayDates: ["2026-10-15"], ...extra });
const build = (items) => api.CampaignCatalog.build({ source: api.ActivitySnapshot.source, items }, now);
const future = "10月15日10:45开售";

test("constructed MCP-format snapshot: 27 display entries become 16 records and two reminders", () => {
  const catalog = api.CampaignCatalog.build(api.ActivitySnapshot, now);
  assert.deepEqual(clone(catalog.stats), { displayEntries: 27, uniqueItems: 16, mergedEntries: 11, ready: 2 });
  assert.deepEqual(clone(catalog.items.filter((e) => api.CampaignCatalog.canExport(e, now)).map((e) => e.activityCode)), ["cme8", "m228"]);
});

test("duplicate activity IDs merge while distinct products with the same title stay separate", () => {
  const entries = [item(future), item(future, { displayDates: ["2026-10-22"] }), item(future, { activityCode: "different" })];
  const catalog = build(entries);
  assert.equal(catalog.items.length, 2);
  assert.deepEqual(clone(catalog.items[0].displayDates), ["2026-10-15", "2026-10-22"]);
  assert.equal(catalog.stats.ready, 2);
});

test("different source text under one ID requires review instead of silently choosing a version", () => {
  const result = build([item(future), item("10月22日10:45开售")]);
  assert.equal(result.items.length, 1);
  assert.equal(result.stats.ready, 0);
  assert.match(result.items[0].reason, /不同版本/);
});

test("future display dates do not turn an already launched burger into a new launch", () => {
  const event = build([item("10月8日 10:30 准时开售", { displayDates: ["2026-10-16"] })]).items[0];
  assert.equal(event.date, "2026-10-08");
  assert.equal(event.status, "past");
  assert.equal(api.CampaignCatalog.canExport(event, now), false);
});

test("explicit formal sale and conditional early access remain distinct", () => {
  const event = build([item(`${future}\n更有APP专享积分抢先购10:40开抢`)]).items[0];
  assert.equal(event.startTime, "10:45");
  assert.match(event.earlyAccess, /10:40/);
  assert.equal(event.verification, "verified");
});

test("conflicting reminder button or multiple formal starts cannot export", () => {
  assert.equal(build([item(future, { buttonTimeText: "10:30开始" })]).stats.ready, 0);
  assert.equal(build([item(`${future}\n10月22日10:45开售`)]).stats.ready, 0);
  const cap = api.CampaignCatalog.build(api.ActivitySnapshot, now).items.find((e) => e.activityCode === "en70");
  assert.match(cap.reason, /不一致/);
});

test("missing time, invalid date/time and ambiguous year stay browse-only", () => {
  for (const text of ["新品上新", "10月15日开售", "10月32日10:45开售", "10月15日25:00开售", "11月15日10:45开售"]) {
    assert.equal(build([item(text)]).stats.ready, 0, text);
  }
  assert.equal(build([item("2027年1月15日10:45开售")]).stats.ready, 1);
});

test("missing stable identifiers never merge by title and cannot export", () => {
  const catalog = build([item(future, { activityCode: "" }), item(future, { activityCode: "" })]);
  assert.equal(catalog.items.length, 2);
  assert.equal(catalog.stats.ready, 0);
});

test("full-width date and time normalize, without interpreting promotional display dates", () => {
  const event = build([item("１０月１５日 １０：４５起正式开售")]).items[0];
  assert.equal(event.date, "2026-10-15");
  assert.equal(event.startTime, "10:45");
});

test("export rejects pending or expired events even when caller bypasses the UI", () => {
  const catalog = api.CampaignCatalog.build(api.ActivitySnapshot, now);
  assert.throws(() => api.CalendarFile.create([catalog.items.find((e) => e.status === "pending")], "none", now), /未核实/);
  assert.throws(() => api.CalendarFile.create([catalog.items.find((e) => e.status === "past")], "none", now), /已经开售/);
  assert.throws(() => api.CalendarFile.create([catalog.items[0]], "none", new Date("2026-10-15T10:45:00+08:00")), /已经开售/);
});

test("ICS preserves Beijing starts, real source and stable IDs; duplicates export once", () => {
  const events = api.CampaignCatalog.build(api.ActivitySnapshot, now).items.filter((e) => api.CampaignCatalog.canExport(e, now));
  const ics = api.CalendarFile.create([...events, events[0]], "previous-day", now);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(unfolded, /DTSTART:20261015T024500Z/);
  assert.match(unfolded, /DTSTART:20261022T024500Z/);
  assert.match(unfolded, /TRIGGER;VALUE=DATE-TIME:20261014T010000Z/);
  assert.match(unfolded, /UID:mcd-cme8@mai-calendar.invalid/);
  assert.match(unfolded, /APP 积分抢先购 10:40/);
  assert.match(unfolded, /2026-10-13 08:10:56/);
  assert.doesNotMatch(unfolded, /虚构|DTEND:|LOCATION:/);
  assert.equal(ics.replace(/\r\n/g, "").includes("\n"), false);
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  const nextExport = api.CalendarFile.create(events, "none", new Date("2026-10-13T09:00:00+08:00")).replace(/\r\n /g, "");
  assert.deepEqual(unfolded.match(/UID:.*$/gm), nextExport.match(/UID:.*$/gm));
  assert.doesNotMatch(nextExport, /BEGIN:VALARM/);
});
