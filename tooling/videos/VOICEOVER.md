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
| 01 | Plausible | 126 | 6.8 | An agent built this backend in an afternoon. Ten seconds later, an audit found two ways in. |
| 02 | Claim | 386 | 5.6 | So Rebase keeps authorization down in the database, where nothing can route around it. |
| 03 | OneDefinition | 610 | 6.8 | You describe a collection once, and the API, the SDK and the policies all come from it. |
| 04 | Headline | 909 | 4.8 | It's one package, your own Postgres, and everything you're about to see. |
| 05 | Headless | 1067 | 4.8 | Auth, storage, realtime, functions, cron, backups — all of it already running. |
| 06 | Stream | 1230 | 6.4 | Every write shows up on a socket, filtered by those same policies. You didn't build that. |
| 07 | Panel | 1444 | 6.8 | Your team gets a real admin panel — same data, same API, and nothing rebuilt for them. |
| 08 | Everything | 1705 | 6.8 | Boards, tables, cards, forms, a record open beside them. All of it generated, all of it live. |
| 09 | Studio | 1926 | 4.0 | And you can run the database from right inside it. |
| 10 | SchemaMap | 2139 | 6.4 | Studio reads it straight from the catalogue, so what you're looking at is what's really there. |
| 11 | TwoUsers | 2399 | 5.2 | One call, two people, different rows — and neither can reach the other's. |
| 12 | Proof | 2639 | 4.0 | Try it on whatever you're running today. Ours, or anyone's. |
| 13 | Agent | 2835 | 4.8 | Agents get exactly what you get — there's nothing to talk around. |
| 14 | OneCommand | 3030 | 4.0 | Three commands, no account, and nothing to sign up for. |
| 15 | Ownership | 3235 | 5.6 | It's MIT, end to end, on your own machine. Nobody else holds your keys. |
| 16 | Close | 3445 | 2.8 | Start with the database you've already got. |

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
