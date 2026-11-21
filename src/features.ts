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
import { StdlibCatalog } from "./stdlib/stdlib";
import { FinDeclaration, declarationAtPosition, matchingDeclarations, parseFinSource } from "./stdlib/model";

/** Per-document parse cache, invalidated on change. */
export class DocumentModelCache implements vscode.Disposable {
  private readonly cache = new Map<string, { version: number; declarations: FinDeclaration[] }>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.cache.delete(event.document.uri.toString());
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.cache.delete(document.uri.toString());
      })
    );
  }

  get(document: vscode.TextDocument): FinDeclaration[] {
    const key = document.uri.toString();
    const hit = this.cache.get(key);
    if (hit && hit.version === document.version) {
      return hit.declarations;
    }
    const moduleName = path.basename(document.uri.fsPath).replace(/\.fin$/, "");
    const declarations = parseFinSource(document.getText(), moduleName);
    this.cache.set(key, { version: document.version, declarations });
    return declarations;
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.cache.clear();
  }
}

export interface LanguageFeaturesContext {
  catalog: StdlibCatalog;
  models: DocumentModelCache;
  extensionRoot: string;
}

/**
 * Hover. Three sources, in order of specificity: the declaration under the cursor
 * in this file, a stdlib declaration with that name, and the stdlib module header
 * when the cursor is on a module name in an import.
 */
export function createHoverProvider(context: LanguageFeaturesContext): vscode.HoverProvider {
  return {
    provideHover(document, position, token) {
      if (token.isCancellationRequested) {
        return undefined;
      }
      const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
      if (!wordRange) {
        return undefined;
      }
      const word = document.getText(wordRange);

      const local = declarationAtPosition(context.models.get(document), position.line, position.character);
      if (local) {
        const markdown = new vscode.MarkdownString();
        markdown.appendCodeblock(local.signature, "fin");
        markdown.appendMarkdown(`\n\n*${local.kind}* · this file`);
        if (local.doc.trim() !== "") {
          markdown.appendMarkdown("\n\n---\n\n");
          markdown.appendMarkdown(escapeMarkdown(local.doc));
        }
        return new vscode.Hover(markdown, wordRange);
      }

      const moduleSummary = stdlibModuleForWord(context, document, position, word);
      if (moduleSummary) {
        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**${moduleSummary.name}::std** — ${moduleSummary.declarations} exported declaration(s)\n\n`);
        markdown.appendMarkdown(escapeMarkdown(moduleSummary.header || "(this module has no header comment)"));
        return new vscode.Hover(markdown, wordRange);
      }

      const entries = context.catalog.index.lookup(word);
      if (entries.length === 0) {
        return undefined;
      }
      // `len` is declared by five modules. A free function is what a bare `len(x)`
      // calls; a `self: &Self` declaration is an instance method reached through a
      // receiver. Show the free ones first so the common case is the first thing
      // read, then the methods, then a count of anything not shown.
      const ordered = [...entries].sort((a, b) => Number(isMethod(a)) - Number(isMethod(b)));
      const shown = ordered.slice(0, HOVER_ENTRY_LIMIT);
      const markdown = new vscode.MarkdownString();
      shown.forEach((entry, index) => {
        if (index > 0) {
          markdown.appendMarkdown("\n\n---\n\n");
        }
        const relative = vscode.workspace.asRelativePath(entry.file, false);
        markdown.appendCodeblock(entry.declaration.signature, "fin");
        markdown.appendMarkdown(
          `\n\n*${entry.declaration.kind}${isMethod(entry) ? " (method)" : ""}*` +
            ` · \`${entry.declaration.module}::${entry.declaration.namespace || "std"}\`` +
            ` · ${escapeMarkdown(relative)}`
        );
        if (entry.declaration.doc.trim() !== "") {
          markdown.appendMarkdown("\n\n");
          markdown.appendMarkdown(escapeMarkdown(entry.declaration.doc));
        }
      });
      if (ordered.length > shown.length) {
        markdown.appendMarkdown(
          `\n\n*…and ${ordered.length - shown.length} more module(s) declare \`${word}\`.*`
        );
      }
      return new vscode.Hover(markdown, wordRange);
    },
  };
}

function stdlibModuleForWord(
  context: LanguageFeaturesContext,
  document: vscode.TextDocument,
  position: vscode.Position,
  word: string
): { name: string; header: string; declarations: number } | undefined {
  const line = document.lineAt(position.line).text;
  // Only treat a name as a module when it is written where a module is written.
  const isImportLine = /^\s*import\b/.test(line);
  if (!isImportLine) {
    return undefined;
  }
  return context.catalog.modules.find((module) => module.name === word);
}

