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
| III · The offer | 05–08 | Take the backend / add the panel — here is all of it — add Studio. |
| IV · Guarantee | 09–11 | Whichever layers you took, RLS holds — provably. |
| V · Ownership | 12–13 | MIT, self-hosted, nobody holds your credentials. |

## The script

| # | Scene | Frames | Sec | Line |
|---|-------|--------|-----|------|
| 00 | Cold open | 96 | 3.2 | *(silent — the mark assembles)* |
| 01 | Headline | 150 | 5.0 | A backend for Postgres — one you run, or a new one. |
| 02 | One command | 205 | 6.8 | One command, and it is running. REST, auth, realtime, storage — read straight from your schema. |
| 03 | The second copy | 325 | 10.8 | You have described that table before. In the schema. Again in your types, a validator, a route, a form. With Rebase there is one. |
| 04 | One definition | 210 | 7.0 | It compiles to a schema, REST routes, an OpenAPI spec, a typed SDK, and policies. |
| 05 | Headless | 200 | 6.7 | Take only that and you are done — a typed SDK, realtime, auth, storage, cron, backups. |
| 06 | The panel | 280 | 9.3 | Or add the panel, and the same definition becomes an application for everyone who is not a developer. |
| 07 | Every view | 240 | 8.0 | Lists, boards, tables, forms — every one generated, every one reading through the same policies. |
| 08 | Studio | 200 | 6.7 | Add Studio and you run the database from the same app — SQL, schema, policies, logs. |
| 09 | Row-level security | 200 | 6.7 | Authorization lives in the database, generated from the same file. You cannot forget middleware nobody wrote. |
| 10 | The proof | 200 | 6.7 | rls-check reads any Postgres — Supabase, Neon, RDS, your own — and reports what is exposed. |
| 11 | Agent-native | 165 | 5.5 | An agent gets the same authorization you do. Not a way around it. |
| 12 | Yours | 175 | 5.8 | MIT, end to end. Your laptop, your server, your cloud. Nobody holds your keys. |
| 13 | The ask | 160 | 5.3 | Rebase. Open source, Postgres-native, self-hosted. |

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
