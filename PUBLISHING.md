# Publishing

Everything here is done by hand, in this order, unless a step says it runs in GitHub Actions. Formats were checked on 2026-10-09 against the versions named in each step.

## 1. Public repositories

1. Create `github.com/yetanotherbrowser/yab-mcp` (public) and push `main`.
2. Create `github.com/yetanotherbrowser/homebrew-tap` (public) and push its `main` (the tap lives in `~/Documents/GitHub/homebrew-tap`).
3. Turn on Issues for both: the plugin's `supportUrl` points at this repository's issues.

## 2. npm

The package name `yab-mcp` was free on 2026-10-09.

The first publish is manual, because npm's trusted publisher is set in the package's settings, which exist only after the package does.

```sh
npm login                      # the account that will own yab-mcp
git checkout v0.1.0            # after tagging, or main at 0.1.0
npm test
npm publish --access public
```

Then on npmjs.com, `yab-mcp` › Settings › Trusted Publisher › GitHub Actions:

- Organization or user: `yetanotherbrowser`
- Repository: `yab-mcp`
- Workflow filename: `release.yml`
- Environment: leave empty

The trusted publisher must publish once within 2 days of being set, or it lapses. After that, turn on "Require two-factor authentication and disallow tokens" in the package's publishing access.

From then on a release is: raise the version in `package.json`, `server.json` (twice), `.claude-plugin/plugin.json` and `plugin.json` (`npm test` fails if they differ), commit, `git tag v<version>`, `git push --tags`. `.github/workflows/release.yml` tests, packs the `.mcpb` onto a GitHub release, and publishes to npm with provenance (trusted publishing needs npm 11.5.1 or later and Node 22.14 or later; the workflow uses Node 24).

## 3. The site file for the MCP registry

The registry checks that we own `yetanotherbrowser.com` by a public key served at:

```
https://yetanotherbrowser.com/.well-known/mcp-registry-auth
```

The file is one line of plain text:

```
v=MCPv1; k=ed25519; p=<base64 of the 32-byte Ed25519 public key>
```

Make the key with OpenSSL 3 (macOS's own `openssl` is LibreSSL and can't make Ed25519 keys). Keep `key.pem` out of every repository, in a password manager:

```sh
brew install openssl@3
OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl
$OPENSSL genpkey -algorithm Ed25519 -out key.pem
PUBLIC_KEY="$($OPENSSL pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "v=MCPv1; k=ed25519; p=${PUBLIC_KEY}" > mcp-registry-auth
```

In fast-web, put that file at `public/.well-known/mcp-registry-auth`, and serve it as text by adding to `headers()` in `next.config.ts`:

```ts
{
  source: "/.well-known/mcp-registry-auth",
  headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }],
},
```

The middleware lets it through on yetanotherbrowser.com as it is. Deploy, then check:

```sh
curl -i https://yetanotherbrowser.com/.well-known/mcp-registry-auth
```

It must answer 200 with the line above. It answered 404 on 2026-10-09.

## 4. The official MCP registry

Schema: `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` (the newest released one on 2026-10-09; registry v1.8.1). The registry is still a preview.

npm must have `yab-mcp` at the version in `server.json` first: the registry reads `mcpName` (`com.yetanotherbrowser/yab`) from the published `package.json` to check that we own the package.

```sh
brew install mcp-publisher
OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl
PRIVATE_KEY="$($OPENSSL pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login http --domain yetanotherbrowser.com --private-key "${PRIVATE_KEY}"
mcp-publisher publish          # from this repository's root, reads server.json
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.yetanotherbrowser/yab"
```

Domain login grants `com.yetanotherbrowser/*`. It stays out of GitHub Actions on purpose, so the key never leaves this Mac. Publish again by hand after each npm release whose `server.json` changed. `mcp-publisher` may write `.mcpregistry_*` token files here; `.gitignore` keeps them out.

Optional later: add the `.mcpb` from a GitHub release as a second package (`"registryType": "mcpb"`, the release URL as `identifier`, and its `fileSha256`).

## 5. Anthropic's directory

Local MCP servers are listed only inside a plugin now: the directory no longer takes `.mcpb` desktop extensions. Submit this repository as a **Plugin bundle**.

