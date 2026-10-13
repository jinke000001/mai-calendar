"use strict";

// Public, fictional data only. Dates follow the first run so a fresh checkout
// remains usable after the original contest. Real snapshots stay on each Mac.
const DemoSnapshots = (() => {
  const pad = (n) => String(n).padStart(2, "0");
  const civil = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const beijing = (d) => { const v = new Date(Number(d) + 8 * 3600000); return `${civil(v)} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`; };
  const after = (date, days) => civil(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000));
  const wording = (date) => `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
  function create(now = new Date()) {
    const today = beijing(now).slice(0, 10), star = after(today, 2), coffee = after(today, 5), cap = after(today, 3);
    return {
      source: { mode: "demo", service: "虚构演示", tool: "campaign-calendar", arguments: {}, queriedAt: beijing(now) },
      items: [
        { activityCode: "demo-star", title: "[演示] 星星徽章", content: `虚构演示：收集一点小期待\n${wording(star)}10:45正式开售\n更有APP专享积分抢先购10:40开抢`, displayDates: [after(today, 1), star], buttonText: "演示提醒", buttonTimeText: "10:45开始" },
        { activityCode: "demo-star", title: "[演示] 星星徽章", content: `虚构演示：收集一点小期待\n${wording(star)}10:45正式开售\n更有APP专享积分抢先购10:40开抢`, displayDates: [star], buttonText: "演示提醒", buttonTimeText: "10:45开始" },
        { activityCode: "demo-coffee", title: "[演示] 午后新品", content: `虚构演示：给午后留一点期待\n${wording(coffee)}10:30开售`, displayDates: [coffee], buttonTimeText: "10:30开始" },
        { activityCode: "demo-cap", title: "[演示] 帽子预热", content: `虚构演示：这项时间有冲突\n${wording(cap)}10:45开售`, displayDates: [cap], buttonTimeText: "10:30开始" },
        { activityCode: "demo-reading", title: "[演示] 周末阅读", content: "虚构演示：需要预约，具体场次尚未公布。", displayDates: [after(today, 7)] },
      ],
    };
  }
  function reschedule(snapshot, now = new Date()) {
    if (snapshot.source?.mode !== "demo") throw new Error("演示改期只适用于虚构活动，不会修改真实快照。");
    const next = JSON.parse(JSON.stringify(snapshot));
    const first = next.items.find((e) => e.activityCode === "demo-star");
    const match = first?.content.match(/(\d{4})年(\d{1,2})月(\d{1,2})日10:45/);
    if (!match) throw new Error("当前演示快照没有可改期的徽章，请使用全新演示目录。");
    const oldDate = `${match[1]}-${pad(match[2])}-${pad(match[3])}`, newDate = after(oldDate, 1);
    for (const e of next.items.filter((e) => e.activityCode === "demo-star")) {
      e.content = e.content.replace(wording(oldDate), wording(newDate)); e.displayDates = [newDate];
    }
    if (!next.items.some((e) => e.activityCode === "demo-extra")) next.items.push({ activityCode: "demo-extra", title: "[演示] 新到贴纸", content: `虚构演示：新增活动不会替你选择\n${wording(after(newDate, 5))}11:00开售`, displayDates: [after(newDate, 5)] });
    const oldTime = Date.parse(`${snapshot.source.queriedAt.replace(" ", "T")}+08:00`);
    next.source.queriedAt = beijing(new Date(Math.max(Number(now), oldTime + 1000)));
    return next;
  }
  return Object.freeze({ create, reschedule });
})();
const ActivitySnapshot = DemoSnapshots.create();
if (typeof module !== "undefined") {
  module.exports = ActivitySnapshot;
  Object.defineProperties(module.exports, { createDemo: { value: DemoSnapshots.create }, rescheduleDemo: { value: DemoSnapshots.reschedule } });
}
