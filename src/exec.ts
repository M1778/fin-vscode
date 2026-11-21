// =============================================================================
// Fin Programming Language
//
// Made with ❤️ for someone special.
//
// This project is genuinely built on love and dedication, a way to express your love can be done through Fin.
// Fin is a semi-object-orientated programming language that specialized in control, giving so much control to the user while asking for the bare minimum.
// Fin is the name of the Angel from BlackNightmare-Stories not yet published.
// “Love is the reason this project exists”
// -----------------------------------------------------------------------------
// Author: M1778
// Repository: https://github.com/M1778/fin-vscode
// Profile: https://github.com/M1778M/
// -----------------------------------------------------------------------------
// Copyright (C) 2027 M1778
//
// This file is part of fin-vscode, a project for the Fin Programming Language.
//
// Licensed under the MIT License. See LICENSE in the repository root.
//
// SPDX-License-Identifier: MIT
// =============================================================================

import { spawn } from "child_process";
import { StringDecoder } from "string_decoder";
import { ParsedReport, parseDiagnosticsJsonl } from "./diagnostics/parse";
import { redactCommandForLog } from "./log";

export interface RunResult {
  /** 0 when the process exited normally with 0. Null when it never started or died on a signal. */
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** True when `error` was set, e.g. ENOENT because the binary is not there. */
  failedToStart: boolean;
  error?: NodeJS.ErrnoException;
  /** True when a cancel or timeout asked the child to stop. */
  cancelled: boolean;
}

export interface Cancellable {
  /** Ask the child to exit, escalate to SIGKILL after a grace period, resolve when it is gone. */
  cancel(): Promise<void>;
  readonly done: Promise<RunResult>;
  readonly pid: number | undefined;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Max characters kept per stream; the tail is kept because that is where errors land. */
  limit?: number;
  timeoutMs?: number;
}

const DEFAULT_LIMIT = 4 * 1024 * 1024;
const CANCEL_GRACE_MS = 1500;
/** How long to collect trailing output after `exit` before `close` may never come. */
const EXIT_FLUSH_MS = 120;

/**
 * Run a command from an argv array. Never uses a shell: a path with spaces stays one
 * argument and nothing in the invocation is interpreted as shell syntax.
 */
export function run(command: string, args: readonly string[], options: RunOptions = {}): Cancellable {
  const limit = options.limit ?? DEFAULT_LIMIT;
  // `shell: false` is the whole point: a path with spaces stays one argument and no
  // part of the invocation is interpreted as shell syntax.
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const outDecoder = new StringDecoder("utf8");
  const errDecoder = new StringDecoder("utf8");

  let stdout = "";
  let stderr = "";
  let cancelled = false;
  let settled = false;
  let timeout: NodeJS.Timeout | undefined;
  let killTimer: NodeJS.Timeout | undefined;

  let resolveDone: (value: RunResult) => void = () => undefined;
  const done = new Promise<RunResult>((resolve) => {
    resolveDone = resolve;
  });

  const finish = (result: RunResult): void => {
    if (settled) {
      return;
    }
    settled = true;
    if (timeout) {
      clearTimeout(timeout);
    }
    if (killTimer) {
      clearTimeout(killTimer);
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
    }
    resolveDone(result);
  };

  const keepTail = (current: string, addition: string): string =>
    current.length + addition.length > limit ? (current + addition).slice(-limit) : current + addition;

  let spawnError: NodeJS.ErrnoException | undefined;
  let flushTimer: NodeJS.Timeout | undefined;

  child.on("error", (error: NodeJS.ErrnoException) => {
    spawnError = error;
    finish({ code: null, signal: null, stdout, stderr, failedToStart: true, error, cancelled });
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = keepTail(stdout, outDecoder.write(chunk));
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = keepTail(stderr, errDecoder.write(chunk));
  });

  child.on("close", (code, signal) => {
    stdout = keepTail(stdout, outDecoder.end());
    stderr = keepTail(stderr, errDecoder.end());
    finish({
      code,
      signal,
      stdout,
      stderr,
      failedToStart: spawnError !== undefined,
      error: spawnError,
      cancelled,
    });
  });

  // `close` waits for every holder of the stdio pipes, and a tool that spawned a
  // child of its own (a shell, a linker) can leave one holding them after the tool
  // is dead. Finishing on `exit` after a short flush keeps Cancel and timeout from
  // hanging the editor on someone else's orphan.
  child.on("exit", (code, signal) => {
    flushTimer = setTimeout(() => {
      stdout = keepTail(stdout, outDecoder.end());
      stderr = keepTail(stderr, errDecoder.end());
      finish({
        code,
        signal,
        stdout,
        stderr,
        failedToStart: spawnError !== undefined,
        error: spawnError,
        cancelled,
      });
    }, EXIT_FLUSH_MS);
  });

  if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
    timeout = setTimeout(() => {
      cancelled = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
  }

  const cancel = async (): Promise<void> => {
    if (settled) {
      return;
    }
    cancelled = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (!settled) {
        child.kill("SIGKILL");
      }
    }, CANCEL_GRACE_MS);
    await done;
  };

  return { cancel, done, pid: child.pid };
}

