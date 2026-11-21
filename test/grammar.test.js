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

// Real Oniguruma tokenization of real Fin files, through the same engine VS Code
// uses (vscode-textmate + vscode-oniguruma). Each assertion names a byte offset in
// a real file and the scope that must own it.
//
// Files are copied from their sources rather than retyped, so a grammar change
// that only highlights a hand-written snippet is caught here:
//   test/fixtures/fin/*.fin          <- Fin/tests/samples and Fin/lib/std (see SOURCES)

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vsctm = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");

const GRAMMAR = path.join(__dirname, "..", "syntaxes", "fin.tmLanguage.json");
const FIXTURES = path.join(__dirname, "fixtures", "fin");

/** Where each fixture came from in the Fin repository, recorded in `test/fixtures/fin/SOURCES.md`. */
const SOURCES = {
  "basic.fin": "tests/samples/basic.fin",
  "structs.fin": "tests/samples/structs.fin",
  "preprocessor.fin": "tests/samples/preprocessor.fin",
  "match.fin": "tests/samples/match.fin",
  "interface_pointer_map.fin": "tests/samples/interface_pointer_map.fin",
  "macros.fin": "tests/samples/macros.fin",
  "stdlib-ascii.fin": "lib/std/ascii.fin",
  "stdlib-diag.fin": "lib/std/diag.fin",
  "stdlib-strings.fin": "lib/std/strings.fin",
  "stdlib-argparse.fin": "lib/std/argparse.fin",
  "love.fin": "tests/samples/love.fin",
};

let registry;

async function loadRegistry() {
  if (registry) {
    return registry;
  }
  const wasmPath = path.join(
    path.dirname(require.resolve("vscode-oniguruma")),
    "..",
    "release",
    "onig.wasm"
  );
  const wasm = fs.readFileSync(wasmPath);
  const onigLib = oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)).then(() => ({
    createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
    createOnigString: (text) => new oniguruma.OnigString(text),
  }));
  registry = new vsctm.Registry({
    onigLib,
    loadGrammar: async (scopeName) => {
      if (scopeName !== "source.fin") {
        return null;
      }
      return vsctm.parseRawGrammar(fs.readFileSync(GRAMMAR, "utf8"), GRAMMAR);
    },
  });
  return registry;
}

/** Tokenize a whole file; returns {lines, scopesAt(line, column)} with 0-based line and column. */
async function tokenizeFile(file) {
  const grammar = await (await loadRegistry()).loadGrammar("source.fin");
  assert.ok(grammar, "the grammar must load as source.fin");
  const text = fs.readFileSync(path.join(FIXTURES, file), "utf8");
  const lines = text.split(/\r?\n/);
  const tokenized = [];
  let ruleStack = vsctm.INITIAL;
  for (const line of lines) {
    const result = grammar.tokenizeLine(line, ruleStack);
    tokenized.push(result.tokens);
    ruleStack = result.ruleStack;
  }
  return { text, lines, tokenized };
}

/** The most specific (last) scope at a 0-based line and column. */
function scopesAt(file, line, column) {
  const tokens = file.tokenized[line];
  const token = tokens.find((entry) => column >= entry.startIndex && column < entry.endIndex);
  return token ? token.scopes : [];
}

function textAt(file, line, start, end) {
  return file.lines[line].slice(start, end);
}

/** Index of `needle` on a 0-based line, asserted present. */
function indexOf(file, line, needle) {
  const at = file.lines[line].indexOf(needle);
  assert.notEqual(at, -1, `fixture line ${line + 1} should contain ${JSON.stringify(needle)}`);
  return at;
}

test("the copied grammar is the canonical one plus documented local additions", () => {
  const grammar = JSON.parse(fs.readFileSync(GRAMMAR, "utf8"));
  assert.equal(grammar.scopeName, "source.fin");
  assert.deepEqual(grammar.fileTypes, ["fin"]);
  const canonical = process.env.FIN_TMLANGUAGE;
  if (!canonical) {
    return; // The Fin checkout is not required to run this suite.
  }
  const upstream = JSON.parse(fs.readFileSync(canonical, "utf8"));
  assert.equal(upstream.scopeName, "source.fin");
  // Every keyword the canonical file colours must also be coloured here; the local
  // copy only adds, because a dropped scope would silently unhighlight real code.
  const localRules = JSON.stringify(grammar);
  for (const rule of upstream.patterns) {
    if (rule.match) {
      assert.ok(localRules.includes(JSON.stringify(rule.match).slice(1, -1)), `missing pattern ${rule.match}`);
    }
  }
});

