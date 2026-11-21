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
function cachedExecutable(root) {
  const cacheRoot = path.join(root, ".vscode-test");
  if (!fs.existsSync(cacheRoot)) {
    return undefined;
  }
  for (const entry of fs.readdirSync(cacheRoot)) {
    if (!entry.startsWith("vscode-")) {
      continue;
    }
    const candidates =
      process.platform === "win32"
        ? ["Code.exe", path.join("bin", "code.cmd")]
        : process.platform === "darwin"
          ? [path.join("Visual Studio Code.app", "Contents", "MacOS", "Electron")]
          : ["code"];
    for (const candidate of candidates) {
      const full = path.join(cacheRoot, entry, candidate);
      if (fs.existsSync(full)) {
        return full;
      }
    }
  }
  return undefined;
}

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const extensionTestsPath = path.resolve(__dirname, "index.js");

  // A scratch user-data dir and extensions dir, so the test never sees (or
  // changes) the developer's real VS Code state.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fin-vscode-e2e-"));
  const userDataDir = path.join(scratch, "user-data");
  const extensionsDir = path.join(scratch, "extensions");

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
