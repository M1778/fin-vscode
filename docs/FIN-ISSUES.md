# Fin issues found while building fin-vscode

Everything here was reproduced against the real binary at
`/home/M1778/Fin/build/finc` (finc 1.0.1, contract 3). None of it was fixed in the
Fin repository: this extension works around each item and the report stays here.

## 1. The JSONL report goes to stderr, contradicting the editor brief

**Observed**

```sh
$ finc e.fin --diagnostics=json --color=never 2>/dev/null | od -c
0000000                      # stdout is empty

$ finc e.fin --diagnostics=json --color=never 2>&1 1>/dev/null
{"kind":"diagnostic","severity":"error","code":"E0201",...}
{"kind":"summary","errors":2,"warnings":1,"exitCode":1,"status":"failed"}
```

`docs/finc-interface-contract.md` §"`--diagnostics=json`" says *"Fin writes JSONL
on **stderr**"*, which the binary does. The editor brief said stdout. The contract
document and the binary agree, so the document is right and the brief's line is
the stale one.

**Why it matters:** a consumer that reads only stdout sees an empty stream and,
following the brief's advice to read stdout, would report zero problems for a
file with two errors — the exact failure mode the brief warns about.

**Workaround here:** `parseCompilerOutput` reads both streams and takes whichever
carries the `summary`; a run with neither is an explicit failure, never a pass.

**Smallest repro:** `printf 'fun main() <noret> {\n let x <int> = "hi";\n}\n' > e.fin && finc e.fin --diagnostics=json --color=never 2>/dev/null | wc -c` → `0`.

## 2. `column` counts UTF-8 bytes, not characters

The contract does not say what unit `column`/`endColumn` use. They are byte
offsets into the line's UTF-8 encoding, which is correct for the compiler's own
byte-indexed source rendering but is not what an editor position means.

**Observed**, for `    let s <string> = "éé"; let x <int> = "hi";`:

| Spelling of the prefix | chars | UTF-8 bytes | `column` reported for `"hi"` |
| --- | --- | --- | --- |
| `"hi"` | 1 | 1 | 42 (= chars) |
| `"éé"` | 1 | 2 each | 44 (= bytes) |
| `"😀"` | 1 | 4 | 44 (= bytes) |
| `"世界"` | 1 | 3 each | 46 (= bytes) |

So `column - 1` is a byte offset into the UTF-8 line, not a character index. The
extension converts byte offset → UTF-16 code units before making a `Range`.

**Why it matters:** every diagnostic after a non-ASCII character lands two to
three columns to the right if a consumer uses `column - 1` directly as a
character offset. A comment containing `❤️` (which lib/std itself uses) is enough.

**Smallest repro:**

```sh
printf 'fun main() <noret> {\n    let s <string> = "éé"; let x <int> = "hi";\n}\n' > u.fin
finc u.fin --diagnostics=json --color=never 2>&1 | head -1
# column 44; the real character offset of `"hi"` is 42
```

## 3. `--explain` names a code the compiler raises, but `code` is `null` for warnings

Warnings carry `"code":null` — e.g. the unused-variable warning on every one of
the samples above. That is allowed by the contract (`code` is nullable) but it
means the most common warning in the language has no explanation to fetch and no
`CodeDescription` link. Not a bug, a gap worth naming: `finc --explain list`
lists 34 codes, all of them errors.

**Smallest repro:** `printf 'fun main() <noret> {\n let x <int> = 1;\n}\n' > w.fin && finc w.fin --diagnostics=json --color=never 2>&1 | head -1` → `"code":null`.

## 4. `finfmt` is not in the release tarball

The editor brief points at `build/tools/fmt/finfmt`, which a source build has. The
`finc-1.0.0-x86_64-unknown-linux-gnu.tar.gz` release asset ships only `bin/finc`
and `lib/std`, so a user who installs Fin from a release has no formatter and the
extension's formatting path reports "formatter not found". That is the correct
behaviour, but the release is incomplete for editor use.

**Smallest repro:** `tar tzf finc-1.0.0-x86_64-unknown-linux-gnu.tar.gz | grep fmt` → no output.

## 5. Grammar gaps in `editors/textmate/fin.tmLanguage.json` (fixed locally, not upstream)

Three constructs the compiler accepts tokenize as plain variables/punctuation in
the canonical grammar:

1. `@special(pub) name(...)` — `lib/std/error.fin:43`,
   `tests/samples/interface_pointer_map.fin:16`. The grammar only matches
   `@special name`, so the declared name is `variable.other`.
2. The `@`-spelled compiler intrinsics `@type_name`, `@type_size`,
   `@field_count`, `@field_offset`, `@implements`, `@defined`, `@unpacked`
   (`src/semantics/impl/Analyzer_Expr.cpp:1940-2052`). All are plain variables.
3. The meta-types `$type`, `$struct`, `$interface`, `$enum_member` — the `$` is
   `punctuation.fin` and the word after it is coloured as a *declaration keyword*
   (`$type` renders `type` as `keyword.declaration.fin`, which is wrong in a
   parameter list).

Also worth noting: `editors/textmate/fin.tmLanguage.json` and
`tools/grammar/fin.tmLanguage.json` are two different grammars with different
scope names for the same constructs (`meta.directive.grant.fin` vs
`meta.attribute.fin`, `keyword.other.macro.fin` vs nothing). Only the first is
documented as canonical in `editors/README.md`.

**Smallest repro:** the offsets are pinned in `test/grammar.test.js`
("the local additions colour compiler intrinsics and `@special(pub)`").

## 6. `linf` duplicates compiler diagnostics on its `gcc` lane

`linf check e.fin --format gcc` prints the same `E0201` line three times for one
error (once per compiler phase it relays), and its `contract` lane emits the
compiler's diagnostics with the compiler's own codes. A consumer merging lanes
naively shows every squiggle two to four times. The extension filters to
`linf:*` codes only, which is why the setting is off by default and documented as
"style warnings only".

**Smallest repro:** `linf check e.fin --format gcc --finc /home/M1778/Fin/build/finc`
→ the same `e.fin:2:19: error:` line repeated.
