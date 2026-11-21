# zeee0404-csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/zeee0404/zeee0404-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/zeee0404/zeee0404-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for csv-reader 1.0.0: `solve.js` returns exactly csv-reader's answer `{columns, rows, errors}` for every input — including its whole broken-row policy (BOM, stray CRs, unterminated quotes, quote junk, short/long rows) — but reads the text with native scans instead of one character at a time.

## How it is fast

The reference builds every field a character at a time (`value += c`). This one never loops over characters:

- An unquoted field ends at the nearest of the next comma, LF or CR, each found with a native `indexOf` (the CR cursor advances once per CR in the whole text, never once per field).
- A quoted field is found with `indexOf('"')`; its content is taken with `slice()`, and CRLF/lone CR inside it become LF with one `replace()`.
- A record whose first line holds no quote at all is read with one `split(',')`.
- Field readers return the value string and report how it ended through two shared slots, so no result object is allocated per field.

On the kit's practice set (6 cases, ~10.2 MB of CSV) it runs the six cases in ~110 ms steady-state, against ~545 ms for csv-reader 1.0.0 itself — about 5× faster — and its answers are byte-identical to the reference on all six practice cases plus 30,000 randomized fuzz cases.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` is the house driver (unchanged): it reads every case from `/input/cases.json`, answers each with `run()` from `solve.js`, and writes `/output/answers.json`.

---

<sub>Entry for [make.fun](https://make.fun/bounty/csv-reader-speed-01-run-20261121) · csv-reader-speed-01-run-20261121</sub>
