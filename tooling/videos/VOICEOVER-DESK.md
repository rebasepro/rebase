# Rebase intro — the desk cut — voice-over script

Read at **164 words per minute** (11 frames a word at 30fps). Say it the way
you would say it to one person across a desk. Short sentences. "You".

**It opens on you, with a question.** "You can build a backend in an
afternoon now. But can you trust it?" — to camera, before any evidence. Then
the evidence: this one, built by an agent, three ways in. The close answers
the question in the same words.

**One story, one desk, in the order it happens.** There are no cuts. Every
line is caused by the one before: the scan finds three ways in, so you point
Rebase at that same database; it writes a file per table, so the rule goes in
that file; you push it, so the same scan comes back clean; you run it, so the
API answers Robert, Dana and an agent, and your team gets the panel. "Three
commands" at the end is a count of what you watched.

Total: **2831 frames = 94.4 seconds** at 30fps · 210 words · speech is
82% of the running time. The climax is the quietest part: two short
lines with the terminal doing the talking between them.

## The script

| # | Beat | Starts | Words | Line | Join |
|---|------|--------|-------|------|------|
| 00 | Cold open | 0.0s | — | *(silent — the mark assembles)* | — |
| 01 | You, to camera | 3.2s | 14 | You can build a backend in an afternoon now. But can you trust it? | 0.5s beat |
| 02 | The evidence | 8.8s | 17 | This one was built by an agent. It works. A free ten-second scan found three ways in. | 1.5s **pause** |
| 03 | Point Rebase at it | 16.5s | 18 | So you point Rebase at that same database. It reads the tables, and writes one file per table. | 1.3s beat |
| 04 | The rule | 24.4s | 22 | Who can see what goes in that file. Here, customers only see their own orders. And Postgres enforces it, not your code. | 0.9s beat |
| 05 | Push, and the same scan | 33.4s | 10 | Push it, and run the same scan again. Nothing found. | 1.2s beat |
| 06 | Run it | 38.3s | 3 | Then run it. | 2.8s **pause** — the terminal prints the ports |
| 07 | Two people | 42.2s | 23 | The same request, from two different people, gets two different answers. Robert sees his own orders. Dana, on support, sees all of them. | 0.4s flow |
| 08 | The agent | 51.0s | 17 | An agent gets your permissions, and it can't get around them. Same rules, same database, same answer. | 1.1s beat |
| 09 | The panel | 58.3s | 18 | And your team gets an admin panel. Same data, same rules. Nobody built any of this by hand. | 3.0s **pause** — the montage plays |
| 10 | Every view | 67.9s | 10 | Boards, tables, cards, forms. It all comes from your data. | 0.4s flow |
| 11 | The schema | 71.9s | 12 | The schema, straight from the database, so it's never out of date. | 0.1s flow |
| 12 | Studio | 76.4s | 10 | And you can work on the database itself, right there. | 0.2s flow |
| 13 | The whole desk | 80.3s | 36 | That was three commands. It's open source, and it runs anywhere. Your laptop, your servers, any cloud. Nobody else holds your data. So go build it by lunch. This time, you'll know you can trust it. | — |

## The presenter

You are on screen. Three places, one video element (`src/desk/Presenter.tsx`):

- **Open** — large and centred over the ribbon for the question. Then the
  window flies to the corner while the evidence arrives behind it.
- **Corner** — a 260px rounded square, bottom right, for the whole demo.
  Every desk composition keeps that corner clear of text.
- **Close** — you grow out of the corner into the left column as the desk
  recedes; the address lands beside you. The last line is to camera.

**At the climax, look at the scan.** "Push it, and run the same scan again.
Nothing found." — glance left toward the terminal as the green line prints,
then back to the lens for "Then run it." The silence there is yours.

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
- "The same scan" means it: the window from the opening re-runs, same
  command, same database. Say it like something you watched happen.
- "Nothing found." is its own sentence. Stop after it; the green line lands
  under the silence.
- The three tour lines (every view, the schema, Studio) are one breath split
  three ways. Do not stop between them.
- Every terminal line is what the tools print. Numbers are checked against
  the repo, not rounded for the read.
- No line refers to Rebase Cloud. "Any cloud" means the viewer's own.
- The timeline is the original sheet stretched by `TEMPO` (1.1) in
  `src/desk/beats.ts`. To slow it again, change one number; the beats, the
  moves and these frames all follow.
