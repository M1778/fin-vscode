# Fixture provenance

Every file here is a byte-for-byte copy of a real file from
[M1778/Fin](https://github.com/M1778/Fin), taken at finc 1.0.1 (contract 3).
They are test *inputs*: do not add a project header, edit them, or reformat them.
`test/grammar.test.js` tokenizes them with real Oniguruma and asserts scopes at
named offsets, so a changed byte invalidates the assertion.

| Fixture | Source |
| --- | --- |
| `basic.fin` | `tests/samples/basic.fin` |
| `structs.fin` | `tests/samples/structs.fin` |
| `preprocessor.fin` | `tests/samples/preprocessor.fin` |
| `match.fin` | `tests/samples/match.fin` |
| `interface_pointer_map.fin` | `tests/samples/interface_pointer_map.fin` |
| `macros.fin` | `tests/samples/macros.fin` |
| `importing.fin` | `tests/samples/importing.fin` |
| `love.fin` | `tests/samples/love.fin` |
| `stdlib-ascii.fin` | `lib/std/ascii.fin` |
| `stdlib-diag.fin` | `lib/std/diag.fin` |
| `stdlib-strings.fin` | `lib/std/strings.fin` |
| `stdlib-argparse.fin` | `lib/std/argparse.fin` |

`test/fixtures/captured/` holds the compiler inputs and the exact JSONL it printed
for them (`finc <file> --diagnostics=json --color=never`), including `crlf.fin`
with CRLF endings and `utf8.fin` with two `é` before the reported column.
