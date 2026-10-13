"use strict";
// Constructed input for deterministic rule tests; this is not an MCP response.
const codes = ["cme8", "m228", "en70", "939d", ...Array.from({ length: 12 }, (_, i) => `test-${i}`)];
module.exports = {
  source: { mode: "real", service: "麦当劳中国官方 MCP", tool: "campaign-calendar", arguments: {}, queriedAt: "2026-10-13 08:10:56" },
  items: codes.map((activityCode, i) => ({
    activityCode, title: `构造测试条目 ${i + 1}`,
    content: i === 0 ? "构造测试徽章\n10月15日10:45开售\nAPP专享积分抢先购10:40开抢" : i === 1 ? "构造测试丝巾\n10月22日10:45开售" : i === 2 ? "构造测试帽子\n10月8日10:45开售" : i === 3 ? "构造测试旧条目\n10月8日10:30开售" : "构造测试文案，没有开售时刻。",
    displayDates: i < 11 ? ["2026-10-13", "2026-10-16"] : ["2026-10-13"],
    buttonTimeText: i === 2 ? "10:30开始" : "",
  })),
};
