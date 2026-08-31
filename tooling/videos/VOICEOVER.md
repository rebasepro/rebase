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
| 01 | The problem | 300 | 10.0 | Getting a backend has never been easier. Knowing whether it is safe never got easier at all. Same database, ninety seconds apart. |
| 02 | Row-level security | 170 | 5.7 | Authorization belongs in the database, where your code cannot forget to ask. |
| 03 | One definition | 210 | 7.0 | And it is generated from your collection file — the same file that defines everything else. |
| 04 | Forty endpoints | 270 | 9.0 | REST over every table, an OpenAPI spec, a typed SDK. None of them written, all of them following that file. |
| 05 | Headline | 150 | 5.0 | A backend for Postgres — one you run, or a new one. |
| 06 | Headless | 175 | 5.8 | Take only that: the SDK, auth, storage, functions, cron, backups. |
| 07 | The wire | 240 | 8.0 | Realtime too. Every write reaches the clients your policies allow to see it. |
| 08 | The panel | 280 | 9.3 | Or add the panel, and the same definition becomes an application for everyone who is not a developer. |
| 09 | Every view | 240 | 8.0 | Lists, boards, tables, forms — every one generated, every one reading through the same policies. |
| 10 | Studio | 175 | 5.8 | Add Studio and you run the database from the same app. |
| 11 | The schema | 260 | 8.7 | It draws the schema out of the catalogue, so what you are looking at is what is actually there. |
| 12 | Access is not a switch | 240 | 8.0 | Per collection, per operation, per role — and Postgres, not your code, is what enforces it. |
| 13 | The same query, twice | 240 | 8.0 | The same call, from two people, returning different rows. No branch anywhere in your code. |
| 14 | The proof | 200 | 6.7 | And rls-check will tell you the same about any Postgres, including one we have never seen. |
| 15 | Agent-native | 165 | 5.5 | An agent gets the same authorization you do. Not a way around it. |
| 16 | One command | 205 | 6.8 | All of it starts with one command, against a database you have or one it creates. |
| 17 | Yours | 175 | 5.8 | MIT, end to end. Your laptop, your server, your cloud. Nobody holds your keys. |
| 18 | The ask | 160 | 5.3 | Rebase. Open source, Postgres-native, self-hosted. |

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
