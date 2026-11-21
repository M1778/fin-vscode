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

// Runs inside a real VS Code extension host. The point is not to re-test parsing
// (plain Node does that); it is to prove the extension activates, registers its
// contributions, launches a compiler process, converts its report into editor
// diagnostics at the right positions, formats, and never reports a clean file when
// the compiler is missing.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");

const FINC = process.env.FIN_COMPILER || "";
const FINFMT = process.env.FIN_FORMATTER || "";
const STDLIB = process.env.FIN_STDLIB || "";
// Three separate capabilities, because a release tarball ships `finc` and `lib/std`
// but not `finfmt` (that is built from source). A missing formatter must skip only
// the formatting test, not the compiler and library tests.
const HAS_COMPILER = FINC !== "" && STDLIB !== "";
// `--explain` is additive to the compiler: a 1.0.0 release does not implement it,
// so the explain test is gated on the flag actually working rather than on the
// binary merely existing.
const HAS_EXPLAIN = HAS_COMPILER && (process.env.FIN_EXPLAIN || "").toLowerCase() !== "no";
const HAS_FORMATTER = FINFMT !== "";
const HAS_STDLIB = STDLIB !== "";

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fin-vscode-suite-"));
}

/** `Diagnostic.code` is a string or a `{value, target}` object; both name the code. */
function codeOf(diagnostic) {
  return typeof diagnostic.code === "string" ? diagnostic.code : diagnostic.code?.value;
}

function waitFor(predicate, timeoutMs, what) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      Promise.resolve()
        .then(predicate)
        .then((value) => {
          if (value) {
            resolve(value);
            return;
          }
          if (Date.now() - started > timeoutMs) {
            reject(new Error(`timed out waiting for ${what}`));
            return;
          }
          setTimeout(tick, 50);
        })
        .catch(reject);
    };
    tick();
  });
}


/** `Hover.contents` is an array of strings or MarkdownStrings; both expose text. */
function renderHover(hover) {
  const parts = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
  return parts.map((part) => (typeof part === "string" ? part : part.value)).join("\n");
}

async function openFinDocument(directory, name, text) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, text, "utf8");
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document);
  return document;
}

let previousSettings;

