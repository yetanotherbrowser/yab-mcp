// A small MCP server for when Yab can't run here: no Yab on this Mac, or
// not a Mac. It lists Yab's real tools (a snapshot taken from `yab mcp`,
// src/tools.json) so a client or a directory sees what Yab offers, and it
// answers every tool call with an error that says how to get Yab.

import { readFileSync } from "node:fs";
import { release } from "node:os";
import { createInterface } from "node:readline";

export const DOWNLOAD = "https://yetanotherbrowser.com/dl?ref=npm";
export const DEVELOPERS = "https://yetanotherbrowser.com/developers";

export function snapshot() {
  return JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
}

/** Whether this macOS is 15.4 or later (Darwin 24.4 or later). */
export function recentMac(darwin = release()) {
  const [major, minor] = darwin.split(".").map(Number);
  return major > 24 || (major === 24 && minor >= 4);
}

/** Why Yab's tools can't run here, in words a model can pass on. */
export function reason({ platform = process.platform, darwin = release(), env = process.env } = {}) {
  if (env.YAB_APP) {
    return `YAB_APP is set to ${env.YAB_APP}, but there is no Yab there (no Contents/MacOS/yab). Fix or unset YAB_APP, then restart this MCP server.`;
  }
  if (platform !== "darwin") {
    return `Yab, Yet Another Browser, is a Mac app, so its tools can't run on this computer. It needs macOS 15.4 or later: ${DEVELOPERS}`;
  }
  if (!recentMac(darwin)) {
    return `Yab, Yet Another Browser, needs macOS 15.4 or later, and this Mac has an older macOS, so its tools can't run here. More: ${DEVELOPERS}`;
  }
  return `Yab, Yet Another Browser, isn't installed on this Mac, so this tool can't run. Ask the user to download Yab (free, macOS 15.4 or later) from ${DOWNLOAD}, open it once, then restart this MCP server.`;
}

/**
 * Serves MCP over newline-delimited JSON-RPC on `input` and `output`.
 * `why` says why every tool fails; `recheck` may return a newer reason, as
 * when Yab was installed after this server started.
 */
export function serveFallback({
  input = process.stdin,
  output = process.stdout,
  version = "0.0.0",
  why = reason(),
  recheck = () => null,
  onClose = () => process.exit(0),
} = {}) {
  const { tools } = snapshot();
  const send = (message) => output.write(JSON.stringify(message) + "\n");
  const reply = (id, result) => send({ jsonrpc: "2.0", id, result });

  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
      return;
    }
    const { id, method, params = {} } = message;
    // A notification wants nothing back.
    if (id === undefined || id === null) return;
    switch (method) {
      case "initialize":
        reply(id, {
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "yab-browser", title: "Yab, Yet Another Browser", version },
          instructions: why,
        });
        break;
      case "ping":
        reply(id, {});
        break;
      case "tools/list":
        reply(id, { tools });
        break;
      case "tools/call":
        reply(id, { content: [{ type: "text", text: recheck() ?? why }], isError: true });
        break;
      default:
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  });
  lines.on("close", onClose);
  return lines;
}
