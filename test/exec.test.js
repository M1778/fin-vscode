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
//
// Windows note: a `.cmd`/`.bat` cannot be spawned without `shell: true`, and the
// product never uses a shell, so the Windows fake is a `.js` file run by Node
// itself. That keeps the test honest about what the extension actually does.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { run, explainSpawnError } = require("../out/exec.js");

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fin-vscode-test-"));
}

/**
 * Write a fake tool that is a real executable on every platform.
 * Returns the command plus any leading arguments needed to run it.
 */
function writeFakeTool(dir, name, body) {
  if (process.platform === "win32") {
    const file = path.join(dir, `${name}.js`);
    const source = [
      "const args = process.argv.slice(2);",
      'const out = (text) => process.stdout.write(String(text) + "\\n");',
      'const err = (text) => process.stderr.write(String(text) + "\\n");',
      body,
    ].join("\n");
    fs.writeFileSync(file, source, "utf8");
    return { command: process.execPath, prefix: [file] };
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, "utf8");
  fs.chmodSync(file, 0o755);
  return { command: file, prefix: [] };
}

function runFake(tool, args, options) {
  return run(tool.command, [...tool.prefix, ...args], options);
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
    const tool = writeFakeTool(
      dir,
      "fake-finc",
      process.platform === "win32"
        ? 'out(\'{"kind":"summary","errors":0,"warnings":0,"exitCode":0,"status":"ok"}\');\nerr("chatter");\nprocess.exit(0);'
        : 'echo \'{"kind":"summary","errors":0,"warnings":0,"exitCode":0,"status":"ok"}\'\necho "chatter" >&2\nexit 0'
    );
    const result = await runFake(tool, ["a.fin", "--diagnostics=json"], { cwd: dir }).done;
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
    const tool = writeFakeTool(
      spaced,
      "fake-finc",
      process.platform === "win32"
        ? 'out("argv1=" + args[0]);\nout("count=" + args.length);\nprocess.exit(0);'
        : 'echo "argv1=$1"\necho "count=$#"\nexit 0'
    );
    const result = await runFake(tool, [path.join(spaced, "my file.fin")], { cwd: dir }).done;
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
    const tool = writeFakeTool(
      dir,
      "slow-finc",
      process.platform === "win32"
        ? "setTimeout(() => process.exit(0), 30000);"
        : "sleep 30"
    );
    const child = runFake(tool, [], { cwd: dir });
    // Give the child a moment to exist before killing it.
    await new Promise((resolve) => setTimeout(resolve, 300));
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
    const tool = writeFakeTool(
      dir,
      "slow-finc",
      process.platform === "win32"
        ? "setTimeout(() => process.exit(0), 30000);"
        : "sleep 30"
    );
    const result = await runFake(tool, [], { cwd: dir, timeoutMs: 400 }).done;
    assert.equal(result.cancelled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("UTF-8 output survives chunk splitting (a decoder, not a byte slice)", async () => {
  const dir = scratchDir();
  try {
    const tool = writeFakeTool(
      dir,
      "unicode-finc",
      process.platform === "win32" ? 'out("é😀");' : 'printf "é😀\\n"'
    );
    const result = await runFake(tool, [], { cwd: dir }).done;
    assert.equal(result.stdout.replace(/\r\n/g, "\n"), "é😀\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a huge stream keeps its tail, which is where the error text is", async () => {
  const dir = scratchDir();
  try {
    // Filler then a marker: a small limit must keep the marker at the end.
    const tool = writeFakeTool(
      dir,
      "noisy-finc",
      process.platform === "win32"
        ? 'out("filler line that pads the output".repeat(7000));\nout("MARKER-AT-END");'
        : 'yes "filler line that pads the output" | head -c 200000\necho MARKER-AT-END'
    );
    const result = await runFake(tool, [], { cwd: dir, limit: 5000 }).done;
    assert.match(result.stdout, /MARKER-AT-END/);
    assert.ok(result.stdout.length <= 5100);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function spawnFailure(code, message) {
  return {
    code: null,
    signal: null,
    stdout: "",
    stderr: "",
    failedToStart: true,
    error: Object.assign(new Error(message), { code }),
    cancelled: false,
  };
}

test("a Windows .cmd wrapper is explained, not reported as EINVAL", () => {
  const message = explainSpawnError("C:\\tools\\finc.cmd", spawnFailure("EINVAL", "spawn EINVAL"));
  assert.match(message, /shell wrapper/);
  assert.match(message, /finc\.exe/, "it names the real executable to point at");
  assert.ok(!/EINVAL/.test(message), "the OS errno is not the user's problem");
});

test("other spawn failures keep a reason the user can act on", () => {
  assert.match(explainSpawnError("/x/finc", spawnFailure("ENOENT", "spawn ENOENT")), /does not exist/);
  assert.match(explainSpawnError("/x/finc", spawnFailure("EACCES", "spawn EACCES")), /not executable/);
});
