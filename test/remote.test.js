import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { login, origin, remoteCall, taskStatus } from "../src/remote.js";

test("remote origin requires HTTPS, except localhost", () => {
  assert.equal(origin("https://assist.example"), "https://assist.example");
  assert.equal(origin("http://localhost:8787"), "http://localhost:8787");
  assert.throws(() => origin("http://assist.example"), /HTTPS/);
  assert.throws(() => origin("https://user:secret@assist.example"), /unexpected/);
});

test("device login binds a nonce, saves a private token, and sends an MCP call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yab-mcp-"));
  const file = join(dir, "auth.json");
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/oauth/device")) return Response.json({ device_code: "device", user_code: "ABCD-1234", verification_uri: "https://assist.example/connect", interval: 1, expires_in: 600 });
    if (url.endsWith("/oauth/token")) return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
    if (url.endsWith("/mcp")) return Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    throw new Error(url);
  };
  try {
    let said = "";
    await login({ server: "https://assist.example", client: "dots", nonce: "abcdefghijklmnop", file, fetcher, sleep: async () => {}, write: (part) => { said += part; } });
    assert.match(said, /ABCD-1234/);
    assert.equal(new URLSearchParams(calls[0].init.body).get("nonce"), "abcdefghijklmnop");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(file, "utf8")).client_id, "dots");
    const answer = await remoteCall({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { server: "https://assist.example", file, fetcher });
    assert.deepEqual(answer.result.tools, []);
    assert.equal(calls[2].init.headers.authorization, "Bearer access");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a mismatched nonce is rejected before the login request", async () => {
  await assert.rejects(login({ nonce: "short", fetcher: () => { throw new Error("called"); } }), /nonce/);
});

test("shell-only bots can check a task by session or use their newest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yab-mcp-status-"));
  const file = join(dir, "auth.json");
  const seen = [];
  const fetcher = async (_url, init) => {
    const request = JSON.parse(init.body);
    seen.push(request.params);
    return Response.json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "state: done" }] } });
  };
  try {
    await writeFile(file, JSON.stringify({ origin: "https://assist.example", client_id: "dots",
      access_token: "access", refresh_token: "refresh", expires_at: Date.now() + 3_600_000 }), { mode: 0o600 });
    let said = "";
    const options = { server: "https://assist.example", file, fetcher, write: (part) => { said += part; } };
    await taskStatus("session-1", options);
    await taskStatus(undefined, options);
    assert.deepEqual(seen, [
      { name: "task_status", arguments: { session: "session-1" } },
      { name: "task_status", arguments: {} },
    ]);
    assert.equal(said, "state: done\nstate: done\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the status CLI prints a remote task's next update", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yab-mcp-status-cli-"));
  const file = join(dir, "auth.json");
  let requested;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requested = JSON.parse(body);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "state: done" }] } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    await writeFile(file, JSON.stringify({ origin: base, client_id: "dots", access_token: "access",
      refresh_token: "refresh", expires_at: Date.now() + 3_600_000 }), { mode: 0o600 });
    const child = spawn(process.execPath, [new URL("../src/cli.js", import.meta.url).pathname,
      "status", "session-1", "--server", base],
    { env: { ...process.env, YAB_MCP_AUTH_FILE: file }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.equal(output, "state: done\n");
    assert.deepEqual(requested.params, { name: "task_status", arguments: { session: "session-1" } });
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("bot login returns its code before the person approves", async () => {
  let said = "", handed = "", detached = false, polls = 0;
  const fetcher = async (url) => {
    if (url.endsWith("/oauth/device")) return Response.json({ device_code: "private-device-code", user_code: "ABCD-1234",
      verification_uri: "https://assist.example/connect", interval: 2, expires_in: 600 });
    polls++;
    throw new Error("login waited for the person's answer");
  };
  const spawnWorker = (_node, args, options) => {
    assert.deepEqual(args.slice(-2), ["login", "--complete"]);
    assert.equal(options.detached, true);
    return { stdin: { on: () => {}, end: (data, done) => { handed = data; done(); } }, unref: () => { detached = true; } };
  };
  await login({ server: "https://assist.example", client: "dots", nonce: "abcdefghijklmnop",
                background: true, fetcher, spawnWorker, write: (part) => { said += part; } });
  assert.match(said, /ABCD-1234/);
  assert.equal(polls, 0);
  assert.equal(JSON.parse(handed).device_code, "private-device-code");
  assert.equal(detached, true);
});

test("CLI returns the code while its detached worker saves the token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yab-mcp-background-"));
  const file = join(dir, "auth.json");
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* drain the form */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.url === "/oauth/device"
      ? { device_code: "device", user_code: "ABCD-1234", verification_uri: "http://localhost/connect", interval: 1, expires_in: 5 }
      : { access_token: "access", refresh_token: "refresh", expires_in: 3600 }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    const child = spawn(process.execPath, [new URL("../src/cli.js", import.meta.url).pathname, "login", "--server",
      `http://127.0.0.1:${address.port}`, "--client", "dots", "--nonce", "abcdefghijklmnop"],
    { env: { ...process.env, YAB_MCP_AUTH_FILE: file }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.match(output, /ABCD-1234/);
    let auth;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { auth = JSON.parse(await readFile(file, "utf8")); break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.equal(auth?.access_token, "access");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
