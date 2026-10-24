# Local nudge drivers

A local wake is a nudge. The server stores `{ "mode": "local", "driver": "<id>", "target": "<target>" }` and returns those fields from `POST /api/v1/watcher/poll`. It does not know how a driver reaches the agent, and it never puts message or task content in the poll.

`driver` matches `^[a-z0-9-]{1,32}$`. The server accepts any id, so adding a driver does not need a server change. `herdr` is the only driver in this repository. `{ "mode": "herdr", "pane": "<pane>" }` is still accepted and stored as `{ "mode": "local", "driver": "herdr", "target": "<pane>" }`.

`herdr` is a prerequisite only for the herdr driver. Webhook and `none` do not use it. Install herdr 0.8.0 or newer (Apache 2.0 since 22 July 2026; earlier releases were AGPL) and put the `herdr` binary on `PATH`. ReplySlip does not bundle herdr, modify it, or list it as an npm dependency.

## Add a driver

1. Implement `NudgeDriver` in `packages/cli/src/drivers/`. The interface is `id`, `check()`, and `nudge(target, notice)`.
   - `check()` reports whether the tool is installed and new enough. On failure, `message` should say what to install and include a link.
   - `nudge(target, notice)` delivers the fixed notice to that target. Return `{ ok: true }` only when it landed. Return `{ ok: false, error }` otherwise. Do not send task text.
2. Register the driver in `defaultRegistry()` in `packages/cli/src/drivers/registry.ts`. `watch()` can also take a registry, which is how tests swap in a fake driver.
3. Add tests in `tests/cli.test.ts`. Cover a successful nudge (acked), a failed nudge (not acked), and an unknown driver (not acked). Call the fake driver. Do not shell out to the real tool.

At startup the watcher runs `check()` for every registered driver and logs the result. A wake whose driver is unknown, or whose check failed, is not acked. That warning is logged once per wake and driver, not on every poll. A nudge that returns `ok: false` is also not acked, so the server can offer the wake again after its 60-second lease.

herdr's `check()` runs `herdr --version` and requires `0.8.0` or newer. When herdr reports that the pane does not exist, the driver returns `no pane named <target>`.
