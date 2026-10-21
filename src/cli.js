#!/usr/bin/env node
// yab-mcp: Yab's MCP server for any agent.
//
// With Yab on this Mac, it runs `yab mcp` from the app, with YAB_CLI=1, as
// the `yab` command does. Without it, or off a Mac, it serves the list of
// Yab's tools and answers each call with how to get Yab.

import { readFileSync } from "node:fs";
import { findYab } from "./find.js";
import { forward } from "./forward.js";
import { DOWNLOAD, DEVELOPERS, reason, serveFallback } from "./fallback.js";
import { finishLogin, login, origin, runTask, serveRemote, taskStatus } from "./remote.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  const yab = findYab();
  const where = yab
    ? `Yab:  ${yab.app} (found by ${yab.via})`
    : `Yab:  not found. ${reason()}`;
  process.stdout.write(`yab-mcp ${version}: the MCP server of Yab, Yet Another Browser

Usage:
  npx -y yab-mcp           Start the MCP server on stdio (an MCP client runs this)
  npx yab-mcp --help       Show this help and where Yab is
  npx yab-mcp --version    Show the version of yab-mcp
  npx yab-mcp login --client dots  Link this assistant's computer to Yab
  npx yab-mcp --remote      Direct browser control through a stdio MCP client
  npx yab-mcp task WORDS    Delegate to Yab's model; uses the user's plan limits
  npx yab-mcp status [SESSION]  Check a delegated task; omit SESSION for the newest

Choose how remote work runs after login:
  --remote: your existing assistant calls open, snapshot, click, type, etc.
    Configure its MCP server with command "npx", args ["-y", "yab-mcp", "--remote"].
    This is a JSON-RPC stdio bridge, not a shell command that accepts task words.
    Your assistant uses its own model/account; the bridge starts no Yab model run.
    Calling the task MCP tool through this bridge still delegates as below.
  task: hand the job to the model selected for Tasks in Yab on the Mac.
    ChatGPT (via Codex) consumes the user's ChatGPT limits; Claude uses their
    Claude plan instead. Choose this only when you intend that delegation.
    Example: npx yab-mcp task "Find a table for Friday"
    Then:    npx yab-mcp status SESSION  (use the returned session ID)
    Or:      npx yab-mcp status          (newest task after a reconnect)

Both modes keep the assistant's existing account access and approval settings.
login also accepts --nonce NONCE when Yab's Connect flow supplies a real nonce.

${where}

With Yab on this Mac, yab-mcp runs "yab.app/Contents/MacOS/yab mcp" with
YAB_CLI=1, passing other arguments on. Without it, it lists Yab's tools and
each call says how to get Yab.

Environment:
  YAB_APP   The path to yab.app, when it isn't in Applications
  YAB_MCP_URL   Remote Yab server (HTTPS, or localhost for tests)

Download: ${DOWNLOAD}
More:     ${DEVELOPERS}
`);
  process.exit(0);
}

if (args[0] === "login" || args[0] === "task" || args[0] === "status" || args.includes("--remote")) {
  const value = (flag) => {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${flag} needs a value.`);
    return args[index + 1];
  };
  try {
    if (args[0] === "login" && args[1] === "--complete") {
      const pending = JSON.parse(readFileSync(0, "utf8"));
      await finishLogin(pending);
      process.exit();
    }
    const server = origin(value("--server"));
    if (args[0] === "login") {
      const allowed = new Set(["login", "--client", "--nonce", "--server"]);
      if (args.some((word) => word.startsWith("--") && !allowed.has(word))) throw new Error("Unknown login option.");
      await login({ server, client: value("--client") || "yab-mcp", nonce: value("--nonce"), background: true });
    } else if (args[0] === "task") {
      const words = args.slice(1).filter((word, index, list) => word !== "--server" && (index === 0 || list[index - 1] !== "--server"));
      await runTask(words.join(" "), { server });
    } else if (args[0] === "status") {
      const values = args.slice(1).filter((word, index, list) => word !== "--server" && (index === 0 || list[index - 1] !== "--server"));
      if (values.length > 1) throw new Error("Give one session id, or omit it for the newest task.");
      await taskStatus(values[0], { server });
    } else {
      await serveRemote({ server });
    }
  } catch (error) {
    process.stderr.write(`yab-mcp: ${error.message}\n`);
    process.exitCode = 1;
  }
  process.exit();
}

function fallback(why) {
  serveFallback({
    version,
    why,
    recheck: () => {
      const now = findYab();
      return now
        ? `Yab is installed now (${now.app}). Restart this MCP server so its tools come from Yab.`
        : null;
    },
  });
}

const yab = findYab();
if (yab) {
  forward(yab.executable, ["mcp", ...args], {
    onError: (error) =>
      fallback(`Yab is at ${yab.app}, but it couldn't be started (${error.code ?? error.message}). Check that it opens, then restart this MCP server.`),
  });
} else {
  fallback(reason());
}
