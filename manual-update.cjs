"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const State = require("./subscription-state.cjs");
const defaultFile = process.env.MAI_CALENDAR_DATA_DIR ? path.resolve(process.env.MAI_CALENDAR_DATA_DIR, "latest.json") : path.join(__dirname, "output/manual-updates/latest.json");
const maxBytes = 2 * 1024 * 1024;

// Preparation stores only allowlisted public fields. Applying it remains a
// separate user action; this module never contacts MCP or reads credentials.
async function writePrepared(input, file = defaultFile) {
  const safe = State.validateSnapshot(input);
  const data = JSON.stringify(safe, null, 2);
  if (Buffer.byteLength(data) > maxBytes) State.fail("快照超过 2 MiB，原数据已保留。", "REQUEST_TOO_LARGE", 413);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { await fs.writeFile(temp, data, { mode: 0o600, flag: "wx" }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
  return safe;
}
module.exports = { writePrepared, defaultFile, maxBytes };
