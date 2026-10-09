#!/usr/bin/env node
// Takes a new snapshot of Yab's tools from the Yab on this Mac and writes
// src/tools.json and the README's tool list.
//
//   node scripts/snapshot.mjs [--app /Applications/yab.app]
//   node scripts/snapshot.mjs --readme     (README only, from src/tools.json)
//
// It sends `yab mcp` only initialize and tools/list. It never calls a tool.
// Listing reads Yab's settings through its socket; with Yab closed, it may
// open Yab hidden (no window, no Dock tile), as any agent's first call does.
// Tools Yab lists only when something is turned on (Gmail, Messages) come
// only from a Mac that has them on: the script says which are missing.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executableOf, findYab } from "../src/find.js";
import { CONDITIONS, read, readmeTools, replaceBetween, write } from "./lib.mjs";

// --readme: only write the README's tool list again, from src/tools.json.
if (process.argv.includes("--readme")) {
  const current = JSON.parse(read("src/tools.json"));
  write("README.md", replaceBetween(read("README.md"), "<!-- tools:start -->", "<!-- tools:end -->", readmeTools(current)));
  process.exit(0);
}

const at = process.argv.indexOf("--app");
const yab = at > 0 ? { app: process.argv[at + 1], executable: executableOf(process.argv[at + 1]) } : findYab();
if (!yab) {
  console.error("No Yab on this Mac. Install it, or pass --app /path/to/yab.app.");
  process.exit(1);
}

function build(app) {
  try {
    const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
    return /<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1] ?? null;
  } catch {
    return null;
  }
}

function list(executable) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["mcp"], { env: { ...process.env, YAB_CLI: "1" }, stdio: ["pipe", "pipe", "inherit"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("yab mcp didn't answer in 30 seconds"));
    }, 30_000);
    const answers = {};
    let buffer = "";
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id === 1) {
          answers.initialize = message;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (message.id === 2) {
          answers.list = message;
          child.stdin.end();
        }
      }
    });
    child.on("error", reject);
    child.on("exit", () => {
      clearTimeout(timer);
      if (!answers.list) reject(new Error("yab mcp ended before it listed its tools"));
      else resolve(answers);
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "yab-mcp-snapshot", version: "1" } },
    });
  });
}

const answers = await list(yab.executable);
if (answers.list.error) throw new Error(`tools/list failed: ${JSON.stringify(answers.list.error)}`);
const { serverInfo } = answers.initialize.result;
const { tools } = answers.list.result;

const snapshot = {
  note: "Yab's tools as `yab mcp` listed them. Made by scripts/snapshot.mjs; don't edit by hand.",
  yab: { version: serverInfo.version, build: build(yab.app) },
  taken: new Date().toISOString().slice(0, 10),
  tools,
};
write("src/tools.json", JSON.stringify(snapshot, null, 2) + "\n");
write("README.md", replaceBetween(read("README.md"), "<!-- tools:start -->", "<!-- tools:end -->", readmeTools(snapshot)));

console.log(`${tools.length} tools from Yab ${snapshot.yab.version} (${snapshot.yab.build}) at ${yab.app}`);
const names = new Set(tools.map((tool) => tool.name));
for (const [key, condition] of Object.entries(CONDITIONS)) {
  const missing = condition.tools.filter((name) => !names.has(name));
  if (missing.length) console.warn(`missing (${key}, ${condition.note}): ${missing.join(", ")}`);
}
