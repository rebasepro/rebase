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

| # | Scene | Starts | Secs | Line |
|---|-------|--------|------|------|
| 00 | ColdOpen | 0 | 3.2 | *(silent — the mark assembles)* |
| 01 | Plausible | 126 | 7.0 | An agent built this backend in an afternoon. A ten-second check found two ways anyone could read the data. |
| 02 | Claim | 386 | 4.8 | So Rebase keeps the rules about who sees what inside the database itself. |
| 03 | OneDefinition | 610 | 6.6 | You describe your data once, and the API, the code and the security rules all come from it. |
| 04 | Headline | 909 | 4.4 | It's one install, your own Postgres, and everything you're about to see. |
| 05 | Headless | 1055 | 4.0 | Logins, file storage, live updates, scheduled jobs, backups — already running. |
| 06 | Stream | 1230 | 5.9 | When data changes your app hears about it instantly, and only what that person may see. |
| 07 | Panel | 1444 | 6.6 | Your team gets a real admin panel, on the same data and the same rules. Nothing built twice. |
| 08 | Everything | 1705 | 5.9 | Boards, tables, cards, forms, filters and search — all of it generated, all of it live. |
| 09 | Studio | 1926 | 4.4 | And you can query the database and change the schema right here. |
| 10 | SchemaMap | 2139 | 5.9 | This diagram is read from the live database, so it can never be out of date. |
| 11 | TwoUsers | 2399 | 5.1 | The same request, from two people, returns different rows. Neither can see the other's. |
| 12 | Proof | 2639 | 4.8 | Try it on the database you use today. It works on any Postgres. |
| 13 | Agent | 2835 | 4.0 | An agent gets your permissions, and it can't argue past them. |
| 14 | OneCommand | 3030 | 3.7 | Three commands, no account, and nothing to sign up for. |
| 15 | Ownership | 3235 | 5.1 | It's open source, it runs on your machine, and nobody else has your password. |
| 16 | Close | 3445 | 5.5 | So build it by lunch if you like. The difference is you'll know it's safe. |

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
