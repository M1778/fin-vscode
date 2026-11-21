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

/**
 * The `finc --diagnostics=json` contract, parsed without a dependency on `vscode`
 * so the conversion can be tested directly under plain Node.
 *
 * Contract 3 facts this file is built on, all measured against finc 1.0.1:
 *
 *   - one JSON object per line, each with `kind`; `diagnostic` objects then a
 *     `summary`;
 *   - `line` and `column` are 1-based;
 *   - `endColumn` is exclusive and also 1-based;
 *   - **columns count UTF-8 bytes, not UTF-16 code units.** A line holding `"éé"`
 *     before the reported token shifts the reported column by two. VS Code
 *     positions count UTF-16 code units, so a byte column must be converted
 *     against the line's real text or the squiggle lands on the wrong character.
 *   - `file` may be null and `line` 0 for a diagnostic about the invocation
 *     (a module that could not be found), which has no range to underline.
 */

export type Severity = "error" | "warning" | "info" | "hint";

export interface CompilerDiagnostic {
  kind: "diagnostic";
  severity: Severity;
  code: string | null;
  message: string;
  file: string | null;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  help: string | null;
  attribution: string | null;
}

export interface CompilerSummary {
  kind: "summary";
  errors: number;
  warnings: number;
  exitCode: number;
  status: string;
}

export interface ParsedReport {
  diagnostics: CompilerDiagnostic[];
  summary: CompilerSummary | null;
  /** Lines that were not JSON, kept so a protocol change is visible, not fatal. */
  unparsed: string[];
}

const SEVERITIES: ReadonlySet<string> = new Set(["error", "warning", "info", "hint"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Parse the whole JSONL stream. Never throws: a malformed line is reported, not fatal.
 *
 * Fin's contract says the report is written to stderr (stdout is reserved for
 * `--help`, `--version` and `--explain`), and finc 1.0.1 does exactly that. The
 * editor brief expected stdout, so both streams are accepted: whichever one holds
 * the summary wins, and a stream with no JSON at all is simply empty.
 */
export function parseDiagnosticsJsonl(text: string): ParsedReport {
  const diagnostics: CompilerDiagnostic[] = [];
  let summary: CompilerSummary | null = null;
  const unparsed: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      unparsed.push(rawLine);
      continue;
    }
    if (!isRecord(value)) {
      unparsed.push(rawLine);
      continue;
    }
    if (value.kind === "summary") {
      summary = {
        kind: "summary",
        errors: finiteNumber(value.errors, 0),
        warnings: finiteNumber(value.warnings, 0),
        exitCode: finiteNumber(value.exitCode, 0),
        status: typeof value.status === "string" ? value.status : "unknown",
      };
      continue;
    }
    if (value.kind !== "diagnostic") {
      unparsed.push(rawLine);
      continue;
    }
    const severity = typeof value.severity === "string" && SEVERITIES.has(value.severity)
      ? (value.severity as Severity)
      : "error";
    const line1 = finiteNumber(value.line, 0);
    const column1 = finiteNumber(value.column, 0);
    const endLine1 = finiteNumber(value.endLine, line1);
    const endColumn1 = finiteNumber(value.endColumn, column1);
    diagnostics.push({
      kind: "diagnostic",
      severity,
      code: nullableString(value.code),
      message: typeof value.message === "string" ? value.message : "",
      file: nullableString(value.file),
      line: line1,
      column: column1,
      endLine: endLine1,
      endColumn: endColumn1,
      help: nullableString(value.help),
      attribution: nullableString(value.attribution),
    });
  }

  return { diagnostics, summary, unparsed };
}

/**
 * Convert a 1-based UTF-8 byte column to a 0-based UTF-16 code-unit offset.
 *
 * `byteColumn` is 1-based and points at a byte boundary the compiler counted in
 * the UTF-8 encoding of `lineText`. A column past the end of the line clamps to
 * the line length; a column of 0 (a diagnostic with no range) maps to 0.
 */
export function byteColumnToUtf16(lineText: string, byteColumn: number): number {
  if (byteColumn <= 1) {
    return 0;
  }
  const targetByte = byteColumn - 1;
  let bytes = 0;
  let utf16 = 0;
  for (const char of lineText) {
    const width = utf8Width(char.codePointAt(0) ?? 0);
    if (bytes + width > targetByte) {
      break;
    }
    bytes += width;
    utf16 += char.length;
    if (bytes === targetByte) {
      break;
    }
  }
  return utf16;
}

function utf8Width(codePoint: number): number {
  if (codePoint < 0x80) {
    return 1;
  }
  if (codePoint < 0x800) {
    return 2;
  }
  if (codePoint < 0x10000) {
    return 3;
  }
  return 4;
}

export interface ZeroBasedRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/** A line accessor returning the text of a 1-based line, or undefined when absent. */
export type LineTextProvider = (line1: number) => string | undefined;

/**
 * Turn a compiler diagnostic into a 0-based editor range.
 *
 * `line`/`column` are 1-based, so the range start subtracts one from each;
 * `endColumn` is already exclusive, so after the byte conversion it is used as
 * the UTF-16 offset unchanged. A diagnostic with no file or line 0 has no range
 * and becomes an empty range at the top of the document.
 */
export function toZeroBasedRange(diagnostic: CompilerDiagnostic, lineText: LineTextProvider): ZeroBasedRange {
  if (diagnostic.line < 1) {
    return { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 };
  }
  const startLine = diagnostic.line - 1;
  const endLine = Math.max(diagnostic.endLine, 1) - 1;
  const startText = lineText(diagnostic.line) ?? "";
  const endText = lineText(Math.max(diagnostic.endLine, 1)) ?? startText;
  const startCharacter = byteColumnToUtf16(startText, diagnostic.column);
  const endCharacter = byteColumnToUtf16(endText, diagnostic.endColumn);
  // A range that ends before it starts would make the editor drop the squiggle;
  // a compiler that reported an inverted range is clamped rather than trusted.
  if (endLine < startLine || (endLine === startLine && endCharacter < startCharacter)) {
    return { startLine, startCharacter, endLine: startLine, endCharacter: startCharacter };
  }
  return { startLine, startCharacter, endLine, endCharacter };
}