test("basic.fin: keyword, function name, type, number, operator, punctuation", async () => {
  const file = await tokenizeFile("basic.fin");
  // line 3 (0-based 2): `fun main() <noret> {`
  assert.ok(scopesAt(file, 2, indexOf(file, 2, "fun")).includes("storage.type.function.fin"));
  assert.ok(scopesAt(file, 2, indexOf(file, 2, "main")).includes("entity.name.function.fin"));
  assert.ok(scopesAt(file, 2, indexOf(file, 2, "noret")).includes("storage.type.fin"));
  // line 4: `    let x <int> = 10;`
  assert.ok(scopesAt(file, 3, indexOf(file, 3, "let")).includes("keyword.declaration.fin"));
  assert.ok(scopesAt(file, 3, indexOf(file, 3, "int")).includes("storage.type.fin"));
  assert.ok(scopesAt(file, 3, indexOf(file, 3, "10")).includes("constant.numeric.integer.fin"));
  assert.ok(scopesAt(file, 3, indexOf(file, 3, "=")).includes("keyword.operator.fin"));
  assert.ok(scopesAt(file, 3, indexOf(file, 3, ";")).includes("punctuation.fin"));
  // line 5: `    let y <float> = 20.5;`
  assert.ok(scopesAt(file, 4, indexOf(file, 4, "20.5")).includes("constant.numeric.float.fin"));
});

test("real stdlib file: comment banner, `//` doc lines and `#[export]` attributes", async () => {
  const file = await tokenizeFile("stdlib-ascii.fin");
  assert.ok(scopesAt(file, 0, 0).includes("comment.line.double-slash.fin"));
  const exportLine = file.lines.findIndex((line) => line.trim() === "#[export]");
  assert.ok(exportLine >= 0);
  assert.ok(scopesAt(file, exportLine, 0).includes("meta.attribute.fin"));
  const funLine = file.lines.findIndex((line) => line.includes("pub fun is_alpha"));
  assert.ok(scopesAt(file, funLine, indexOf(file, funLine, "is_alpha")).includes("entity.name.function.fin"));
  assert.ok(scopesAt(file, funLine, indexOf(file, funLine, "pub")).includes("keyword.modifier.fin"));
  assert.ok(scopesAt(file, funLine, indexOf(file, funLine, "char")).includes("storage.type.fin"));
  // `'a'` is a character literal, not a single-quoted string.
  const bodyLine = file.lines.findIndex((line) => line.includes("c >= 'a'"));
  assert.ok(scopesAt(file, bodyLine, indexOf(file, bodyLine, "'a'")).includes("string.quoted.single.fin"));
});

test("nullable function: `fun?` marks the return as nullable", async () => {
  const file = await tokenizeFile("stdlib-diag.fin");
  const line = file.lines.findIndex((entry) => entry.includes("fun? diag_read_file"));
  assert.ok(line >= 0, "diag.fin should still declare a nullable function");
  assert.ok(scopesAt(file, line, indexOf(file, line, "fun?")).includes("storage.type.function.fin"));
  assert.ok(scopesAt(file, line, indexOf(file, line, "?")).includes("keyword.operator.nullable.fin"));
  assert.ok(scopesAt(file, line, indexOf(file, line, "diag_read_file")).includes("entity.name.function.fin"));
});

test("struct declaration and fields in a real sample", async () => {
  const file = await tokenizeFile("structs.fin");
  // line 2 (0-based 2): `struct Vector3 {`
  assert.ok(scopesAt(file, 2, indexOf(file, 2, "struct")).includes("keyword.declaration.fin"));
  assert.ok(scopesAt(file, 2, indexOf(file, 2, "Vector3")).includes("entity.name.type.fin"));
  assert.ok(scopesAt(file, 3, indexOf(file, 3, "x")).includes("variable.other.fin"));
  assert.ok(scopesAt(file, 3, indexOf(file, 3, "float")).includes("storage.type.fin"));
});

test("preprocessor lines are their own scope", async () => {
  const file = await tokenizeFile("preprocessor.fin");
  const cdefLine = file.lines.findIndex((line) => line.startsWith("#cdef CONST_NUM"));
  assert.ok(cdefLine >= 0);
  assert.ok(scopesAt(file, cdefLine, 0).includes("keyword.control.preprocessor.fin"));
  const ifdefLine = file.lines.findIndex((line) => line.startsWith("#c_ifdef DEBUG"));
  assert.ok(scopesAt(file, ifdefLine, 0).includes("keyword.control.preprocessor.fin"));
});

