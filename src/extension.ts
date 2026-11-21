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
import { explainDiagnosticCode, showCodeInventory, showCompilerOutput } from "./commands";
import { readSettings } from "./config";
import { DiagnosticsController, probeCompiler } from "./diagnostics/service";
import { DocumentModelCache, createCompletionProvider, createDocumentSymbolProvider, createHoverProvider } from "./features";
import { FinFormattingProvider, formatActiveDocument } from "./format";
import { clearRecentNotifications, disposeOutput, recentNotifications, showInfo, showWarning } from "./output";
import { StdlibCatalog, loadStdlib, reportMissingStdlib } from "./stdlib/stdlib";

/** Exported so the integration suite can observe activation without internals. */
export interface FinExtensionApi {
  describeState(): { stdlibRoot: string | undefined; declarations: number };
  describeNotifications(): readonly { level: string; message: string }[];
  resetNotifications(): void;
  recheck(): void;
}

/** Everything the extension owns, so a restart can rebuild it without a reload. */
interface ExtensionState {
  disposables: vscode.Disposable[];
  catalog: StdlibCatalog | undefined;
  features: vscode.Disposable[];
  modelCache: DocumentModelCache | undefined;
}

let state: ExtensionState = { disposables: [], catalog: undefined, features: [], modelCache: undefined };
let diagnosticsController: DiagnosticsController | undefined;
let formattingProvider: FinFormattingProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<FinExtensionApi> {
  const settings = readSettings();
  showInfo(`Fin ${context.extension.packageJSON.version} activated.`);

  // Diagnostics first: a missing compiler has to say so on activation, not only
  // after the first edit, or a user opens a broken file and sees it look clean.
  diagnosticsController = new DiagnosticsController();
  state.disposables.push(...diagnosticsController.register());

  formattingProvider = new FinFormattingProvider();
  state.disposables.push(...formattingProvider.register());

  await buildLanguageFeatures(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("fin.explainDiagnosticCode", explainDiagnosticCode),
    vscode.commands.registerCommand("fin.showCompilerOutput", showCompilerOutput),
    vscode.commands.registerCommand("fin.showDiagnosticCodes", () => showCodeInventory(readSettings().compilerPath)),
    vscode.commands.registerCommand("fin.formatDocument", formatActiveDocument),
    vscode.commands.registerCommand("fin.restartToolchain", async () => {
      await restartToolchain(context);
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        event.affectsConfiguration("fin.stdlibPath") ||
        event.affectsConfiguration("fin.compilerPath")
      ) {
        await buildLanguageFeatures(context);
      }
    }),
    { dispose: () => void disposeAll() }
  );

  const compiler = await probeCompiler(settings.compilerPath, settings.trace);
  if (!compiler.ok) {
    diagnosticsController.notifyMissingCompiler(settings.compilerPath);
  } else {
    showInfo(`Fin: standard library at ${state.catalog?.root ?? "(unresolved)"}`);
  }

  // The extension object is the suite's only window into internal state; exporting
  // it keeps the test from reaching into the module cache.
  return {
    describeState,
    describeNotifications,
    resetNotifications,
    recheck: () => diagnosticsController?.recheckVisible(),
  };
}

/**
 * (Re)build the stdlib index and swap the providers that read it.
 *
 * The new index is built **before** the old providers are disposed, so a settings
 * change never leaves a window where hover, completion or outline are missing
 * while `lib/std` is being re-read. The old registrations are disposed after the
 * new ones are in place, so a restart does not stack two providers on the language.
 */
let rebuild: Promise<void> | undefined;

/**
 * Serialize rebuilds. A settings change can arrive while a rebuild is in flight
 * (compiler path and stdlib path are two separate events), and two interleaved
 * rebuilds could dispose each other's registrations and leave the language with no
 * providers at all.
 */
function buildLanguageFeatures(context: vscode.ExtensionContext): Promise<void> {
  const previous = rebuild ?? Promise.resolve();
  const next = previous.then(() => doBuildLanguageFeatures(context));
  rebuild = next.catch(() => undefined);
  return next;
}

async function doBuildLanguageFeatures(context: vscode.ExtensionContext): Promise<void> {
  const settings = readSettings();
  const catalog = await loadStdlib(settings.stdlibPath, settings.compilerPath);
  const modelCache = new DocumentModelCache();
  const shared = { catalog, models: modelCache, extensionRoot: context.extensionPath };
  const features: vscode.Disposable[] = [
    modelCache,
    vscode.languages.registerHoverProvider({ language: "fin" }, createHoverProvider(shared)),
    vscode.languages.registerCompletionItemProvider(
      { language: "fin" },
      createCompletionProvider(shared),
      ":"
    ),
    vscode.languages.registerDocumentSymbolProvider({ language: "fin" }, createDocumentSymbolProvider(shared)),
  ];

  for (const disposable of state.features) {
    disposable.dispose();
  }
  state.features = features;
  state.modelCache = modelCache;
  state.catalog = catalog;
  reportMissingStdlib(catalog);
  showInfo(
    `Fin: indexed ${catalog.index.size} declaration(s) from ${catalog.modules.length} module(s) in ${catalog.root}`
  );
}

/**
 * "Fin: Restart toolchain" rebuilds the compiler-independent parts (stdlib index,
 * providers) and re-checks every open file. There is no long-lived language server
 * process to restart: diagnostics are a short compiler run per document, which is
 * what makes a crashed run harmless, so this command exists to recover from a
 * changed stdlib or a moved compiler.
 */
async function restartToolchain(context: vscode.ExtensionContext): Promise<void> {
  const settings = readSettings();
  showWarning("Fin: restarting toolchain (reloading stdlib and re-checking open files)…");
  await buildLanguageFeatures(context);
  diagnosticsController?.resetMissingNotification();
  diagnosticsController?.recheckVisible();
  const compiler = await probeCompiler(settings.compilerPath, settings.trace);
  if (compiler.ok) {
    showInfo(`Fin: toolchain restarted — ${compiler.version}.`);
  }
}

function disposeAll(): void {
  for (const disposable of state.features) {
    disposable.dispose();
  }
  for (const disposable of state.disposables) {
    disposable.dispose();
  }
  state = { disposables: [], catalog: undefined, features: [], modelCache: undefined };
  diagnosticsController = undefined;
  formattingProvider = undefined;
}

export function deactivate(): void {
  disposeAll();
  disposeOutput();
}

/** Test hooks. Reading the extension's own state keeps the suite from reaching in. */
export function describeState(): { stdlibRoot: string | undefined; declarations: number } {
  return {
    stdlibRoot: state.catalog?.root,
    declarations: state.catalog?.index.size ?? 0,
  };
}

export function describeNotifications(): readonly { level: string; message: string }[] {
  return recentNotifications().map((entry) => ({ level: entry.level, message: entry.message }));
}

export function resetNotifications(): void {
  clearRecentNotifications();
}

export { path };
