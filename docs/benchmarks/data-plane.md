# Data plane vs raw SQL — before and after (2026-11-09)

`tooling/scripts/bench-data-plane.mts`, local Postgres 18.4 on an Apple-silicon laptop, 30,000-row song
catalogue (~45 columns), every SDK call as `dataAsAdmin` (the service identity, under row-level security).
"Before" is `0e3a0e79d3` (main as this work started); "after" is this branch. p50 in ms; round trips per
SDK call in brackets. Raw SQL is `rebase.sql()` in autocommit, so one round trip and no RLS.

| Case | Raw SQL | Before | After | Raw SQL, 2.7 ms RTT | Before, 2.7 ms RTT | After, 2.7 ms RTT |
|---|---:|---:|---:|---:|---:|---:|
| findById | 0.20 | 1.28 (4) | 0.73 (1) | 3.17 | 12.53 | 3.82 |
| find 30, filter + order, `count: "none"` | 3.43 | 5.51 (4) | 4.73 (1) | 7.75 | 23.33 | 9.05 |
| find 30, default count | 5.24 | 8.96 (5) | 9.41 (3) | 8.39 | 33.32 | 23.04 |
| count by filter | 2.74 | 3.07 (4) | 3.23 (1) | 6.70 | 22.47 | 7.15 |
| update one field | 0.27 | 1.27 (6) | 0.69 (2) | 3.43 | 20.05 | 6.91 |
| upsert one row | 0.17 | 0.89 (8) | 0.50 (2) | 3.20 | 24.84 | 7.06 |
| createMany 30 rows | 1.64 | 6.36 (35) | 2.32 (2) | 5.01 | 118.85 | 8.74 |
| updateMany 30, a value per row | 0.92 | 46.23 (95) | 4.13 (2) | 5.01 | 333.14 | 10.36 |
| createMany 1,000 rows | 88.04 | 740.85 (1,005) | 166.39 (2) | 88.14 | 3,804.13 | 178.91 |
| has the table changed (`fingerprint()` vs `md5(string_agg(...))`) | 60.79 | n/a | 4.48 (1) | 62.71 | n/a | 8.59 |
| rows per array element (`groupBy unnest`) | 10.77 | n/a | 13.41 (1) | 13.24 | n/a | 14.42 |
| mode by `lower(artist)` | 75.28 | n/a | 78.51 (1) | 71.56 | n/a | 83.86 |

CPU per call (direct, µs, raw → before → after): findById 248 → 1,307 → 945; find 30 755 → 2,057 → 1,584;
createMany 1,000 92,372 → 381,277 → 169,183.

What remains between "after" and raw SQL:

- A write is two round trips (the statement, then COMMIT) where autocommit SQL is one.
- `find` with the default count is three: the page and its count share a REPEATABLE READ snapshot.
  `count: "none"` is one.
- Row-level security, which raw SQL as the owner skips.
- CPU: drizzle builds every statement and maps every row; a 1,000-row insert renders all 46 columns of
  each row. That is most of the 166 vs 88 ms.

Reproduce: `TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx tooling/scripts/bench-data-plane.mts --database-url postgresql://you@127.0.0.1:5432/postgres [--delay-ms 1.35] [--cpu]`.
