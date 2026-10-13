"use strict";

const Catalog = require("./campaigns.js");
const CalendarFile = require("./calendar.js");
const reminders = new Set(["none", "previous-day", "same-day"]);
const clone = (value) => structuredClone(value);

function fail(message, code = "INVALID_INPUT", status = 422) {
  throw Object.assign(new Error(message), { code, status });
}

function queryTime(snapshot) {
  return Date.parse(`${snapshot.source.queriedAt.replace(" ", "T")}+08:00`);
}

// Keep only public campaign fields. Raw MCP responses and credentials are never stored.
function validateSnapshot(input) {
  const mode = input?.source?.mode || "real";
  if (!["demo", "real"].includes(mode) || !input || input.source?.tool !== "campaign-calendar" || input.source?.service !== (mode === "demo" ? "虚构演示" : "麦当劳中国官方 MCP")
    || typeof input.source.queriedAt !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input.source.queriedAt)
    || !Array.isArray(input.items) || !input.items.length || input.items.length > 300) {
    fail("活动快照格式不完整，原活动与选择已保留。");
  }
  const validDate = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!validDate(input.source.queriedAt.slice(0, 10)) || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(input.source.queriedAt.slice(11))) fail("查询时间无效，原活动与选择已保留。");
  const text = (item, name, limit, optional = false) => {
    if (optional && item[name] === undefined) return "";
    if (typeof item[name] !== "string" || item[name].length > limit) fail("活动字段无效，原活动与选择已保留。");
    return item[name];
  };
  const items = input.items.map((item) => {
    if (!item || !Array.isArray(item.displayDates) || item.displayDates.length > 100 || !item.displayDates.every(validDate)) fail("活动展示日期无效，原活动与选择已保留。");
    return {
      activityCode: text(item, "activityCode", 80), title: text(item, "title", 400), content: text(item, "content", 20000),
      displayDates: [...new Set(item.displayDates)], buttonText: text(item, "buttonText", 200, true), buttonTimeText: text(item, "buttonTimeText", 200, true),
    };
  });
  return { source: { mode, service: input.source.service, tool: "campaign-calendar", arguments: {}, queriedAt: input.source.queriedAt }, items };
}

function initialState(snapshot, now = new Date()) {
  return { version: 1, snapshot: validateSnapshot(snapshot), entries: {}, retired: {}, reminder: "none", initialized: false, revision: 0, updatedAt: now.toISOString(), lastUpdate: null };
}

function checkRevision(state, revision) {
  if (revision !== state.revision) fail("选择已在另一页面更新，请刷新页面后再操作。", "STALE_REVISION", 409);
}

function setPreferences(state, input, now = new Date()) {
  checkRevision(state, input.revision);
  if (!Array.isArray(input.selected) || input.selected.length > 300 || !input.selected.every((id) => typeof id === "string") || !reminders.has(input.reminder)) fail("请选择有效的活动与提醒方式。");
  const next = clone(state);
  next.retired ||= {};
  const items = new Map(Catalog.build(state.snapshot, now).items.map((event) => [event.id, event]));
  const wanted = new Set(input.selected);
  for (const id of wanted) {
    if (!Object.hasOwn(next.entries, id)) {
      const event = items.get(id);
      if (!event || !Catalog.canExport(event, now)) fail("有活动尚未核实或已经开售，请刷新后重新挑选。");
      next.entries[id] = { event, syncState: "active", sequence: Object.hasOwn(next.retired, id) ? next.retired[id] + 1 : 0, modifiedAt: now.toISOString() };
    }
  }
  for (const id of Object.keys(next.entries)) {
    if (!wanted.has(id)) { next.retired[id] = next.entries[id].sequence + 1; delete next.entries[id]; }
  }
  if (next.reminder !== input.reminder) {
    for (const entry of Object.values(next.entries)) {
      if (Object.hasOwn(state.entries, entry.event.id)) { entry.sequence++; entry.modifiedAt = now.toISOString(); }
    }
  }
  next.reminder = input.reminder;
  next.initialized = true;
  if (JSON.stringify([next.entries, next.reminder, next.initialized]) !== JSON.stringify([state.entries, state.reminder, state.initialized])) {
    next.revision++; next.updatedAt = now.toISOString();
  }
  return next;
}

const sourceContent = (event) => JSON.stringify([event.originalTitle, event.content, event.buttonTimes]);
const calendarContent = (entry) => JSON.stringify([entry.event.title, entry.event.content, entry.event.date, entry.event.startTime, entry.event.earlyAccess, entry.event.sourceTime, entry.syncState]);

function applySnapshot(state, raw, revision, now = new Date()) {
  checkRevision(state, revision);
  const snapshot = validateSnapshot(raw);
  const sameMode = snapshot.source.mode === (state.snapshot.source.mode || "real");
  if (!sameMode && Object.keys(state.entries).length) fail("请先取消当前所选活动，再切换演示与真实数据；原选择已保留。", "MODE_CONFLICT", 409);
  if (sameMode && queryTime(snapshot) < queryTime(state.snapshot)) fail("这份快照比当前活动旧，未覆盖现有数据。", "OLDER_SNAPSHOT", 409);
  if (JSON.stringify(snapshot) === JSON.stringify(state.snapshot)) return clone(state);
  if (sameMode && queryTime(snapshot) === queryTime(state.snapshot)) fail("同一查询时间出现不同内容，需要核对快照。", "SNAPSHOT_CONFLICT", 409);
  const previous = new Map(Catalog.build(state.snapshot, now).items.map((event) => [event.id, event]));
  const catalog = Catalog.build(snapshot, now);
  const current = new Map(catalog.items.map((event) => [event.id, event]));
  const next = clone(state);
  for (const [id, entry] of Object.entries(next.entries)) {
    const before = calendarContent(entry);
    const event = current.get(id);
    if (!event) entry.syncState = "missing"; // Absence is not proof of cancellation.
    else if (event.verification !== "verified") entry.syncState = "pending";
    else { entry.event = event; entry.syncState = "active"; }
    if (before !== calendarContent(entry)) { entry.sequence++; entry.modifiedAt = now.toISOString(); }
  }
  next.snapshot = snapshot;
  next.revision++;
  next.updatedAt = now.toISOString();
  next.lastUpdate = {
    added: catalog.items.filter((e) => !previous.has(e.id)).length,
    changed: catalog.items.filter((e) => previous.has(e.id) && sourceContent(e) !== sourceContent(previous.get(e.id))).length,
    missing: [...previous.keys()].filter((id) => !current.has(id)).length,
    retained: Object.keys(next.entries).length,
  };
  return next;
}

function selectedEvents(state) {
  return Object.values(state.entries).map((entry) => ({ ...entry.event, syncState: entry.syncState,
    syncNote: entry.syncState === "missing" ? "本次快照未出现，保留上次核实日程，等待复核。"
      : entry.syncState === "pending" ? "新文案时间待核实；保留选择，暂停此项订阅。" : "",
  }));
}

function feed(state) {
  const events = selectedEvents(state).filter((event) => event.syncState !== "pending");
  return CalendarFile.create(events, state.reminder, new Date(state.updatedAt), { subscription: true, revisions: state.entries, sourceMode: state.snapshot.source.mode });
}

module.exports = { validateSnapshot, initialState, setPreferences, applySnapshot, selectedEvents, feed, queryTime, fail };
