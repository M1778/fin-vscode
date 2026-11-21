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
import { FinSettings, missingCompilerMessage, readSettings } from "../config";
import { Cancellable, RunResult, describeRun, explainSpawnError, parseCompilerOutput, run } from "../exec";
import { TraceLevel } from "../log";
import { output, showError, showInfo, showWarning, traceInfo, traceVerbose } from "../output";
import { CompilerDiagnostic, ParsedReport, toZeroBasedRange } from "./parse";

export const DEBOUNCE_MS = 300;
const COMPILER_TIMEOUT_MS = 30_000;
const LINF_TIMEOUT_MS = 20_000;

export interface AnalysisOutcome {
  /** What to publish for the document that was checked. */
  diagnostics: vscode.Diagnostic[];
  /** Diagnostics the compiler attributed to another file, keyed by absolute path. */
  others: Map<string, vscode.Diagnostic[]>;
  summary: ParsedReport["summary"];
  /** Set when no report could be produced; the text is already user-facing. */
  failure?: string;
}

/** The argv array. Paths with spaces stay single arguments; there is no shell. */
export function buildCompilerArgs(tempFile: string, realFile: string, settings: FinSettings): string[] {
  const args = [tempFile, "--diagnostics=json", "--color=never"];
  const realDir = path.dirname(realFile);
  // The compiler sees a scratch copy, so the real directory has to be on the search
  // path for quoted sibling imports to resolve.
  args.push("-I", realDir);
  for (const includePath of settings.includePaths) {
    if (includePath !== realDir) {
      args.push("-I", includePath);
    }
  }
  return args;
}

/**
 * Owns the `finc --diagnostics=json` lifecycle: debounce, one child at a time per
 * document, cancel the previous run, publish only the newest answer, and make every
 * failure visible. A missing compiler never reads as "no problems".
 */
