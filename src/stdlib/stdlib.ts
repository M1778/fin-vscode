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

import * as fs from "fs/promises";
import * as path from "path";
import { derivedStdlibPath } from "../config";
import { showWarning } from "../output";
import { DeclarationIndex, indexDeclarations } from "./index-builder";
import { FinDeclaration, moduleHeader, parseFinSource } from "./model";

export { DeclarationIndex };
export { moduleHeader };

/** The module text block above `namespace`, reused as a hover for a module name. */
export interface ModuleSummary {
  name: string;
  file: string;
  /** The `//` block before `namespace`, comment markers stripped. */
  header: string;
  declarations: number;
}

export interface StdlibCatalog {
  /** Directory this catalog was read from, or the path that was tried. */
  root: string;
  modules: ModuleSummary[];
  index: DeclarationIndex;
  /** Why the directory could not be read, when it could not. */
  problem?: string;
}

/**
 * Read `lib/std/*.fin` once and build the declaration index from the real files.
 * Nothing here is a hand-written API list: a module the library adds shows up in
 * hover and completion with no change to this extension.
 */
export async function loadStdlib(stdlibPath: string, compilerPath: string): Promise<StdlibCatalog> {
  const root = stdlibPath.trim() !== "" ? stdlibPath : derivedStdlibPath(compilerPath);
  const index = indexDeclarations();
  const modules: ModuleSummary[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (error) {
    return {
      root,
      modules,
      index,
      problem: `Fin: standard library not found at ${root} (${describeError(error)}). ` +
        `Set "fin.stdlibPath" to the directory holding the *.fin library files. Hospitality: hover and ` +
        `completion keep working for the file itself, with no library entries.`,
    };
  }

  const files = entries.filter((entry) => entry.endsWith(".fin")).sort();
  for (const file of files) {
    const absolute = path.join(root, file);
    let text: string;
    try {
      text = await fs.readFile(absolute, "utf8");
    } catch {
      continue;
    }
    const moduleName = file.replace(/\.fin$/, "");
    const declarations = parseFinSource(text, moduleName);
    for (const declaration of declarations) {
      index.add(declaration, absolute);
    }
    modules.push({
      name: moduleName,
      file: absolute,
      header: moduleHeader(text),
      declarations: declarations.filter((entry) => entry.exported).length,
    });
  }
  return { root, modules, index };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ? `${code}` : error.message;
  }
  return String(error);
}

/** Warn once when the library directory is missing; the caller decides when. */
export function reportMissingStdlib(catalog: StdlibCatalog): void {
  if (catalog.problem) {
    showWarning(catalog.problem);
  }
}

/** Hover markdown for a declaration: signature, then the real comment block. */
export function renderHover(declaration: FinDeclaration, relativeTo?: string): string {
  const parts: string[] = [];
  const kindLabel = declaration.kind === "function" ? "fun" : declaration.kind;
  parts.push("```fin\n" + declaration.signature + "\n```");
  const origin = relativeTo
    ? `${declaration.module}::${declaration.namespace || "std"} — ${relativeTo}`
    : `${declaration.module}::${declaration.namespace || "std"}`;
  parts.push(`*${kindLabel}* · \`${origin}\``);
  if (declaration.doc.trim() !== "") {
    parts.push("---");
    parts.push(declaration.doc);
  }
  return parts.join("\n\n");
}
