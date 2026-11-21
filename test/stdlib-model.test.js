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

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { parseFinSource, moduleHeader } = require("../out/stdlib/model.js");

const FIXTURES = path.join(__dirname, "fixtures", "fin");

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

test("parses `pub fun` with its parameter list, result and doc block", () => {
  const declarations = parseFinSource(readFixture("stdlib-strings.fin"), "strings");
  const len = declarations.find((entry) => entry.name === "len");
  assert.ok(len, "strings::std declares len");
  assert.equal(len.kind, "function");
  assert.equal(len.exported, true);
  assert.equal(len.namespace, "std");
  assert.deepEqual(len.parameters, [{ name: "s", type: "string" }]);
  assert.equal(len.returns, "int");
  assert.match(len.signature, /^pub fun len\(s: string\) <int>/);
  assert.match(len.doc, /byte length, not counting the terminator/);
});

test("a `priv fun` is parsed but not exported", () => {
  const declarations = parseFinSource(readFixture("stdlib-strings.fin"), "strings");
  const privFun = declarations.find((entry) => !entry.exported && entry.kind === "function");
  assert.ok(privFun, "strings.fin has private helpers");
  assert.match(privFun.signature, /^priv fun /);
  // ...and the same name must not be reachable from an import.
  const pubFun = declarations.find((entry) => entry.exported && entry.kind === "function");
  assert.match(pubFun.signature, /^pub fun /);
});

test("parses a struct and its public fields", () => {
  const declarations = parseFinSource(readFixture("stdlib-argparse.fin"), "argparse");
  const flagDef = declarations.find((entry) => entry.name === "FlagDef");
  assert.ok(flagDef);
  assert.equal(flagDef.kind, "struct");
  assert.deepEqual(
    flagDef.fields.map((field) => field.name),
    ["name", "short_name", "desc", "value"]
  );
  assert.equal(flagDef.fields[0].type, "string");
  assert.equal(flagDef.fields[3].type, "bool");
});

test("parses `pub const` and `pub type`", () => {
  const ast = parseFinSource(readFixture("stdlib-strings.fin"), "strings");
  assert.equal(ast.some((entry) => entry.kind === "namespace"), true);
  const astFile = parseFinSource(
    "namespace std {\n\n#[export]\npub const AST_PROGRAM <int> = 1;\n\npub type EnumType = any;\n}\n",
    "ast"
  );
  const constant = astFile.find((entry) => entry.name === "AST_PROGRAM");
  assert.ok(constant);
  assert.equal(constant.kind, "const");
  assert.equal(constant.exported, true);
  const typeAlias = astFile.find((entry) => entry.name === "EnumType");
  assert.ok(typeAlias);
  assert.equal(typeAlias.kind, "type");
});

test("the doc block belongs to the declaration under it, not to a blank-line-separated one", () => {
  const source = [
    "// This belongs to alpha.",
    "pub fun alpha() <int> { return 1; }",
    "",
    "// This does not belong to beta.",
    "",
    "pub fun beta() <int> { return 2; }",
  ].join("\n");
  const declarations = parseFinSource(source, "m");
  assert.equal(declarations[0].doc, "This belongs to alpha.");
  assert.equal(declarations[1].doc, "");
});

test("the whole lib/std index parses: every file yields exported declarations", () => {
  const files = fs.readdirSync(FIXTURES).filter((name) => name.startsWith("stdlib-") && name.endsWith(".fin"));
  assert.ok(files.length >= 3);
  let total = 0;
  for (const file of files) {
    const declarations = parseFinSource(readFixture(file), file);
    const exported = declarations.filter((entry) => entry.exported && entry.kind !== "namespace");
    assert.ok(exported.length > 0, `${file} should export something`);
    for (const declaration of exported) {
      assert.ok(declaration.name.length > 0, `${file}: a declaration has no name`);
      assert.ok(declaration.signature.length > 0, `${file}: ${declaration.name} has no signature`);
      assert.ok(declaration.nameColumn >= 0, `${file}: ${declaration.name} has no column`);
    }
    total += exported.length;
  }
  assert.ok(total > 50, `expected a real library, parsed ${total} declarations`);
});

test("moduleHeader keeps the module's own prose and drops the shared banner", () => {
  const header = moduleHeader(readFixture("stdlib-strings.fin"));
  assert.match(header, /^Strings: length, comparison, search/);
  assert.ok(!header.includes("Made with"));
  assert.match(header, /WHAT A `string` IS/);
});

test("parameters survive a wrapped declaration line", () => {
  const source = ["fun process(", "  first: int,", "  second: string", ") <bool> {", "  return true;", "}"].join("\n");
  const declarations = parseFinSource(source, "m");
  assert.equal(declarations.length, 1);
  assert.deepEqual(
    declarations[0].parameters.map((entry) => entry.name),
    ["first", "second"]
  );
  assert.equal(declarations[0].returns, "bool");
});

test("`fun?` keeps the nullable marker out of the return type", () => {
  const source = "priv fun? read(path: string) <string> {\n  return null;\n}";
  const declarations = parseFinSource(source, "m");
  assert.equal(declarations[0].name, "read");
  assert.equal(declarations[0].returns, "string");
  assert.equal(declarations[0].exported, false);
});
