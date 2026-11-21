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
 * A tiny model of a Fin source file: declarations at their real positions, each
 * carrying the `//` comment block written directly above it. Used for hover,
 * completion, outline and document symbols.
 *
 * This is a scanner, not a parser. It reads the shape the standard library
 * actually uses -- one declaration per line, a `//` block above it, fields
 * indented under `pub:` -- and declines to guess when a line does not match. The
 * alternative (a real parser) would need the whole grammar to answer "what does
 * this name mean", which is what the compiler is for.
 */

export type DeclKind =
  | "function"
  | "struct"
  | "enum"
  | "interface"
  | "type"
  | "const"
  | "macro"
  | "special"
  | "define"
  | "operator"
  | "namespace"
  | "field";

export interface FinParameter {
  name: string;
  type: string;
}

export interface FinDeclaration {
  kind: DeclKind;
  name: string;
  /** Full source line(s) of the declaration with the comment block removed. */
  signature: string;
  /** The `//` block directly above, comment markers stripped, blank lines kept. */
  doc: string;
  /** 0-based start line of the doc block, or the declaration when there is no doc. */
  startLine: number;
  /** 0-based line of the declaration itself. */
  line: number;
  /** 0-based column where the name starts on its line. */
  nameColumn: number;
  nameLength: number;
  parameters: FinParameter[];
  /** Return type as written, e.g. `int`, `[char]`, `string?` -- empty for structs. */
  returns: string;
  /** The module that declares it, e.g. `strings`, when this came from the stdlib. */
  module: string;
  /** Enclosing namespace when the file declares one (`std` everywhere in lib/std). */
  namespace: string;
  /** Struct fields, for a struct declaration. */
  fields: FinField[];
  /** True when the declaration is exported (`pub`). */
  exported: boolean;
}

export interface FinField {
  name: string;
  type: string;
  doc: string;
  line: number;
  nameColumn: number;
}

const DECL_KEYWORDS = new Set([
  "fun",
  "struct",
  "enum",
  "interface",
  "type",
  "const",
  "macro",
  "special",
  "define",
  "operator",
  "namespace",
]);

/** `fun? name(...)`, `pub fun name(...)`, `pub operator ==(...)`, `pub type X = ...`. */
const DECL_PATTERN =
  /^(\s*)(?:(pub|priv)\s+)?(?:(@)(macro|special|define)\s+|(fun)(\?)?\s+|(struct|enum|interface|class|type|const|namespace)\s+|(operator)\s+)/;

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const NAME_AFTER_KEYWORD = new RegExp(`^(${IDENT}|[^\\s(]+)`);

/**
 * Parse one Fin source file. Positions are for the text as given, so a document
 * with CRLF endings parses the same; callers convert to editor positions.
 */
export function parseFinSource(text: string, moduleName: string): FinDeclaration[] {
  const lines = text.split(/\r?\n/);
  const declarations: FinDeclaration[] = [];
  let namespaceName = "";
  // Index of the line that ended the previous comment block, so a doc block is
  // consumed exactly once even when two declarations sit close together.
  const docCache = collectDocBlocks(lines);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = DECL_PATTERN.exec(line);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const visibility = match[2] as string | undefined;
    const keyword = (match[5] ?? match[7] ?? match[10] ?? match[4]) as string | undefined;
    if (!keyword || !DECL_KEYWORDS.has(keyword)) {
      continue;
    }
    const keywordEnd = match[0].length;
    const rest = line.slice(keywordEnd);
    const nameMatch = NAME_AFTER_KEYWORD.exec(rest);
    if (!nameMatch) {
      continue;
    }
    const name = nameMatch[1];
    const declaration = buildDeclaration({
      lines,
      lineIndex: index,
      keyword,
      name,
      nameColumn: keywordEnd + (rest.length - rest.trimStart().length),
      visibility,
      docCache,
      moduleName,
      namespaceName,
      indent,
    });
    if (declaration) {
      if (declaration.kind === "namespace") {
        namespaceName = declaration.name;
        declaration.namespace = declaration.name;
      }
      declarations.push(declaration);
      if (declaration.kind === "struct") {
        declaration.fields = parseFields(lines, index, docCache);
      }
    }
  }

  return declarations;
}

interface BuildArgs {
  lines: string[];
  lineIndex: number;
  keyword: string;
  name: string;
  nameColumn: number;
  visibility: string | undefined;
  docCache: Map<number, { doc: string; start: number }>;
  moduleName: string;
  namespaceName: string;
  indent: number;
}

const KIND_BY_KEYWORD: Record<string, DeclKind> = {
  fun: "function",
  struct: "struct",
  enum: "enum",
  interface: "interface",
  type: "type",
  const: "const",
  macro: "macro",
  special: "special",
  define: "define",
  operator: "operator",
  namespace: "namespace",
};