/**
 * Completion. The stdlib index supplies real signatures and doc blocks; a small
 * set of language keywords and the standard types fills the rest. A member after
 * `.` is not guessed: the extension does not know the receiver's type, and a wrong
 * member list is worse than none.
 */
export function createCompletionProvider(context: LanguageFeaturesContext): vscode.CompletionItemProvider {
  const keywords = KEYWORDS.map((entry) => {
    const item = new vscode.CompletionItem(entry.word, entry.kind);
    item.detail = entry.detail;
    item.documentation = new vscode.MarkdownString(entry.doc);
    return item;
  });

  return {
    provideCompletionItems(document, position, token) {
      if (token.isCancellationRequested) {
        return undefined;
      }
      const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
      if (/\.\s*[A-Za-z_][A-Za-z0-9_]*$|\.[A-Za-z0-9_]*$/.test(linePrefix)) {
        return undefined;
      }

      const importUse = /^\s*import\s+(?:\{[^}]*\}\s+from\s+)?/.test(linePrefix);
      if (importUse) {
        const items = context.catalog.modules.map((module) => {
          const item = new vscode.CompletionItem(module.name, vscode.CompletionItemKind.Module);
          item.detail = `${module.declarations} exported declaration(s)`;
          item.documentation = new vscode.MarkdownString(escapeMarkdown(module.header || module.name));
          item.sortText = module.name;
          return item;
        });
        return new vscode.CompletionList(items, false);
      }

      const target = importTargetModule(linePrefix);
      if (target !== undefined && target !== "") {
        const entries = context.catalog.index.module(target);
        const items = entries.map((entry) => stdlibCompletion(entry.declaration, entry.file));
        return new vscode.CompletionList(items, false);
      }

      const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
      const typed = wordRange ? document.getText(wordRange).toLowerCase() : "";
      const items: vscode.CompletionItem[] = [...keywords];
      for (const name of context.catalog.index.names()) {
        const lowered = name.toLowerCase();
        if (typed !== "" && !lowered.startsWith(typed)) {
          // A cheap membership test keeps a 1000-entry index from building 1000
          // CompletionItems on every keystroke.
          continue;
        }
        for (const entry of context.catalog.index.lookup(name)) {
          items.push(stdlibCompletion(entry.declaration, entry.file));
        }
      }
      return new vscode.CompletionList(items, false);
    },
  };
}

/** `import { len } from strings::std;` typed as far as `strings::` -> "strings". */
function importTargetModule(linePrefix: string): string | undefined {
  const match = /^\s*import\s+\{[^}]*\}\s+from\s+([A-Za-z_][A-Za-z0-9_]*)\s*::/.exec(linePrefix);
  return match ? match[1] : undefined;
}

function stdlibCompletion(declaration: FinDeclaration, file: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(declaration.name, kindOf(declaration));
  item.detail = declaration.signature;
  item.documentation = new vscode.MarkdownString(
    escapeMarkdown(declaration.doc || declaration.signature)
  );
  item.sortText = `${declaration.kind === "function" ? "0" : "1"}${declaration.name}`;
  item.label = { label: declaration.name, description: declaration.module };
  // The signature is already written, so inserting the name alone is the useful
  // default; insertTextFormat stays plain to avoid an editor-side snippet parse.
  item.insertText = declaration.name;
  item.filterText = declaration.name;
  item.documentation = new vscode.MarkdownString(
    escapeMarkdown(declaration.doc || declaration.signature) + `\n\nDeclared in \`${file}\`.`
  );
  return item;
}

function kindOf(declaration: FinDeclaration): vscode.CompletionItemKind {
  switch (declaration.kind) {
    case "function":
    case "special":
    case "define":
    case "operator":
      return vscode.CompletionItemKind.Function;
    case "struct":
    case "enum":
    case "interface":
    case "type":
      return vscode.CompletionItemKind.Class;
    case "const":
      return vscode.CompletionItemKind.Constant;
    case "macro":
      return vscode.CompletionItemKind.Snippet;
    default:
      return vscode.CompletionItemKind.Value;
  }
}

/**
 * Document symbols. The outline is the file's own declarations, with struct fields
 * nested under their struct, so the breadcrumb and outline show the real shape.
 */
