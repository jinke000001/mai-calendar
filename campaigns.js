"use strict";

// Display dates are never interpreted as launch dates. This deliberately narrow
// checker accepts an explicit sale date AND time in the campaign's own text.
const CampaignCatalog = (() => {
  const normalize = (value) => String(value || "").normalize("NFKC").trim();
  const metadata = {
    "demo-star": { category: "merch", art: "star" },
    "demo-coffee": { category: "new", art: "coffee" },
    "demo-cap": { category: "merch", art: "bag" },
    "demo-reading": { category: "meet", art: "notebook" },
    cme8: { title: "PEACEMINUSONE 联名徽章", category: "merch", art: "star" },
    m228: { title: "「我就喜欢」限定主题丝巾", category: "merch", art: "bag" },
    en70: { title: "PEACEMINUSONE 联名棒球帽", category: "merch", art: "bag" },
    "45f3": { category: "new", art: "coffee", note: "有优惠日期范围，但没有新的开售时刻；仅供浏览。" },
    "185p": { title: "韩式风味蘸酱", category: "new", art: "burger" },
    "939d": { title: "龙焰鸡腿堡与龙焰芝士棒鸡腿堡", category: "new", art: "burger" },
    pns1: { title: "蓝莓爆爆珠麦旋风", category: "new", art: "coffee" },
    "2yf9": { title: "厚松饼堡回归", category: "new", art: "burger", note: "正文只写 10 月 8 日起的优惠，未给出新的开售时刻。" },
    b429: { title: "麦咖啡浓浓黑巧", category: "new", art: "coffee" },
    vf8f: { title: "麦咖啡元气早餐", category: "new", art: "coffee" },
    "9b4e": { title: "灰焰圆筒", category: "new", art: "coffee" },
    oskp: { title: "150 天麦金学期卡", category: "new", art: "notebook" },
    "86i6": { title: "麦金卡龙焰鸡腿堡四件套", category: "new", art: "burger" },
    "7dgp": { title: "90 分钟亲子阅读体验", category: "meet", art: "notebook", note: "需要另行预约；本条内容没有具体场次日期和时间。" },
    "5lz9": { title: "过家家派对", category: "meet", art: "apron", note: "9 月 9 日是上线信息，具体预约场次时间仍未给出。" },
    "3pma": { title: "麦当劳趣读派对", category: "meet", art: "notebook", note: "需要另行预约；本条内容没有具体场次日期和时间。" },
  };
  const colors = { merch: "#edce78", new: "#eddbad", meet: "#dce3cf" };

  function validDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
    const stamp = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date;
  }

  function startStamp(event) {
    if (!validDate(event.date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.startTime || "")) return NaN;
    return Date.parse(`${event.date}T${event.startTime}:00+08:00`);
  }

  function canExport(event, now = Date.now()) {
    return event.verification === "verified" && Number.isFinite(startStamp(event)) && startStamp(event) > Number(now);
  }

  function checkTime(item, sourceDate, now) {
    const pending = (reason, extra = {}) => ({ verification: "pending", status: "pending", reason, ...extra });
    if (!item.hasStableCode) return pending("缺少可靠的活动编号，需要核实后再加入日历。");
    if (item.variants.length > 1) return pending("同一编号出现不同版本的活动文案，需要核实后再加入日历。");
    const body = normalize(item.content);
    const matches = [...body.matchAll(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*(?:起|准时|正式|\s)*(?:开售|发售|上市)/g)];
    if (!matches.length) return pending(metadata[item.activityCode]?.note || "正文没有明确的开售日期和时刻；列表日期不能代替开售日期。");
    const starts = [];
    for (const match of matches) {
      // A same-month announcement may omit its year. Cross-month/year dates
      // require explicit evidence instead of guessing from a timeline grouping.
      if (!match[1] && Number(match[2]) !== Number(sourceDate.slice(5, 7))) return pending("正文省略了年份且不在查询月份，需要核实年份。");
      const year = match[1] || sourceDate.slice(0, 4);
      const date = `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
      const startTime = `${match[4].padStart(2, "0")}:${match[5]}`;
      if (!Number.isFinite(startStamp({ date, startTime }))) return pending("正文中的日期或时刻无效，需要核实。");
      starts.push({ date, startTime, timeEvidence: match[0] });
    }
    if (new Set(starts.map((s) => `${s.date} ${s.startTime}`)).size > 1) return pending("正文出现多个不同的正式开售时间，需要核实具体场次。");
    const start = starts[0];
    const buttonTimes = item.buttonTimes.flatMap((text) => [...normalize(text).matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => `${m[1].padStart(2, "0")}:${m[2]}`));
    if (buttonTimes.some((time) => time !== start.startTime)) return pending("正文开售时间与提醒按钮时间不一致，暂不生成日历。", { timeEvidence: start.timeEvidence });
    const past = startStamp(start) <= now;
    const early = body.match(/APP[^\n]*积分[^\n]*?(\d{1,2}):(\d{2})\s*开抢/i);
    return {
      ...start, verification: "verified", status: past ? "past" : "ready",
      reason: past ? "这是已开售内容；后面的列表展示日期不是新的开售日。" : "开售日期与时刻已按官方正文核对。",
      earlyAccess: early ? `APP 积分抢先购 ${early[1].padStart(2, "0")}:${early[2]}` : "",
    };
  }

  function build(snapshot, now = Date.now()) {
    const sourceDate = snapshot?.source?.queriedAt?.slice(0, 10);
    if (!validDate(sourceDate) || !Array.isArray(snapshot.items) || !Number.isFinite(Number(now))) throw new Error("活动快照格式不完整，请重新打开页面。");
    const grouped = new Map();
    let displayEntries = 0;
    snapshot.items.forEach((raw, index) => {
      const code = typeof raw.activityCode === "string" ? raw.activityCode : "";
      const hasStableCode = /^[A-Za-z0-9_-]{1,80}$/.test(code);
      const key = hasStableCode ? `known:${code}` : `missing:${index}`;
      const content = typeof raw.content === "string" ? raw.content.slice(0, 20000) : "";
      const dates = [...new Set((Array.isArray(raw.displayDates) ? raw.displayDates : []).filter(validDate))];
      displayEntries += Math.max(1, dates.length);
      const previous = grouped.get(key);
      if (previous) {
        previous.displayDates = [...new Set([...previous.displayDates, ...dates])].sort();
        previous.variants = [...new Set([...previous.variants, normalize(content)])];
        previous.buttonTimes.push(String(raw.buttonTimeText || ""));
      } else {
        grouped.set(key, { id: hasStableCode ? `mcd-${code}` : `unidentified-${index}`, activityCode: code, hasStableCode, originalTitle: String(raw.title || "未命名活动").slice(0, 400), content, displayDates: dates.sort(), variants: [normalize(content)], buttonTimes: [String(raw.buttonTimeText || "")] });
      }
    });
    const items = [...grouped.values()].map((item) => {
      const meta = item.hasStableCode ? metadata[item.activityCode] : null;
      const category = meta?.category || "new";
      const description = item.content.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 80) || "查看官方活动文案了解详情。";
      const checked = checkTime(item, sourceDate, Number(now));
      if (snapshot.source.mode === "demo" && checked.status === "ready") checked.reason = "演示文案包含完整日期与时刻；全部活动虚构。";
      return { ...item, title: meta?.title || item.originalTitle, category, art: meta?.art || "notebook", color: colors[category], description, sourceMode: snapshot.source.mode || "real", sourceTime: snapshot.source.queriedAt, ...checked };
    });
    const rank = { ready: 0, pending: 1, past: 2 };
    items.sort((a, b) => rank[a.status] - rank[b.status] || (a.date || "").localeCompare(b.date || ""));
    return { items, source: snapshot.source, stats: { displayEntries, uniqueItems: items.length, mergedEntries: displayEntries - items.length, ready: items.filter((item) => canExport(item, now)).length } };
  }

  return Object.freeze({ build, canExport, startStamp });
})();

if (typeof module !== "undefined") module.exports = CampaignCatalog;
