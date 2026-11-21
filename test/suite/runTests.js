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
function cachedExecutable(root) {
  const cacheRoot = path.join(root, ".vscode-test");
  if (!fs.existsSync(cacheRoot)) {
    return undefined;
  }
  const candidates = [];
  for (const entry of fs.readdirSync(cacheRoot)) {
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

  // A scratch user-data dir and extensions dir, so the test never sees (or
  // changes) the developer's real VS Code state.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fin-vscode-e2e-"));
  const userDataDir = path.join(scratch, "user-data");
  const extensionsDir = path.join(scratch, "extensions");

  // An explicit override wins; otherwise reuse a cached Linux/Windows build when one
  // is present, and let the library download and resolve the build for any other
  // platform (its macOS layout is not one this repository should guess at).
  const explicit = process.env.VSCODE_EXECUTABLE_PATH || cachedExecutable(extensionDevelopmentPath);
  const version = process.env.VSCODE_TEST_VERSION;
  const launchArgs = [userDataDir, `--extensions-dir=${extensionsDir}`, "--disable-workspace-trust"];

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs,
      ...(explicit ? { vscodeExecutablePath: explicit } : {}),
      ...(version ? { version } : {}),
    });
  } catch (error) {
    console.error("Extension host test run failed:", error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main();
