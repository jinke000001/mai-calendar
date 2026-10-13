"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const State = require("./subscription-state.cjs");
const baseline = require("./activity-data.js");
const { writePrepared, maxBytes, defaultFile } = require("./manual-update.cjs");

const root = __dirname;
const assets = new Map(["index.html", "styles.css", "app.js", "campaigns.js", "calendar.js", "activity-data.js"].map((name) => [`/${name}`, name]));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

async function createServer({ stateDir = process.env.MAI_CALENDAR_DATA_DIR ? path.resolve(process.env.MAI_CALENDAR_DATA_DIR) : path.join(root, ".local-calendar"), preparedFile = defaultFile, snapshot = baseline, now = () => new Date() } = {}) {
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const stateFile = path.join(stateDir, "state.json");
  let state;
  try {
    state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    if (state.version !== 1 || !Number.isInteger(state.revision) || !state.entries || !["none", "previous-day", "same-day"].includes(state.reminder)) throw new Error("invalid state");
    state.snapshot = State.validateSnapshot(state.snapshot);
    State.feed(state);
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("本地保存的数据未能读取。原文件已保留，请按 README 的故障排查步骤处理后再启动。");
    state = State.initialState(snapshot, now());
  }
  let queue = Promise.resolve();
  const save = (operation) => {
    const job = queue.then(async () => {
      const next = operation(state);
      const temp = `${stateFile}.tmp`;
      await fs.writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await fs.rename(temp, stateFile);
      state = next;
    });
    queue = job.catch(() => {});
    return job;
  };
  const prepare = (factory, revision) => {
    const job = queue.then(async () => {
      const snapshot = factory(state.snapshot);
      State.applySnapshot(state, snapshot, revision, now()); // Validate against current choices before replacing the pending file.
      await writePrepared(snapshot, preparedFile);
    });
    queue = job.catch(() => {});
    return job;
  };
  async function prepared() {
    try {
      const stat = await fs.stat(preparedFile);
      if (stat.size > 2 * 1024 * 1024) State.fail("快照过大，原活动与选择已保留。");
      return State.validateSnapshot(JSON.parse(await fs.readFile(preparedFile, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") State.fail("还没有新的手动查询快照。请先导入活动快照，再点击更新。", "NO_PREPARED_SNAPSHOT", 409);
      if (error instanceof SyntaxError) State.fail("新快照未能读取，原活动与选择已保留。");
      throw error;
    }
  }
  async function view() {
    const current = state;
    let preparedAt = null;
    try { preparedAt = (await prepared()).source.queriedAt; } catch { /* Update button reports an actionable error. */ }
    return { snapshot: current.snapshot, selected: Object.keys(current.entries), selectedEvents: State.selectedEvents(current), reminder: current.reminder,
      initialized: current.initialized, revision: current.revision, lastUpdate: current.lastUpdate, updatedAt: current.updatedAt, preparedAt };
  }
  function reply(res, status, body, type = "application/json") {
    res.writeHead(status, { "Content-Type": `${type};charset=utf-8` });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  }
  async function readJson(req, limit = 32768) {
    if (req.headers["content-type"]?.split(";")[0] !== "application/json") State.fail("请求格式无效。", "CONTENT_TYPE", 415);
    const parts = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) State.fail("请求过大。", "REQUEST_TOO_LARGE", 413);
      parts.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { State.fail("请求内容未能读取。", "INVALID_JSON", 400); }
  }
  const server = http.createServer(async (req, res) => {
    const host = `127.0.0.1:${server.address().port}`;
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      // Exact Host plus same-origin JSON writes protects a loopback service from
      // other websites and DNS rebinding. No CORS, credentials or remote fetches.
      if (req.headers.host !== host) State.fail("请使用本地预览地址访问。", "INVALID_HOST", 403);
      const url = new URL(req.url, `http://${host}`);
      if (req.method === "POST") {
        if (req.headers.origin !== `http://${host}`) State.fail("只接受当前本地页面的操作。", "INVALID_ORIGIN", 403);
        const input = await readJson(req, url.pathname === "/api/snapshots" ? maxBytes : 32768);
        if (!input || typeof input !== "object" || Array.isArray(input)) State.fail("请求内容无效。");
        if (url.pathname === "/api/preferences") await save((current) => State.setPreferences(current, input, now()));
        else if (url.pathname === "/api/updates") { const next = await prepared(); await save((current) => State.applySnapshot(current, next, input.revision, now())); }
        else if (url.pathname === "/api/snapshots") await prepare(() => input.snapshot, input.revision);
        else if (url.pathname === "/api/demo-updates") await prepare((snapshot) => {
          if (snapshot.source.mode !== "demo") State.fail("演示改期只适用于虚构活动，真实数据已保留。", "REAL_DATA_PROTECTED", 409);
          try { return baseline.rescheduleDemo(snapshot, now()); } catch { State.fail("当前演示快照没有可改期的徽章，请使用全新演示目录。"); }
        }, input.revision);
        else State.fail("没有这个操作。", "NOT_FOUND", 404);
        reply(res, 200, await view()); return;
      }
      if (!["GET", "HEAD"].includes(req.method)) State.fail("不支持这个请求方法。", "METHOD_NOT_ALLOWED", 405);
      if (url.pathname === "/api/state") { reply(res, 200, await view()); return; }
      if (url.pathname === "/calendar.ics") {
        const body = State.feed(state);
        const etag = `"${crypto.createHash("sha256").update(body).digest("hex")}"`;
        res.setHeader("ETag", etag);
        if (req.headers["if-none-match"] === etag) { res.writeHead(304); res.end(); return; }
        reply(res, 200, req.method === "HEAD" ? "" : body, "text/calendar"); return;
      }
      const file = assets.get(url.pathname === "/" ? "/index.html" : url.pathname);
      if (!file) State.fail("页面不存在。", "NOT_FOUND", 404);
      const body = await fs.readFile(path.join(root, file));
      reply(res, 200, req.method === "HEAD" ? "" : body, types[path.extname(file)]);
    } catch (error) {
      if (!res.headersSent) reply(res, error.status || 500, { error: { code: error.status ? error.code : "LOCAL_SERVICE_ERROR", message: error.status ? error.message : "本地操作未完成，请重试或按 README 排查。" } });
      else res.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.MAI_CALENDAR_PORT || 3268);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error("MAI_CALENDAR_PORT 必须为 1024 到 65535 的端口。"); process.exit(1); }
  createServer().then((server) => {
    server.on("error", (error) => { console.error(error.code === "EADDRINUSE" ? `端口 ${port} 已被占用，请先关闭原预览服务。` : "本地服务启动失败。"); process.exitCode = 1; });
    server.listen(port, "127.0.0.1", () => console.log(`麦日历已启动：http://127.0.0.1:${port}\n保留此窗口，Mac 日历才能刷新本地订阅。按 Control+C 可停止。`));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { createServer };
