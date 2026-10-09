import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { reason, recentMac, serveFallback } from "../src/fallback.js";
import { reader, scratch } from "./helpers.js";

const cli = new URL("../src/cli.js", import.meta.url).pathname;
const { tools } = JSON.parse(readFileSync(new URL("../src/tools.json", import.meta.url), "utf8"));

test("the snapshot holds Yab's real tools", () => {
  assert.ok(tools.length >= 30);
  for (const tool of tools) {
    assert.equal(typeof tool.name, "string");
    assert.equal(typeof tool.description, "string");
    assert.equal(tool.inputSchema.type, "object");
  }
  for (const name of ["open", "snapshot", "click", "type", "tabs"]) assert.ok(tools.some((tool) => tool.name === name), name);
});

test("says why, with the download link, for each case", () => {
  assert.match(reason({ platform: "darwin", darwin: "25.0.0", env: {} }), /isn't installed on this Mac.*https:\/\/yetanotherbrowser\.com\/dl\?ref=npm/);
  assert.match(reason({ platform: "linux", darwin: "6.8.0", env: {} }), /is a Mac app/);
  assert.match(reason({ platform: "darwin", darwin: "24.3.0", env: {} }), /needs macOS 15\.4 or later/);
  assert.match(reason({ platform: "darwin", darwin: "25.0.0", env: { YAB_APP: "/x.app" } }), /YAB_APP is set to \/x\.app/);
  assert.equal(recentMac("24.4.0"), true);
  assert.equal(recentMac("24.3.9"), false);
  assert.equal(recentMac("23.6.0"), false);
  assert.equal(recentMac("27.0.0"), true);
});

test("answers in process: recheck replaces the reason once Yab is there", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const next = reader(output);
  let installed = false;
  serveFallback({ input, output, version: "9.9.9", why: "not here", recheck: () => (installed ? "installed now" : null), onClose: () => {} });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "open", arguments: {} } }) + "\n");
  assert.equal(JSON.parse(await next()).result.content[0].text, "not here");
  installed = true;
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "open", arguments: {} } }) + "\n");
  assert.equal(JSON.parse(await next()).result.content[0].text, "installed now");
  input.end();
});

test("without Yab, serves initialize, tools/list and tools/call over stdio", async () => {
  const home = scratch();
  // YAB_APP naming nothing makes the CLI fall back on any machine, this one included.
  const child = spawn(process.execPath, [cli], {
    env: { PATH: process.env.PATH, HOME: home, YAB_APP: join(home, "Missing.app") },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const next = reader(child.stdout);
  const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  const init = JSON.parse(await next());
  assert.equal(init.id, 1);
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "yab-browser");
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });

  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const list = JSON.parse(await next());
  assert.equal(list.id, 2);
  assert.deepEqual(list.result.tools.map((tool) => tool.name), tools.map((tool) => tool.name));

  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "open", arguments: { url: "https://example.com" } } });
  const call = JSON.parse(await next());
  assert.equal(call.id, 3);
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /YAB_APP is set/);

  send({ jsonrpc: "2.0", id: 4, method: "resources/list" });
  assert.equal(JSON.parse(await next()).error.code, -32601);

  child.stdin.write("not json\n");
  assert.equal(JSON.parse(await next()).error.code, -32700);

  send({ jsonrpc: "2.0", id: 5, method: "ping" });
  assert.deepEqual(JSON.parse(await next()), { jsonrpc: "2.0", id: 5, result: {} });

  child.stdin.end();
  const [code] = await new Promise((resolve) => child.on("exit", (...args) => resolve(args)));
  assert.equal(code, 0);
});

test("--version and --help", async () => {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const run = (args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [cli, ...args], { env: { PATH: process.env.PATH, HOME: scratch(), YAB_APP: "/nowhere/yab.app" } });
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.on("exit", (code) => resolve({ code, out }));
    });
  assert.deepEqual(await run(["--version"]), { code: 0, out: `${version}\n` });
  const help = await run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.out, /npx -y yab-mcp/);
  assert.match(help.out, /Yab:  not found/);
});
