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

// The conversion under test is TypeScript; compile first with `npm run compile`.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { parseDiagnosticsJsonl, toZeroBasedRange, byteColumnToUtf16 } = require("../out/diagnostics/parse.js");
const { parseCompilerOutput } = require("../out/exec.js");

const FIXTURES = path.join(__dirname, "fixtures", "captured");

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

function lineProviderFrom(file) {
  const lines = fs.readFileSync(path.join(FIXTURES, file), "utf8").split(/\r?\n/);
  return (line1) => (line1 >= 1 && line1 <= lines.length ? lines[line1 - 1] : undefined);
}

test("parses every real JSONL line: three diagnostics then the summary", () => {
  const report = parseDiagnosticsJsonl(readFixture("ascii.jsonl"));
  assert.equal(report.unparsed.length, 0);
  assert.ok(report.summary);
  assert.equal(report.summary.errors, 2);
  assert.equal(report.summary.warnings, 1);
  assert.equal(report.summary.exitCode, 1);
  assert.equal(report.summary.status, "failed");
  assert.equal(report.diagnostics.length, 3);
});

test("a summary-only stream is a real report, not an empty one", () => {
  const report = parseDiagnosticsJsonl(readFixture("clean.jsonl"));
  assert.equal(report.diagnostics.length, 0);
  assert.ok(report.summary, "the summary line must survive");
  assert.equal(report.summary.exitCode, 0);
  assert.equal(report.summary.status, "ok");
});

test("1-based line/column convert to a 0-based range: E0201 on ascii.fin", () => {
  const report = parseDiagnosticsJsonl(readFixture("ascii.jsonl"));
  const error = report.diagnostics.find((entry) => entry.code === "E0201");
  assert.ok(error);
  // compiler says line 2, column 19..23 (endColumn exclusive) for `"hi"`.
  const range = toZeroBasedRange(error, lineProviderFrom("ascii.fin"));
  assert.deepEqual(range, { startLine: 1, startCharacter: 18, endLine: 1, endCharacter: 22 });
  const text = fs.readFileSync(path.join(FIXTURES, "ascii.fin"), "utf8").split(/\r?\n/)[1];
  assert.equal(text.slice(range.startCharacter, range.endCharacter), '"hi"');
});

test("CRLF source yields the same range as LF: byte and UTF-16 offsets agree", () => {
  const report = parseDiagnosticsJsonl(readFixture("crlf.jsonl"));
  const error = report.diagnostics.find((entry) => entry.code === "E0201");
  assert.ok(error);
  const range = toZeroBasedRange(error, lineProviderFrom("crlf.fin"));
  assert.deepEqual(range, { startLine: 1, startCharacter: 18, endLine: 1, endCharacter: 22 });
  // The \r lives at the end of the line, so a mid-line range is unaffected by it.
  const line = fs.readFileSync(path.join(FIXTURES, "crlf.fin"), "utf8").split(/\r?\n/)[1];
  assert.equal(line.slice(range.startCharacter, range.endCharacter), '"hi"');
});

test("UTF-8 columns are bytes: `éé` shifts the reported column by two", () => {
  const report = parseDiagnosticsJsonl(readFixture("utf8.jsonl"));
  const error = report.diagnostics.find((entry) => entry.code === "E0201");
  assert.ok(error);
  assert.equal(error.column, 44, "compiler counted UTF-8 bytes");
  const range = toZeroBasedRange(error, lineProviderFrom("utf8.fin"));
  const line = fs.readFileSync(path.join(FIXTURES, "utf8.fin"), "utf8").split(/\r?\n/)[1];
  assert.equal(line.slice(range.startCharacter, range.endCharacter), '"hi"');
  assert.equal(range.startCharacter, 41, "UTF-16 offset, two less than the byte column");
});

test("a zero-length point diagnostic still produces a usable empty range", () => {
  const report = parseDiagnosticsJsonl(readFixture("syntax.jsonl"));
  const error = report.diagnostics[0];
  assert.equal(error.code, "E0902");
  assert.equal(error.column, error.endColumn);
  const range = toZeroBasedRange(error, lineProviderFrom("syntax.fin"));
  assert.equal(range.startLine, 1);
  assert.equal(range.startCharacter, range.endCharacter);
});