/**
 * Parse a finished compiler run. finc 1.0.1 writes the JSONL report to **stderr**
 * (its contract reserves stdout for `--help`/`--version`/`--explain`); the brief
 * says stdout. Both are read, the summary decides, and a run with neither is a
 * failure rather than a clean file.
 */
export function parseCompilerOutput(result: RunResult): ParsedReport {
  const onStdout = parseDiagnosticsJsonl(result.stdout);
  if (onStdout.summary !== null) {
    return onStdout;
  }
  const onStderr = parseDiagnosticsJsonl(result.stderr);
  if (onStderr.summary !== null) {
    // Metadata lines that were not JSON on stderr are chatter, not a protocol
    // violation; only a stray line on the report stream is worth keeping.
    return { diagnostics: onStderr.diagnostics, summary: onStderr.summary, unparsed: onStdout.unparsed };
  }
  const onBoth = {
    diagnostics: [...onStderr.diagnostics, ...onStdout.diagnostics],
    summary: null,
    unparsed: [...onStderr.unparsed, ...onStdout.unparsed],
  };
  return onBoth;
}

/**
 * Explain a spawn failure in the terms the user can act on.
 *
 * `ENOENT` means the path is wrong or the tool is not on `PATH`. `EINVAL` on
 * Windows is what a `.cmd`/`.bat` produces when spawned without a shell: Node
 * refuses, and this extension never uses a shell (a path with spaces would split
 * and a path with `&` would execute). A user who wrote `finc.cmd` gets told to
 * point at the `.exe` instead of seeing "EINVAL".
 */
export function explainSpawnError(command: string, result: RunResult): string {
  const code = result.error?.code;
  if (code === "EINVAL" && /\.(cmd|bat)$/i.test(command)) {
    return (
      `"${command}" is a shell wrapper. Fin runs the compiler without a shell, so ` +
      `point fin.compilerPath at the real .exe (finc.exe) instead.`
    );
  }
  if (code === "EACCES") {
    return `"${command}" is not executable. Check its permissions.`;
  }
  if (code === "ENOENT") {
    return `"${command}" does not exist.`;
  }
  return result.error?.message ?? "the process could not be started.";
}

/** Human-readable one-line description of a finished run, for the output channel. */
export function describeRun(command: string, args: readonly string[], result: RunResult): string {
  const status = result.failedToStart
    ? `could not start: ${result.error?.message ?? "unknown error"}`
    : result.signal
      ? `killed by ${result.signal}`
      : `exit ${result.code}`;
  return `${redactCommandForLog([command, ...args])} -> ${status}`;
}