function buildDeclaration(args: BuildArgs): FinDeclaration | null {
  const { lines, lineIndex, keyword, name, nameColumn, visibility, docCache } = args;
  const kind = KIND_BY_KEYWORD[keyword];
  if (!kind) {
    return null;
  }
  const firstLine = lines[lineIndex];
  // Gather the signature: from the declaration line until the parameter list and
  // result close. A declaration can wrap across lines; stop at the first line that
  // balances the brackets we opened, or at the `{`/`;` when there were none.
  const signatureLines = [firstLine.trim()];
  let depth = balance(firstLine);
  let cursor = lineIndex;
  while (depth > 0 && cursor + 1 < lines.length && cursor - lineIndex < 12) {
    cursor += 1;
    const next = lines[cursor].trim();
    signatureLines.push(next);
    depth += balance(next);
  }
  const signature = signatureLines.join(" ");
  const open = signature.indexOf("(");
  const close = findMatching(signature, "(", ")");
  const parameters = open >= 0 && close > open ? parseParameters(signature.slice(open + 1, close)) : [];
  const returns = open >= 0 && close > open ? parseResultType(signature.slice(close + 1)) : "";
  return {
    kind,
    name,
    signature,
    doc: docBlockAt(docCache, docAnchor(lines, lineIndex)),
    startLine: docStart(docCache, docAnchor(lines, lineIndex)),
    line: lineIndex,
    nameColumn,
    nameLength: name.length,
    parameters,
    returns,
    module: args.moduleName,
    namespace: args.namespaceName,
    fields: [],
    exported: visibility !== "priv",
  };
}

function balance(line: string): number {
  let depth = 0;
  for (const char of line) {
    if (char === "(" || char === "[" || char === "<") {
      depth++;
    } else if (char === ")" || char === "]" || char === ">") {
      depth--;
    }
  }
  return Math.max(depth, 0);
}

function findMatching(line: string, openChar: string, closeChar: string): number {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === openChar) {
      depth++;
    } else if (line[i] === closeChar) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** `(a: int, b: string)` -> parameters. A trailing `...` is kept as a variadic marker. */
export function parseParameters(source: string): FinParameter[] {
  const parts = splitTopLevel(source, ",");
  const parameters: FinParameter[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === "" || trimmed === "...") {
      continue;
    }
    const colon = trimmed.indexOf(":");
    if (colon < 0) {
      // `@define printf(fmt: <string>, ...)` can carry angle-bracketed parameters;
      // anything else without a colon is not a parameter this model understands.
      continue;
    }
    const name = trimmed.slice(0, colon).trim().replace(/^const\s+/, "");
    const type = trimmed.slice(colon + 1).trim().replace(/^<(.+)>$/, "$1");
    if (name !== "") {
      parameters.push({ name, type });
    }
  }
  return parameters;
}

/** Everything between the parameter list's `)` and the body: `<T>` or `{`. */
export function parseResultType(afterParams: string): string {
  const text = afterParams.trim();
  if (!text.startsWith("<")) {
    return "";
  }
  const close = findMatching(text, "<", ">");
  return close > 0 ? text.slice(1, close).trim() : "";
}

function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of source) {
    if (char === "(" || char === "[" || char === "{" || char === "<") {
      depth++;
    } else if (char === ")" || char === "]" || char === "}" || char === ">") {
      depth--;
    }
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Fields of a struct: `pub:` / `priv:` labels then `name <type> = default,` lines
 * until the matching `}`. Only `pub:` fields are collected, because those are the
 * ones another file can name.
 */
function parseFields(
  lines: string[],
  structLine: number,
  docCache: Map<number, { doc: string; start: number }>
): FinField[] {
  const fields: FinField[] = [];
  let visibility: "pub" | "priv" = "priv";
  let depth = 0;
  const fieldPattern = new RegExp(`^\\s*(${IDENT})\\s*<`);
  for (let index = structLine; index < lines.length; index++) {
    const line = lines[index];
    for (const char of line) {
      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
      }
    }
    if (index === structLine) {
      continue;
    }
    if (depth <= 0) {
      break;
    }
    const label = /^\s*(pub|priv)\s*:\s*$/.exec(line);
    if (label) {
      visibility = label[1] as "pub" | "priv";
      continue;
    }
    const field = fieldPattern.exec(line);
    if (!field || /^\s*(fun|pub\s+fun|priv\s+fun|operator|pub\s+operator|priv\s+operator)\b/.test(line)) {
      continue;
    }
    if (visibility !== "pub") {
      continue;
    }
    const typeStart = line.indexOf("<", line.indexOf(field[1]) + field[1].length);
    const typeEnd = findMatching(line.slice(typeStart), "<", ">");
    const type = typeEnd > 0 ? line.slice(typeStart + 1, typeStart + typeEnd).trim() : "";
    fields.push({
      name: field[1],
      type,
      doc: docBlockAt(docCache, index),
      line: index,
      nameColumn: line.indexOf(field[1], line.search(/\S/)),
    });
  }
  return fields;
}

