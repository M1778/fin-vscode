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

const path = require("path");
const fs = require("fs");
const os = require("os");
const { runTests } = require("@vscode/test-electron");

/**
 * The VS Code build the suite runs against. Pinned rather than "latest": a macOS
 * bundle-layout change in a newer build is not this extension's bug, and the pin
 * makes a failure mean the extension changed.
 */
const DEFAULT_VSCODE_VERSION = "1.95.3";

/**
 * Launches a real VS Code, installs this extension in it, and runs
 * `test/suite/extension.test.js` inside that window.
 *
 * Downloading a build needs network access; `VSCODE_EXECUTABLE_PATH` points at an
 * existing installation instead, and an already-extracted download under
 * `.vscode-test` is reused so a second run needs no network at all.
 */
/**
 * An already-extracted build under `.vscode-test`, so a developer's second run
 * needs no network. The path shapes differ per platform and VS Code build, so only
 * the two this repository has actually run are recognised; anything else falls
 * through to `@vscode/test-electron`, whose own resolution is authoritative.
 */
function cachedExecutable(root, version) {
  const cacheRoot = path.join(root, ".vscode-test");
  if (!fs.existsSync(cacheRoot)) {
    return undefined;
  }
  const candidates = [];
  for (const entry of fs.readdirSync(cacheRoot)) {
    // Only a build of the requested version is a valid cache hit; reusing a different
    // one would make the pin a lie.
    if (version && !entry.endsWith(`-${version}`)) {
      continue;
    }
    const base = path.join(cacheRoot, entry);
    if (entry.startsWith("vscode-linux")) {
      candidates.push(path.join(base, "code"));
    } else if (entry.startsWith("vscode-win32") && process.platform === "win32") {
      candidates.push(path.join(base, "Code.exe"));
    }
  }
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const extensionTestsPath = path.resolve(__dirname, "index.js");
  // `VSCODE_TEST_CACHE` lets a test run use a throwaway download directory, which is
  // how CI isolates a run from any cache a previous job left behind.
  const cachePath = process.env.VSCODE_TEST_CACHE;

  // A scratch user-data dir and extensions dir, so the test never sees (or
  // changes) the developer's real VS Code state.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fin-vscode-e2e-"));
  const userDataDir = path.join(scratch, "user-data");
  const extensionsDir = path.join(scratch, "extensions");

  const version = process.env.VSCODE_TEST_VERSION || DEFAULT_VSCODE_VERSION;
  // Precedence: an explicit executable, then a cached build of *this* version, then a
  // download. The version check is what keeps the pin honest.
  const explicit =
    process.env.VSCODE_EXECUTABLE_PATH || cachedExecutable(extensionDevelopmentPath, version);
  const launchArgs = [userDataDir, `--extensions-dir=${extensionsDir}`, "--disable-workspace-trust"];

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs,
      ...(explicit ? { vscodeExecutablePath: explicit } : {}),
      ...(version ? { version } : {}),
      ...(cachePath ? { cachePath } : {}),
    });
  } catch (error) {
    console.error("Extension host test run failed:", error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main();
