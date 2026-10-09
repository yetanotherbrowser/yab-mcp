// Where Yab is on this Mac.
//
// In order: YAB_APP when it is set; the app the `yab` command runs (the
// script Yab's Settings › Developers writes to ~/.local/bin/yab); yab.app in
// /Applications and ~/Applications; then Spotlight, by bundle id.

import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export const BUNDLE_ID = "dev.serafim.fast";

export function executableOf(app) {
  return join(app, "Contents", "MacOS", "yab");
}

function isExecutable(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The .app around a binary path, as /Applications/yab.app for .../Contents/MacOS/yab. */
export function appOf(binary) {
  const at = binary.indexOf(".app/Contents/MacOS/");
  return at < 0 ? null : binary.slice(0, at + 4);
}

/** The binary the `yab` command runs: `YAB_CLI=1 exec "<binary>" "$@"`. */
export function shimTarget(text) {
  const found = /exec\s+"([^"]+\.app\/Contents\/MacOS\/[^"/]+)"/.exec(text);
  return found ? found[1] : null;
}

/** CFBundleIdentifier from an XML Info.plist, or null when it can't be read. */
export function bundleIdOf(app) {
  try {
    const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
    const found = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/.exec(plist);
    return found ? found[1] : null;
  } catch {
    return null;
  }
}

// Copies that aren't anyone's browser: in the Trash, a temporary folder, or
// the copy inside the disk image's installer.
export function kept(app) {
  if (/\/\.Trash\//.test(app)) return false;
  if (/^\/(private\/)?(tmp|var\/folders)\//.test(app)) return false;
  if (app.slice(0, -4).includes(".app/")) return false;
  return true;
}

function usable(app, via) {
  const executable = executableOf(app);
  if (!isExecutable(executable)) return null;
  const id = bundleIdOf(app);
  if (id !== null && id !== BUNDLE_ID) return null;
  return { app, executable, via };
}

/** Apps Spotlight knows by bundle id, best first. */
export function spotlight(id = BUNDLE_ID) {
  const result = spawnSync("/usr/bin/mdfind", [`kMDItemCFBundleIdentifier == '${id}'`], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".app"))
    .sort((a, b) => Number(a.startsWith("/Volumes/")) - Number(b.startsWith("/Volumes/")));
}

/**
 * Yab on this Mac: { app, executable, via }, or null.
 * Every input can be replaced, so tests run it against folders of their own.
 */
export function findYab({
  env = process.env,
  home = env.HOME || homedir(),
  platform = process.platform,
  roots,
  mdfind = spotlight,
  keep = kept,
} = {}) {
  if (env.YAB_APP) {
    const app = env.YAB_APP.replace(/\/+$/, "");
    return usable(app, "YAB_APP");
  }
  if (platform !== "darwin") return null;

  const shim = join(home, ".local", "bin", "yab");
  try {
    const target = shimTarget(readFileSync(shim, "utf8"));
    const app = target && appOf(target);
    if (app && isExecutable(target)) return { app, executable: target, via: shim };
  } catch {
    // No command installed: look further.
  }

  for (const root of roots ?? ["/Applications", join(home, "Applications")]) {
    const found = usable(join(root, "yab.app"), root);
    if (found) return found;
  }

  for (const app of mdfind(BUNDLE_ID)) {
    if (!keep(app)) continue;
    const found = usable(app, "Spotlight");
    if (found) return found;
  }
  return null;
}
