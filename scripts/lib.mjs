// Shared by the scripts: the tool list's one-line summaries and the README
// section made from it.

import { readFileSync, writeFileSync } from "node:fs";

export const root = new URL("../", import.meta.url);
export const read = (path) => readFileSync(new URL(path, root), "utf8");
export const write = (path, text) => writeFileSync(new URL(path, root), text);
export const readJSON = (path) => JSON.parse(read(path));

// Tools Yab lists only when the user turned something on, and what.
export const CONDITIONS = {
  mail: {
    tools: ["mail_triage", "mail_search", "mail_read", "mail_file", "mail_draft", "mail_send", "mail_act", "mail_labels"],
    note: "with a Gmail account connected in Yab (Settings › Mail)",
  },
  recall: { tools: ["mail_recall"], note: "when agents may search all your mail (Settings › Mail)" },
  codes: { tools: ["mail_code"], note: "when Yab may read sign-in codes from Gmail (Settings › Autofill)" },
  messages: {
    tools: ["messages", "send_message", "messages_code"],
    note: "when agents may use Messages (Settings › AI › Agents)",
  },
};

export function conditionOf(name) {
  return Object.values(CONDITIONS).find((condition) => condition.tools.includes(name))?.note ?? null;
}

/** The first sentence of a description, cut at a clause if it runs long. */
export function oneLine(description, limit = 120) {
  const flat = description.replace(/\s+/g, " ").trim();
  let line = (/^.+?[.!?](?=\s|$)/.exec(flat) ?? [flat])[0];
  if (line.length > limit) {
    const head = line.slice(0, limit);
    // The strongest break that leaves a useful line: a colon, then a
    // semicolon, a bracket, a comma, or else the last whole word.
    const closed = (text) => (text.match(/\(/g) ?? []).length === (text.match(/\)/g) ?? []).length;
    const at = (mark) => {
      for (let i = head.lastIndexOf(mark); i > 40; i = head.lastIndexOf(mark, i - 1)) if (closed(head.slice(0, i))) return i;
      return -1;
    };
    const cut = [": ", "; ", " (", ", "].map(at).find((i) => i > 0) ?? -1;
    line = (cut > 0 ? head.slice(0, cut) : head.replace(/\s+\S*$/, "")) + ".";
  }
  return line.replace(/[\u2013\u2014]/g, ",");
}

/** The README's tool list, between its markers, from the snapshot. */
export function readmeTools(snapshot) {
  const rows = snapshot.tools.map((tool) => {
    const condition = conditionOf(tool.name);
    return `| \`${tool.name}\` | ${oneLine(tool.description).replace(/\|/g, "\\|")}${condition ? ` Listed ${condition}.` : ""} |`;
  });
  return [
    `Yab ${snapshot.yab.version} lists ${snapshot.tools.length} tools. Some appear only when you turn on what they need, as noted.`,
    "",
    "| Tool | What it does |",
    "| --- | --- |",
    ...rows,
  ].join("\n");
}

export function replaceBetween(text, start, end, body) {
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to < from) throw new Error(`markers ${start} ... ${end} not found`);
  return text.slice(0, from + start.length) + "\n" + body + "\n" + text.slice(to);
}