suite("Fin extension", () => {
  suiteSetup(async () => {
    const configuration = vscode.workspace.getConfiguration("fin");
    previousSettings = {
      compilerPath: configuration.get("compilerPath"),
      formatterPath: configuration.get("formatterPath"),
      stdlibPath: configuration.get("stdlibPath"),
    };
    if (FINC !== "") {
      await configuration.update("compilerPath", FINC, vscode.ConfigurationTarget.Global);
    }
    if (FINFMT !== "") {
      await configuration.update("formatterPath", FINFMT, vscode.ConfigurationTarget.Global);
    }
    if (STDLIB !== "") {
      await configuration.update("stdlibPath", STDLIB, vscode.ConfigurationTarget.Global);
    }
    const extension = vscode.extensions.getExtension("M1778.fin-vscode");
    assert.ok(extension, "the extension is installed in the test host");
    await extension.activate();
    if (HAS_STDLIB) {
      // A settings change re-indexes asynchronously; wait for the index to be real.
      await waitFor(
        () => extension.exports.describeState().declarations > 0,
        30_000,
        "the standard library index"
      );
    }
  });

  suiteTeardown(async () => {
    const configuration = vscode.workspace.getConfiguration("fin");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    if (previousSettings) {
      await configuration.update("compilerPath", previousSettings.compilerPath, vscode.ConfigurationTarget.Global);
      await configuration.update("formatterPath", previousSettings.formatterPath, vscode.ConfigurationTarget.Global);
      await configuration.update("stdlibPath", previousSettings.stdlibPath, vscode.ConfigurationTarget.Global);
    }
  });

  test("activates and contributes the fin language, grammar, snippets and commands", async () => {
    const extension = vscode.extensions.getExtension("M1778.fin-vscode");
    assert.strictEqual(extension.isActive, true);
    const packageJSON = extension.packageJSON;
    const language = packageJSON.contributes.languages.find((entry) => entry.id === "fin");
    assert.ok(language, "fin is a contributed language");
    assert.deepStrictEqual(language.extensions, [".fin"]);
    const grammar = packageJSON.contributes.grammars.find((entry) => entry.language === "fin");
    assert.strictEqual(grammar.scopeName, "source.fin");
    assert.ok(packageJSON.contributes.snippets.some((entry) => entry.language === "fin"));

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      "fin.explainDiagnosticCode",
      "fin.showCompilerOutput",
      "fin.restartToolchain",
      "fin.formatDocument",
      "fin.showDiagnosticCodes",
    ]) {
      assert.ok(commands.includes(command), `${command} is registered`);
    }
  });

  test("the standard library index is built from the real sources", async function () {
    if (!HAS_STDLIB) {
      this.skip();
      return;
    }
    const state = vscode.extensions.getExtension("M1778.fin-vscode").exports.describeState();
    assert.strictEqual(state.stdlibRoot, STDLIB, "the index used fin.stdlibPath");
    assert.ok(state.declarations > 300, `indexed ${state.declarations} declarations`);
  });

  test("opening a .fin file selects the fin language", async () => {
    const directory = scratchDir();
    try {
      const document = await openFinDocument(directory, "hello.fin", "fun main() <noret> { }\n");
      assert.strictEqual(document.languageId, "fin");
      assert.strictEqual(document.uri.fsPath.endsWith(".fin"), true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("document symbols come from the file itself", async () => {
    const directory = scratchDir();
    try {
      const source = [
        "// A boxed value.",
        "pub struct Box {",
        "    pub:",
        "        value <int> = 0,",
        "}",
        "",
        "// Adds one.",
        "fun bump(x: int) <int> {",
        "    return x + 1;",
        "}",
        "",
      ].join("\n");
      const document = await openFinDocument(directory, "symbols.fin", source);
      const symbols = await vscode.commands.executeCommand(
        "vscode.executeDocumentSymbolProvider",
        document.uri
      );
      assert.ok(Array.isArray(symbols) && symbols.length >= 2, "two declarations are outlined");
      const box = symbols.find((symbol) => symbol.name === "Box");
      const bump = symbols.find((symbol) => symbol.name === "bump");
      assert.ok(box, "struct Box is a symbol");
      assert.ok(bump, "fun bump is a symbol");
      assert.ok(box.children.some((child) => child.name === "value"), "the struct field is nested");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  suite("with a real toolchain", () => {
    test("hover on a stdlib name shows the real signature and its comment", async function () {
      if (!HAS_STDLIB) {
        this.skip();
        return;
      }
      const directory = scratchDir();
      try {
        const document = await openFinDocument(
          directory,
          "hover.fin",
          'fun main() <noret> {\n    let n <int> = len("abc");\n}\n'
        );
        const position = new vscode.Position(1, document.getText().split(/\n/)[1].indexOf("len(") + 1);
        // Provider registration crosses an RPC boundary, so the first query after
        // activation can legitimately see no provider yet.
        const hovers = await waitFor(
          async () => {
            const found = await vscode.commands.executeCommand(
              "vscode.executeHoverProvider",
              document.uri,
              position
            );
            return Array.isArray(found) && found.length > 0 ? found : undefined;
          },
          20_000,
          "a hover for len"
        );
        const rendered = hovers.map(renderHover).join("\n");
        assert.match(rendered, /pub fun len\(s: string\) <int>/, "the real signature is shown");
        assert.match(rendered, /byte length/, "the module's own comment is shown");
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    test("completion offers stdlib declarations", async function () {
      if (!HAS_STDLIB) {
        this.skip();
        return;
      }
      const directory = scratchDir();
      try {
        const document = await openFinDocument(
          directory,
          "complete.fin",
          "fun main() <noret> {\n    let s <string> = con\n}\n"
        );
        const position = new vscode.Position(1, "    let s <string> = con".length);
        const completions = await vscode.commands.executeCommand(
          "vscode.executeCompletionItemProvider",
          document.uri,
          position
        );
        assert.ok(completions, "a completion list is returned");
        const labels = completions.items.map((item) =>
          typeof item.label === "string" ? item.label : item.label.label
        );
        assert.ok(labels.includes("concat"), `concat should complete, got ${labels.slice(0, 12).join(", ")}`);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    test("compiler diagnostics land on the exact reported range", async function () {
      if (!HAS_COMPILER) {
        this.skip();
        return;
      }
      const directory = scratchDir();
      try {
        // `"hi"` is assigned where an int belongs: E0201, line 2, column 19..23 1-based.
        const document = await openFinDocument(
          directory,
          "range.fin",
          'fun main() <noret> {\n    let x <int> = "hi";\n}\n'
        );
        const diagnostics = await waitFor(
          () => {
            const found = vscode.languages.getDiagnostics(document.uri);
            return found.length > 0 ? found : undefined;
          },
          30_000,
          "compiler diagnostics to arrive"
        );
        const error = diagnostics.find((entry) => codeOf(entry) === "E0201");
        assert.ok(error, `E0201 should be reported, got ${diagnostics.map(codeOf).join(", ")}`);
        assert.strictEqual(error.severity, vscode.DiagnosticSeverity.Error);
        assert.strictEqual(error.range.start.line, 1, "0-based line 1 for the compiler's line 2");
        assert.strictEqual(error.range.start.character, 18);
        assert.strictEqual(error.range.end.character, 22);
        assert.strictEqual(document.getText(error.range), '"hi"', "the squiggle covers the string literal");

        // A fix must clear it, and must not leave the stale one behind.
        const editor = vscode.window.activeTextEditor;
        assert.ok(editor);
        await editor.edit((builder) => {
          builder.replace(new vscode.Range(1, 18, 1, 22), "1");
        });
        await document.save();
        await waitFor(
          () =>
            vscode.languages
              .getDiagnostics(document.uri)
              .filter((entry) => codeOf(entry) === "E0201").length === 0,
          30_000,
          "the stale diagnostic to be replaced"
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    test("formatting is applied and is idempotent", async function () {
      if (!HAS_COMPILER || !HAS_FORMATTER) {
        this.skip();
        return;
      }
      const directory = scratchDir();
      try {
        const ugly = "fun main() <noret> {\n      let x <int> = 1;\n}\n";
        const document = await openFinDocument(directory, "ugly.fin", ugly);
        await vscode.commands.executeCommand("editor.action.formatDocument");
        const once = document.getText();
        assert.notStrictEqual(once, ugly, "formatting changed the file");
        assert.strictEqual(once, "fun main() <noret> {\n    let x <int> = 1;\n}\n");
        await vscode.commands.executeCommand("editor.action.formatDocument");
        assert.strictEqual(document.getText(), once, "formatting an already-formatted file is a no-op");
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    test("the explain command opens the compiler's own explanation", async function () {
      if (!HAS_EXPLAIN) {
        this.skip();
        return;
      }
      await vscode.commands.executeCommand("fin.explainDiagnosticCode", "E0301");
      const editor = await waitFor(
        () => vscode.window.visibleTextEditors.find((entry) => entry.document.getText().includes("E0301")),
        20_000,
        "the explanation document"
      );
      assert.match(editor.document.getText(), /E0301/);
      assert.match(editor.document.getText(), /a name was used that nothing in scope declares/);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });
  });

  test("a missing compiler is reported, never as a silently clean file", async () => {
    const directory = scratchDir();
    const configuration = vscode.workspace.getConfiguration("fin");
    const extension = vscode.extensions.getExtension("M1778.fin-vscode");
    const api = extension.exports;
    try {
      api.resetNotifications();
      await configuration.update(
        "compilerPath",
        path.join(directory, "no-such-finc"),
        vscode.ConfigurationTarget.Global
      );
      const document = await openFinDocument(
        directory,
        "broken.fin",
        'fun main() <noret> {\n  let x <int> = "s";\n}\n'
      );
      // Touch the buffer so the debounced check runs against the missing tool.
      const editor = vscode.window.activeTextEditor;
      await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), " "));
      await waitFor(
        () => api.describeNotifications().some((entry) => /compiler not found/i.test(entry.message)),
        30_000,
        "an actionable missing-compiler message"
      );
      const message = api
        .describeNotifications()
        .filter((entry) => /compiler not found/i.test(entry.message))
        .pop().message;
      assert.match(message, /fin\.compilerPath/, "the message names the setting to fix");
      assert.match(message, /releases/, "the message says where to install Fin");
      // A missing compiler must not manufacture diagnostics; the honest state is
      // "not checked", which the message above carries.
      assert.deepStrictEqual(vscode.languages.getDiagnostics(document.uri), []);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      if (FINC !== "") {
        await configuration.update("compilerPath", FINC, vscode.ConfigurationTarget.Global);
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a compiler that cannot produce a report is reported, not treated as clean", async () => {
    const directory = scratchDir();
    const configuration = vscode.workspace.getConfiguration("fin");
    const extension = vscode.extensions.getExtension("M1778.fin-vscode");
    const api = extension.exports;
    const fake = path.join(
      directory,
      process.platform === "win32" ? "fake-finc.cmd" : "fake-finc"
    );
    const body =
      process.platform === "win32"
        ? "@echo off\r\necho not json at all\r\nexit 1\r\n"
        : "#!/bin/sh\necho 'not json at all' >&2\nexit 1\n";
    fs.writeFileSync(fake, body, "utf8");
    if (process.platform !== "win32") {
      fs.chmodSync(fake, 0o755);
    }
    try {
      api.resetNotifications();
      await configuration.update("compilerPath", fake, vscode.ConfigurationTarget.Global);
      const document = await openFinDocument(
        directory,
        "noreport.fin",
        "fun main() <noret> {\n}\n"
      );
      const editor = vscode.window.activeTextEditor;
      await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), " "));
      await waitFor(
        () => api.describeNotifications().some((entry) => /no diagnostics report/i.test(entry.message)),
        30_000,
        "a message about the missing report"
      );
      assert.deepStrictEqual(vscode.languages.getDiagnostics(document.uri), []);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      if (FINC !== "") {
        await configuration.update("compilerPath", FINC, vscode.ConfigurationTarget.Global);
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
