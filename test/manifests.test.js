// The files that describe this package to registries, plugin hosts and
// directories agree with each other.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("../", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const json = (path) => JSON.parse(read(path));

const pkg = json("package.json");
const server = json("server.json");
const claudePlugin = json(".claude-plugin/plugin.json");
const portablePlugin = json("plugin.json");

test("one version everywhere", () => {
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].version, pkg.version);
  assert.equal(claudePlugin.version, pkg.version);
  assert.equal(portablePlugin.version, pkg.version);
});

test("server.json fits the official registry", () => {
  assert.equal(server.name, pkg.mcpName);
  assert.ok(server.description.length <= 100, `description is ${server.description.length} characters`);
  assert.match(server.$schema, /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d\d-\d\d\/server\.schema\.json$/);
  assert.deepEqual(server.packages[0], {
    registryType: "npm",
    registryBaseUrl: "https://registry.npmjs.org",
    identifier: pkg.name,
    version: pkg.version,
    transport: { type: "stdio" },
  });
});

test("plugins run the bundled wrapper and carry the app's skill", () => {
  const claude = json(".mcp.json").mcpServers["yab-browser"];
  assert.deepEqual(claude, { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/src/cli.js"] });
  const portable = json("mcp.json").mcpServers["yab-browser"];
  assert.deepEqual(portable, { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/src/cli.js"] });
  assert.equal(pkg.bin["yab-mcp"], "src/cli.js");
  assert.ok(existsSync(join(root, "src/cli.js")));
  const skill = read("skills/yab-browser/SKILL.md");
  assert.match(skill, /^---\nname: yab-browser\nversion: \d+\n/);
  // The Claude plugin directory and Cowork refuse a plugin with bin/ at its root.
  assert.equal(existsSync(join(root, "bin")), false);
});

test("marketplaces name the plugin the way its manifests do", () => {
  const claude = json(".claude-plugin/marketplace.json");
  assert.equal(claude.plugins[0].name, claudePlugin.name);
  assert.equal(claude.plugins[0].source, "./");
  const codex = json(".agents/plugins/marketplace.json");
  assert.equal(codex.plugins[0].name, portablePlugin.name);
  assert.equal(codex.plugins[0].source.path, "./");
});

test("no file the plugin directory would hold for a reviewer", () => {
  const big = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      if ([".git", "node_modules", "dist"].includes(name)) continue;
      const path = join(dir, name);
      const stat = statSync(join(root, path));
      if (stat.isDirectory()) walk(path);
      else if (!/\.(png|jpe?g|gif|webp|svg)$/.test(name) && stat.size > 256 * 1024) big.push(path);
      assert.notEqual(name, ".DS_Store", path);
      assert.notEqual(name, "package-lock.json", "a lockfile makes Claude Code install packages");
      assert.notEqual(name, ".npmrc", path);
    }
  };
  walk("");
  assert.deepEqual(big, []);
});

test("no long dashes in what people read", () => {
  for (const path of ["README.md", "PUBLISHING.md", "server.json", "package.json", ".claude-plugin/plugin.json", "plugin.json", "mcpb/manifest.json"]) {
    if (!existsSync(join(root, path))) continue;
    assert.doesNotMatch(read(path), /[\u2013\u2014]/, path);
  }
});