export class DiagnosticsController implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly otherCollection: vscode.DiagnosticCollection;
  private readonly status: vscode.StatusBarItem;
  private readonly debounces = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Map<string, Cancellable>();
  private readonly generations = new Map<string, number>();
  private readonly disposables: vscode.Disposable[] = [];
  private missingNotifiedFor = "";
  private disposed = false;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection("fin");
    this.otherCollection = vscode.languages.createDiagnosticCollection("fin-other");
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.status.name = "Fin";
    this.status.command = "fin.showCompilerOutput";
    this.disposables.push(this.collection, this.otherCollection, this.status);
  }

  register(): vscode.Disposable[] {
    const schedule = (document: vscode.TextDocument): void => {
      if (this.isFinDocument(document)) {
        this.scheduleCheck(document, false);
      }
    };
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument(schedule),
      vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
      vscode.workspace.onDidSaveTextDocument(schedule),
      vscode.workspace.onDidCloseTextDocument((document) => this.forget(document)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("fin")) {
          this.missingNotifiedFor = "";
          this.recheckVisible();
        }
      })
    );
    for (const document of vscode.workspace.textDocuments) {
      if (this.isFinDocument(document) && !document.isDirty) {
        this.scheduleCheck(document, false);
      }
    }
    return this.disposables;
  }

  private isFinDocument(document: vscode.TextDocument): boolean {
    return document.languageId === "fin" && document.uri.scheme === "file";
  }

  /** Re-check every open Fin file, for a settings or toolchain change. */
  recheckVisible(): void {
    for (const document of vscode.workspace.textDocuments) {
      if (this.isFinDocument(document)) {
        this.scheduleCheck(document, true);
      }
    }
  }

  scheduleCheck(document: vscode.TextDocument, immediate: boolean): void {
    const key = document.uri.toString();
    const pending = this.debounces.get(key);
    if (pending) {
      clearTimeout(pending);
    }
    const timer = setTimeout(() => {
      this.debounces.delete(key);
      void this.check(document);
    }, immediate ? 0 : DEBOUNCE_MS);
    this.debounces.set(key, timer);
  }

  private forget(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const timer = this.debounces.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounces.delete(key);
    }
    const child = this.inFlight.get(key);
    if (child) {
      void child.cancel();
      this.inFlight.delete(key);
    }
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.collection.delete(document.uri);
  }

  private async check(document: vscode.TextDocument): Promise<void> {
    if (this.disposed) {
      return;
    }
    const key = document.uri.toString();
    const settings = readSettings(document.uri);
    if (!settings.diagnosticsEnabled) {
      this.collection.delete(document.uri);
      this.otherCollection.clear();
      this.status.hide();
      return;
    }

    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);

    // Cancel the previous child before starting a new one: a second process per
    // keystroke is exactly what the debounce exists to prevent.
    const previous = this.inFlight.get(key);
    if (previous) {
      this.inFlight.delete(key);
      await previous.cancel();
    }
    if (this.disposed || this.generations.get(key) !== generation) {
      return;
    }

    const snapshot = document.getText();
    let scratch: string | undefined;
    let child: Cancellable | undefined;
    try {
      scratch = await fs.mkdtemp(path.join(os.tmpdir(), "fin-vscode-"));
      const tempFile = path.join(scratch, path.basename(document.uri.fsPath));
      await fs.writeFile(tempFile, snapshot, "utf8");
      const args = buildCompilerArgs(tempFile, document.uri.fsPath, settings);
      traceInfo(settings.trace, `finc: ${describeArgs(settings.compilerPath, args)}`);

      child = run(settings.compilerPath, args, {
        cwd: workingDirectory(document, settings),
        timeoutMs: COMPILER_TIMEOUT_MS,
      });
      this.inFlight.set(key, child);
      const result = await child.done;
      this.inFlight.delete(key);
      traceVerbose(settings.trace, `finc stdout:\n${result.stdout}`);
      traceVerbose(settings.trace, `finc stderr:\n${result.stderr}`);
      traceInfo(settings.trace, describeRun(settings.compilerPath, args, result));

      if (result.cancelled || this.generations.get(key) !== generation || this.disposed) {
        return;
      }
      const outcome = await this.interpret(result, tempFile, document, settings);
      if (this.generations.get(key) !== generation) {
        return;
      }
      this.publish(document, outcome);
    } catch (error) {
      if (this.generations.get(key) !== generation) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      showError(`Fin: could not check ${path.basename(document.uri.fsPath)}: ${message}`);
      this.collection.delete(document.uri);
      this.otherCollection.clear();
      this.status.text = "$(warning) Fin: not checked";
      this.status.tooltip = message;
      this.status.show();
    } finally {
      this.inFlight.delete(key);
      if (scratch) {
        await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private async interpret(
    result: RunResult,
    tempFile: string,
    document: vscode.TextDocument,
    settings: FinSettings
  ): Promise<AnalysisOutcome> {
    if (result.failedToStart) {
      // The single most important behaviour in the brief: a missing compiler must
      // never look like a clean file.
      this.notifyMissingCompiler(settings.compilerPath, explainSpawnError(settings.compilerPath, result));
      return { diagnostics: [], others: new Map(), summary: null, failure: "compiler missing" };
    }

    const report = parseCompilerOutput(result);
    if (report.unparsed.length > 0) {
      traceInfo(settings.trace, `finc: ${report.unparsed.length} stream line(s) were not JSON`);
      traceVerbose(settings.trace, report.unparsed.join("\n"));
    }

    if (report.summary === null && report.diagnostics.length === 0) {
      // Exit code or stderr, never silence. The contract promises a summary; its
      // absence means this finc is not the one this extension was built for.
      const status = result.signal ? `signal ${result.signal}` : `exit ${result.code}`;
      const detail = firstMeaningfulLine(result.stderr) || firstMeaningfulLine(result.stdout);
      const message =
        `Fin: finc produced no diagnostics report (${status}). ` +
        (detail ? `stderr says: ${detail}` : "stderr was empty. Check fin.trace=verbose for the invocation.");
      showError(message);
      return { diagnostics: [], others: new Map(), summary: null, failure: message };
    }
    if (report.summary?.exitCode === 3) {
      showError(
        "Fin: finc reported an internal compiler failure (exit 3). This is a bug in finc, not in the source."
      );
    }

    const outcome = await convertReport(report, tempFile, document);
    traceInfo(
      settings.trace,
      `finc: ${report.diagnostics.length} diagnostic(s) for ${path.basename(document.uri.fsPath)}`
    );

    if (settings.linfEnabled) {
      const lint = await this.runLinf(document, tempFile, settings);
      for (const diagnostic of lint) {
        outcome.diagnostics.push(diagnostic);
      }
    }
    return outcome;
  }

  private publish(document: vscode.TextDocument, outcome: AnalysisOutcome): void {
    this.collection.set(document.uri, outcome.diagnostics);
    this.otherCollection.clear();
    for (const [file, diagnostics] of outcome.others) {
      this.otherCollection.set(vscode.Uri.file(file), diagnostics);
    }
    const errors = outcome.diagnostics.filter(
      (diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error
    ).length;
    const warnings = outcome.diagnostics.length - errors;
    if (errors > 0) {
      this.status.text = `$(error) Fin: ${errors} error${errors === 1 ? "" : "s"}`;
      this.status.tooltip = `${errors} error(s), ${warnings} warning(s) in ${path.basename(document.uri.fsPath)}`;
      this.status.show();
    } else if (warnings > 0) {
      this.status.text = `$(warning) Fin: ${warnings} warning${warnings === 1 ? "" : "s"}`;
      this.status.tooltip = `No errors, ${warnings} warning(s) in ${path.basename(document.uri.fsPath)}`;
      this.status.show();
    } else {
      this.status.hide();
    }
  }

  /** One actionable message per configuration, then a status bar state that stays. */
  notifyMissingCompiler(configured: string, detail?: string): void {
    const message = missingCompilerMessage(configured, detail);
    this.status.text = "$(warning) Fin: compiler not found";
    this.status.tooltip = message;
    this.status.show();
    if (this.missingNotifiedFor === configured) {
      return;
    }
    this.missingNotifiedFor = configured;
    showError(message);
    void vscode.window
      .showWarningMessage(message, "Open settings", "Show Fin output")
      .then((choice) => {
        if (choice === "Open settings") {
          void vscode.commands.executeCommand("workbench.action.openSettings", "fin.compilerPath");
        } else if (choice === "Show Fin output") {
          output().show(true);
        }
      });
  }

  /** Allow the missing-compiler message to be shown again after a restart. */
  resetMissingNotification(): void {
    this.missingNotifiedFor = "";
  }

  /** The optional linf pass, kept off by default. Only `linf:*` warnings are added. */
  private async runLinf(
    document: vscode.TextDocument,
    tempFile: string,
    settings: FinSettings
  ): Promise<vscode.Diagnostic[]> {
    const args = ["check", tempFile, "--format", "contract", "--finc", settings.compilerPath];
    traceInfo(settings.trace, `linf: ${describeArgs(settings.linfPath, args)}`);
    const child = run(settings.linfPath, args, {
      cwd: workingDirectory(document, settings),
      timeoutMs: LINF_TIMEOUT_MS,
    });
    const result = await child.done;
    if (result.failedToStart) {
      if (this.missingNotifiedFor !== settings.linfPath) {
        this.missingNotifiedFor = settings.linfPath;
        showWarning(
          `Fin: fin.lint.linfEnabled is on but linf could not run ("${settings.linfPath}"). ` +
            `Compiler diagnostics are unaffected. Set "fin.lint.linfPath" or turn the setting off.`
        );
      }
      return [];
    }
    const report = parseCompilerOutput(result);
    const lines = lineProvider(document.getText());
    const converted = report.diagnostics
      .filter((diagnostic) => (diagnostic.code ?? "").startsWith("linf:"))
      .map((diagnostic) => toVscodeDiagnostic(diagnostic, lines, document.uri.fsPath));
    traceInfo(settings.trace, `linf: ${converted.length} style warning(s)`);
    return converted;
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.debounces.values()) {
      clearTimeout(timer);
    }
    this.debounces.clear();
    for (const child of this.inFlight.values()) {
      void child.cancel();
    }
    this.inFlight.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

function workingDirectory(document: vscode.TextDocument, settings: FinSettings): string {
  if (document.uri.scheme !== "file") {
    return settings.baseDir ?? process.cwd();
  }
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  return folder ? folder.uri.fsPath : path.dirname(document.uri.fsPath);
}

async function convertReport(
  report: ParsedReport,
  tempFile: string,
  document: vscode.TextDocument
): Promise<AnalysisOutcome> {
  const diagnostics: vscode.Diagnostic[] = [];
  const others = new Map<string, vscode.Diagnostic[]>();
  const documentLines = lineProvider(document.getText());

  for (const diagnostic of report.diagnostics) {
    if (isScratchFile(diagnostic.file, tempFile)) {
      diagnostics.push(toVscodeDiagnostic(diagnostic, documentLines, document.uri.fsPath));
      continue;
    }
    const absolute = diagnostic.file === null ? null : resolveReportedPath(diagnostic.file, tempFile);
    if (absolute === null) {
      diagnostics.push(toVscodeDiagnostic(diagnostic, documentLines, document.uri.fsPath));
      continue;
    }
    const text = await readFileIfPresent(absolute);
    const converted = toVscodeDiagnostic(diagnostic, lineProvider(text ?? ""), absolute);
    const list = others.get(absolute) ?? [];
    list.push(converted);
    others.set(absolute, list);
  }
  return { diagnostics, others, summary: report.summary };
}

function isScratchFile(reported: string | null, tempFile: string): boolean {
  if (reported === null) {
    // A diagnostic with no file is about the invocation; it belongs here.
    return true;
  }
  return path.resolve(reported) === path.resolve(tempFile) ||
    path.basename(reported) === path.basename(tempFile);
}

function resolveReportedPath(reported: string, tempFile: string): string {
  return path.isAbsolute(reported) ? reported : path.resolve(path.dirname(tempFile), reported);
}

export function lineProvider(text: string): (line1: number) => string | undefined {
  const lines = text.split(/\r?\n/);
  return (line1: number) => (line1 >= 1 && line1 <= lines.length ? lines[line1 - 1] : undefined);
}

/**
 * One compiler diagnostic as an editor diagnostic. The conversion that matters is
 * `toZeroBasedRange`; everything else is presentation.
 *
 * `result.code` is a `CodeDescription` pointing at the explain command, so
 * `ctrl+click` on a code in the Problems panel runs "Fin: Explain diagnostic code".
 */
export function toVscodeDiagnostic(
  diagnostic: CompilerDiagnostic,
  lines: (line1: number) => string | undefined,
  filePath: string
): vscode.Diagnostic {
  const zero = toZeroBasedRange(diagnostic, lines);
  const range = new vscode.Range(
    new vscode.Position(zero.startLine, zero.startCharacter),
    new vscode.Position(zero.endLine, zero.endCharacter)
  );
  const message = diagnostic.help ? `${diagnostic.message}\n\n${diagnostic.help}` : diagnostic.message;
  const result = new vscode.Diagnostic(range, message, severityOf(diagnostic.severity));
  result.source = "finc";
  if (diagnostic.code) {
    result.code = {
      value: diagnostic.code,
      target: vscode.Uri.parse(
        `command:fin.explainDiagnosticCode?${encodeURIComponent(JSON.stringify([diagnostic.code]))}`
      ),
    };
  }
  if (filePath) {
    result.relatedInformation = [
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(vscode.Uri.file(filePath), range),
        diagnostic.code ? `reported by finc (${diagnostic.code})` : "reported by finc"
      ),
    ];
  }
  return result;
}

function severityOf(severity: CompilerDiagnostic["severity"]): vscode.DiagnosticSeverity {
  switch (severity) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    case "info":
      return vscode.DiagnosticSeverity.Information;
    case "hint":
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

async function readFileIfPresent(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

function firstMeaningfulLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? "";
}

function describeArgs(command: string, args: readonly string[]): string {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

/** `finc --version`, for the first line of the output channel and the startup check. */
export async function probeCompiler(
  compilerPath: string,
  trace: TraceLevel
): Promise<{ ok: boolean; version?: string; detail?: string }> {
  const child = run(compilerPath, ["--version"], { timeoutMs: 10_000 });
  const result = await child.done;
  if (result.failedToStart) {
    return { ok: false, detail: missingCompilerMessage(compilerPath, explainSpawnError(compilerPath, result)) };
  }
  const version = firstMeaningfulLine(result.stdout);
  if (result.code !== 0) {
    return {
      ok: false,
      detail: `finc --version exited ${result.code}: ${firstMeaningfulLine(result.stderr) || "no output"}`,
    };
  }
  traceInfo(trace, `finc version: ${version}`);
  showInfo(`Fin: using ${version} (${compilerPath})`);
  return { ok: true, version };
}
