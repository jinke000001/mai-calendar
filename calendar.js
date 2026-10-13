"use strict";

// All timestamps are derived from verified events' Beijing civil dates.
// UTC timestamps keep the file portable without a client-specific time-zone block.
const CalendarFile = (() => {
  const catalogApi = typeof module !== "undefined" ? require("./campaigns.js") : CampaignCatalog;
  const encoder = new TextEncoder();
  const textValue = (value) => String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");

  function foldLine(line) {
    const parts = [];
    let part = "";
    let bytes = 0;
    for (const character of line) {
      const size = encoder.encode(character).length;
      if (bytes + size > 75) {
        parts.push(part);
        part = " ";
        bytes = 1;
      }
      part += character;
      bytes += size;
    }
    parts.push(part);
    return parts;
  }

  function utcStamp(date) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function beijingStamp(civilDate, time = "00:00", dayOffset = 0) {
    const [year, month, day] = civilDate.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    return utcStamp(new Date(Date.UTC(year, month - 1, day + dayOffset, hour - 8, minute)));
  }

  function create(events, reminder = "none", now = new Date(), options = {}) {
    const subscription = options.subscription === true;
    if (!events.length && !subscription) throw new Error("请先挑选至少一场活动。");
    if (!["none", "previous-day", "same-day"].includes(reminder)) throw new Error("请选择有效的提醒时间。");
    if (events.some((event) => subscription
      ? event.verification !== "verified" || !Number.isFinite(catalogApi.startStamp(event))
      : !catalogApi.canExport(event, now))) throw new Error("有活动的时间未核实或已经开售，请重新挑选。");
    const unique = [...new Map(events.map((event) => [event.id, event])).values()];
    const demo = options.sourceMode === "demo" || (unique.length > 0 && unique.every((e) => e.sourceMode === "demo"));
    const stamp = utcStamp(now);
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      "PRODID:-//Mai Calendar//Verified Activity Snapshot 2.0//ZH-CN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:${textValue(demo ? "麦日历 · 虚构演示" : "麦日历 · 活动提醒")}`,
      "X-WR-TIMEZONE:Asia/Shanghai",
    ];

    for (const event of unique) {
      const revision = options.revisions?.[event.id];
      const changedAt = revision ? utcStamp(new Date(revision.modifiedAt)) : stamp;
      lines.push("BEGIN:VEVENT", `UID:${event.id}@mai-calendar.invalid`, `DTSTAMP:${changedAt}`);
      if (subscription) lines.push(`SEQUENCE:${revision?.sequence || 0}`, `LAST-MODIFIED:${changedAt}`);
      // A sale starts at a known instant; its end was not announced. RFC 5545
      // permits DATE-TIME DTSTART without DTEND, so no duration is invented.
      lines.push(`DTSTART:${beijingStamp(event.date, event.startTime)}`);
      lines.push(
        `SUMMARY:${textValue(`${event.title}开售`)}`,
        `DESCRIPTION:${textValue(`麦日历非官方本地体验 · ${demo ? "虚构演示，不代表任何官方活动" : "真实活动开售提醒"}。\n来源：${demo ? "虚构演示快照" : "麦当劳官方活动信息"}，${event.sourceTime} ${demo ? "生成" : "查询"}。\n开售依据：${event.timeEvidence}\n${event.earlyAccess ? `${event.earlyAccess}；本事件记录正式开售时间。\n` : ""}${event.content}\n未给出结束时间，本事件仅记录开售时刻。${demo ? "演示时间仅供体验。" : "参与条件与后续变更以官方为准。"}\n${subscription ? `本地订阅：手动更新活动后，日历软件刷新订阅时同步。${event.syncNote || ""}` : "本次为一次性导入，不会自动更新。"}`)}`,
        "STATUS:CONFIRMED", "TRANSP:TRANSPARENT",
      );
      if (reminder !== "none") {
        const offset = reminder === "previous-day" ? -1 : 0;
        lines.push(
          "BEGIN:VALARM", "ACTION:DISPLAY",
          `TRIGGER;VALUE=DATE-TIME:${beijingStamp(event.date, "09:00", offset)}`,
          `DESCRIPTION:${textValue(`开售提醒：${event.title}`)}`, "END:VALARM",
        );
      }
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return `${lines.flatMap(foldLine).join("\r\n")}\r\n`;
  }

  return Object.freeze({ create });
})();

if (typeof module !== "undefined") {
  module.exports = CalendarFile;
}
