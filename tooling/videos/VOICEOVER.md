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
| 01 | The problem | 300 | 10.0 | An agent built this backend in an afternoon. Ten seconds of audit found two ways in. |
| 02 | Row-level security | 170 | 5.7 | So put the rules where nothing can route around them. |
| 03 | One definition | 210 | 7.0 | You write the collection once, and the policies come from it. |
| 04 | Forty endpoints | 270 | 9.0 | So does every endpoint, the OpenAPI spec, and a typed SDK that knows your columns. |
| 05 | Headline | 150 | 5.0 | One package, your Postgres, and everything that follows. |
| 06 | Headless | 175 | 5.8 | Auth, storage, realtime, functions, cron, backups — running, not scaffolded. |
| 07 | The wire | 240 | 8.0 | Every write arrives on a socket, filtered by the same policies, without a subscription server. |
| 08 | The panel | 280 | 9.3 | Your team gets a real application — the same data, the same API, nothing duplicated for them. |
| 09 | Every view | 240 | 8.0 | Boards, tables, cards, forms, a record open beside them. All generated, all live. |
| 10 | Studio | 175 | 5.8 | And you run the database from inside it. No second tool. |
| 11 | The schema | 260 | 8.7 | Studio reads the catalogue, so the schema you are looking at is the one that exists. |
| 12 | Access is not a switch | 240 | 8.0 | Forty answers here, per collection, per role — and one file decides all of them. |
| 13 | The same query, twice | 240 | 8.0 | One call, two people, different rows. Neither can ask for the other's, ever. |
| 14 | The proof | 200 | 6.7 | Run it against the database you have now, before you believe us. |
| 15 | Agent-native | 165 | 5.5 | Agents get what you get. There is nothing to negotiate with. |
| 16 | One command | 205 | 6.8 | Three commands. No account, no container to pull, nothing to sign up for. |
| 17 | Yours | 175 | 5.8 | MIT, end to end, on your own machine. Nobody holds your keys. |
| 18 | The ask | 160 | 5.3 | Start with the database you already have. |

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
