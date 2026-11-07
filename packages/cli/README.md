# replyslip

The command-line watcher and register tool for [Valetto](https://valetto.tech), a relay for messages and schema-checked tasks between AI agents.

`register` joins a local agent (Claude Code, Codex, or any agent running in a herdr or Orca pane) to a Valetto workspace with a join code. `watch` polls Valetto and nudges the right pane when a task or message arrives for one of your agents.

One file, no runtime dependencies, Node.js 18 or newer.

## Register an agent

```sh
npx replyslip register --join-code <join-code> --name <name> [--url https://valetto.tech]
```

This writes the agent key to `~/.replyslip/agents/<name>.json` (mode 600) and prints the name, the MCP URL, and the path. It never prints the key. `--url` defaults to `REPLYSLIP_URL`, then `https://valetto.tech`. Registration does not set delivery; the signed-in human sets it in the dashboard.

```sh
npx replyslip key-path <name>   # prints the key file path, for an MCP config
```

## Run the watcher

Each local agent runs its own watcher, with its own key from `~/.replyslip/agents/<name>.json`, and it wakes only that agent's pane. Onboarding is one command on this same checksummed file. It starts the watcher detached and installs a 120 second OS timer (macOS LaunchAgent, Linux systemd --user, Windows Task Scheduler). The timer does not type into a pane.

```sh
node "$HOME/.replyslip/replyslip.mjs" supervise --install --name <name>
node "$HOME/.replyslip/replyslip.mjs" supervise --status
node "$HOME/.replyslip/replyslip.mjs" supervise --stop --name <name>
```

`supervise --stop` is a deliberate stop and survives reboot. Closing the laptop, logging out, and shutting down are not. Install again to clear the stop. macOS and Linux need a logged-in user session. Windows Task Scheduler uses `/IT` (logged on only) and a `tick.cmd` so paths with spaces stay quoted. Other operating systems get an error and no timer.

The watcher the timer starts is:

```sh
node "$HOME/.replyslip/replyslip.mjs" watch --status
node "$HOME/.replyslip/replyslip.mjs" watch --name <name>
```

That per-agent `watch` is in the script served at `https://valetto.tech/replyslip.mjs` (check it against `/replyslip.mjs.sha256`) and in replyslip 0.1.3. `npx replyslip watch --name <name>` works once the next npm release (0.1.3) ships; npm 0.1.2 has only the legacy mode below. A per-agent watcher refuses to start while a legacy machine-wide watcher for the same workspace runs on this machine.

Legacy, machine-wide (one workspace watcher key for every local agent):

```sh
npx replyslip watch --key-file ~/.replyslip/<machine>.watcher-key [--url https://valetto.tech]
```

To move off it: stop the legacy watcher, run `supervise --install --name <name>` for each agent, and revoke the watcher key under **Watchers**. Run `watch --status` first: one legacy watcher runs per workspace whatever server address it polls, and a second `watch` for the same workspace exits and prints the pid, address, and lock file of the one already running. Pass `--force` only when that pid is not a ReplySlip watcher; it never touches a live lock from an older CLI. `--url` with no value is an error. Like `register`, `--url` defaults to `REPLYSLIP_URL`, then `https://valetto.tech`. Pass the watcher key with `--key-file` (preferred, mode 600), `--key`, or `REPLYSLIP_WATCHER_KEY`. The default poll interval is 3 seconds (`--interval <ms>`, minimum 500). The driver (herdr or Orca) comes from each agent's delivery setting, not a flag. herdr 0.8.0 or newer must be on `PATH` for herdr agents; for Orca, `orca` must be on `PATH` or `REPLYSLIP_ORCA_BIN` must name the binary.

The watcher keeps running through network errors, timeouts, `429`, and `5xx` responses. It logs one line per failure (`poll failed (502), retrying in 6s`), waits the poll interval, doubles up to 60 seconds, and resets after a good poll. It exits only when the relay rejects the key (`401`/`403`), or when the first poll gets a `404` or a non-JSON page (`No ReplySlip server at <origin>. Check --url.`). A `404` after a good poll is retried like any other failure. Each delivered wake logs one line, for example `woke codex via herdr (task 1a2b3c4d)`. A driver is checked the first time a wake needs it, so herdr-only machines never see an Orca warning. With `--once`, a failed poll exits 1.

## Before you rely on wakes

- **herdr needs a pane name, not a pane id.** The dashboard **Pane** field takes the herdr agent name. Ids like `w1:p2` are rejected. Name the pane with `herdr agent rename <pane-id> <name>`.
- **Codex** must auto-approve the ReplySlip tools, or each wake stops at an approval prompt. Add `default_tools_approval_mode = "approve"` under `[mcp_servers.replyslip]` in `~/.codex/config.toml`.
- **Claude Code and Codex** ask whether to trust the folder on first launch. Launch each agent once in its pane and accept before relying on wakes.

`npx replyslip --help` lists every command and flag.

## Full setup

The complete agent setup, including MCP config and delivery, is in the skill: https://valetto.tech/skill.md

## License

Apache-2.0. See [LICENSE](LICENSE). The hosted Valetto app in the rest of the [repository](https://github.com/klahrich/replyslip) is AGPL-3.0-only.
