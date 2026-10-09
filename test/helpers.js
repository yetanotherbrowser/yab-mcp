import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function scratch() {
  return mkdtempSync(join(tmpdir(), "yab-mcp-test-"));
}

/** A folder that looks like yab.app, with `script` as its binary. */
export function fakeApp(parent, { name = "yab.app", id = "dev.serafim.fast", script = "#!/bin/sh\nexit 0\n" } = {}) {
  const app = join(parent, name);
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  if (id) {
    writeFileSync(
      join(app, "Contents", "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleIdentifier</key>\n\t<string>${id}</string>\n</dict>\n</plist>\n`,
    );
  }
  const binary = join(app, "Contents", "MacOS", "yab");
  writeFileSync(binary, script);
  chmodSync(binary, 0o755);
  return app;
}

/** Newline-delimited JSON from a stream, one message at a time. */
export function reader(stream) {
  let buffer = "";
  const queue = [];
  const waiting = [];
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (waiting.length) waiting.shift()(line);
      else queue.push(line);
    }
  });
  return () =>
    new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift());
      const timer = setTimeout(() => reject(new Error("no line within 10 s")), 10_000);
      waiting.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
}
