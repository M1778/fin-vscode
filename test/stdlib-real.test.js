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

// The standard-library index against the real library, not a fixture. Skipped with
// a clear message when FIN_STDLIB is not set, so a checkout without Fin still runs
// the rest of the suite; CI sets it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { parseFinSource, moduleHeader } = require("../out/stdlib/model.js");

const STDLIB = process.env.FIN_STDLIB;

test("real lib/std: every module parses and the index is a real API", { skip: STDLIB ? false : "FIN_STDLIB not set" }, () => {
  const files = fs.readdirSync(STDLIB).filter((name) => name.endsWith(".fin"));
  assert.ok(files.length >= 40, `expected the whole library, found ${files.length} modules`);

  let exported = 0;
  let withDoc = 0;
  let emptyModules = 0;
  const names = new Set();
  for (const file of files) {
    const text = fs.readFileSync(path.join(STDLIB, file), "utf8");
    const declarations = parseFinSource(text, file.replace(/\.fin$/, ""));
    const publicEntries = declarations.filter((entry) => entry.exported && entry.kind !== "namespace");
    if (publicEntries.length === 0) {
      // reflect.fin documents that it declares nothing on purpose: its four
      // intrinsics are `@`-spellings the compiler folds, so an import would
      // resolve to nothing. An empty module is only acceptable when it says so.
      assert.match(moduleHeader(text), /Nothing is declared\s+here|declares nothing|Nothing\./i,
        `${file} exports nothing and does not say why`);
      emptyModules += 1;
      continue;
    }
    for (const entry of publicEntries) {
      assert.ok(entry.name.length > 0, `${file}: a declaration has no name`);
      assert.ok(!/\n/.test(entry.signature), `${file}: ${entry.name} signature is multiline`);
      names.add(entry.name);
      exported += 1;
      if (entry.doc.trim() !== "") {
        withDoc += 1;
      }
    }
  }
  assert.ok(exported > 300, `expected a real library, parsed ${exported} exported declarations`);
  assert.ok(emptyModules <= 1, `only a documented module may be empty, found ${emptyModules}`);
  // Not every declaration is documented, but the documented ones are the API a
  // user hovers, and their absence would make hover a signature with no prose.
  assert.ok(withDoc > exported / 4, `only ${withDoc} of ${exported} declarations carry a doc comment`);
  // Names a user will actually type, from modules that are documented as usable.
  for (const expected of ["len", "concat", "trim", "printf"]) {
    assert.ok(names.has(expected), `the index should know ${expected}`);
  }
});

test("real lib/std: a module header states what the module does, banner excluded", { skip: STDLIB ? false : "FIN_STDLIB not set" }, () => {
  const strings = fs.readFileSync(path.join(STDLIB, "strings.fin"), "utf8");
  const header = moduleHeader(strings);
  assert.match(header, /^Strings: length, comparison/);
  assert.ok(!header.includes("Made with"), "the shared brand banner is not the module's own header");
  assert.match(header, /WHAT A `string` IS/, "the module's caveats belong in the header");

  const stdio = moduleHeader(fs.readFileSync(path.join(STDLIB, "stdio.fin"), "utf8"));
  assert.ok(stdio.trim().length > 40, "stdio.fin has a real header");
});
