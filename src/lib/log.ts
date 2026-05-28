/**
 * Phase 8 D4 (2026-05-28) — structured logger.
 *
 * Thin zero-dep wrapper around console that emits structured JSON in
 * production (parseable by Vercel logs / pino / Datadog ingestion) and
 * pretty-prints in dev. The goal is to give every server-side log line
 * a stable shape:
 *
 *     { ts, level, scope, msg, ...payload }
 *
 * **Why not pino?** A real pino dep would tighten the contract but
 * adds ~150KB to the install graph and a binary build step. The
 * wrapper below is small enough that we can swap to pino later by
 * changing only this file (no caller-side churn). The shape we emit
 * is already pino-compatible.
 *
 * **Scope strings** identify the source module. Convention:
 *   - API route: `api:<short-path>` e.g. `api:indicators` / `api:explain`
 *   - Library: `lib:<short-module>` e.g. `lib:audit` / `lib:queue`
 *   - Background worker: `worker:<job-type>` e.g. `worker:recompute`
 *
 * Use `getLogger(scope)` once at module top, then call `.info / .warn
 * / .error / .debug` like console. Test environment downgrades all
 * levels to `noop` unless `LOG_IN_TESTS=1` is set — tests stay quiet
 * by default but can opt in when diagnosing flake.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogPayload {
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, payload?: LogPayload): void;
  info(msg: string, payload?: LogPayload): void;
  warn(msg: string, payload?: LogPayload): void;
  error(msg: string, payload?: LogPayload): void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function activeMinLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env === "debug" || env === "info" || env === "warn" || env === "error") {
    return env;
  }
  // Defaults: production = info+, everywhere else = debug+.
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function inTestEnv(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    typeof process.env.VITEST !== "undefined"
  );
}

function inProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True when the caller asked us to keep logging in tests. */
function logInTests(): boolean {
  return process.env.LOG_IN_TESTS === "1";
}

/**
 * Format a single log line. Production = JSON (one line per log,
 * parseable downstream). Dev = pretty multi-segment string with the
 * payload appended.
 */
function format(
  scope: string,
  level: LogLevel,
  msg: string,
  payload: LogPayload | undefined,
): string {
  const ts = new Date().toISOString();
  if (inProductionEnv()) {
    return JSON.stringify({ ts, level, scope, msg, ...(payload ?? {}) });
  }
  // Dev pretty path: `[12:34:56.789] INFO  api:indicators · message {payload}`
  const time = ts.slice(11, 23);
  const pad = level.toUpperCase().padEnd(5, " ");
  const tail =
    payload && Object.keys(payload).length > 0
      ? " " + safeStringify(payload)
      : "";
  return `[${time}] ${pad} ${scope} · ${msg}${tail}`;
}

/** Defensive JSON.stringify: catches circular refs without throwing. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable payload]";
  }
}

/** Route a formatted line to the right console method so log levels
 *  preserve their natural channel (stderr for warn/error). */
function emit(level: LogLevel, line: string): void {
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === "warn") {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export function getLogger(scope: string): Logger {
  const make = (level: LogLevel) =>
    (msg: string, payload?: LogPayload): void => {
      if (inTestEnv() && !logInTests()) return;
      if (LEVEL_RANK[level] < LEVEL_RANK[activeMinLevel()]) return;
      emit(level, format(scope, level, msg, payload));
    };
  return {
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
  };
}

/** Default logger for ad-hoc one-off calls. Prefer named loggers. */
export const log = getLogger("app");
