#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// packages/cli/src/cli.ts
import { readFile, stat as stat2 } from "node:fs/promises";

// lib/constants.ts
var AGENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
var PANE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
var LOGIN_CODE_TTL_MS = 10 * 60 * 1e3;
var SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
var JOIN_CODE_DEFAULT_TTL_MS = 24 * 60 * 60 * 1e3;
var JOIN_CODE_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var JOIN_CODE_MIN_TTL_MS = 60 * 60 * 1e3;
var RATE_LIMITS = {
  requestCode: { email: 5, ip: 100, windowMs: 15 * 60 * 1e3 },
  register: { ip: 60, windowMs: 15 * 60 * 1e3 },
  testWake: { agent: 10, windowMs: 15 * 60 * 1e3 }
};

// packages/cli/src/register.ts
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
function replyslipHome(home = homedir()) {
  return path.join(home, ".replyslip");
}
function agentKeyPath(name, home = homedir()) {
  return path.join(replyslipHome(home), "agents", `${name}.json`);
}
function joinCodeEnvName(agentName) {
  return `REPLYSLIP_JOIN_CODE_${agentName.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}
function resolveJoinCode(agentName, flag2, env) {
  if (flag2 && flag2.trim()) return flag2.trim();
  const fromEnv = env[joinCodeEnvName(agentName)];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return null;
}
function relayOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Relay URL must use http or https.");
  }
  return url.origin;
}
async function ensurePrivateDir(dir) {
  await mkdir(dir, { recursive: true, mode: 448 });
  await chmod(dir, 448);
}
async function writeAgentKeyFile(file, options) {
  if (!AGENT_NAME_PATTERN.test(file.name)) {
    throw new Error("Agent name must start with a letter and then use only letters, numbers, underscores, or hyphens.");
  }
  const home = options.home ?? homedir();
  const root = replyslipHome(home);
  const agentsDir = path.join(root, "agents");
  await ensurePrivateDir(root);
  await ensurePrivateDir(agentsDir);
  const target = agentKeyPath(file.name, home);
  const body = `${JSON.stringify(file, null, 2)}
`;
  try {
    await writeFile(target, body, { flag: options.force ? "w" : "wx", mode: 384 });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : "";
    if (code === "EEXIST") {
      throw new Error(`Refusing to overwrite ${target}. Pass --force to replace it.`);
    }
    throw new Error(`Registered ${file.name} but could not save the key file. The key was not printed. Revoke the agent and register again.`);
  }
  await chmod(target, 384);
  return target;
}
async function refuseExistingKeyFile(name, home, force) {
  if (force) return;
  const target = agentKeyPath(name, home ?? homedir());
  try {
    await stat(target);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : "";
    if (code === "ENOENT") return;
    throw err;
  }
  throw new Error(`Refusing to overwrite ${target}. Pass --force to replace it.`);
}
async function registerAgent(options) {
  if (!AGENT_NAME_PATTERN.test(options.name)) {
    throw new Error("Agent name must start with a letter and then use only letters, numbers, underscores, or hyphens.");
  }
  await refuseExistingKeyFile(options.name, options.home, options.force);
  const relay = relayOrigin(options.relayUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${relay}/api/v1/agents/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.joinCode}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      name: options.name,
      ...options.description ? { description: options.description } : {}
    })
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && payload && "error" in payload && typeof payload.error?.message === "string" ? payload.error.message : `Registration failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  const record2 = payload;
  if (typeof record2.api_key !== "string" || typeof record2.agent?.id !== "string") {
    throw new Error(`Registration failed (HTTP ${response.status}).`);
  }
  const mcpUrl = typeof record2.mcp?.url === "string" ? record2.mcp.url : `${relay}/api/mcp`;
  const createdAt = typeof record2.agent.created_at === "string" ? record2.agent.created_at : (/* @__PURE__ */ new Date()).toISOString();
  const filePath = await writeAgentKeyFile(
    {
      name: options.name,
      agent_id: record2.agent.id,
      api_key: record2.api_key,
      mcp_url: mcpUrl,
      relay_url: relay,
      created_at: createdAt
    },
    { home: options.home, force: options.force }
  );
  return { path: filePath, name: options.name, mcpUrl };
}

