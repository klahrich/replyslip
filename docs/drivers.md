# Local nudge drivers

A local wake is a nudge. The server stores `{ "mode": "local", "driver": "<id>", "target": "<target>" }` and returns those fields from `POST /api/v1/watcher/poll`. It does not know how a driver reaches the agent, and it never puts message or task content in the poll.

`driver` matches `^[a-z0-9-]{1,32}$`. The server accepts any id. `local_driver` is unconstrained text, and `delivery_mode` already allows `local`, so shipping `orca` did not need a migration. `{ "mode": "herdr", "pane": "<pane>" }` is still accepted and stored as `{ "mode": "local", "driver": "herdr", "target": "<pane>" }`.

This repository ships two drivers, `herdr` and `orca`. Each binary is a prerequisite only for its own driver. Webhook and `none` do not use either. Install herdr 0.8.0 or newer (Apache 2.0 since 22 July 2026; earlier releases were AGPL) and put the `herdr` binary on `PATH`. For Orca, enable Settings → Experimental → CLI and put `orca` on `PATH`. `REPLYSLIP_ORCA_BIN` overrides that binary. ReplySlip does not bundle herdr or Orca, modify them, or list them as npm dependencies.

## Add a driver

1. Implement `NudgeDriver` in `packages/cli/src/drivers/`. The interface is `id`, `check()`, and `nudge(target, notice)`.
   - `check()` reports whether the tool is installed and new enough. On failure, `message` should say what to install and include a link.
   - `nudge(target, notice)` delivers the fixed notice to that target. Return `{ ok: true }` only when it landed. Return `{ ok: false, error }` otherwise. Do not send task text.
2. Register the driver in `defaultRegistry()` in `packages/cli/src/drivers/registry.ts`. `watch()` can also take a registry, which is how tests swap in a fake driver.
3. Add tests in `tests/cli.test.ts`. Cover a successful nudge (acked), a failed nudge (not acked), and an unknown driver (not acked). Call the fake driver. Do not shell out to the real tool.

At startup the watcher runs `check()` for every registered driver and logs the result. A wake whose driver is unknown, or whose check failed, is not acked. That warning is logged once per wake and driver, not on every poll. A nudge that returns `ok: false` is also not acked, so the server can offer the wake again after its 60-second lease. A nudge that returns `ok: true` is acked, and the watcher will not call `nudge` again for that wake.

herdr's `check()` runs `herdr --version` and requires `0.8.0` or newer. When herdr reports that the pane does not exist, the driver returns `no pane named <target>`. The herdr target is the agent name from `herdr agent get` (`.result.agent.name`), not the pane id. `herdr pane current --current` prints a pane id such as `w1:p1`, and the driver refuses that.

## orca

`target` is the Orca terminal title. Handles are runtime-scoped and go stale when Orca restarts, so the driver never stores one. On each wake it runs `orca terminal list --json` and keeps the rows whose `title` equals the stored target.

- Zero matches, or more than one, returns `{ ok: false }` with a clear error. The watcher does not ack, so the wake is requeued after the lease. Nothing was typed.
- Exactly one match runs `orca terminal send --terminal <handle> --text <notice> --enter --wait-submit 10 --json`. `<notice>` is the same fixed text herdr types (`WAKE_NOTICE`), which says another agent sent something on ReplySlip. The call is `execFile` with an argument array. It is not a shell string.
- A receipt whose stages include `turn_started` is delivered: `{ ok: true }`, and the watcher acks.
- A receipt that stops at `input_accepted`, or a send that times out, is unproven. The CLI does not resend the prompt on that timeout, and a later poll must not type it again either. `{ ok: false }` is the watcher's requeue signal and would call `nudge` again, so the driver returns `{ ok: true }` and the watcher acks. The wake is treated as delivered even though Orca did not prove `turn_started`.
- An ambiguous transport failure is the exception that still gets a second `execFile`, and only when the receipt reports `--retry-request`. That second call is the same argument list plus `--retry-request <id>`. Orca replays the original request and does not inject the text again. If the retry reaches `turn_started`, the wake is acked as delivered. If it is still unproven or times out, it is acked as unproven. There is no third send.
- `terminal_handle_stale` re-lists once and sends to the replacement handle only. The first send did not land, so this is not a second prompt to the same terminal. If the new list is not exactly one different handle, the driver returns `{ ok: false }` and the wake is requeued.
- `check()` runs `orca status --json`. A failure, including a missing binary, returns `Orca isn't running or its CLI isn't enabled (Settings → Experimental → CLI)`. That failed check is not acked, so the wake stays pending until Orca is up.
