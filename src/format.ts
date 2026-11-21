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
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { FinSettings, missingFormatterMessage, readSettings } from "./config";
import { explainSpawnError, run } from "./exec";
import { showError, showInfo, traceInfo, traceVerbose } from "./output";

const FORMAT_TIMEOUT_MS = 15_000;

/**
 * Formatting through `finfmt`, the shipped formatter.
 *
 * `finfmt` rewrites a file in place and has no stdin mode, so the document text is
 * written to a scratch directory, formatted there, and read back. The document's
 * basename is kept so a diff the formatter prints is recognisable.
 *
 * Idempotence: formatting a formatted file is a no-op by the formatter's own
 * contract (`finfmt --check` exits 0). Each run also formats its own output once
 * more and prefers nothing when the second pass disagrees, so this extension never
 * produces a file that keeps moving.
 */
export class FinFormattingProvider implements vscode.DocumentFormattingEditProvider, vscode.Disposable {
  private readonly missingNotified = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];

  register(): vscode.Disposable[] {
    this.disposables.push(
      vscode.languages.registerDocumentFormattingEditProvider({ language: "fin" }, this),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.languageId !== "fin") {
          return;
        }
        const settings = readSettings(document.uri);
        if (settings.formatOnSave) {
          void vscode.commands.executeCommand("editor.action.formatDocument", document.uri);
        }
      })
    );
    return this.disposables;
  }

  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    const settings = readSettings(document.uri);
    if (document.uri.scheme !== "file") {
      return [];
    }
    const formatted = await formatText(document.getText(), document.uri, settings, token, {
      onMissing: (detail) => this.notifyMissing(settings.formatterPath, detail),
    });
    if (formatted === undefined || formatted === document.getText()) {
      return [];
    }
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    return [vscode.TextEdit.replace(fullRange, formatted)];
  }

  private notifyMissing(formatterPath: string, detail?: string): void {
    if (this.missingNotified.has(formatterPath)) {
      return;
    }
    this.missingNotified.add(formatterPath);
    const message = missingFormatterMessage(formatterPath, detail);
    showError(message);
    void vscode.window
      .showWarningMessage(message, "Open settings")
      .then((choice) => {
        if (choice === "Open settings") {
          void vscode.commands.executeCommand("workbench.action.openSettings", "fin.formatterPath");
        }
      });
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

export interface FormatCallbacks {
  /** Called once, with the OS's own reason when there is one worth adding. */
  onMissing: (detail?: string) => void;
}

/**
 * Run `finfmt` on `text` and return the formatted text, or undefined when the
 * formatter failed or is not installed. Never throws: formatting is optional and a
 * formatter failure must not lose the user's buffer.
 */
export async function formatText(
  text: string,
  uri: vscode.Uri,
  settings: FinSettings,
  token: vscode.CancellationToken,
  callbacks: FormatCallbacks
): Promise<string | undefined> {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "fin-fmt-"));
  const target = path.join(scratch, path.basename(uri.fsPath));
  try {
    await fs.writeFile(target, text, "utf8");
    const first = await runFormatter(settings.formatterPath, target, settings);
    if (first.status === "missing") {
      callbacks.onMissing(first.detail);
      return undefined;
    }
    if (!first.status) {
      return undefined;
    }
    if (token.isCancellationRequested) {
      return undefined;
    }
    const once = await fs.readFile(target, "utf8");
    if (once === text) {
      return text;
    }
    // Second pass: prove the formatter's own output is stable before handing the
    // editor an edit it would keep re-applying on every save.
    const second = await runFormatter(settings.formatterPath, target, settings);
    if (second.status === "missing" || !second.status) {
      return once;
    }
    const twice = await fs.readFile(target, "utf8");
    if (twice !== once) {
      traceInfo(settings.trace, "finfmt: formatter is not idempotent on this file; keeping the first result");
      traceVerbose(settings.trace, `first:\n${once}\nsecond:\n${twice}`);
    }
    return once;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showError(`Fin: formatting failed: ${message}`);
    return undefined;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * "" for failure, "missing" when the binary is absent, or a short ok marker.
 * The spawn reason is returned alongside so the caller's message can name it.
 */
async function runFormatter(
  formatterPath: string,
  target: string,
  settings: FinSettings
): Promise<{ status: string; detail?: string }> {
  traceInfo(settings.trace, `finfmt: ${formatterPath} ${target}`);
  const child = run(formatterPath, [target], { timeoutMs: FORMAT_TIMEOUT_MS });
  const result = await child.done;
  if (result.failedToStart) {
    // The reason travels with the status so the user sees "point at the .exe, not
    // the .cmd" rather than "EINVAL".
    return { status: "missing", detail: explainSpawnError(formatterPath, result) };
  }
  traceVerbose(settings.trace, `finfmt stdout: ${result.stdout.trim()}`);
  if (result.code !== 0) {
    showError(
      `Fin: finfmt failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim() || "no output"}`
    );
    return { status: "" };
  }
  return { status: "ok" };
}

/** Format the active document on demand, so the command's failure is visible. */
export async function formatActiveDocument(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "fin") {
    void vscode.window.showInformationMessage("Fin: no Fin file is active.");
    return;
  }
  const settings = readSettings(editor.document.uri);
  const formatted = await formatText(
    editor.document.getText(),
    editor.document.uri,
    settings,
    new vscode.CancellationTokenSource().token,
    {
      onMissing: (detail) => {
        const message = missingFormatterMessage(settings.formatterPath, detail);
        showError(message);
        void vscode.window
          .showWarningMessage(message, "Open settings")
          .then((choice) => {
            if (choice === "Open settings") {
              void vscode.commands.executeCommand("workbench.action.openSettings", "fin.formatterPath");
            }
          });
      },
    }
  );
  if (formatted === undefined) {
    return;
  }
  if (formatted === editor.document.getText()) {
    showInfo("Fin: file is already formatted.");
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    editor.document.uri,
    new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)),
    formatted
  );
  await vscode.workspace.applyEdit(edit);
}
