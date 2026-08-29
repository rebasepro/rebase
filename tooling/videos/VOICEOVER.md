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
| I · Premise | 00–02 | What Rebase is: a Postgres backend, running in one command. |
| II · Insight | 03–04 | You have written this table five times. Now once. |
| III · The offer | 05–08 | Take the backend / add the panel / add Studio — and here is all of it at once. |
| IV · Guarantee | 09–11 | Whichever layers you took, RLS holds — provably. |
| V · Ownership | 12–13 | MIT, self-hosted, nobody holds your credentials. |

## The script

| # | Scene | Frames | Sec | Line |
|---|-------|--------|-----|------|
| 00 | Cold open | 90 | 3.0 | *(silent — the mark assembles)* |
| 01 | Headline | 200 | 6.7 | Rebase is a backend for Postgres. The one you already run, or a new one. |
| 02 | One command | 240 | 8.0 | One command, and the backend is running — REST, auth, realtime, storage, the lot. It reads the schema and serves it. |
| 03 | The second copy | 330 | 11.0 | But you have described that table before. In the schema. Again in your types. Again in a validator, in your route handlers, in a form. Four of those can drift. |
| 04 | One definition | 280 | 9.3 | With Rebase there is one. It compiles to a Drizzle schema, REST routes, an OpenAPI spec, a typed SDK, and row-level security policies. |
| 05 | Headless | 300 | 10.0 | Take only that and you are done — REST, a typed SDK, realtime, auth, storage, functions, cron, backups. The SDK is generated from your collections, so a collection is a type rather than a string in a path. |
| 06 | The panel | 360 | 12.0 | Or add the panel, and the same definition becomes an application for everyone who is not a developer. Spreadsheet editing, every field type, import, export, and your own React where you need it. |
| 07 | Studio | 270 | 9.0 | Add Studio and you run the database from the same app — SQL, the schema, policies, logs. |
| 08 | Every view | 300 | 10.0 | Lists, boards, tables, forms, a board you drag cards across — every one of them generated, and every one reading through the same policies. |
| 09 | Row-level security | 300 | 10.0 | Whichever layers you took, authorization is in the database. Generated from that same file, applied by migration. You cannot forget middleware that was never in your code. |
| 10 | The proof | 240 | 8.0 | rls-check reads any Postgres — Supabase, Neon, RDS, your own — and reports which tables are actually exposed. |
| 11 | Agent-native | 210 | 7.0 | An agent gets the same authorization you do. Not a way around it. One definition, three audiences. |
| 12 | Yours | 270 | 9.0 | All of it is MIT. Run it on your laptop, your server, your cloud. Nobody else holds your credentials, and nothing here can be taken away. |
| 13 | The ask | 210 | 7.0 | Rebase. Open source, Postgres-native, self-hosted. |

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
