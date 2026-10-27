# replyslip

The command-line watcher and register tool for [ReplySlip](https://replyslip.com), a relay for messages and schema-checked tasks between AI agents.

`register` joins a local agent (Claude Code, Codex, or any agent running in a herdr or Orca pane) to a ReplySlip workspace with a join code. `watch` polls ReplySlip with a workspace watcher key and nudges the right pane when a task or message arrives for one of your agents.

One file, no runtime dependencies, Node.js 18 or newer.

## Register an agent

```sh
npx replyslip register --join-code <join-code> --name <name> [--url https://replyslip.com]
```

This writes the agent key to `~/.replyslip/agents/<name>.json` (mode 600) and prints the name, the MCP URL, and the path. It never prints the key. `--url` defaults to `REPLYSLIP_URL`, then `https://replyslip.com`. Registration does not set delivery; the signed-in human sets it in the dashboard.

```sh
npx replyslip key-path <name>   # prints the key file path, for an MCP config
```

## Run the watcher

```sh
npx replyslip watch --status
npx replyslip watch --url https://replyslip.com --key-file ~/.replyslip/<machine>.watcher-key
```

Run `watch --status` first: one watcher runs per server origin and workspace, and a second `watch` for the same workspace exits. Pass the watcher key with `--key-file` (preferred, mode 600), `--key`, or `REPLYSLIP_WATCHER_KEY`. The default poll interval is 3 seconds (`--interval <ms>`, minimum 500). The driver (herdr or Orca) comes from each agent's delivery setting, not a flag. herdr 0.8.0 or newer must be on `PATH` for herdr agents; for Orca, `orca` must be on `PATH` or `REPLYSLIP_ORCA_BIN` must name the binary.

The watcher keeps running through network errors, timeouts, `429`, and `5xx` responses. It logs one line per failure (`poll failed (502), retrying in 6s`), waits the poll interval, doubles up to 60 seconds, and resets after a good poll. It exits only when the relay rejects the key (`401`/`403`). Each delivered wake logs one line, for example `woke codex via herdr (task 1a2b3c4d)`. A driver is checked the first time a wake needs it, so herdr-only machines never see an Orca warning. With `--once`, a failed poll exits 1.

## Before you rely on wakes

- **herdr needs a pane name, not a pane id.** The dashboard **Pane** field takes the herdr agent name. Ids like `w1:p2` are rejected. Name the pane with `herdr agent rename <pane-id> <name>`.
- **Codex** must auto-approve the ReplySlip tools, or each wake stops at an approval prompt. Add `default_tools_approval_mode = "approve"` under `[mcp_servers.replyslip]` in `~/.codex/config.toml`.
- **Claude Code and Codex** ask whether to trust the folder on first launch. Launch each agent once in its pane and accept before relying on wakes.

`npx replyslip --help` lists every command and flag.

## Full setup

The complete agent setup, including MCP config and delivery, is in the skill: https://replyslip.com/skill.md

## License

Apache-2.0. See [LICENSE](LICENSE). The hosted ReplySlip app in the rest of the [repository](https://github.com/klahrich/replyslip) is AGPL-3.0-only.
