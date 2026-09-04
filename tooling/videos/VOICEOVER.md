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
| 01 | Plausible | 126 | 6.4 | An agent built this backend in an afternoon. Ten seconds of audit found two ways in. |
| 02 | Claim | 386 | 4.8 | Rebase puts authorization in the database, where nothing can route around it. |
| 03 | OneDefinition | 570 | 6.8 | You describe a collection once. The API, the SDK and the policies all come from that file. |
| 04 | Routes | 788 | 4.4 | Every endpoint, an OpenAPI spec, and types that know your columns. |
| 05 | Headline | 1000 | 3.2 | One package, your Postgres, and everything that follows. |
| 06 | Headless | 1166 | 4.0 | Auth, storage, realtime, functions, cron, backups — running, not scaffolded. |
| 07 | Stream | 1385 | 6.0 | Every write arrives on a socket, filtered by the same policies, without a subscription server. |
| 08 | Panel | 1599 | 6.4 | Your team gets a real admin panel. The same data, the same API, nothing duplicated for them. |
| 09 | Everything | 1860 | 5.2 | Boards, tables, cards, forms, a record open beside them. All generated, all live. |
| 10 | Studio | 2081 | 4.4 | And you run the database from inside it. No second tool. |
| 11 | SchemaMap | 2294 | 5.6 | Studio reads the catalogue, so the schema you see is the one that exists. |
| 12 | Matrix | 2546 | 6.0 | Forty answers here, per collection, per role — and one file decides all of them. |
| 13 | TwoUsers | 2794 | 5.2 | One call, two people, different rows. Neither can ask for the other's, ever. |
| 14 | Proof | 3034 | 4.8 | Run it on whatever you are running today. Ours, or anyone's. |
| 15 | Agent | 3230 | 4.4 | Agents get what you get. There is nothing to negotiate with. |
| 16 | OneCommand | 3425 | 5.2 | Three commands. No account, no container to pull, nothing to sign up for. |
| 17 | Ownership | 3630 | 4.8 | MIT, end to end, on your own machine. Nobody holds your keys. |
| 18 | Close | 3805 | 2.8 | Start with the database you already have. |

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
