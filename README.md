# Fin for Visual Studio Code

Language support for **Fin**, the systems programming language from
[M1778/Fin](https://github.com/M1778/Fin): real syntax highlighting from the
compiler's own grammar, the compiler's diagnostics as squiggles, `finfmt`
formatting, and hover, completion and outline built from the shipped standard
library.

- Verified against **finc 1.0.1 (contract 3)**, and exercised in CI against the
  published **finc 1.0.0** release (which reports contract 3 but has no
  `--explain`; see [docs/FIN-ISSUES.md](docs/FIN-ISSUES.md)).
- Extension version **1.0.0**.
- License **MIT**.

---

## Installing

The extension is **not published to the VS Code Marketplace**: that needs an owner
publisher token, which this build did not have. Install the packaged `.vsix`
instead — it is attached to the
[v1.0.0 release](https://github.com/M1778/fin-vscode/releases/tag/v1.0.0).

```sh
curl -LO https://github.com/M1778/fin-vscode/releases/download/v1.0.0/fin-vscode-1.0.0.vsix
code --install-extension fin-vscode-1.0.0.vsix
```

Or build it yourself:

```sh
git clone https://github.com/M1778/fin-vscode.git
cd fin-vscode
npm ci
npm run compile
npx @vscode/vsce package          # writes fin-vscode-1.0.0.vsix
code --install-extension fin-vscode-1.0.0.vsix
```

Either way, **Extensions: Install from VSIX…** in the Command Palette installs the
same file. Reload the window afterwards.

### You also need the compiler

The extension shells out to the real tools; it does not embed a type checker.

| Tool | What it does | Required for |
| --- | --- | --- |
| `finc` 1.0.1+ (contract 3) | compiles, type-checks, reports diagnostics | squiggles, "Explain diagnostic code" |
| `finfmt` | formats | formatting |
| `lib/std/*.fin` (49 modules) | the standard library sources | hover, completion |
| `linf` *(optional, off by default)* | style warnings | `fin.lint.linfEnabled` |

All four ship with a normal Fin install. Download from
[Fin releases](https://github.com/M1778/Fin/releases); the compiler looks for
`lib/std` at `../lib/std` relative to its own binary, and so does this extension.

If `finc` cannot be found you get **one** message naming `fin.compilerPath` and
the download page, plus a `Fin: compiler not found` item in the status bar. You
never get a silently clean file.

---

## First run

1. Install the `.vsix` (above) and reload.
2. Open a folder containing `.fin` files.
3. Open any `.fin` file. Syntax highlighting works immediately; nothing else
   needs configuring if `finc` is on `PATH`.
4. Diagnostics appear after the file has been idle for 300 ms. Errors and
   warnings also show in the status bar and the Problems panel.
5. Command Palette → **Fin: Show compiler output** to see exactly what was run.

If your tools are not on `PATH`:

```jsonc
// .vscode/settings.json
{
  "fin.compilerPath": "/opt/fin/bin/finc",
  "fin.formatterPath": "/opt/fin/bin/finfmt",
  "fin.stdlibPath": "/opt/fin/lib/std",
  "fin.includePaths": ["${workspaceFolder}/vendor", "../shared-fin"]
}
```

Relative paths (and `${workspaceFolder}`) resolve against the first workspace
folder. A bare name is searched on `PATH`.

---

## What it does

### Syntax highlighting

The TextMate grammar is the canonical one from
[`Fin/editors/textmate/fin.tmLanguage.json`](https://github.com/M1778/Fin/blob/master/editors/textmate/fin.tmLanguage.json)
(scope `source.fin`), copied in and extended locally where the canonical file had
gaps. See [Grammar provenance](#grammar-provenance).

Scopes are the standard TextMate ones, so any theme colours Fin without a theme
rule: `keyword.control`, `keyword.declaration`, `storage.type`,
`entity.name.function`, `constant.numeric`, `comment.line.double-slash`, and so
on.

### Diagnostics

Each check runs

```sh
finc <file> --diagnostics=json --color=never
```

and converts the JSONL report to VS Code diagnostics.

The report is read from **stderr**, which is where finc 1.0.1 writes it: its own
contract reserves stdout for `--help`, `--version` and `--explain`. Both streams
are accepted, because the editor brief expected stdout and a future variant may
move it — whichever stream carries the `summary` line wins, and a run with neither
is reported as a failure rather than as a clean file.

- **Debounced**: 300 ms after the last edit.
- **One process per document at a time**: the previous run is cancelled before a
  new one starts, and a result that arrives after a newer run started is dropped,
  so a stale squiggle cannot overwrite a fresh one.
- **Exact ranges**: the contract's `line`/`column` are 1-based and `endColumn` is
  exclusive; editor positions are 0-based, so the start subtracts one and the end
  does not. Columns are **UTF-8 bytes**, so they are converted against the real
  line text before handing them to the editor — this is what keeps squiggles
  correct on lines containing `é` or `😀`.
- **CRLF safe**: a file with Windows line endings produces the same ranges as the
  same file with Unix endings.
- **Honest failures**: a missing or crashing compiler produces a message, not an
  empty Problems panel. Exit code 3 (a compiler bug) is called out as a bug in
  `finc`, never as a problem in your source.

`--diagnostics=json` type-checks only; it cannot link. There is no "build and
run" command, by design.

### Linting

**Linting is the compiler's diagnostic stream.** Fin's compiler already reports
errors *and* warnings (unused variables, and so on); this extension does not
invent a second set of rules.

The optional [`linf`](https://github.com/M1778/linf) style linter can be merged in
behind `fin.lint.linfEnabled` (off by default). When on, it runs
`linf check <file> --format contract --finc <fin.compilerPath>` and only its own
`linf:*` warnings are added; the compiler diagnostics it relays are dropped so
nothing appears twice. If `linf` is not installed you get one warning and
compiler diagnostics continue unaffected.

### Formatting

`finfmt` from the same release, registered as a document formatting provider, so
**Format Document** (<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>) works and
`editor.formatOnSave` works. `fin.format.onSave` is a separate switch for people
who format Fin on save but not everything else.

Formatting is idempotent: formatting an already-formatted file produces no edit.
The extension also runs the formatter twice on its own output and keeps the first
result if the second disagrees, so a formatter bug cannot turn save into a loop.

If `finfmt` is missing you get one message naming `fin.formatterPath`.

### Hover, completion, outline

Built from the real `lib/std/*.fin` sources: `pub fun`, `pub struct`,
`pub enum`, `pub interface`, `pub type`, `pub const`, `pub operator` and `@macro`,
together with the `//` comment block written above each one. Nothing is a
hand-maintained list.

- **Hover** on a name shows the declaration's real signature, the module and
  namespace that declare it, and the module's own comment — including the caveats
  the library states about itself. Hovering a module name in an `import` shows
  that module's header.
- **Completion** offers keywords, the standard types, and names from the stdlib
  index (filtered by what you typed). After `import { … } from strings::std` it
  offers only that module's declarations. Members after `.` are not guessed,
  because the extension does not know the receiver's type.
- **Outline / breadcrumbs** show the file's declarations with struct fields
  nested under their struct.

The index is rebuilt when `fin.stdlibPath` or `fin.compilerPath` changes, and by
**Fin: Restart toolchain**.

---

## Commands

| Command | What it does |
| --- | --- |
| **Fin: Explain diagnostic code** | Runs `finc --explain <code>` and opens the explanation beside the editor. Takes the code from the selection, the word under the cursor, a clicked code in the Problems panel, or a prompt. |
| **Fin: List every diagnostic code** | Runs `finc --explain list` and opens the inventory of all 34 codes. |
| **Fin: Show compiler output** | Reveals the **Fin** output channel: every invocation, its exit status, and the raw JSONL at `fin.trace = verbose`. |
| **Fin: Format document** | Formats the active file with `finfmt`, and reports when it is already formatted. |
| **Fin: Restart toolchain (reload compiler, formatter and stdlib)** | Rebuilds the stdlib index, re-registers the providers, re-probes `finc` and re-checks every open Fin file. Use it after changing settings outside VS Code or replacing a tool. |

There is no long-lived language-server process, so "restart the language server"
means "rebuild the index and re-check", which is what that command does. A crashed
compiler run cannot wedge the editor because every check is a short child process.

Also contributed: an editor context-menu entry for **Explain diagnostic code**, and
snippets for `main`, `fun`, `struct`, `import`, `import path`, `blame`,
`pub fun`, `fun?` and `foreach`.

---

## Settings

Every setting is read and documented; there is no dead configuration.

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fin.compilerPath` | string | `"finc"` | The compiler, or its name on `PATH`. |
| `fin.formatterPath` | string | `"finfmt"` | The formatter. |
| `fin.includePaths` | string[] | `[]` | Extra module search directories, passed as `-I <path>`. The document's own directory is always added. |
| `fin.stdlibPath` | string | `""` | The directory holding the library `*.fin` files. Empty means `<compiler>/../lib/std`. |
| `fin.diagnostics.enabled` | boolean | `true` | Run the compiler. Off clears Fin's diagnostics. |
| `fin.format.onSave` | boolean | `false` | Format `.fin` files with `finfmt` on save. |
| `fin.lint.linfEnabled` | boolean | `false` | Merge `linf` style warnings. |
| `fin.lint.linfPath` | string | `"linf"` | The `linf` binary used by that setting. |
| `fin.trace` | `off` \| `messages` \| `verbose` | `"off"` | How much reaches the **Fin** output channel. |

---

## Grammar provenance

`syntaxes/fin.tmLanguage.json` starts as a byte-for-byte copy of
`Fin/editors/textmate/fin.tmLanguage.json` (sha256
`84e59c09756df535ac7655c1b7ead3f74e23bcb0119b6b8a0eece93e236d8fb8`) and adds
rules for constructs the canonical file left as plain variables:

1. **`@special(pub) name(...)`** — the visibility form (`lib/std/error.fin:43`,
   `tests/samples/interface_pointer_map.fin:16`). The canonical grammar only
   recognised `@special name`, so the declared name was coloured as an ordinary
   variable.
2. **`@`-spelled compiler intrinsics** — `@type_name`, `@type_size`,
   `@field_count`, `@field_offset`, `@implements`, `@defined`, `@unpacked`, which
   the analyzer implements directly, were plain variables and punctuation.
3. **Meta-types** — `$type`, `$struct`, `$interface`, `$enum_member` (and `$type`
   in an `@special` parameter list) now read as `storage.type.meta`.

Everything else is untouched; the test suite asserts every canonical pattern
still exists and that real files tokenize with no gaps. `fin-keywords.json` is
unchanged and still authoritative: the test suite checks all 81 words land in the
scope the keyword list assigns.

If you want the canonical grammar repaired instead of locally patched, the changes
above are the diff to upstream.

---

## What is not supported

- **Build, run or debug.** No `-o`, no launch configurations, no debugger.
  `--diagnostics=json` cannot link.
- **Rename, go to definition, find references, semantic tokens, code actions.**
  These need a real index of the whole project; the compiler API for that is not
  public yet, and guessing would be worse than not offering it.
- **Member completion after `.`** — see above.
- **Windows ARM64, Web (`vscode.dev`), untrusted workspaces** — the extension runs
  child processes and needs a local filesystem. In an untrusted workspace it stays
  in read-only mode: highlighting, hover, completion and outline only.
- **Multi-root workspaces**: settings resolve against the first workspace folder;
  per-folder `fin.*` settings are honoured for the file being checked.
- **Inlay hints, semantic highlighting, call hierarchy.**

If you need one of these, that is a useful issue to open.

---

## Reporting a bug

Open <https://github.com/M1778/fin-vscode/issues> and include:

1. `finc --version` output (expected `finc 1.0.1 (contract 3)`).
2. The **Fin** output channel at `fin.trace = "verbose"`
   (**Fin: Show compiler output**).
3. The smallest `.fin` file that shows it, plus the exact command you would run by
   hand, e.g. `finc file.fin --diagnostics=json --color=never`.
4. Your OS and VS Code version (`code --version`).

If the compiler itself is wrong — a diagnostic on the wrong range, a report that
contradicts the language — that is a bug in [M1778/Fin](https://github.com/M1778/Fin/issues),
not in this extension. The tests here pin the contract, so a mismatch is usually
visible on the compiler side first.

Everything this extension knows about `finc`'s quirks, with a one-line repro for
each, is recorded in [docs/FIN-ISSUES.md](docs/FIN-ISSUES.md) — including that
the report is on stderr and that columns are UTF-8 byte offsets.

---

## Development

```sh
npm ci
npm run compile
npm test                      # unit + grammar tests, no VS Code needed
npm run test:integration      # real VS Code via @vscode/test-electron
npx @vscode/vsce package      # the .vsix
```

`npm test` covers:

- **`test/diagnostics.test.js`** — parses captured `finc` JSONL (including a CRLF
  file and a file with `é` before the reported column) and asserts the exact
  0-based ranges, the conversion of UTF-8 byte columns, and the stderr/stdout
  lane handling.
- **`test/grammar.test.js`** — real Oniguruma through `vscode-textmate` +
  `vscode-oniguruma`, tokenizing real files from `Fin/tests/samples` and
  `Fin/lib/std`, asserting named scopes at named offsets.
- **`test/stdlib-model.test.js`**, **`test/stdlib-real.test.js`** — the
  declaration scanner against fixtures and, when `FIN_STDLIB` is set, the whole
  real library.
- **`test/exec.test.js`** — the process layer: missing binary, streams kept
  apart, a path with spaces, cancellation, timeout, UTF-8 chunk boundaries.

Set `FIN_COMPILER`, `FIN_FORMATTER` and `FIN_STDLIB` to run integration tests
against a real Fin install. `FIN_EXPLAIN=no` marks a compiler without the additive
`--explain` flag, so that one test reports pending instead of failing.
`FIN_TMLANGUAGE` points at the canonical grammar to re-check that the local copy
still contains every canonical pattern.

CI runs, on Linux, macOS and Windows:

1. `npm ci && npm run compile && npm test && npx @vscode/vsce package`
2. the extension-host suite against a pinned VS Code **1.95.3** (the oldest
   version the extension declares support for), with the published `finc` release
   downloaded and probed. A toolchain test that cannot run against that binary is
   reported as pending, never as a pass.

The last run before release was green on all six jobs; Linux ran the compiler,
formatter and 49-module library, macOS ran the library, Windows ran activation,
symbols, hover and the missing-compiler paths.

### Repository layout

```
syntaxes/fin.tmLanguage.json   the grammar
snippets/fin.json              snippets
src/extension.ts               activation, commands, providers
src/diagnostics/parse.ts       the JSONL contract -> zero-based ranges
src/diagnostics/service.ts     debounce, cancel, publish
src/stdlib/model.ts            declaration scanner
src/stdlib/stdlib.ts           lib/std loader
src/format.ts                  finfmt provider
src/features.ts                hover, completion, outline
test/                          unit, grammar, integration
```

All source files carry the Fin project header (MIT).

---

## License

MIT © 2027 M1778. See [LICENSE](LICENSE).