// lib/wake-notice.ts
var WAKE_NOTICE = "Another agent sent you something on ReplySlip; check it with your ReplySlip tools.";

// packages/cli/src/drivers/command.ts
import { spawn } from "node:child_process";
var runCommand = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.on("error", reject);
  child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
});
function isMissingBinary(err) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}
async function capture(run, command, args) {
  try {
    return await run(command, args);
  } catch (err) {
    if (isMissingBinary(err)) {
      return { code: 127, stdout: "", stderr: "ENOENT" };
    }
    throw err;
  }
}

// packages/cli/src/drivers/herdr.ts
var MIN_HERDR_VERSION = "0.8.0";
var HERDR_INSTALL_URL = "https://github.com/herdrdev/herdr";
var MISSING_PANE = /pane_not_found|agent_not_found|agent_pane_not_found|agent target .+ not found|pane .+ not found/i;
function parseHerdrVersion(text) {
  return text.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? null;
}
function versionAtLeast(version, minimum) {
  const left = version.split(".").map((part) => Number(part));
  const right = minimum.split(".").map((part) => Number(part));
  for (let i = 0; i < 3; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}
function herdrInstallMessage(detail) {
  return `${detail} Install herdr ${MIN_HERDR_VERSION} or newer (${HERDR_INSTALL_URL}). Herdr is Apache 2.0 since 22 July 2026; earlier releases were AGPL.`;
}
function herdrArgs(target, notice) {
  if (!PANE_NAME_PATTERN.test(target)) {
    throw new Error(`Refusing pane name: ${target}`);
  }
  return ["agent", "prompt", target, notice];
}
function herdrMissingPane(output) {
  return MISSING_PANE.test(output);
}
function createHerdrDriver(options) {
  const run = options?.run ?? runCommand;
  return {
    id: "herdr",
    async check() {
      const result = await capture(run, "herdr", ["--version"]);
      if (result.stderr === "ENOENT" || result.code === 127) {
        return { ok: false, message: herdrInstallMessage("herdr is not installed or not on PATH.") };
      }
      const version = parseHerdrVersion(`${result.stdout}
${result.stderr}`);
      if (result.code !== 0 || !version) {
        return { ok: false, message: herdrInstallMessage("herdr --version did not report a version.") };
      }
      if (!versionAtLeast(version, MIN_HERDR_VERSION)) {
        return {
          ok: false,
          version,
          message: herdrInstallMessage(`herdr ${version} is older than ${MIN_HERDR_VERSION}.`)
        };
      }
      return { ok: true, version };
    },
    async nudge(target, notice) {
      let args;
      try {
        args = herdrArgs(target, notice);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Refusing pane name." };
      }
      const result = await capture(run, "herdr", args);
      if (result.code === 0) return { ok: true };
      const output = `${result.stdout}
${result.stderr}`;
      if (herdrMissingPane(output)) return { ok: false, error: `no pane named ${target}` };
      if (result.stderr === "ENOENT" || result.code === 127) {
        return { ok: false, error: herdrInstallMessage("herdr is not installed or not on PATH.") };
      }
      return { ok: false, error: `herdr exited ${result.code}` };
    }
  };
}

// packages/cli/src/drivers/orca.ts
import { execFile as execFileCb } from "node:child_process";
var ORCA_BIN_ENV = "REPLYSLIP_ORCA_BIN";
var ORCA_NOT_RUNNING = "Orca isn't running or its CLI isn't enabled (Settings \u2192 Experimental \u2192 CLI)";
var ORCA_WAIT_SUBMIT_SECONDS = "10";
var SEND_TIMEOUT_MS = 2e4;
var QUICK_TIMEOUT_MS = 5e3;
function orcaBinary(env = process.env) {
  const override = env[ORCA_BIN_ENV]?.trim();
  return override || "orca";
}
function execFileOrca(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFileCb(
      file,
      [...args],
      { timeout: timeoutMs, shell: false, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const out = String(stdout ?? "");
        const errText = String(stderr ?? "");
        if (err && err.code === "ENOENT") {
          resolve({ code: 127, stdout: out, stderr: "ENOENT", timedOut: false });
          return;
        }
        if (!err) {
          resolve({ code: 0, stdout: out, stderr: errText, timedOut: false });
          return;
        }
        const timedOut = Boolean(err.killed);
        const exitCode = err.code;
        const code = typeof exitCode === "number" ? exitCode : 1;
        resolve({ code, stdout: out, stderr: errText, timedOut });
      }
    );
  });
}
function createOrcaDriver(options) {
  const execFile = options?.execFile ?? execFileOrca;
  const bin = orcaBinary(options?.env);
  async function run(args, timeoutMs) {
    return execFile(bin, args, timeoutMs);
  }
  function listArgs() {
    return ["terminal", "list", "--json"];
  }
  function sendArgs(handle, notice, retryRequest) {
    const args = [
      "terminal",
      "send",
      "--terminal",
      handle,
      "--text",
      notice,
      "--enter",
      "--wait-submit",
      ORCA_WAIT_SUBMIT_SECONDS,
      "--json"
    ];
    if (retryRequest) args.push("--retry-request", retryRequest);
    return args;
  }
  async function listTerminals() {
    const result = await run(listArgs(), QUICK_TIMEOUT_MS);
    if (isDown(result)) return { ok: false, error: ORCA_NOT_RUNNING };
    if (result.code !== 0 || result.timedOut) {
      return { ok: false, error: `orca terminal list exited ${result.code}` };
    }
    const payload = parseJson(result.stdout) ?? parseJson(result.stderr);
    return { ok: true, terminals: terminalsFrom(payload) };
  }
  async function send(handle, notice, retryRequest) {
    return run(sendArgs(handle, notice, retryRequest), SEND_TIMEOUT_MS);
  }
  async function submit(handle, target, notice, allowRelist) {
    const first = classify(await send(handle, notice));
    if (first.delivered) return { ok: true };
    if (first.stale && allowRelist) return submitReplacement(target, notice, handle);
    if (first.ambiguous && first.retryRequest) {
      const retried = classify(await send(handle, notice, first.retryRequest));
      if (retried.delivered) return { ok: true };
      if (retried.stale && allowRelist) return submitReplacement(target, notice, handle);
      if (!retried.down) return { ok: true };
      return { ok: false, error: ORCA_NOT_RUNNING };
    }
    if (first.unproven) return { ok: true };
    if (first.down) return { ok: false, error: ORCA_NOT_RUNNING };
    return { ok: false, error: first.error };
  }
  async function submitReplacement(target, notice, staleHandle) {
    const listed = await listTerminals();
    if (!listed.ok) return { ok: false, error: listed.error };
    const matches = matchTitle(listed.terminals, target);
    if (matches.length !== 1 || matches[0].handle === staleHandle) {
      return { ok: false, error: `Orca terminal handle for ${quote(target)} is stale` };
    }
    return submit(matches[0].handle, target, notice, false);
  }
  return {
    id: "orca",
    async check() {
      const result = await run(["status", "--json"], QUICK_TIMEOUT_MS);
      if (isDown(result) || result.code !== 0 || result.timedOut) {
        return { ok: false, message: ORCA_NOT_RUNNING };
      }
      const payload = parseJson(result.stdout);
      const root = record(payload);
      if (root && root.ok === false) return { ok: false, message: ORCA_NOT_RUNNING };
      const version = typeof root?.version === "string" ? root.version : void 0;
      return { ok: true, version };
    },
    async nudge(target, notice) {
      const listed = await listTerminals();
      if (!listed.ok) return { ok: false, error: listed.error };
      const matches = matchTitle(listed.terminals, target);
      if (matches.length === 0) return { ok: false, error: `no Orca terminal titled ${quote(target)}` };
      if (matches.length > 1) return { ok: false, error: `more than one Orca terminal titled ${quote(target)}` };
      return submit(matches[0].handle, target, notice, true);
    }
  };
}
function quote(target) {
  return JSON.stringify(target);
}
function matchTitle(terminals, target) {
  const wanted = target.trim();
  return terminals.filter((terminal) => terminal.title === wanted);
}
function isDown(result) {
  return result.stderr === "ENOENT" || result.code === 127;
}
function classify(result) {
  const text = `${result.stdout}
${result.stderr}`;
  const payload = parseJson(result.stdout) ?? parseJson(result.stderr);
  const stages = stagesOf(payload);
  const delivered = stages.includes("turn_started");
  const accepted = stages.includes("input_accepted") || sendAccepted(payload);
  const stale = isStale(payload, text);
  const retryFromFlag = retryFlag(text);
  const retryRequest = retryFromFlag ?? (result.code !== 0 || result.timedOut ? requestIdOf(payload) : null);
  const down = isDown(result);
  const ambiguous = !delivered && !stale && !down && Boolean(retryRequest) && (result.timedOut || result.code !== 0 || Boolean(retryFromFlag));
  const unproven = !delivered && !stale && !down && !ambiguous && (result.timedOut || result.code === 0 && accepted);
  const error = errorText(payload, result);
  return { delivered, unproven, stale, ambiguous, retryRequest, down, error };
}
function errorText(payload, result) {
  const root = record(payload);
  const error = record(root?.error);
  if (typeof error?.message === "string" && error.message.trim()) return error.message.trim();
  if (result.timedOut) return "orca terminal send timed out";
  return `orca terminal send exited ${result.code}`;
}
function isStale(payload, text) {
  if (text.includes("terminal_handle_stale")) return true;
  const root = record(payload);
  const error = record(root?.error);
  return error?.code === "terminal_handle_stale";
}
function stagesOf(payload) {
  const send = sendRecord(payload);
  const prompt = record(send?.prompt);
  const stages = prompt?.stages ?? send?.stages;
  if (!Array.isArray(stages)) return [];
  return stages.filter((stage) => typeof stage === "string");
}
function sendAccepted(payload) {
  return sendRecord(payload)?.accepted === true;
}
function sendRecord(payload) {
  const root = record(payload);
  if (!root) return null;
  return record(root.send) ?? record(record(root.result)?.send);
}
function requestIdOf(payload) {
  const root = record(payload);
  if (!root) return null;
  const mutation = record(root.mutation) ?? record(record(root.result)?.mutation);
  const id = mutation?.requestId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}
