# yab-mcp

The MCP server of Yab, Yet Another Browser, for Claude Code, Codex, Cursor and any MCP client.

Yab, Yet Another Browser, is a free WebKit browser for the Mac. With this server, any agent gets one real browser on your Mac: the one you're signed in to. Your agent opens tabs of its own beside yours, reads pages as text, clicks, types and fills forms with your sign-ins, your cookies and your IP. There is no cloud browser, no debug port and no Chrome to set up, and it's free. A press on Send, Pay, Delete and the like waits for your yes on a card in Yab, unless you chose Bypass in Yab's settings: the browser holds that yes, not the model. Saved passwords are filled by Yab and never shown to the agent. Agent tabs live in a window off screen and come in front of you only when you ask. With Yab closed, the first call opens it hidden, with no window and no Dock tile, and it quits after half an hour with nothing to do. `yab serve` keeps it running that way.

[Download Yab](https://yetanotherbrowser.com/dl?ref=github) · [For developers](https://yetanotherbrowser.com/developers) · [Manual](https://yetanotherbrowser.com/manual)

## Remote assistants (0.2.0 preview)

On the assistant's own computer, run `npx yab-mcp login --client dots --nonce NONCE`.
It prints the code and returns immediately; a background process saves the
connection after the person allows it in Yab.
Yab on the Mac shows the eight-character code under Settings > AI > Assistants.
After the person allows it there, use `npx yab-mcp --remote` as a stdio MCP server,
or `npx yab-mcp task "Find a table for Friday"` to give Yab one task.
The task command prints its session ID and returns; a shell-only assistant can
run `npx yab-mcp status SESSION` to wait for the next update, or omit SESSION
to check its newest task after a Mac reconnects. Repeat until it says done.
The connection token stays in `~/.config/yab-mcp/auth.json` (mode 0600), or the
path in `YAB_MCP_AUTH_FILE`.
`YAB_MCP_URL` selects a test server; production uses `https://yab-sync.21st.workers.dev`.
Without `--remote`, this package still uses the local Yab app exactly as before.

## Requirements

- A Mac with macOS 15.4 or later.
- Yab, free: [download](https://yetanotherbrowser.com/dl?ref=github). It updates itself.
- Agents allowed in Yab: Settings › AI › Agents › Let agents use Yab. Until then, every call says so.
- Node.js 18 or later, for `npx`. A client can also run Yab directly, without Node: see [Without Node](#without-node).

Chrome is your main browser? Yab can still be the one your agents use, usually closed. `yab import chrome` brings Chrome's sign-ins into Yab after you say yes in Yab, so your agent hits fewer sign-in pages.

Already use Yab? Settings › Developers adds it to Claude Code and Codex with one click, and Copy Config gives the JSON for any other client. You don't need this package for that.

## Install

### Claude Code

The plugin brings the tools and Yab's skill:

```
/plugin marketplace add yetanotherbrowser/yab-mcp
/plugin install yab@yab-mcp
```

From a shell: `claude plugin marketplace add yetanotherbrowser/yab-mcp`, then `claude plugin install yab@yab-mcp`.

Only the tools:

```sh
claude mcp add --scope user yab-browser -- npx -y yab-mcp
```

If Yab's Settings › Developers already added Yab to Claude Code, skip this: you'd have the same tools twice.

### Codex

The plugin, tools and skill:

```sh
codex plugin marketplace add yetanotherbrowser/yab-mcp
codex plugin add yab@yab-mcp
```

Or only the tools, in `~/.codex/config.toml`:

```toml
[mcp_servers.yab-browser]
command = "npx"
args = ["-y", "yab-mcp"]
tool_timeout_sec = 900
default_tools_approval_mode = "approve"
```

`tool_timeout_sec` lets a call wait up to 15 minutes while Yab asks you something; the plugin keeps Codex's default of 5. `default_tools_approval_mode` stops Codex asking before every Yab tool; Yab still asks you before Send, Pay and Delete. Leave it out if you want Codex to ask too.

### Cursor

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=yab-browser&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInlhYi1tY3AiXX0%3D)

Or add it to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "yab-browser": {
      "command": "npx",
      "args": ["-y", "yab-mcp"]
    }
  }
}
```

### VS Code

```sh
code --add-mcp '{"name":"yab-browser","command":"npx","args":["-y","yab-mcp"]}'
```

Or in `.vscode/mcp.json`:

```json
{
  "servers": {
    "yab-browser": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "yab-mcp"]
    }
  }
}
```

### Windsurf (Devin Desktop)

In `~/.config/devin/mcp_config.json` (older Windsurf builds: `~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "yab-browser": {
      "command": "npx",
      "args": ["-y", "yab-mcp"]
    }
  }
}
```

### Claude Desktop

Download `yab-mcp-<version>.mcpb` from [Releases](https://github.com/yetanotherbrowser/yab-mcp/releases) and open it: Claude Desktop installs it as an extension. Or add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "yab-browser": {
      "command": "npx",
      "args": ["-y", "yab-mcp"]
    }
  }
}
```

