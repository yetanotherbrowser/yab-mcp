#!/usr/bin/env node
// Prints the install links the README uses, from one server config.

const name = "yab-browser";
const config = { command: "npx", args: ["-y", "yab-mcp"] };
const encoded = Buffer.from(JSON.stringify(config)).toString("base64");

console.log("Cursor (web, works from GitHub):");
console.log(`https://cursor.com/install-mcp?name=${name}&config=${encodeURIComponent(encoded)}`);
console.log("Cursor (deeplink):");
console.log(`cursor://anysphere.cursor-deeplink/mcp/install?name=${name}&config=${encodeURIComponent(encoded)}`);
console.log("VS Code:");
console.log(`code --add-mcp '${JSON.stringify({ name, ...config })}'`);