/**
 * Map declaration line -> its `//` block. Only contiguous `//` lines directly above
 * a non-comment line count, which is the convention every lib/std declaration uses.
 */
function collectDocBlocks(lines: string[]): Map<number, { doc: string; start: number }> {
  const blocks = new Map<number, { doc: string; start: number }>();
  let run: string[] = [];
  let runStart = 0;
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("//")) {
      if (run.length === 0) {
        runStart = index;
      }
      run.push(stripCommentMarker(trimmed));
      continue;
    }
    if (trimmed === "") {
      // A blank line ends a doc block: a declaration separated from a comment by a
      // blank line does not own that comment.
      run = [];
      continue;
    }
    if (run.length > 0) {
      blocks.set(index, { doc: trimBlankEdges(run).join("\n"), start: runStart });
      run = [];
    }
  }
  return blocks;
}

function stripCommentMarker(trimmed: string): string {
  return trimmed.replace(/^\/\/+/, "").replace(/^ /, "").trimEnd();
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") {
    start++;
  }
  while (end > start && lines[end - 1].trim() === "") {
    end--;
  }
  return lines.slice(start, end);
}

/**
 * The line whose doc block a declaration owns. `#[export]` / `#[llvm_name]` sit
 * between the comment and the declaration in every lib/std file, so the walk goes
 * back over attribute lines first.
 */
function docAnchor(lines: string[], lineIndex: number): number {
  let anchor = lineIndex;
  while (anchor > 0 && /^\s*#\[/.test(lines[anchor - 1])) {
    anchor -= 1;
  }
  return anchor;
}

function docBlockAt(cache: Map<number, { doc: string; start: number }>, lineIndex: number): string {
  return cache.get(lineIndex)?.doc ?? "";
}

function docStart(cache: Map<number, { doc: string; start: number }>, lineIndex: number): number {
  return cache.get(lineIndex)?.start ?? lineIndex;
}

/** Where a name at `column` on `line` lives, if any declaration starts there. */
export function declarationAtPosition(
  declarations: readonly FinDeclaration[],
  line: number,
  column: number
): FinDeclaration | undefined {
  for (const declaration of declarations) {
    if (declaration.line !== line) {
      continue;
    }
    if (column >= declaration.nameColumn && column <= declaration.nameColumn + declaration.nameLength) {
      return declaration;
    }
  }
  return undefined;
}

/** Declarations whose name starts with `prefix`, exported ones only. */
export function matchingDeclarations(
  declarations: readonly FinDeclaration[],
  prefix: string,
  limit = 200
): FinDeclaration[] {
  const lowered = prefix.toLowerCase();
  const matches: FinDeclaration[] = [];
  for (const declaration of declarations) {
    if (!declaration.exported) {
      continue;
    }
    if (lowered === "" || declaration.name.toLowerCase().startsWith(lowered)) {
      matches.push(declaration);
      if (matches.length >= limit) {
        break;
      }
    }
  }
  return matches;
}

/**
 * The prose block before `namespace`. lib/std files open with the shared brand
 * banner; the module's own comment comes after the last banner line, and that is
 * what a hover should show -- including the parts the module says it does *not* do.
 */
export function moduleHeader(text: string): string {
  const lines = text.split(/\r?\n/);
  let namespaceLine = lines.findIndex((line) => /^\s*namespace\s/.test(line));
  if (namespaceLine < 0) {
    namespaceLine = lines.length;
  }
  // The last `// =====` banner before the namespace closes the shared brand block.
  let afterBanner = 0;
  for (let index = 0; index < namespaceLine; index++) {
    if (/^\s*\/\/\s*=+\s*$/.test(lines[index])) {
      afterBanner = index + 1;
    }
  }
  const block: string[] = [];
  for (let index = afterBanner; index < namespaceLine; index++) {
    const trimmed = lines[index].trim();
    if (trimmed === "") {
      if (block.length > 0) {
        block.push("");
      }
      continue;
    }
    if (!trimmed.startsWith("//")) {
      break;
    }
    block.push(trimmed.replace(/^\/\/+/, "").replace(/^ /, "").trimEnd());
  }
  return trimBlankEdges(block).join("\n");
}
