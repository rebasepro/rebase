# Rebase — the desk film — voice-over script

**A marketing film, not a tutorial.** The subject of every line is what Rebase
does for you, never what to type. The commands are on screen as proof that it
is three of them, not as steps to follow.

**Exciting because it is concrete.** No slogans, no taglines. The excitement
is in what happens: nine critical findings become a clean scan; one file
becomes an API, an admin panel and a safe place for agents. The last line is
about the product — what you get — not about the scan, which is the hook's
device and not the point.

**Friendly and professional.** One engineer showing another something they
built. Brisk, warm, present tense. Every line is a sentence.

**About 200 words a minute, with room.** Nine frames a word, a breath between
lines, and a beat after every picture — the montages get five to six seconds
each. The one joint that is exact: the green line prints just before you say
"clean", and it should feel like you saw it.

**It opens on you, already talking.** No logo, no pause. You are on screen
from the first frame and the first word is half a second in.

Total: **3130 frames = 104.3 seconds** at 30fps · 294 words · 169 words a
minute over the whole run, silences included.

## The script

| # | Beat | Starts | Words | Line | After |
|---|------|--------|-------|------|-------|
| 01 | You, to camera | 0.5s | 15 | It's 2026. Anyone can build a backend in an afternoon. But can you trust it? | 0.6s |
| 02 | The evidence | 5.6s | 35 | A coding agent built this one. It says it's done: auth, CRUD for nine tables, a REST API, deployed. And a ten-second scan of the same database finds nine critical issues. Every table is open. | 1.5s — the tally sits |
| 03 | What Rebase does | 17.5s | 28 | Rebase starts from the database you already have. One command reads every table and writes a typed collection file for each one. Your schema, as code, in seconds. | 0.6s |
| 04 | The rule | 26.5s | 40 | Access rules live in that file, right next to the table they protect. This one says customers only see their own orders. Rebase compiles it into a Postgres policy, so the database enforces it on every query, from every client. | 0.7s |
| 05 | The same scan | 39.2s | 12 | Push it, run the same scan again, and it comes back clean. | 1.2s — the clean report sits |
| 06 | Run it → two people | 44.0s | 30 | Then run it, and every request is answered by the database itself. Robert sees his own orders. Dana, in support, sees them all. Same query. Postgres decides who sees what. | 1.2s |
| 07 | The agent | 54.2s | 26 | Give an agent a key, and it gets exactly the permissions on that key, and nothing more. The rules hold no matter what the prompt says. | 1.2s |
| 08 | The panel | 63.2s | 24 | And your team gets an admin panel on day one, generated from the same files, with the same rules. Nobody had to build it. | 1.9s — the montage plays |
| 09 | Every view | 72.3s | 13 | Boards, tables, cards and forms: every collection gets the views that fit it. | 2.1s — the bento plays |
| 10 | The schema | 78.3s | 12 | The schema, read live from your database, so it is always current. | 1.9s |
| 11 | Studio | 83.8s | 18 | And a place to work on the database itself: SQL, schema, policies and logs, in the same app. | 0.9s |
| 12 | Close | 90.1s | 41 | Rebase is open source, and runs on your laptop, your own servers or any cloud. Point it at the Postgres you already have, and you get the whole backend: a typed API, an admin panel, and rules the database itself enforces. | — |

## Timing, beat by beat

| Beat | Length | What has to be seen |
|------|--------|---------------------|
| Hook | 17.3s | you; then the agent's session and the scan's tally |
| What Rebase does | 9.0s | the command, nine files, the done line |
| The rule | 12.7s | the file, four lines typed into it, the policy |
| The same scan | 7.2s | push, then the clean report under it |
| Two people | 7.8s | the query, then both panels |
| The agent | 9.0s | the key, the list, the 403 |
| The panel | 9.1s | the montage |
| Every view | 6.0s | the bento |
| The schema | 5.5s | the map |
| Studio | 6.3s | the window and its four labels |
| Close | 14.1s | the whole desk, then you and the address |

## The presenter

You are on screen. Three places, one video element (`src/desk/Presenter.tsx`):

- **Open** — large and centred over the ribbon, from the first frame, for
  the question. Then the window flies to the corner while the evidence
  arrives behind it.
- **Corner** — a 260px rounded square, bottom right, for the whole demo.
  Every desk composition keeps that corner clear of text.
- **Close** — you grow out of the corner into the left column as the desk
  recedes; the address lands beside you. The last line is to camera.

**At "comes back clean", look at the scan.** Glance left toward the report
as the green line prints, then back to the lens for "Then run it".

### Shooting

- 4K, head and shoulders, eyes on the lens; the prompter (`RebaseDesk-VO`)
  on a screen right beside it. One take of the whole film, two or three
  times; pick the best.
- **Do not key it.** A real room, slightly out of focus, on the dark side.
  Plain top, no stripes — they moiré at 260px.
- Your audio is the narration. Record it well (lav or a close mic).

### Dropping the take in

1. Put the file at `public/presenter/take.mp4`.
2. In `src/desk/Presenter.tsx`, set `TAKE = { src: "presenter/take.mp4",
   startFrom: <frames to trim from the head> }`.
3. Do not chase the prompter's frames. Send me the take: I transcribe it with
   word timestamps and derive the beat starts from where each line actually
   begins, so the film fits the read rather than the other way round.

## What is on screen is real

- The scan window prints rls-check 0.18.1's own report, verbatim, captured
  against a database built to the story's shape (`windows/scan-output.ts`).
- The terminal prints lines init, push and dev actually print, with the
  real file list for these nine tables. Lines are left out, never made up.
- The collection file is the head of the one introspection generates; the
  policy is the one `db push` writes to `drizzle/policies.sql`.
- MIT, three commands, nine tables and the container image are checked
  against the repo. No line refers to Rebase Cloud.
- **Open:** the clean report was captured with FORCE ROW LEVEL SECURITY set
  on every table. After `db push` alone, rls-check 0.18.1 reports
  `rls-enabled-not-forced` on every table. That is a product decision, not
  a film one — see the note in `windows/Hook.tsx`.

## Footage and resolution

- Every product clip is shot frame by frame from demo.rebase.pro at **device
  scale factor 2** (`scripts/render-demo.mjs`): the viewports stay small so
  the app lays out densely, and each capture carries four times the pixels
  a 1× capture did. The bento tiles used to be 680×348 at ~100 kb/s, which
  is why they looked soft; they are 1360×696 now, the record tiles
  1200×1256, the full windows 2560×1600.
- The demo carries the current surface system (frame, sheet, card, hairlines,
  tinted chips), and the film's own windows follow the same ladder
  (`SURFACE`, `RADIUS`, `FRAME` in `src/theme.ts`): sheets with an 8%
  hairline, wells for code and terminals, no shadows.
- Render the deliverable at 4K: `remotion render src/index.ts RebaseDesk
  out/rebase-desk-4k.mp4 --scale=2`. A 1080p render throws the reshoot
  away.

`TEMPO` in `src/desk/beats.ts` stretches the whole sheet — beats, moves and
the narration's frames alike. It is 1 now. To slow it, change one number.
