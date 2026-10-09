import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fakeApp, reader, scratch } from "./helpers.js";

const cli = new URL("../src/cli.js", import.meta.url).pathname;

// A stand-in for `yab mcp`: says its arguments and YAB_CLI, echoes each line
// of stdin, exits with 7 on "exit7", kills itself on "die", and answers
// SIGTERM by saying so.
const STAND_IN = `#!${process.execPath}
const readline = require("node:readline");
console.log("args:" + process.argv.slice(2).join(" "));
console.log("cli:" + process.env.YAB_CLI);
process.on("SIGTERM", () => { console.log("got:SIGTERM"); process.exit(143); });
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (line === "exit7") process.exit(7);
  if (line === "die") process.kill(process.pid, "SIGKILL");
  console.log("echo:" + line);
});
lines.on("close", () => { console.log("eof"); process.exit(0); });
`;

function start(args = []) {
  const dir = scratch();
  const app = fakeApp(dir, { script: STAND_IN });
  const child = spawn(process.execPath, [cli, ...args], {
    env: { PATH: process.env.PATH, HOME: dir, YAB_APP: app },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  return { child, next: reader(child.stdout), exited };
}

test("runs `yab mcp` with YAB_CLI=1 and the arguments passed on", async () => {
  const { child, next, exited } = start(["--socket", "/tmp/x.sock"]);
  assert.equal(await next(), "args:mcp --socket /tmp/x.sock");
  assert.equal(await next(), "cli:1");
  child.stdin.end();
  assert.equal(await next(), "eof");
  assert.deepEqual(await exited, { code: 0, signal: null });
});

test("passes stdin and stdout straight through", async () => {
  const { child, next, exited } = start();
  await next();
  await next();
  const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  child.stdin.write(message + "\n");
  assert.equal(await next(), "echo:" + message);
  child.stdin.write("second line\n");
  assert.equal(await next(), "echo:second line");
  child.stdin.end();
  assert.equal(await next(), "eof");
  await exited;
});

test("ends with the child's exit code", async () => {
  const { child, next, exited } = start();
  await next();
  await next();
  child.stdin.write("exit7\n");
  assert.deepEqual(await exited, { code: 7, signal: null });
});

test("passes SIGTERM on to the child", async () => {
  const { child, next, exited } = start();
  await next();
  await next();
  child.kill("SIGTERM");
  assert.equal(await next(), "got:SIGTERM");
  assert.deepEqual(await exited, { code: 143, signal: null });
});

test("ends by the child's signal when the child is killed", async () => {
  const { child, next, exited } = start();
  await next();
  await next();
  child.stdin.write("die\n");
  assert.deepEqual(await exited, { code: null, signal: "SIGKILL" });
});