export function createDocumentSymbolProvider(context: LanguageFeaturesContext): vscode.DocumentSymbolProvider {
  return {
    provideDocumentSymbols(document, token) {
      if (token.isCancellationRequested) {
        return undefined;
      }
      const declarations = context.models.get(document);
      const symbols: vscode.DocumentSymbol[] = [];
      const byName = new Map<string, vscode.DocumentSymbol>();
      for (const declaration of declarations) {
        if (declaration.kind === "namespace") {
          continue;
        }
        const range = new vscode.Range(
          new vscode.Position(declaration.line, 0),
          new vscode.Position(declaration.line, Number.MAX_SAFE_INTEGER)
        );
        const selection = new vscode.Range(
          new vscode.Position(declaration.line, declaration.nameColumn),
          new vscode.Position(declaration.line, declaration.nameColumn + declaration.nameLength)
        );
        const symbol = new vscode.DocumentSymbol(
          declaration.name,
          declaration.signature,
          symbolKindOf(declaration),
          range,
          selection
        );
        symbols.push(symbol);
        byName.set(declaration.name, symbol);
        for (const field of declaration.fields) {
          const fieldRange = new vscode.Range(
            new vscode.Position(field.line, 0),
            new vscode.Position(field.line, Number.MAX_SAFE_INTEGER)
          );
          const fieldSelection = new vscode.Range(
            new vscode.Position(field.line, field.nameColumn),
            new vscode.Position(field.line, field.nameColumn + field.name.length)
          );
          symbol.children.push(
            new vscode.DocumentSymbol(
              field.name,
              field.type,
              vscode.SymbolKind.Field,
              fieldRange,
              fieldSelection
            )
          );
        }
      }
      return symbols;
    },
  };
}

function symbolKindOf(declaration: FinDeclaration): vscode.SymbolKind {
  switch (declaration.kind) {
    case "function":
    case "special":
    case "define":
    case "operator":
      return vscode.SymbolKind.Function;
    case "struct":
      return vscode.SymbolKind.Struct;
    case "enum":
      return vscode.SymbolKind.Enum;
    case "interface":
      return vscode.SymbolKind.Interface;
    case "type":
      return vscode.SymbolKind.TypeParameter;
    case "const":
      return vscode.SymbolKind.Constant;
    case "macro":
      return vscode.SymbolKind.Method;
    case "field":
      return vscode.SymbolKind.Field;
    default:
      return vscode.SymbolKind.Variable;
  }
}

const HOVER_ENTRY_LIMIT = 8;

/** A declaration with a `self` parameter is an instance method, reached via a receiver. */
function isMethod(entry: { declaration: FinDeclaration }): boolean {
  return entry.declaration.parameters.some((parameter) => parameter.name === "self");
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+\-.!|]/g, (match) => "\\" + match);
}

interface KeywordEntry {
  word: string;
  kind: vscode.CompletionItemKind;
  detail: string;
  doc: string;
}

/**
 * Words the grammar colours as keywords, with the one-line meaning a hover should
 * give. The list mirrors editors/fin-keywords.json so it cannot invent syntax the
 * compiler rejects; scope/form live in the TextMate grammar, not here.
 */
