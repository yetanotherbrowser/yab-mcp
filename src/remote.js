// The remote half of yab-mcp: OAuth device login and a stdio to Streamable
// HTTP bridge. Tokens belong to this assistant's cloud computer, never to
// the person's Yab Sync account or its encryption key.
import { createInterface } from "node:readline";
import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ORIGIN = "https://assist.yetanotherbrowser.com";
const GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const PROTOCOL = "2025-06-18";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function origin(value = process.env.YAB_MCP_URL || DEFAULT_ORIGIN) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("The remote server must use HTTPS (or localhost for a test).");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("The remote server address has unexpected parts.");
  return url.origin;
}

export function authFile() {
  return process.env.YAB_MCP_AUTH_FILE || join(homedir(), ".config", "yab-mcp", "auth.json");
}

async function saveAuth(auth, file = authFile()) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomBytes(6).toString("hex") + ".tmp";
  await writeFile(temp, JSON.stringify(auth), { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

async function loadAuth(file = authFile()) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch { return null; }
}

async function form(base, path, fields, fetcher = fetch) {
  const response = await fetcher(base + path, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

export async function login({ server = origin(), client = "yab-mcp", nonce, fetcher = fetch, write = (s) => process.stdout.write(s), sleep = pause,
                              file = authFile(), background = false, spawnWorker = spawn } = {}) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(client)) throw new Error("Client name must use letters, digits, dots, dashes or underscores.");
  if (nonce && !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) throw new Error("Connection nonce is invalid.");
  const base = origin(server);
  const issued = await form(base, "/oauth/device", { client_id: client, ...(nonce ? { nonce } : {}) }, fetcher);
  if (issued.status !== 200 || !issued.body.device_code || !issued.body.user_code) {
    throw new Error(issued.body.error_description || issued.body.error || `The server answered ${issued.status}.`);
  }
  const d = issued.body;
  write(`In Yab on your Mac, open Settings > AI > Assistants and enter ${d.user_code}.\n`);
  write(`Or open ${d.verification_uri} and follow its instructions.\n`);
  if (nonce) write(`Connection nonce: ${nonce}\n`);
  const pending = { server: base, client, device_code: d.device_code, interval: d.interval,
                    until: Date.now() + Math.min(600, Number(d.expires_in) || 600) * 1000, file };
  if (background) {
    const worker = spawnWorker(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), "login", "--complete"],
                               { detached: true, stdio: ["pipe", "ignore", "ignore"] });
    await new Promise((resolve, reject) => {
      worker.stdin.on("error", reject);
      worker.stdin.end(JSON.stringify(pending), resolve);
    });
    worker.unref();
    write("Show this code to the person now. Yab will connect after they allow it.\n");
    return;
  }
  await finishLogin(pending, { fetcher, sleep, write });
}

/// Called by the detached CLI worker after the shell command has already
/// returned the code to the bot. The device code stays in a private pipe.
export async function finishLogin(pending, { fetcher = fetch, sleep = pause, write = () => {} } = {}) {
  const { server, client, device_code, until, file } = pending;
  let interval = Math.max(1, Number(pending.interval) || 2);
  while (Date.now() < until) {
    await sleep(interval * 1000);
    const token = await form(server, "/oauth/token", { grant_type: GRANT, device_code, client_id: client }, fetcher);
    if (token.status === 200 && token.body.access_token && token.body.refresh_token) {
      await saveAuth({ origin: server, client_id: client, access_token: token.body.access_token,
                       refresh_token: token.body.refresh_token, expires_at: Date.now() + Number(token.body.expires_in || 0) * 1000 }, file);
      write("Connected to Yab.\n");
      return;
    }
    if (token.body.error === "authorization_pending") continue;
    if (token.body.error === "slow_down") { interval = Math.max(interval + 5, Number(token.body.interval) || 0); continue; }
    throw new Error(token.body.error_description || token.body.error || `The server answered ${token.status}.`);
  }
  throw new Error("The code expired. Run yab-mcp login again.");
}

async function usableAuth(server, fetcher, file) {
  const auth = await loadAuth(file);
  if (!auth || auth.origin !== server || !auth.access_token || !auth.refresh_token || !auth.client_id) {
    throw new Error("Yab is not connected here. Run yab-mcp login in this assistant's computer.");
  }
  if (Date.now() < (auth.expires_at || 0) - 60_000) return auth;
  const refreshed = await form(server, "/oauth/token", { grant_type: "refresh_token", refresh_token: auth.refresh_token,
                                                         client_id: auth.client_id }, fetcher);
  if (refreshed.status !== 200 || !refreshed.body.access_token || !refreshed.body.refresh_token) {
    throw new Error("Yab's connection expired or was removed. Run yab-mcp login again.");
  }
  const next = { ...auth, access_token: refreshed.body.access_token, refresh_token: refreshed.body.refresh_token,
                 expires_at: Date.now() + Number(refreshed.body.expires_in || 0) * 1000 };
  await saveAuth(next, file);
  return next;
}

export async function remoteCall(body, { server = origin(), fetcher = fetch, file = authFile() } = {}) {
  const base = origin(server);
  let auth = await usableAuth(base, fetcher, file);
  const send = (token) => fetcher(base + "/mcp", { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL, authorization: `Bearer ${token}`,
  }, body: JSON.stringify(body) });
  let response = await send(auth.access_token);
  if (response.status === 401) {
    auth = { ...auth, expires_at: 0 };
    await saveAuth(auth, file);
    auth = await usableAuth(base, fetcher, file);
    response = await send(auth.access_token);
  }
  if (response.status === 202 || response.status === 204) return null;
  if (!response.ok) throw new Error(`Yab's server answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/event-stream")) {
    const text = await response.text();
    const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).pop();
    return data ? JSON.parse(data) : null;
  }
  return response.json();
}

export async function serveRemote(options = {}) {
  const pending = new Set();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const work = (async () => {
      let request;
      try { request = JSON.parse(line); }
      catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n"); return; }
      try {
        const result = await remoteCall(request, options);
        if (result != null) process.stdout.write(JSON.stringify(result) + "\n");
      } catch (error) {
        if (request.id !== undefined && request.id !== null) {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id,
            error: { code: -32001, message: error.message } }) + "\n");
        }
      }
    })();
    pending.add(work);
    work.finally(() => pending.delete(work));
  }
  await Promise.allSettled(pending);
}

export async function runTask(words, options = {}) {
  if (!words.trim()) throw new Error("Give a task after yab-mcp task.");
  const response = await remoteCall({ jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "task", arguments: { prompt: words } } }, options);
  if (response?.error) throw new Error(response.error.message || "The task failed.");
  const content = response?.result?.content || [];
  const text = content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
  process.stdout.write(text + "\n");
  if (response?.result?.isError) process.exitCode = 1;
}
