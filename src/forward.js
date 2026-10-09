// Runs `<yab.app>/Contents/MacOS/yab mcp` in this process's place, as far as
// Node allows: the child gets this process's stdin, stdout and stderr as
// they are (nothing copied in between), signals sent here go on to it, and
// this process ends the way it ends, with its exit code or its signal.

import { spawn } from "node:child_process";
import { constants } from "node:os";

const FORWARDED = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];

export function forward(executable, args, { env = process.env, onError } = {}) {
  const child = spawn(executable, args, {
    stdio: "inherit",
    env: { ...env, YAB_CLI: "1" },
  });

  const handlers = FORWARDED.map((signal) => {
    const handler = () => {
      try {
        child.kill(signal);
      } catch {
        // Gone already: its exit ends this process.
      }
    };
    process.on(signal, handler);
    return [signal, handler];
  });
  const stopForwarding = () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };

  let started = false;
  child.on("spawn", () => {
    started = true;
  });

  child.on("error", (error) => {
    if (started) return;
    stopForwarding();
    if (onError) onError(error);
    else {
      process.stderr.write(`yab-mcp: couldn't start ${executable}: ${error.message}\n`);
      process.exit(127);
    }
  });

  child.on("exit", (code, signal) => {
    if (!started) return;
    stopForwarding();
    if (signal) {
      // Ended by a signal: end the same way, so the client sees what it did.
      process.kill(process.pid, signal);
      setTimeout(() => process.exit(128 + (constants.signals[signal] ?? 1)), 200);
      return;
    }
    process.exit(code ?? 1);
  });

  return child;
}