### Any other client

The same `mcpServers` entry: command `npx`, arguments `-y yab-mcp`, over stdio.

### Without Node

Point the client at the app itself. This is what Yab's Copy Config gives:

```json
{
  "mcpServers": {
    "yab-browser": {
      "command": "/Applications/yab.app/Contents/MacOS/yab",
      "args": ["mcp"],
      "env": { "YAB_CLI": "1" }
    }
  }
}
```

## What yab-mcp does

1. It finds Yab: `YAB_APP` if set, then the app the `yab` command runs (`~/.local/bin/yab`), then `yab.app` in `/Applications` and `~/Applications`, then Spotlight (`mdfind`, bundle id `dev.serafim.fast`).
2. It runs `yab.app/Contents/MacOS/yab mcp` with `YAB_CLI=1`. Your client talks to Yab directly: stdin and stdout go straight through, signals are passed on, and the exit code comes back.
3. Without Yab, or off a Mac, it serves a short built-in server instead. It lists Yab's tools from a snapshot and answers every call with how to get Yab.

It has no dependencies and makes no network requests of its own. `npx yab-mcp --help` says where it found Yab.

## Tools

These come from a real `tools/list` of Yab, made by `scripts/snapshot.mjs`. The app you run is the final word: newer versions may list more.

<!-- tools:start -->
Yab 0.0.18 lists 69 tools. Some appear only when you turn on what they need, as noted.