- Where: [claude.ai/directory/manage](https://claude.ai/directory/manage), **Submit new** › **Plugin bundle**. Needs a paid Claude plan (Pro or Max from your own account; on Team or Enterprise, an Owner) and GitHub connected on claude.ai with push access to the repository.
- **Source**: Repository `yetanotherbrowser/yab-mcp`; Plugin path empty (the plugin is the repository root); Branch or tag `main`, or a release tag. Then **Validate**, fix anything **Blocking**, validate again.
- **Listing details**: read from `.claude-plugin/plugin.json` and `README.md`: `name`, `displayName`, `description`, `author`, `version`, `icon` (`./icon.png`), `documentationUrl`, `supportUrl`, `privacyPolicyUrl` (`https://yetanotherbrowser.com/privacy`), `termsOfServiceUrl`, `license` and `LICENSE`. The README must have at least 40 words outside code blocks.
- **Data handling**: whether it reads or stores personal data (it reads pages and, if allowed, mail and messages, all on the Mac; it stores nothing itself); whether it sends data to services other than its declared connectors (no; what the agent reads goes to the user's model provider, as with any tool); how long it keeps data (it keeps none; Yab's own retention is in its privacy policy); whether it's for people under 18 (no).
- **Compliance**: a contact email, and the four acknowledgements (Software Directory Terms and Policy).
- **Review and submit**: GitHub push webhook (default) or scheduled checks; Auto-publish passing versions as you like.

What the checks will see here, from the pre-submission checklist on 2026-10-09:

- The MCP server runs a file in the plugin with plain arguments: `node ${CLAUDE_PLUGIN_ROOT}/src/cli.js`. There is no `npx` launcher (unpinned `npx` blocks; pinned `npx` is held for a reviewer), no lockfile, no `.npmrc`, no `bin/` folder (claude.ai and Cowork don't install plugins with one), every non-image file under 256 KiB (`src/tools.json` is about 57 KiB).
- The README says what the plugin runs (the `yab` binary of the installed app, `mdfind`) and that it sends nothing itself.
- Tool annotations: the connector rules ask every tool for a `title` and `readOnlyHint` or `destructiveHint`. Yab's `yab mcp` gives none yet. Plugins aren't checked for them automatically, but a reviewer may ask, and Codex already uses `destructiveHint` and `openWorldHint` in its approval settings. Add them in the app (`Mcp.swift`) before submitting, then `npm run snapshot`.
- `claude plugin validate --strict .` and `claude plugin validate --strict .claude-plugin/plugin.json` pass with Claude Code 2.1.293.

Escalations: `directory@anthropic.com` for plugin submissions.

## 6. Claude Desktop extension (.mcpb)

`npm run pack:mcpb` packs `dist/yab-mcp-<version>.mcpb` with `@anthropic-ai/mcpb@2.1.2` (manifest version 0.3, the newest the latest schema takes). The release workflow attaches it to each GitHub release. It's for people who install by opening the file, and for directories that take an upload: Smithery, mcp.so, MCP Market, LobeHub.

## 7. Codex and Cursor

- Codex: `codex plugin marketplace add yetanotherbrowser/yab-mcp` reads `.agents/plugins/marketplace.json`, then `codex plugin add yab@yab-mcp` installs the portable plugin (`plugin.json` and `mcp.json`, Agent Plugins 1.0.0). Checked with Codex CLI 0.157.0. OpenAI's public plugin directory takes remote servers only.
- Cursor: the README's button is `https://cursor.com/install-mcp?name=yab-browser&config=<base64 of {"command":"npx","args":["-y","yab-mcp"]}>` (the web form of `cursor://anysphere.cursor-deeplink/mcp/install`, which GitHub won't link). `npm run links` prints it. For cursor.directory, submit the repository there.

## 8. Lists and directories

In order, once the repository is public and npm has the package:

1. **Glama**: add the server at glama.ai/mcp/servers from the GitHub repository; `glama.json` names `serafimcloud` as maintainer, so the listing can be claimed.
2. **awesome-mcp-servers** (punkpeye): a pull request adding Yab under Browser Automation, with its Glama badge.
3. **PulseMCP** picks servers up from the official registry.
4. **Smithery, mcp.so, MCP Market, LobeHub**: upload the `.mcpb` or fill in their forms with the repository link.
5. **awesome-claude-code**: through its issue form (not a pull request), once the repository is 14 days old.
6. **awesome-mac**: a pull request to all four READMEs, alphabetical, with the freeware icon.
7. **Console.dev**: an email to hello@console.dev.
8. **Homebrew's official cask**: later, once the tap repository is 30 days old and has 75 stars or other public interest.
