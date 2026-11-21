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

// The process layer, exercised through real child processes: a fake compiler is
// written to a temp directory and run. No shell, no fixed paths, and every fixture
// is under os.tmpdir()/fin-vscode-test-<random>.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { run } = require("../out/exec.js");

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fin-vscode-test-"));
}

/** Write an executable script; on Windows, a .cmd shim so it can be spawned directly. */
function writeFakeTool(dir, name, body) {
  if (process.platform === "win32") {
    const file = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(file, `@echo off\r\n${body.replace(/\n/g, "\r\n")}\r\n`, "utf8");
    return file;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, "utf8");
  fs.chmodSync(file, 0o755);
  return file;
}

test("a missing executable is reported as failedToStart, never as a clean run", async () => {
  const dir = scratchDir();
  try {
    const result = await run(path.join(dir, "definitely-not-here"), ["--version"]).done;
    assert.equal(result.failedToStart, true);
    assert.equal(result.code, null);
    assert.ok(result.error, "the spawn error is preserved");
    assert.equal(result.stdout, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stdout and stderr are kept apart, and the exit code is real", async () => {
  const dir = scratchDir();
  try {
    const tool = writeFakeTool(dir, "fake-finc", 'echo \'{"kind":"summary","errors":0,"warnings":0,"exitCode":0,"status":"ok"}\'\necho "chatter" >&2\nexit 0');
    const result = await run(tool, ["a.fin", "--diagnostics=json"], { cwd: dir }).done;
    assert.equal(result.code, 0);
    assert.match(result.stdout, /"kind":"summary"/);
    assert.equal(result.stderr.trim(), "chatter");
    assert.ok(!result.stdout.includes("chatter"), "stderr must not leak into the JSON lane");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a path with spaces is one argument, not two", async () => {
  const dir = scratchDir();
  try {
    const spaced = path.join(dir, "dir with spaces");
    fs.mkdirSync(spaced);
    const tool = writeFakeTool(spaced, "fake-finc", 'echo "argv1=$1"\necho "count=$#"\nexit 0');
    const result = await run(tool, [path.join(spaced, "my file.fin")], { cwd: dir }).done;
    assert.equal(result.code, 0);
    assert.match(result.stdout, /argv1=.*my file\.fin/);
    assert.match(result.stdout, /count=1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cancel() kills a slow child and resolves its done promise", async () => {
  const dir = scratchDir();
  try {
    const tool = writeFakeTool(dir, "slow-finc", "sleep 30");
    const child = run(tool, [], { cwd: dir });
    // Give the child a moment to exist before killing it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const started = Date.now();
    await child.cancel();
    const result = await child.done;
    assert.equal(result.cancelled, true);
    assert.ok(Date.now() - started < 10_000, "cancel must not wait for the child's own timeout");
    assert.ok(result.signal !== null || result.code !== 0, "the child did not exit successfully");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a timeout kills the child instead of hanging the editor", async () => {
  const dir = scratchDir();
  try {
    const tool = writeFakeTool(dir, "slow-finc", "sleep 30");
    const result = await run(tool, [], { cwd: dir, timeoutMs: 250 }).done;
    assert.equal(result.cancelled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("UTF-8 output survives chunk splitting (a decoder, not a byte slice)", async () => {
  const dir = scratchDir();
  try {
    const tool = writeFakeTool(dir, "unicode-finc", 'printf "é😀\\n"');
    const result = await run(tool, [], { cwd: dir }).done;
    assert.equal(result.stdout, "é😀\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a huge stream keeps its tail, which is where the error text is", async () => {
  const dir = scratchDir();
  try {
    // 200 KB of filler then a marker line: a small limit must keep the marker.
    const tool = writeFakeTool(dir, "noisy-finc", 'yes "filler line that pads the output" | head -c 200000\necho MARKER-AT-END');
    const result = await run(tool, [], { cwd: dir, limit: 5000 }).done;
    assert.match(result.stdout, /MARKER-AT-END/);
    assert.ok(result.stdout.length <= 5100);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
