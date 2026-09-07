# Rebase in 100 seconds — voice-over script

**Read fast — 8.5 frames a word, about 200 words a minute — and dry.** It's
2026, you're talking to one person, and you are not impressed by any of it.
Present tense. Blunt. The jokes are flat, not performed: "not an if-statement
you wrote at 2 AM" is said exactly like the sentence before it.

**No dead air.** The gaps between lines are half a second at most. The
pictures run under the words; you do not wait for them. The one exception is
"and it finds nothing" — the green line prints five frames before you say
"nothing", and it should feel like you saw it.

**It opens on you, already talking.** No logo, no pause. You are on screen
from the first frame and the first word is half a second in.

**Every line is still a sentence.** "Zero findings." would have been on brand
and is not one.

Total: **3000 frames = 100.0 seconds** at 30fps · 324 words · 194 words a
minute over the whole run, silences included.

## The script

| # | Beat | Starts | Words | Line | Gap after |
|---|------|--------|-------|------|-----------|
| 01 | You, to camera | 0.5s | 24 | It's 2026. Anyone can build a backend in an afternoon. You don't even need to know what one is. But can you trust it? | 0.6s |
| 02 | The evidence | 7.9s | 27 | This one was vibe-coded by an agent in an afternoon. It works. And a ten-second scan found three holes, including a customers table that anyone can read. | 1.0s |
| 03 | Point Rebase at it | 16.5s | 28 | So you point Rebase at that same database. It reads the tables that are already there and writes a TypeScript file for each one. That's the whole setup. | 0.4s |
| 04 | The rule | 24.9s | 40 | Access rules go in that same file. This one says customers can only see their own orders. And it doesn't compile into middleware you might forget to call. It compiles into a Postgres row-level security policy. The database enforces it. | 0.7s |
| 05 | Push, and the same scan | 36.9s | 14 | You push it, you run the exact same scan again, and it finds nothing. | 0.5s |
| 06 | Run it | 41.3s | 4 | Then you run it. | 1.3s — the terminal prints the ports |
| 07 | Two people | 43.8s | 38 | Robert is a customer, so he gets his own orders. Dana works in support, so she gets all of them. It's the same query. The database decides who gets what, not an if-statement you wrote at 2 AM. | 0.4s |
| 08 | The agent | 55.0s | 30 | And an agent works the exact same way. It gets a key with permissions on it, and it cannot get around them. The database doesn't care how nicely you ask. | 0.4s |
| 09 | The panel | 63.9s | 30 | Your team also gets an admin panel, generated from the same files, with the same rules applied. Nobody had to build a CRUD app on top of the CRUD app. | 0.4s |
| 10 | Every view | 72.8s | 12 | Every collection gets boards, tables, cards and forms, straight from its schema. | 0.3s |
| 11 | The schema | 76.4s | 15 | The schema view is read from the live database, so it can't lie to you. | 0.3s |
| 12 | Studio | 80.9s | 12 | And you can work on the database itself from the same app. | 0.1s |
| 13 | The whole desk | 84.4s | 50 | So that was three commands. It's open source, MIT licensed, and you can run it on your laptop, on your own servers, or on any cloud that can run a container. The scan works on any Postgres, so go run it on your own database, ideally before somebody else does. | — |

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