test("a diagnostic with no file and line 0 becomes the top of the document", () => {
  const report = parseDiagnosticsJsonl(readFixture("module.jsonl"));
  const noFile = report.diagnostics.find((entry) => entry.file === null);
  assert.ok(noFile);
  const range = toZeroBasedRange(noFile, () => undefined);
  assert.deepEqual(range, { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 });
});

test("an inverted range is clamped instead of dropped", () => {
  const diagnostic = {
    kind: "diagnostic",
    severity: "error",
    code: "E0000",
    message: "bad range",
    file: "x.fin",
    line: 2,
    column: 10,
    endLine: 2,
    endColumn: 4,
    help: null,
    attribution: null,
  };
  const range = toZeroBasedRange(diagnostic, () => "0123456789abcdef");
  assert.equal(range.startCharacter, 9);
  assert.equal(range.endCharacter, 9);
});

test("byteColumnToUtf16 handles astral characters (a 4-byte code point, 2 UTF-16 units)", () => {
  const line = 'let s <string> = "😀"; let x <int>';
  const byteOfX = Buffer.byteLength(line.slice(0, line.indexOf("x <int>")), "utf8");
  const utf16 = byteColumnToUtf16(line, byteOfX + 1);
  assert.equal(line.slice(utf16, utf16 + 5), "x <in");
});

test("byteColumnToUtf16 clamps a column past the end of the line", () => {
  assert.equal(byteColumnToUtf16("abc", 500), 3);
  assert.equal(byteColumnToUtf16("abc", 2), 1);
  assert.equal(byteColumnToUtf16("abc", 0), 0);
});

test("every captured fixture parses with no unparsed lines", () => {
  for (const file of fs.readdirSync(FIXTURES).filter((name) => name.endsWith(".jsonl"))) {
    const report = parseDiagnosticsJsonl(readFixture(file));
    assert.equal(report.unparsed.length, 0, `${file} had unparsed lines`);
    assert.ok(report.summary, `${file} had no summary`);
  }
});

test("a non-JSON line is kept, not fatal", () => {
  const report = parseDiagnosticsJsonl(
    'not json\n{"kind":"summary","errors":0,"warnings":0,"exitCode":0,"status":"ok"}\n'
  );
  assert.equal(report.unparsed.length, 1);
  assert.equal(report.summary.exitCode, 0);
});

test("an unknown severity falls back to error, never to a silent hint", () => {
  const report = parseDiagnosticsJsonl(
    '{"kind":"diagnostic","severity":"catastrophe","code":null,"message":"m","file":"f.fin","line":1,"column":1,"endLine":1,"endColumn":2,"help":null,"attribution":null}'
  );
  assert.equal(report.diagnostics[0].severity, "error");
});

test("finc 1.0.1 writes the report to stderr; the stderr lane is read", () => {
  // Captured from the real binary: stdout is reserved, the JSONL is on stderr.
  const result = {
    code: 1,
    signal: null,
    stdout: "",
    stderr: readFixture("ascii.jsonl"),
    failedToStart: false,
    cancelled: false,
  };
  const report = parseCompilerOutput(result);
  assert.ok(report.summary, "the summary on stderr was found");
  assert.equal(report.summary.errors, 2);
  assert.equal(report.diagnostics.length, 3);
});

test("a report on stdout is accepted too, so a contract-3 variant keeps working", () => {
  const result = {
    code: 1,
    signal: null,
    stdout: readFixture("ascii.jsonl"),
    stderr: "some build chatter\n",
    failedToStart: false,
    cancelled: false,
  };
  const report = parseCompilerOutput(result);
  assert.ok(report.summary);
  assert.equal(report.diagnostics.length, 3);
  assert.equal(report.unparsed.length, 0, "chatter on the other stream is not a protocol error");
});

test("neither stream carrying a summary is reported as no report, not as clean", () => {
  const result = {
    code: 1,
    signal: null,
    stdout: "",
    stderr: "finc: internal explosion\n",
    failedToStart: false,
    cancelled: false,
  };
  const report = parseCompilerOutput(result);
  assert.equal(report.summary, null, "there is no summary, and the caller must say so");
});
