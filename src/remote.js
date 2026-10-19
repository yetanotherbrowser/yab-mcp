// The remote half of yab-mcp: OAuth device login and a stdio to Streamable
// HTTP bridge. Tokens belong to this assistant's cloud computer, never to
// the person's Yab Sync account or its encryption key.
import { createInterface } from "node:readline";
import { mkdir, readFile, rename, writeFile, chmod, unlink } from "node:fs/promises";
import { accessSync, constants, existsSync, openSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ORIGIN = "https://yab-sync.21st.workers.dev";
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

// Where the token may live, in order. A bot's computer may keep its home
// read-only (dots: /home/agent) and its work in a shared folder that every
// worker sees (/workspace/shared), so the first writable one is used, and an
// existing connection is found wherever an earlier login put it.
export function authPlaces(home = homedir(), cwd = process.cwd()) {
  return [join(home, ".config", "yab-mcp", "auth.json"), "/workspace/shared/.yab-mcp/auth.json",
          "/workspace/.yab-mcp/auth.json", join(cwd, ".yab-mcp", "auth.json")];
}

function writableDir(dir) {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(at)) {
      try { accessSync(at, constants.W_OK); return statSync(at).isDirectory(); } catch { return false; }
    }
    if (dirname(at) === at) return false;
  }
}

export function authFile(places = authPlaces()) {
  if (process.env.YAB_MCP_AUTH_FILE) return process.env.YAB_MCP_AUTH_FILE;
  const kept = places.find((file) => existsSync(file) || existsSync(file + ".pending"));
  return kept || places.find((file) => writableDir(dirname(file))) || places[0];
}

// A login waiting for the person's Allow, kept beside the token: a bot's
// computer may end the background worker with the command that started it,
// so the next yab-mcp command finishes the login instead.
function pendingFile(file) { return file + ".pending"; }

async function saveAuth(auth, file = authFile()) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomBytes(6).toString("hex") + ".tmp";
  await writeFile(temp, JSON.stringify(auth), { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

/// Fails now, while the bot is still listening, rather than in the
/// background worker after the person has already allowed it.
async function checkWritable(file) {
  const probe = file + "." + randomBytes(6).toString("hex") + ".probe";
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(probe, "", { mode: 0o600 });
    await unlink(probe);
  } catch (error) {
    throw new Error(`Can't save the connection in ${dirname(file)} (${error.code || error.message}). Set YAB_MCP_AUTH_FILE to a writable path and run login again.`);
  }
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
  await checkWritable(file);
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
  await saveAuth({ ...pending, user_code: d.user_code }, pendingFile(file));
  if (background) {
    const worker = spawnWorker(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), "login", "--complete"],
                               { detached: true, stdio: ["pipe", "ignore", workerLog(file)] });
    await new Promise((resolve, reject) => {
      worker.stdin.on("error", reject);
      worker.stdin.end(JSON.stringify(pending), resolve);
    });
    worker.unref();
    write("Show this code to the person now. Yab will connect after they allow it.\n");
    write("If this computer ends background processes, any yab-mcp command run after they allow finishes connecting.\n");
    return;
  }
  await finishLogin(pending, { fetcher, sleep, write });
}

// What the background worker says, if it fails, lands beside the token.
function workerLog(file) {
  try { return openSync(file + ".log", "w", 0o600); } catch { return "ignore"; }
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
      const auth = { origin: server, client_id: client, access_token: token.body.access_token,
                     refresh_token: token.body.refresh_token, expires_at: Date.now() + Number(token.body.expires_in || 0) * 1000 };
      await saveAuth(auth, file);
      await unlink(pendingFile(file)).catch(() => {});
      write("Connected to Yab.\n");
      return auth;
    }
    if (token.body.error === "authorization_pending") continue;
    if (token.body.error === "slow_down") { interval = Math.max(interval + 5, Number(token.body.interval) || 0); continue; }
    throw new Error(token.body.error_description || token.body.error || `The server answered ${token.status}.`);
  }
  throw new Error("The code expired. Run yab-mcp login again.");
}

// One refresh at a time per file: a refresh token works once, so two calls
// refreshing together would log the second one out.
const refreshing = new Map();

/// The login a worker didn't live to finish: asks the server for a while
/// (20 s by default) whether the person has allowed it yet.
async function finishPending(server, fetcher, file, { sleep = pause, wait = 20_000 } = {}) {
  const pending = await loadAuth(pendingFile(file));
  if (!pending || pending.server !== server || !pending.device_code) return null;
  if (Date.now() >= pending.until) {
    await unlink(pendingFile(file)).catch(() => {});
    throw new Error("The connection code expired before it was allowed. Run yab-mcp login again.");
  }
  try {
    return await finishLogin({ ...pending, file, until: Math.min(pending.until, Date.now() + wait) }, { fetcher, sleep });
  } catch (error) {
    if (/expired/.test(error.message) && Date.now() < pending.until) {
      throw new Error(`Yab hasn't been allowed yet. Ask the person to enter ${pending.user_code} in Yab on their Mac (Settings > AI > Assistants) and press Allow, then try again.`);
    }
    await unlink(pendingFile(file)).catch(() => {});
    throw error;
  }
}

async function usableAuth(server, fetcher, file, options) {
  let auth = await loadAuth(file);
  if (!auth || auth.origin !== server || !auth.access_token || !auth.refresh_token || !auth.client_id) {
    auth = await finishPending(server, fetcher, file, options);
    if (!auth) throw new Error("Yab is not connected here. Run yab-mcp login in this assistant's computer.");
    return auth;
  }
  if (Date.now() < (auth.expires_at || 0) - 60_000) return auth;
  if (refreshing.has(file)) return refreshing.get(file);
  const work = (async () => {
    const refreshed = await form(server, "/oauth/token", { grant_type: "refresh_token", refresh_token: auth.refresh_token,
                                                           client_id: auth.client_id }, fetcher);
    if (refreshed.status !== 200 || !refreshed.body.access_token || !refreshed.body.refresh_token) {
      // Another process may have refreshed it first.
      const now = await loadAuth(file);
      if (now && now.refresh_token !== auth.refresh_token && Date.now() < (now.expires_at || 0) - 60_000) return now;
      throw new Error("Yab's connection expired or was removed. Run yab-mcp login again.");
    }
    const next = { ...auth, access_token: refreshed.body.access_token, refresh_token: refreshed.body.refresh_token,
                   expires_at: Date.now() + Number(refreshed.body.expires_in || 0) * 1000 };
    await saveAuth(next, file);
    return next;
  })();
  refreshing.set(file, work);
  try { return await work; } finally { refreshing.delete(file); }
}

export async function remoteCall(body, { server = origin(), fetcher = fetch, file = authFile(), pending } = {}) {
  const base = origin(server);
  let auth = await usableAuth(base, fetcher, file, pending);
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

async function runTool(name, args, options) {
  const response = await remoteCall({ jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name, arguments: args } }, options);
  if (response?.error) throw new Error(response.error.message || "The task failed.");
  const content = response?.result?.content || [];
  const text = content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
  (options.write || process.stdout.write.bind(process.stdout))(text + "\n");
  if (response?.result?.isError) process.exitCode = 1;
}

export async function runTask(words, options = {}) {
  if (!words.trim()) throw new Error("Give a task after yab-mcp task.");
  await runTool("task", { prompt: words }, options);
}

export async function taskStatus(session, options = {}) {
  await runTool("task_status", session ? { session } : {}, options);
}
