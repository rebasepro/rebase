# Rebase in 100 seconds — voice-over script

**Friendly and professional.** One engineer showing another something they
built. Brisk, warm, present tense, second person. Nothing at anyone's
expense — no jabs at the viewer, no jokes about their code. The register of
a good conference demo.

**About 200 words a minute, no dead air.** Nine frames a word, gaps of half
a second or so. The pictures run under the words; you do not wait for them.
The one exception is "and it finds nothing" — the green line prints just
before you say "nothing", and it should feel like you saw it.

**It opens on you, already talking.** No logo, no pause. You are on screen
from the first frame and the first word is half a second in.

**Every line is a sentence.** A subject, a verb, and the thing the verb is
about. Nothing here needs a second reading to parse.

Total: **3000 frames = 100.0 seconds** at 30fps · 302 words · 181 words a
minute over the whole run, silences included.

## The script

| # | Beat | Starts | Words | Line | Gap after |
|---|------|--------|-------|------|-----------|
| 01 | You, to camera | 0.5s | 15 | It's 2026. Anyone can build a backend in an afternoon. But can you trust it? | 0.6s |
| 02 | The evidence | 5.6s | 34 | A coding agent built this one. It says it's done: auth, CRUD for nine tables, a REST API, deployed. And a ten-second scan of the same database finds two critical issues and one high. | 0.7s |
| 03 | Point Rebase at it | 16.5s | 28 | So you point Rebase at that same database. It reads the tables that are already there and writes a TypeScript file for each one. That's the whole setup. | 0.5s |
| 04 | The rule | 25.4s | 35 | Access rules go in that same file. This one says customers can only see their own orders. It doesn't compile into middleware. It compiles into a Postgres row-level security policy, and the database enforces it. | 0.7s |
| 05 | Push, and the same scan | 36.6s | 14 | You push it, you run the exact same scan again, and it finds nothing. | 0.6s |
| 06 | Run it | 41.4s | 4 | Then you run it. | 1.5s — the terminal prints the ports |
| 07 | Two people | 44.1s | 34 | Robert is a customer, so he gets his own orders. Dana works in support, so she gets all of them. It's the same query. The database decides who gets what, not your application code. | 0.5s |
| 08 | The agent | 54.8s | 30 | And an agent works the same way. It gets a key with permissions on it, and it cannot get around them. The rules hold no matter what the prompt says. | 0.5s |
| 09 | The panel | 64.4s | 25 | Your team also gets an admin panel. It is generated from the same files, with the same rules applied, and nobody had to build it. | 0.7s — the montage plays |
| 10 | Every view | 72.5s | 12 | Every collection gets boards, tables, cards and forms, straight from its schema. | 0.4s |
| 11 | The schema | 76.5s | 14 | The schema view is read from the live database, so it is always current. | 0.4s |
| 12 | Studio | 81.1s | 12 | And you can work on the database itself from the same app. | 0.4s |
| 13 | The whole desk | 85.1s | 45 | So that was three commands. It's open source, MIT licensed, and you can run it on your laptop, on your own servers, or on any cloud that can run a container. The scan works on any Postgres database, so it's a good place to start. | — |

## The presenter

You are on screen. Three places, one video element (`src/desk/Presenter.tsx`):

- **Open** — large and centred over the ribbon, from the first frame, for
  the question. Then the window flies to the corner while the evidence
  arrives behind it.
- **Corner** — a 260px rounded square, bottom right, for the whole demo.
  Every desk composition keeps that corner clear of text.
- **Close** — you grow out of the corner into the left column as the desk
  recedes; the address lands beside you. The last line is to camera.

**At "it finds nothing", look at the scan.** Glance left toward the terminal
as the green line prints, then back to the lens for "Then you run it."

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

## Recording notes

- The prompter lights each word as it should be spoken and shows the line
  **36 frames early**, so you can read ahead rather than sight-read.
- A line that starts before the camera has arrived is deliberate. Do not wait
  for the picture.
- "The exact same scan" means it: the window from the opening re-runs, same
  command, same database.
- The three tour lines (every view, the schema, Studio) are one breath split
  three ways. Do not stop between them.
- Every terminal line is what the tools print. MIT, three commands, nine
  tables, three findings and the container image are all checked against
  the repo.
- No line refers to Rebase Cloud. "Any cloud" means the viewer's own.
- `TEMPO` in `src/desk/beats.ts` stretches the whole sheet — beats, moves and
  the narration's frames alike. It is 1 now. To slow it, change one number.
