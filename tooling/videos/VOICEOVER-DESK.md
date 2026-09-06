# Rebase intro — the desk cut — voice-over script

Read at **171 words per minute** (10.5 frames a word at 30fps). Say it the way
you would say it to one person across a desk.

**Every line is a sentence** — a subject, a verb, and the thing the verb is
about. Nothing here needs to be read twice to parse.

**It opens on you, with a question.** "You can build a backend in an
afternoon now. But can you trust it?" — to camera, before any evidence. Then
the evidence: an agent built this one, and a scan found three security holes.

**No slogans.** You are explaining what just happened, not selling it. The
last thing said is a practical offer — the scan is free, run it on your own
database — not a tagline.

**One story, one desk, in the order it happens.** There are no cuts. Every
line is caused by the one before: the scan finds three holes, so you point
Rebase at the same database; it writes a file per table, so the rule goes in
that file; you push it, so the same scan finds nothing; you run it, so the
API answers Robert, Dana and an agent, and your team gets the panel. "Three
commands" at the end is a count of what you watched.

Total: **2727 frames = 90.9 seconds** at 30fps · 225 words · speech is
87% of the running time.

## The script

| # | Beat | Starts | Words | Line | Join |
|---|------|--------|-------|------|------|
| 00 | Cold open | 0.0s | — | *(silent — the mark assembles)* | — |
| 01 | You, to camera | 3.1s | 14 | You can build a backend in an afternoon now. But can you trust it? | 0.5s beat |
| 02 | The evidence | 8.5s | 14 | An agent built this one. It works. A ten-second scan found three security holes. | 2.6s **pause** |
| 03 | Point Rebase at it | 15.9s | 20 | So you point Rebase at the same database. It reads the tables and writes one file for each of them. | 0.6s beat |
| 04 | The rule | 23.4s | 25 | The access rules go in that file. This one says customers can only see their own orders. Postgres enforces it. Your code doesn't have to. | 0.1s flow |
| 05 | Push, and the same scan | 32.2s | 13 | You push it, and you run the same scan again. It finds nothing. | 0.2s flow |
| 06 | Run it | 37.0s | 4 | Then you run it. | 2.1s **pause** — the terminal prints the ports |
| 07 | Two people | 40.3s | 25 | Two people send the same request. Robert is a customer, so he sees his own orders. Dana works in support, so she sees every order. | 0.0s flow |
| 08 | The agent | 49.1s | 18 | An agent works the same way. It gets a key with permissions, and it can't get around them. | 0.4s flow |
| 09 | The panel | 55.7s | 19 | Your team also gets an admin panel. It is generated from the same files, so the same rules apply. | 2.6s **pause** — the montage plays |
| 10 | Every view | 64.9s | 11 | Every collection gets its own views: boards, tables, cards and forms. | 0.0s flow |
| 11 | The schema | 68.8s | 13 | The schema is read from the database, so it matches what is there. | 0.0s flow |
| 12 | Studio | 73.3s | 11 | And you can edit the database itself from the same app. | 0.1s flow |
| 13 | The whole desk | 77.2s | 38 | That was three commands. It is open source, and you can run it on your laptop, on your own servers, or on any cloud. If you want to know where your own database stands, the scan is free. | — |

## The presenter

You are on screen. Three places, one video element (`src/desk/Presenter.tsx`):

- **Open** — large and centred over the ribbon for the question. Then the
  window flies to the corner while the evidence arrives behind it.
- **Corner** — a 260px rounded square, bottom right, for the whole demo.
  Every desk composition keeps that corner clear of text.
- **Close** — you grow out of the corner into the left column as the desk
  recedes; the address lands beside you. The last line is to camera.

**At the climax, look at the scan.** "You push it, and you run the same scan
again. It finds nothing." — glance left toward the terminal as the green
line prints, then back to the lens for "Then you run it."

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
- The three tour lines (every view, the schema, Studio) are one breath split
  three ways. Do not stop between them.
- Every terminal line is what the tools print. Numbers are checked against
  the repo, not rounded for the read.
- No line refers to Rebase Cloud. "Any cloud" means the viewer's own.
- The timeline is the original sheet stretched by `TEMPO` (1.05) in
  `src/desk/beats.ts`. To slow it again, change one number; the beats, the
  moves and these frames all follow.
