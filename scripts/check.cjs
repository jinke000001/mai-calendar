"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("._") || [".git", "node_modules", "output", ".local-calendar", ".playwright-cli"].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:js|cjs)$/.test(entry.name)) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
  }
}
walk(root); console.log("JavaScript syntax checks passed.");
