import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { appOf, findYab, kept, shimTarget } from "../src/find.js";
import { fakeApp, scratch } from "./helpers.js";

const none = () => [];
const anywhere = () => true;

test("reads the binary out of the yab command's script", () => {
  const script = '#!/bin/sh\n# Put here by yab › Settings › Agents; remove it there.\nYAB_CLI=1 exec "/Applications/yab.app/Contents/MacOS/yab" "$@"\n';
  assert.equal(shimTarget(script), "/Applications/yab.app/Contents/MacOS/yab");
  assert.equal(appOf("/Applications/yab.app/Contents/MacOS/yab"), "/Applications/yab.app");
  assert.equal(shimTarget("#!/bin/sh\nexec chrome\n"), null);
});

test("finds nothing off a Mac", () => {
  const home = scratch();
  fakeApp(join(home, "Applications"));
  assert.equal(findYab({ env: {}, home, platform: "linux", roots: [join(home, "Applications")], mdfind: none }), null);
});

test("finds nothing when nothing is there", () => {
  const home = scratch();
  assert.equal(findYab({ env: {}, home, platform: "darwin", roots: [join(home, "Applications")], mdfind: none }), null);
});

test("YAB_APP comes first, on any platform", () => {
  const dir = scratch();
  const app = fakeApp(dir, { name: "Elsewhere.app" });
  const found = findYab({ env: { YAB_APP: app + "/" }, home: dir, platform: "linux", mdfind: none });
  assert.equal(found.app, app);
  assert.equal(found.via, "YAB_APP");
  assert.equal(findYab({ env: { YAB_APP: join(dir, "Missing.app") }, home: dir, platform: "darwin", mdfind: none }), null);
});

test("the app the yab command runs comes before Applications", () => {
  const home = scratch();
  const kept = fakeApp(join(home, "Kept"));
  fakeApp(join(home, "Applications"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "yab"), `#!/bin/sh\nYAB_CLI=1 exec "${kept}/Contents/MacOS/yab" "$@"\n`);
  const found = findYab({ env: {}, home, platform: "darwin", roots: [join(home, "Applications")], mdfind: none });
  assert.equal(found.app, kept);
  assert.equal(found.via, join(home, ".local", "bin", "yab"));
});

test("a yab command naming a missing app is passed over", () => {
  const home = scratch();
  const app = fakeApp(join(home, "Applications"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "yab"), '#!/bin/sh\nYAB_CLI=1 exec "/nowhere/yab.app/Contents/MacOS/yab" "$@"\n');
  assert.equal(findYab({ env: {}, home, platform: "darwin", roots: [join(home, "Applications")], mdfind: none }).app, app);
});

test("Applications folders in order, and only Yab's bundle id", () => {
  const home = scratch();
  const system = join(home, "system");
  const user = join(home, "Applications");
  fakeApp(system, { id: "com.example.other" });
  const app = fakeApp(user);
  const found = findYab({ env: {}, home, platform: "darwin", roots: [system, user], mdfind: none });
  assert.equal(found.app, app);
  assert.equal(found.via, user);
});

test("Spotlight last, skipping copies that aren't anyone's browser", () => {
  const home = scratch();
  const app = fakeApp(join(home, "Somewhere"));
  const asked = [];
  const mdfind = (id) => {
    asked.push(id);
    return [join(home, ".Trash", "yab.app"), app];
  };
  const found = findYab({ env: {}, home, platform: "darwin", roots: [], mdfind, keep: anywhere });
  assert.deepEqual(asked, ["dev.serafim.fast"]);
  assert.equal(found.app, app);
  assert.equal(found.via, "Spotlight");
});

test("which Spotlight results are kept", () => {
  assert.equal(kept("/Applications/yab.app"), true);
  assert.equal(kept("/Users/a/Applications/yab.app"), true);
  assert.equal(kept("/Users/a/.Trash/yab.app"), false);
  assert.equal(kept("/private/tmp/x/yab.app"), false);
  assert.equal(kept("/private/var/folders/ab/T/yab.app"), false);
  assert.equal(kept("/Volumes/yab/Open yab.app/Contents/Resources/Payload/yab.app"), false);
});