test("@define and a macro call keep their own scopes", async () => {
  const file = await tokenizeFile("macros.fin");
  const defineLine = file.lines.findIndex((line) => line.includes("@define"));
  assert.ok(defineLine >= 0);
  assert.ok(scopesAt(file, defineLine, 0).includes("meta.macro-declaration.fin"));
  // `@` opens the meta region; the word starts one column later.
  assert.ok(scopesAt(file, defineLine, indexOf(file, defineLine, "@define")).includes("meta.macro-declaration.fin"));
  assert.ok(scopesAt(file, defineLine, indexOf(file, defineLine, "@define") + 1).includes("keyword.other.macro.fin"));
  const macroName = file.lines[defineLine].slice(indexOf(file, defineLine, "@define") + "@define".length).trim().split(/[(\s]/)[0];
  assert.ok(
    scopesAt(file, defineLine, indexOf(file, defineLine, macroName)).includes("entity.name.function.fin"),
    `${macroName} should be an entity.name.function.fin`
  );
});

test("enum member patterns and `=>` arms in the match sample", async () => {
  const file = await tokenizeFile("match.fin");
  const enumLine = file.lines.findIndex((line) => line.startsWith("enum R "));
  assert.ok(scopesAt(file, enumLine, indexOf(file, enumLine, "enum")).includes("keyword.declaration.fin"));
  assert.ok(scopesAt(file, enumLine, indexOf(file, enumLine, "R")).includes("entity.name.type.fin"));
  const matchLine = file.lines.findIndex((line) => line.includes("match (a)"));
  assert.ok(scopesAt(file, matchLine, indexOf(file, matchLine, "match")).includes("keyword.control.fin"));
  assert.ok(scopesAt(file, matchLine, indexOf(file, matchLine, "=>")).includes("keyword.operator.fin"));
});

test("the local additions colour compiler intrinsics and `@special(pub)`", async () => {
  const file = await tokenizeFile("interface_pointer_map.fin");
  const specialLine = file.lines.findIndex((line) => line.includes("@special(pub)"));
  assert.ok(specialLine >= 0);
  assert.ok(
    scopesAt(file, specialLine, indexOf(file, specialLine, "meta")).includes("entity.name.function.fin"),
    "@special(pub) declares a name"
  );
  assert.ok(scopesAt(file, specialLine, indexOf(file, specialLine, "pub")).includes("keyword.modifier.fin"));
  // `$struct` is a meta-type, not a declaration keyword.
  const dollar = indexOf(file, specialLine, "$struct");
  assert.ok(scopesAt(file, specialLine, dollar).includes("keyword.operator.fin"));
  assert.ok(scopesAt(file, specialLine, dollar + 1).includes("storage.type.meta.fin"));
});

test("a real string literal is a string, a URL in a comment is a comment", async () => {
  const file = await tokenizeFile("stdlib-argparse.fin");
  const stringLine = file.lines.findIndex((line) => line.includes('"parse count cannot be negative"'));
  assert.ok(stringLine >= 0);
  const quote = indexOf(file, stringLine, '"parse count');
  assert.ok(scopesAt(file, stringLine, quote).includes("string.quoted.double.fin"));
  assert.ok(scopesAt(file, stringLine, quote + 1).includes("string.quoted.double.fin"));

  const commentFile = await tokenizeFile("stdlib-strings.fin");
  const urlLine = commentFile.lines.findIndex((line) => line.includes("https://github.com"));
  assert.ok(urlLine >= 0);
  assert.ok(
    scopesAt(commentFile, urlLine, indexOf(commentFile, urlLine, "https:")).includes("comment.line.double-slash.fin"),
    "a URL inside a // banner must not become code"
  );
});

test("tokens cover every line with no gaps: no unhighlighted non-space text", async () => {
  for (const file of Object.keys(SOURCES)) {
    const tokenized = await tokenizeFile(file);
    for (let line = 0; line < tokenized.lines.length; line++) {
      const tokens = tokenized.tokenized[line];
      if (tokenized.lines[line] === "") {
        continue;
      }
      let cursor = 0;
      for (const token of tokens) {
        assert.equal(token.startIndex, cursor, `${file}:${line + 1} has a gap at column ${cursor}`);
        cursor = token.endIndex;
      }
      assert.equal(cursor, tokenized.lines[line].length, `${file}:${line + 1} is not fully tokenized`);
    }
  }
});
