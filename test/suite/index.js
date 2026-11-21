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
const Mocha = require("mocha");

/**
 * The extension-host test runner. `@vscode/test-electron` loads this module inside
 * a real VS Code and calls `run()`; resolving means the suite passed, rejecting
 * means it did not.
 *
 * Mocha runs in the extension host, so `vscode` is the real API rather than a stub.
 */
async function run() {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 180_000 });
  mocha.addFile(path.resolve(__dirname, "extension.test.js"));
  await mocha.loadFilesAsync();
  await new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} extension-host test(s) failed`));
        return;
      }
      resolve();
    });
  });
}

module.exports = { run };
