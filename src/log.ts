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

export type TraceLevel = "off" | "messages" | "verbose";

const TRACE_LEVELS: readonly TraceLevel[] = ["off", "messages", "verbose"];

export function normalizeTraceLevel(value: unknown): TraceLevel {
  return typeof value === "string" && (TRACE_LEVELS as readonly string[]).includes(value)
    ? (value as TraceLevel)
    : "off";
}

/**
 * Keep the tail of a long command line for a log. The head names the tool; the
 * tail carries the file. Nothing here is secret -- Fin has no credential flag --
 * but a log line should not be the whole 40-path argument list.
 */
export function redactCommandForLog(parts: readonly string[]): string {
  const rendered = parts.map(quoteForLog).join(" ");
  const MAX = 400;
  return rendered.length <= MAX ? rendered : rendered.slice(0, 200) + " … " + rendered.slice(-180);
}

/** Quote an argument for a log line only; this string is never executed. */
export function quoteForLog(part: string): string {
  return /^[A-Za-z0-9_@.\/:=<>,+-]+$/.test(part) ? part : JSON.stringify(part);
}
