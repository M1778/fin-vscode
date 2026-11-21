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

import * as path from "path";
import * as vscode from "vscode";
import { TraceLevel, normalizeTraceLevel } from "./log";

export interface FinSettings {
  compilerPath: string;
  formatterPath: string;
  linfPath: string;
  includePaths: string[];
  stdlibPath: string;
  diagnosticsEnabled: boolean;
  formatOnSave: boolean;
  linfEnabled: boolean;
  trace: TraceLevel;
  /** Directory relative paths resolve against: the first workspace folder, else the file's own folder. */
  baseDir: string | undefined;
}

export const FINC_RELEASES_URL = "https://github.com/M1778/Fin/releases";
export const FORMATTER_NAME = "finfmt";

/** The executable name `finc` grows on Windows. */
export function withPlatformExtension(name: string): string {
  if (process.platform !== "win32") {
    return name;
  }
  return /\.(exe|cmd|bat)$/i.test(name) ? name : `${name}.exe`;
}

/**
 * Resolve a configured command. A bare name (no separator) stays bare so the OS
 * searches PATH; a path with a separator is made absolute against the base
 * directory, which is what a workspace-relative setting means to a user.
 */
export function resolveCommand(configured: string, baseDir: string | undefined): string {
  const trimmed = configured.trim();
  if (trimmed === "") {
    return trimmed;
  }
  const looksLikePath = trimmed.includes("/") || trimmed.includes("\\") || path.isAbsolute(trimmed);
  if (!looksLikePath) {
    return trimmed;
  }
  const expanded = trimmed.startsWith("~/") && process.env.HOME
    ? path.join(process.env.HOME, trimmed.slice(2))
    : trimmed;
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return baseDir ? path.resolve(baseDir, expanded) : path.resolve(expanded);
}

export function readSettings(scope?: vscode.Uri): FinSettings {
  const config = vscode.workspace.getConfiguration("fin", scope ?? null);
  const baseDir = workspaceBaseDir(scope);
  return {
    compilerPath: resolveCommand(config.get<string>("compilerPath", "finc"), baseDir),
    formatterPath: resolveCommand(config.get<string>("formatterPath", "finfmt"), baseDir),
    linfPath: resolveCommand(config.get<string>("lint.linfPath", "linf"), baseDir),
    includePaths: config
      .get<string[]>("includePaths", [])
      .filter((entry) => entry.trim() !== "")
      .map((entry) => resolveCommand(entry, baseDir)),
    stdlibPath: resolveCommand(config.get<string>("stdlibPath", ""), baseDir),
    diagnosticsEnabled: config.get<boolean>("diagnostics.enabled", true),
    formatOnSave: config.get<boolean>("format.onSave", false),
    linfEnabled: config.get<boolean>("lint.linfEnabled", false),
    trace: normalizeTraceLevel(config.get<string>("trace", "off")),
    baseDir,
  };
}

export function workspaceBaseDir(scope?: vscode.Uri): string | undefined {
  if (scope) {
    const folder = vscode.workspace.getWorkspaceFolder(scope);
    if (folder) {
      return folder.uri.fsPath;
    }
  }
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/**
 * Where `lib/std` lives next to the compiler: a normal Fin install keeps the
 * library beside the binary (`<prefix>/lib/std` next to `<prefix>/bin/finc`), and
 * the compiler's own lookup is `../lib/std` from its real path.
 */
export function derivedStdlibPath(compilerPath: string): string {
  return path.resolve(path.dirname(compilerPath), "..", "lib", "std");
}

/**
 * The install message shown when a tool cannot be started. One sentence, one
 * action. `detail` lets the caller add the OS's own reason (a `.cmd` wrapper, a
 * permission problem) without a second message.
 */
export function missingCompilerMessage(configured: string, detail?: string): string {
  return (
    `Fin compiler not found: could not run "${configured}". ` +
    (detail ? `${detail} ` : "") +
    `Set "fin.compilerPath" to your finc binary, or install Fin from ${FINC_RELEASES_URL}.`
  );
}

export function missingFormatterMessage(configured: string, detail?: string): string {
  return (
    `Fin formatter not found: could not run "${configured}". ` +
    (detail ? `${detail} ` : "") +
    `Set "fin.formatterPath" to your finfmt binary; a normal Fin install ships it beside finc.`
  );
}