const KEYWORDS: readonly KeywordEntry[] = [
  { word: "fun", kind: vscode.CompletionItemKind.Keyword, detail: "function declaration", doc: "`fun name(params) <result> { ... }`. A nullable result is written `fun? name(...) <T>`." },
  { word: "let", kind: vscode.CompletionItemKind.Keyword, detail: "local binding", doc: "`let name <Type> = value;`. Use `<auto>` to infer." },
  { word: "const", kind: vscode.CompletionItemKind.Keyword, detail: "constant binding", doc: "`const NAME <Type> = value;` -- cannot be reassigned." },
  { word: "struct", kind: vscode.CompletionItemKind.Keyword, detail: "struct declaration", doc: "`struct Name { pub: field <int>, }`. Members are labelled `pub:` or `priv:`." },
  { word: "enum", kind: vscode.CompletionItemKind.Keyword, detail: "enum declaration", doc: "`enum Name { A, B }`; members are reached as `Name::A`." },
  { word: "interface", kind: vscode.CompletionItemKind.Keyword, detail: "interface declaration", doc: "A struct conforms with `struct S : <I> { ... }`." },
  { word: "namespace", kind: vscode.CompletionItemKind.Keyword, detail: "namespace block", doc: "`namespace std { ... }` groups declarations a module exports." },
  { word: "type", kind: vscode.CompletionItemKind.Keyword, detail: "type alias", doc: "`type Name = existing;`." },
  { word: "if", kind: vscode.CompletionItemKind.Keyword, detail: "branch", doc: "`if (condition) { ... } else { ... }`." },
  { word: "else", kind: vscode.CompletionItemKind.Keyword, detail: "branch", doc: "The alternative arm of an `if`." },
  { word: "for", kind: vscode.CompletionItemKind.Keyword, detail: "counted loop", doc: "`for (let i <int> = 0; i < n; i++) { ... }`." },
  { word: "foreach", kind: vscode.CompletionItemKind.Keyword, detail: "array loop", doc: "`foreach (i <int>, value <T> in items) { ... }`." },
  { word: "while", kind: vscode.CompletionItemKind.Keyword, detail: "loop", doc: "`while (condition) { ... }`." },
  { word: "match", kind: vscode.CompletionItemKind.Keyword, detail: "pattern dispatch", doc: "Dispatches over enum members, nullable presence, and constants. Arms must be exhaustive." },
  { word: "return", kind: vscode.CompletionItemKind.Keyword, detail: "early exit", doc: "Returns a value of the declared result type." },
  { word: "break", kind: vscode.CompletionItemKind.Keyword, detail: "leave the loop", doc: "Leaves the nearest enclosing loop." },
  { word: "continue", kind: vscode.CompletionItemKind.Keyword, detail: "next iteration", doc: "Skips to the next iteration of the nearest loop." },
  { word: "blame", kind: vscode.CompletionItemKind.Keyword, detail: "runtime assertion", doc: "`blame condition, \"message\";` aborts when the condition is false. `blame m1778;` marks unfinished work." },
  { word: "import", kind: vscode.CompletionItemKind.Keyword, detail: "import", doc: "`import { Name } from module::std;` or `import \"path/file.fin\";`." },
  { word: "from", kind: vscode.CompletionItemKind.Keyword, detail: "import clause", doc: "Names the module an `import { ... } from` reads." },
  { word: "pub", kind: vscode.CompletionItemKind.Keyword, detail: "visibility", doc: "Exported: another file may name this declaration." },
  { word: "priv", kind: vscode.CompletionItemKind.Keyword, detail: "visibility", doc: "Not exported from the file." },
  { word: "readonly", kind: vscode.CompletionItemKind.Keyword, detail: "immutable member", doc: "A member that only the declaring type may assign." },
  { word: "delete", kind: vscode.CompletionItemKind.Keyword, detail: "free storage", doc: "`delete value;` frees what `new` allocated. Free once." },
  { word: "new", kind: vscode.CompletionItemKind.Keyword, detail: "allocate", doc: "`new int(4)`, `new [char, count]{}`." },
  { word: "cast", kind: vscode.CompletionItemKind.Keyword, detail: "conversion", doc: "`cast<T>(value)`." },
  { word: "as", kind: vscode.CompletionItemKind.Keyword, detail: "alias / fallible cast", doc: "`import x as y;` aliases; `value as T` is the fallible form." },
  { word: "null", kind: vscode.CompletionItemKind.Keyword, detail: "absent value", doc: "Nullability is written `T?` and tested with `== null`." },
  { word: "true", kind: vscode.CompletionItemKind.Keyword, detail: "bool literal", doc: "`bool` true." },
  { word: "false", kind: vscode.CompletionItemKind.Keyword, detail: "bool literal", doc: "`bool` false." },
  { word: "int", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "Signed integer type." },
  { word: "uint", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "Unsigned integer type." },
  { word: "long", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "64-bit integer type on every platform." },
  { word: "ulong", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "64-bit unsigned integer type on every platform." },
  { word: "float", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "Floating-point type." },
  { word: "double", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "Double-precision floating-point type." },
  { word: "bool", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "Boolean type." },
  { word: "char", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "One character, written `'x'`." },
  { word: "string", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "A pointer to NUL-terminated bytes. `==` compares contents (ADR 0049)." },
  { word: "noret", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "No result, as in `fun main() <noret>`." },
  { word: "void", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "No value." },
  { word: "auto", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "Infer the type from the initializer." },
  { word: "any", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "A boxed value with its exact type checked on unbox (ADR 0034)." },
  { word: "Self", kind: vscode.CompletionItemKind.TypeParameter, detail: "type", doc: "The enclosing struct's own type, for methods." },
];

export { matchingDeclarations };