| Tool | What it does |
| --- | --- |
| `devtools_comments` | Read user-authored comments on elements of an already inspected, non-private tab. |
| `devtools_console` | Read recorded Console messages from an already inspected, non-private tab. |
| `devtools_network` | Read sanitized request metadata recorded by the tab's Developer Tools. |
| `devtools_trace` | Read the WebKit Performance recording's event names, durations and nesting. |
| `devtools_styles` | Read the currently selected element's matched and computed styles from Developer Tools. |
| `native_context` | Read Yab's own current settings, spaces, tabs, mail accounts, permissions and this task's native operations. |
| `native_actions` | List native Yab actions with their strict argument schemas, targetKind, undo support and permission requirements. |
| `native_apply` | Perform a native Yab action explicitly requested by the user: settings, spaces, tabs, page fonts or connecting Gmail. |
| `native_operation` | Read this task's native operation by operationId, or wait for a change up to seconds (0 to 10). |
| `native_undo` | Undo a native change of this task by its changeId (or the last undoable change). |
| `tabs` | List the tabs open in Yab, the user's web browser: the user's and the agents'. |
| `open` | Open a web page (URL) in a new agent tab in Yab, the user's browser, signed in to their sites, beside the user's tabs. |
| `spaces` | List the user's spaces: sets of tabs, some signed in as someone else, with cookies of their own. |
| `navigate` | Send an agent tab to a URL, or back, forward or reload. |
| `snapshot` | Read a web page in a browser tab as an accessibility tree with ref ids. |
| `click` | Click an element by ref, as a real mouse click. |
| `type` | Replace the text in a field by ref (inputs, text areas, editors), or without ref, type into whatever has focus. |
| `choose` | Pick an option in a <select> by its value or label. |
| `press` | Press keys on the focused element, as real key events. |
| `hover` | Rest the pointer on an element, as a mouse would: menus that open on hover open. |
| `drag` | Drag an element with the mouse: onto another element (to, its ref; the dragged one lands before it) or by dx, dy pixels. |
| `dialog` | Answer what the page asked with alert, confirm or prompt: accept (OK) or not (Cancel), and text for a prompt. |
| `scroll` | Scroll the page, or the box around an element by ref (lists marked scrolls), by dy pixels (negative is up). |
| `run` | Run JavaScript that drives tabs with the same tools, several steps in one call. |
| `text` | A tab's whole visible text, for reading articles and results. |
| `screenshot` | A picture of a tab as it is now, for when the snapshot is not enough. |
| `wait` | Wait for a tab to finish loading, or until its text contains `for`. |
| `eval` | Run JavaScript in an agent tab (isolated from the page's own scripts, same DOM) and return its value. |
| `close` | Close an agent tab. |
| `show` | Put a tab in front of the user as one of theirs. |
| `memory_search` | Search what you know about the user from earlier tasks, who they are, their accounts and sites, people, projects. |
| `memory_read` | Read one memory page whole: USER (who the user is), MEMORY (how to work for them), TAXONOMY. |
| `profile` | The user's profile for forms: name, headline, company, role, location, linkedin, x, github, website, telegram. |
| `form_answers` | Answers the user typed into web forms, kept with nothing asked once the form went through. |
| `remember` | Keep something for later tasks. |
| `history` | The user's browsing history. |
| `watch` | Watch a thread for someone's reply: every two hours for `days`. |
| `suggest` | Hand the user what needs them, as quiet rows under a new tab's field. |
| `boosts` | List saved site boosts, their sites, permissions and state. |
| `boost_read` | Read the files of a saved boost or this task's trial before changing it. |
| `skills` | Yab's skills: how particular sites work for an agent (Gmail, GitHub, LinkedIn, Amazon, …), a line each. |
| `skill` | Read one skill whole, by name. |
| `handoff` | Ask the user to take over a tab, sign in, pass a captcha, enter a code, and wait until they say they are done. |
| `ask` | Ask the user to pick: a question with up to four options (they may also write their own), shown at the foot of a tab. |
| `sign_in` | Sign in on this tab's page with a password Yab has saved for the site (the user may be asked first). |
| `autofill` | Fill a form on this tab with what Yab keeps for the user. |
| `upload` | Give the page files from this Mac (the user may be asked first). |
| `download` | Download a file: click ref (a download link or button), or fetch url with the tab's cookies. |
| `pdf` | Save a tab's page as a PDF in the task's folder; returns the path. |
| `fetch` | Read a URL with the user's cookies, no tab needed. |
| `mail_triage` | The user's mail as yab already sorted it on this Mac. Listed with a Gmail account connected in Yab (Settings › Mail). |
| `mail_search` | Search all of the user's mail, of any age. Listed with a Gmail account connected in Yab (Settings › Mail). |
| `mail_read` | A thread of the user's mail as text, oldest message first, with its labels by name, the files each message carries. Listed with a Gmail account connected in Yab (Settings › Mail). |
| `mail_file` | The words of a file a thread of the user's mail carries. Listed with a Gmail account connected in Yab (Settings › Mail). |
| `mail_draft` | Write a reply in a thread (thread), a forward of a thread's last mail (thread, forward: true, to), or a new mail. Listed with a Gmail account connected in Yab (Settings › Mail). |
| `mail_send` | Send a mail that is in yab's mail page, only when the user asked for exactly that mail to go. Listed with a Gmail account connected in Yab (Settings › Mail). |
| `mail_act` | Tidy a thread of the user's mail, as they would in yab's mail page. Listed with a Gmail account connected in Yab (Settings › Mail). |
| `mail_labels` | The user's own labels in their Gmail, and the list itself. Listed with a Gmail account connected in Yab (Settings › Mail). |
| `mail_recall` | Search all of the user's mail of the last 5 years, kept on this Mac, by what it says as well as its words. Listed when agents may search all your mail (Settings › Mail). |
| `mail_code` | Read the one-time code the tab's own site mailed to the user in the last `minutes` (default 10), from their Gmail. Listed when Yab may read sign-in codes from Gmail (Settings › Autofill). |
| `messages` | The user's Messages (iMessage and texts): with no chat, their chats, most recent first, each with its last line. Listed when agents may use Messages (Settings › AI › Agents). |
| `send_message` | Send a message through Messages to a phone number or an address. Listed when agents may use Messages (Settings › AI › Agents). |
| `messages_code` | Read the latest one-time code from the user's Messages. Listed when agents may use Messages (Settings › AI › Agents). |
| `name` | Name this task: once it has more than one tab they sit in a folder in the user's tab list. |
| `task` | Hand a whole browser job to an agent Yab runs itself (Claude Code, or Codex), and wait for its answer. |
| `task_status` | What a task is doing now, and its answer when it is done. |
| `task_stop` | Stop a task. |
| `task_steer` | Redirect a running task now: it reads this at its next step. |
| `task_queue` | Give a task something to do after what it is doing now. |
<!-- tools:end -->

## What leaves your Mac

- **This package**: nothing. It reads a few files and asks Spotlight to find Yab, then starts it. `npx` downloads the package from the npm registry.
- **Between your agent and Yab**: nothing leaves the Mac. `yab mcp` talks to the browser over a socket in Yab's folder that only your macOS user can open.
- **To your agent's model**: what your agent reads with these tools, pages and, if you allow it, mail and messages, goes to the provider of the model your agent uses (Anthropic, OpenAI or another), under your account, as with anything else you give it. The `task` tool asks Yab to run Claude Code or Codex with your own plan, so the same applies there.
- **Yab itself**: it checks yetanotherbrowser.com for updates, counts active days with a random installation ID (Settings › About › Share daily activity turns it off), and sends crash reports only if you say yes. Sync is off until you turn it on, and then end to end encrypted. Yab has no account, and no server of ours sees your browsing. Mail comes from Google straight to your Mac.
- **Websites** get what any browser sends them.

### Privacy Policy

Yab's privacy policy is at [yetanotherbrowser.com/privacy](https://yetanotherbrowser.com/privacy). In short:

- Collection: yab-mcp collects nothing. Yab keeps your tabs, history, passwords and mail on your Mac.
- Use and storage: what Yab keeps stays in your user folder and the macOS keychain. Sync, if you turn it on, stores only end to end encrypted records.
- Sharing: nobody at Yab gets your pages or mail. What an agent reads goes to that agent's provider, as above.
- Retention: data on your Mac stays until you delete it. Sync data stays until you delete it in Settings › Sync. Yab's own records of updates and daily activity keep no IP address; the web host's request logs last a day at most.
- Contact: serafimcloud@gmail.com, or Send Feedback in Yab.

## Troubleshooting

- **"Agents are off in Yab"**: turn on Settings › AI › Agents › Let agents use Yab.
- **"Yab isn't installed on this Mac"**: install Yab, open it once, then restart the MCP server (in Claude Code: `/mcp`).
- **"The Yab that's running is older"**: quit Yab and open it again, so the running app matches the one on disk.
- **Yab lives somewhere else**: set `YAB_APP=/path/to/yab.app` in the server's environment.

## Development

```sh
npm test                 # node --test, no dependencies
npm run snapshot         # new src/tools.json and README tool list from the Yab on this Mac
npm run pack:mcpb        # dist/yab-mcp-<version>.mcpb for Claude Desktop
npm run links            # the Cursor and VS Code install links
```

`npm run snapshot` sends Yab only `initialize` and `tools/list`, never a tool call. Releases and directory listings: [PUBLISHING.md](PUBLISHING.md).

## License

MIT, see [LICENSE](LICENSE). Yab itself is free and closed source; this repository is its open part for agents.
