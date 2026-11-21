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

// `src/config.ts` imports `vscode`, so its pure helpers are exercised through a
// small loader that swaps that module for a stub. The helpers themselves are pure
// path/string logic; the only thing the stub supplies is the API surface the module
// touches at load time.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");

function loadConfigWithStub() {
  const originalResolve = Module._resolveFilename;
  const fakePath = path.join(__dirname, "fixtures", "vscode-stub.js");
  const stub = {
    workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    Uri: { file: (value) => ({ fsPath: value }) },
  };
  require.cache[fakePath] = {
    id: fakePath,
    filename: fakePath,
    loaded: true,
    exports: stub,
  };
  Module._resolveFilename = function (request, ...rest) {
    if (request === "vscode") {
      return fakePath;
    }
    return originalResolve.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve("../out/config.js")];
    return require("../out/config.js");
  } finally {
    Module._resolveFilename = originalResolve;
  }
}

const config = loadConfigWithStub();

test("a bare tool name stays bare so the OS searches PATH", () => {
  assert.equal(config.resolveCommand("finc", "/workspace"), "finc");
  assert.equal(config.resolveCommand("  finfmt  ", "/workspace"), "finfmt");
  assert.equal(config.resolveCommand("", "/workspace"), "");
});

test("a relative path resolves against the workspace, not the process cwd", () => {
  assert.equal(config.resolveCommand("./tools/finc", "/workspace"), path.resolve("/workspace", "tools/finc"));
  assert.equal(config.resolveCommand("bin/finc", "/workspace"), path.resolve("/workspace", "bin/finc"));
});

test("a relative path with no workspace resolves against the process cwd", () => {
  assert.equal(config.resolveCommand("bin/finc", undefined), path.resolve("bin/finc"));
});

test("an absolute path is kept, even with spaces", () => {
  const absolute = path.join(path.sep, "opt", "fin tools", "bin", "finc");
  assert.equal(config.resolveCommand(absolute, "/workspace"), absolute);
});

test("a Windows-style separator is treated as a path", () => {
  const resolved = config.resolveCommand("tools\\finc", "/workspace");
  assert.equal(resolved, path.resolve("/workspace", "tools\\finc"));
});

test("stdlib defaults to <compiler>/../lib/std, which is where Fin installs it", () => {
  const compiler = path.resolve("/opt/fin/bin/finc");
  assert.equal(config.derivedStdlibPath(compiler), path.resolve("/opt/fin/lib/std"));
});

test("the missing-compiler message names the setting and where to install", () => {
  const message = config.missingCompilerMessage("/nope/finc");
  assert.match(message, /Fin compiler not found/);
  assert.match(message, /fin\.compilerPath/);
  assert.match(message, /releases/);
});

test("the missing-formatter message names its own setting", () => {
  const message = config.missingFormatterMessage("/nope/finfmt");
  assert.match(message, /Fin formatter not found/);
  assert.match(message, /fin\.formatterPath/);
});

test("a platform extension is added once, and only on Windows", () => {
  const withExe = config.withPlatformExtension("finc.exe");
  assert.equal(withExe, "finc.exe", "an existing extension is kept on every platform");
});