function retryFlag(text) {
  const match = text.match(/--retry-request(?:=|\s+)([^\s'"]+)/);
  return match?.[1] ?? null;
}
function terminalsFrom(payload) {
  const root = record(payload);
  if (!root) return [];
  const result = record(root.result);
  const list = arrayOf(result?.terminals) ?? arrayOf(root.terminals);
  if (!list) return [];
  const found = [];
  for (const item of list) {
    const row = record(item);
    if (!row) continue;
    const handle = typeof row.handle === "string" ? row.handle.trim() : "";
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (handle && title) found.push({ handle, title });
  }
  return found;
}
function parseJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function arrayOf(value) {
  return Array.isArray(value) ? value : null;
}

// packages/cli/src/drivers/registry.ts
function createRegistry(initial = []) {
  const drivers = /* @__PURE__ */ new Map();
  const registry = {
    register(driver) {
      drivers.set(driver.id, driver);
    },
    get(id) {
      return drivers.get(id);
    },
    list() {
      return [...drivers.values()];
    }
  };
  for (const driver of initial) registry.register(driver);
  return registry;
}
function commandRunnerAsExec(run) {
  return async (file, args) => {
    try {
      const result = await run(file, [...args]);
      return { ...result, timedOut: false };
    } catch (err) {
      const missing = typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
      if (missing) return { code: 127, stdout: "", stderr: "ENOENT", timedOut: false };
      throw err;
    }
  };
}
function defaultRegistry(run) {
  return createRegistry([
    createHerdrDriver(run ? { run } : void 0),
    createOrcaDriver(run ? { execFile: commandRunnerAsExec(run) } : void 0)
  ]);
}

// packages/cli/src/watch.ts
function resolveWake(wake) {
  const driver = wake.driver?.trim() || (wake.pane ? "herdr" : "");
  const target = wake.target?.trim() || wake.pane?.trim() || "";
  if (!driver || !target) return null;
  return { driver, target };
}
async function checkDrivers(registry, log = console.error) {
  const checks = /* @__PURE__ */ new Map();
  for (const driver of registry.list()) {
    const result = await driver.check();
    checks.set(driver.id, result);
    log(
      result.ok ? `[replyslip] driver ${driver.id}: ok${result.version ? ` (${result.version})` : ""}` : `[replyslip] driver ${driver.id}: ${result.message ?? "check failed"}`
    );
  }
  return checks;
}
async function nudgeWakes(options) {
  const log = options.log ?? console.error;
  const acked = [];
  for (const wake of options.wakes) {
    const resolved = resolveWake(wake);
    if (!resolved) {
      warnOnce(options.warned, wake.id, "missing", log, `[replyslip] wake ${wake.id}: missing driver and target; not acked`);
      continue;
    }
    const key = `${wake.id}:${resolved.driver}`;
    const driver = options.registry.get(resolved.driver);
    if (!driver) {
      warnOnce(
        options.warned,
        key,
        "unknown",
        log,
        `[replyslip] wake ${wake.id} driver ${resolved.driver}: unknown driver; not acked`
      );
      continue;
    }
    const check = options.checks.get(driver.id);
    if (!check?.ok) {
      warnOnce(
        options.warned,
        key,
        "check",
        log,
        `[replyslip] wake ${wake.id} driver ${driver.id}: ${check?.message ?? "driver check failed"}; not acked`
      );
      continue;
    }
    const result = await driver.nudge(resolved.target, WAKE_NOTICE);
    if (result.ok) {
      acked.push(wake.id);
      continue;
    }
    warnOnce(
      options.warned,
      key,
      "nudge",
      log,
      `[replyslip] wake ${wake.id} driver ${driver.id}: ${result.error ?? "nudge failed"}; not acked`
    );
  }
  return acked;
}
function warnOnce(warned, key, kind, log, message) {
  const slot = `${key}:${kind}`;
  if (warned.has(slot)) return;
  warned.add(slot);
  log(message);
}
async function watch(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? console.error;
  const registry = options.registry ?? defaultRegistry(options.runCommand);
  const base = options.url.replace(/\/$/, "");
  const checks = await checkDrivers(registry, log);
  const warned = /* @__PURE__ */ new Set();
  do {
    const response = await fetchImpl(`${base}/api/v1/watcher/poll`, {
      method: "POST",
      headers: { authorization: `Bearer ${options.key}` }
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Watcher poll failed (${response.status}): ${text.slice(0, 200)}`);
    }
    const payload = await response.json();
    const acked = await nudgeWakes({
      wakes: payload.wakes ?? [],
      registry,
      checks,
      warned,
      log
    });
    if (acked.length > 0) {
      const ack = await fetchImpl(`${base}/api/v1/watcher/ack`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.key}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ wake_ids: acked })
      });
      if (!ack.ok) {
        const text = await ack.text();
        throw new Error(`Watcher ack failed (${ack.status}): ${text.slice(0, 200)}`);
      }
    }
    if (options.once) return;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  } while (!options.once);
}

// packages/cli/src/cli.ts
function flag(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return void 0;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) return void 0;
  return value;
}
function positionals(argv) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--force" || arg === "--once") continue;
    if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value && !value.startsWith("-")) i += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}
async function runReplyslip(argv, io = {}) {
  const stdout = io.stdout ?? ((line) => process.stdout.write(`${line}
`));
  const stderr = io.stderr ?? ((line) => process.stderr.write(`${line}
`));
  const env = io.env ?? process.env;
  const [command, ...rest] = positionals(argv);
  if (command === "key-path") {
    const name = rest[0] ?? flag(argv, "--name");
    if (!name || !AGENT_NAME_PATTERN.test(name)) {
      stderr("Usage: replyslip key-path <name>");
      return 1;
    }
    stdout(agentKeyPath(name, io.home));
    return 0;
  }
  if (command === "register") {
    const name = flag(argv, "--name");
    if (!name || !AGENT_NAME_PATTERN.test(name)) {
      stderr("Usage: replyslip register --join-code <code> --name <name> [--url <origin>] [--description <text>] [--force]");
      return 1;
    }
    const joinCode = resolveJoinCode(name, flag(argv, "--join-code"), env);
    if (!joinCode) {
      stderr(
        `Pass --join-code or set ${joinCodeEnvName(name)}. A shared REPLYSLIP_JOIN_CODE is ignored: one name on a shared machine burned single-use join codes when the wrong process registered first.`
      );
      return 1;
    }
    const relayUrl = flag(argv, "--url") ?? env.REPLYSLIP_URL ?? "https://replyslip.com";
    try {
      const saved = await registerAgent({
        name,
        description: flag(argv, "--description"),
        joinCode,
        relayUrl,
        home: io.home,
        force: argv.includes("--force"),
        fetchImpl: io.fetchImpl
      });
      stdout(saved.name);
      stdout(saved.mcpUrl);
      stdout(`key saved to ${saved.path}`);
      return 0;
    } catch (err) {
      stderr(err instanceof Error ? err.message : "Registration failed.");
      return 1;
    }
  }
  if (command !== "watch") {
    stderr("Usage: replyslip watch | register | key-path");
    return 1;
  }
  const url = flag(argv, "--url") ?? env.REPLYSLIP_URL;
  const keyFile = flag(argv, "--key-file");
  let key = flag(argv, "--key") ?? env.REPLYSLIP_WATCHER_KEY;
  if (keyFile) {
    try {
      key = await readWatcherKeyFile(keyFile, stderr);
    } catch (err) {
      stderr(err instanceof Error ? err.message : "Could not read watcher key file.");
      return 1;
    }
  }
  const intervalMs = Number(flag(argv, "--interval") ?? env.REPLYSLIP_POLL_INTERVAL_MS ?? "3000");
  if (!url || !key) {
    stderr("Set --url and one of --key-file, --key, or REPLYSLIP_WATCHER_KEY. REPLYSLIP_URL stands in for --url.");
    return 1;
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 500) {
    stderr("--interval must be at least 500 milliseconds.");
    return 1;
  }
  await watch({ url, key, intervalMs, once: argv.includes("--once"), fetchImpl: io.fetchImpl });
  return 0;
}
async function readWatcherKeyFile(file, stderr) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new Error(`Could not read watcher key file ${file}.`);
  }
  const key = text.trim();
  if (!key || key.includes("\n") || key.includes("\r")) {
    throw new Error(`Watcher key file ${file} must contain a single line.`);
  }
  try {
    const info = await stat2(file);
    if ((info.mode & 63) !== 0) {
      stderr(`Watcher key file ${file} is not mode 600.`);
    }
  } catch {
  }
  return key;
}

// packages/cli/src/index.ts
runReplyslip(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
