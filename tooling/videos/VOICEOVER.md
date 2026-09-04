# Rebase intro — voice-over script

Timed at **~2.5 words per second**, unhurried, plus a beat of silence at each
end of a scene. Every scene's `durationInFrames` in `src/film.ts` is derived
from the line below it — **if you rewrite a line, retime the scene**, not the
other way round.

Total: **3300 frames = 110 seconds** at 30fps.

## The shape

The product describes its own structure in `docs/PRODUCT.md`: three adoption
modes — BaaS, CMS, Full — called there *"the shape of the offer"*. The film
follows it, because an earlier cut told only the middle mode and made a platform
with a full CMS, a database workspace, a typed SDK, agents and an MIT licence
sound like a way to generate REST routes.

| Act | Scenes | Doing |
|-----|--------|-------|
| I · The problem | 00–01 | Anyone can ship a backend. Nobody can tell you it is safe. |
| II · The answer | 02–05 | Authorization in the database, generated from one definition. |
| III · The offer | 06–11 | Take the backend / add the panel / add Studio. |
| IV · The proof | 12–14 | The granularity, the behaviour, an audit you run yourself. |
| V · Yours | 15–18 | Agents included, one command, MIT. |

## The script

| # | Scene | Frames | Sec | Line |
|---|-------|--------|-----|------|
| 00 | Cold open | 96 | 3.2 | *(silent — the mark assembles)* |
| 01 | The problem | 300 | 10.0 | Getting a backend has never been easier. Knowing whether it is safe never got easier. |
| 02 | Row-level security | 170 | 5.7 | Authorization belongs in the database, where code cannot forget to ask. |
| 03 | One definition | 210 | 7.0 | One definition, and everything else is compiled from it. |
| 04 | Forty endpoints | 270 | 9.0 | REST, an OpenAPI spec, a typed SDK. None of it written. |
| 05 | Headline | 150 | 5.0 | A backend for Postgres. The one you choose. |
| 06 | Headless | 175 | 5.8 | Take only that: SDK, auth, storage, functions, cron, backups. |
| 07 | The wire | 240 | 8.0 | Realtime too — and the rows you cannot see never arrive. |
| 08 | The panel | 280 | 9.3 | Or add the panel, and the same definition becomes an application for everyone else. |
| 09 | Every view | 240 | 8.0 | Lists, boards, tables, forms. Every one of them generated. |
| 10 | Studio | 175 | 5.8 | Add Studio and run the database from the same app. |
| 11 | The schema | 260 | 8.7 | Drawn from the catalogue, so it is what is actually there. |
| 12 | Access is not a switch | 240 | 8.0 | Per collection, per operation, per role. Postgres enforces every cell. |
| 13 | The same query, twice | 240 | 8.0 | The same call, two people, different rows. No branch anywhere. |
| 14 | The proof | 200 | 6.7 | And rls-check will tell you the same about any Postgres. |
| 15 | Agent-native | 165 | 5.5 | An agent gets the same authorization you do. |
| 16 | One command | 205 | 6.8 | Three commands, and all of it runs against your database. |
| 17 | Yours | 175 | 5.8 | MIT, end to end. Nobody else holds your keys. |
| 18 | The ask | 160 | 5.3 | Rebase. Open source. Postgres-native. |

## Notes for the read

- **03 has to breathe.** Five code cards sit on screen for about five seconds
  before they collapse, because the viewer is being asked to actually read them
  and recognise their own week. The line breaks in the middle: the list of
  places, a pause on the collapse, then the last sentence over the single file.
- **05, 06 and 07 are one sentence in three parts** — *take only / or add / or
  add*. Keep the same cadence across all three so the additive shape is audible,
  not just visible.
- **11 is the only place the licence is named.** Land "MIT" and then stop; the
  rest of that line is consequence, not more claims.
- **Do not read the on-screen headlines.** They are already on screen. The
  narration says what the picture cannot.
