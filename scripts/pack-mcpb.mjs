#!/usr/bin/env node
// Packs dist/yab-mcp-<version>.mcpb, a desktop extension for Claude Desktop
// and other MCPB clients. The bundle runs the same wrapper as npm: src/,
// package.json, the license and the icon, with the manifest's version and
// tool list filled in from package.json and src/tools.json.
//
// Uses the MCPB CLI from npm, pinned: @anthropic-ai/mcpb.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { oneLine, readJSON, root } from "./lib.mjs";

const MCPB = "@anthropic-ai/mcpb@2.1.2";
const pkg = readJSON("package.json");
const { tools } = readJSON("src/tools.json");
const base = fileURLToPath(root);
const stage = `${base}dist/mcpb`;
const out = `${base}dist/yab-mcp-${pkg.version}.mcpb`;

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const file of ["src", "package.json", "LICENSE", "README.md", "icon.png"]) {
  cpSync(`${base}${file}`, `${stage}/${file}`, { recursive: true });
}

const manifest = readJSON("mcpb/manifest.json");
manifest.version = pkg.version;
manifest.tools = tools.map((tool) => ({ name: tool.name, description: oneLine(tool.description) }));
writeFileSync(`${stage}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");

const run = (...args) => execFileSync("npx", ["-y", MCPB, ...args], { stdio: "inherit", cwd: base });
run("validate", `${stage}/manifest.json`);
run("pack", stage, out);
console.log(out);
