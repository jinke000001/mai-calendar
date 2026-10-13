"use strict";

const fs = require("node:fs/promises");
const { writePrepared, maxBytes } = require("../manual-update.cjs");
async function main() {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) throw new Error("用法：npm run snapshot:prepare -- /path/to/snapshot.json");
  if ((await fs.stat(file)).size > maxBytes) throw new Error("快照超过 2 MiB。");
  let input;
  try { input = JSON.parse(await fs.readFile(file, "utf8")); } catch { throw new Error("快照必须是有效 JSON 文件。"); }
  const safe = await writePrepared(input);
  console.log(`已准备 ${safe.source.queriedAt} 的${safe.source.mode === "demo" ? "虚构演示" : "活动"}快照。请在页面点击“更新活动”。`);
}
main().catch(() => { console.error("快照未能准备，原数据已保留。请检查文件路径、JSON 格式和 README 的字段说明。用法：npm run snapshot:prepare -- /path/to/snapshot.json"); process.exitCode = 1; });
