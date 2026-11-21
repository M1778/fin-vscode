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

import * as vscode from "vscode";
import { readSettings } from "./config";
import { run } from "./exec";
import { traceVerbose } from "./output";
import { output, showError } from "./output";

const EXPLAIN_TIMEOUT_MS = 15_000;

/**
 * "Fin: Explain diagnostic code". The code comes from the selection, the word under
 * the cursor, a `command:` URI argument (the Problems panel's code link), or a
 * prompt. `finc --explain <code>` is the only source of the explanation: the
 * extension does not carry a second copy of the table that could drift.
 */
export async function explainDiagnosticCode(argument?: unknown): Promise<void> {
  const settings = readSettings(vscode.window.activeTextEditor?.document.uri);
  const code = await resolveCode(argument);
  if (!code) {
    return;
  }
  if (code.toLowerCase() === "list") {
    await showCodeInventory(settings.compilerPath);
    return;
  }

  const child = run(settings.compilerPath, ["--explain", code], { timeoutMs: EXPLAIN_TIMEOUT_MS });
  const result = await child.done;
  traceVerbose(settings.trace, `finc --explain ${code} stdout:\n${result.stdout}`);
  if (result.failedToStart) {
    showError(
      `Fin compiler not found: could not run "${settings.compilerPath}". ` +
        `Set "fin.compilerPath" to your finc binary.`
    );
    return;
  }

  const document = await vscode.workspace.openTextDocument({
    content: explainDocumentText(code, result.stdout, result.stderr, result.code),
    language: "plaintext",
  });
  await vscode.window.showTextDocument(document, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}

export async function resolveCode(argument?: unknown): Promise<string | undefined> {
  const fromArgument = decodeArgument(argument);
  if (fromArgument) {
    return fromArgument;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selected = editor.document.getText(editor.selection).trim();
    const selectedCode = /\b([A-Za-z]{1,6}\d{3,5})\b/.exec(selected);
    if (selectedCode) {
      return selectedCode[1];
    }
    const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active, /[A-Za-z]{1,6}\d{3,5}/);
    if (wordRange) {
      return editor.document.getText(wordRange);
    }
  }
  return vscode.window.showInputBox({
    title: "Fin: Explain diagnostic code",
    prompt: "A diagnostic code such as E0301, or `list` for every code this compiler raises",
    placeHolder: "E0301",
    value: "",
  });
}

function decodeArgument(argument: unknown): string | undefined {
  if (typeof argument === "string" && argument.trim() !== "") {
    return argument.trim();
  }
  if (argument && typeof argument === "object") {
    const asRecord = argument as Record<string, unknown>;
    if (typeof asRecord.value === "string" && asRecord.value.trim() !== "") {
      return asRecord.value.trim();
    }
  }
  return undefined;
}

function explainDocumentText(code: string, stdout: string, stderr: string, exitCode: number | null): string {
  if (stdout.trim() !== "") {
    return stdout;
  }
  return (
    `finc --explain ${code} produced no explanation (exit ${exitCode}).\n\n` +
    (stderr.trim() || "stderr was empty.") +
    "\n\nThe code may belong to a different compiler version; run " +
    "`finc --explain list` to see the codes this compiler raises."
  );
}

/** The full inventory, so a user can browse the 34 codes without a terminal. */
export async function showCodeInventory(compilerPath: string): Promise<void> {
  const settings = readSettings();
  const child = run(compilerPath, ["--explain", "list"], { timeoutMs: EXPLAIN_TIMEOUT_MS });
  const result = await child.done;
  if (result.failedToStart) {
    showError(
      `Fin compiler not found: could not run "${compilerPath}". Set "fin.compilerPath" to your finc binary.`
    );
    return;
  }
  traceVerbose(settings.trace, `finc --explain list stdout:\n${result.stdout}`);
  if (result.code !== 0) {
    showError(`Fin: finc --explain list exited ${result.code}: ${result.stderr.trim()}`);
    return;
  }
  const document = await vscode.workspace.openTextDocument({
    content: result.stdout,
    language: "plaintext",
  });
  await vscode.window.showTextDocument(document, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}

/** "Fin: Show compiler output" -- reveal the channel even before the first check. */
export function showCompilerOutput(): void {
  output().show(true);
}
