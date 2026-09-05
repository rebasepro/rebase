# Rebase intro — the desk cut — voice-over script

Read at **164 words per minute** (11 frames a word at 30fps). A brisk
conversational pace, not an announcer's.

**One story, one desk, in the order it happens.** There are no cuts. The
camera moves across one workspace and the windows appear where the story
needs them. Every line is caused by the one before: the scan finds three
ways in, so you point Rebase at the same database; it writes a file per
table, so the rule goes in that file; you push it, so the same scan comes
back clean; you run it, so the API answers Robert, Dana and an agent, and the
panel is on the other port. "Three commands" at the end is a count of what
you watched.

Every line follows the camera: it starts a few frames before the move so the
words are already going when the picture arrives.

Total: **2633 frames = 87.8 seconds** at 30fps · 201 words · speech is
84% of the running time. The climax is the quietest part: two short
lines with the terminal doing the talking between them.

## The script

| # | Beat | Starts | Words | Line | Join |
|---|------|--------|-------|------|------|
| 00 | Cold open | 0.0s | — | *(silent — the mark assembles)* | — |
| 01 | The hook | 3.2s | 20 | This backend was built by an agent in an afternoon. It works. A free ten-second scan found three ways in. | 1.6s **pause** |
| 02 | Point Rebase at it | 12.1s | 19 | So point Rebase at the same database. It reads the tables it finds, and writes a file for each. | 1.0s beat |
| 03 | The rule | 20.0s | 24 | Every rule about who sees what goes in that file — customers see their own orders — and Postgres enforces it, not your code. | 0.1s flow |
| 04 | Push, and the same scan | 29.0s | 10 | Push it, and run the same scan again. Nothing found. | 1.2s beat |
| 05 | Run it | 33.9s | 3 | Then run it. | 2.8s **pause** — the terminal prints the ports |
| 06 | Two people | 37.8s | 23 | The same request, from two different people, gets two different answers. Robert sees his own orders. Dana, on support, sees all of them. | 0.4s flow |
| 07 | The agent | 46.6s | 16 | An agent gets your permissions, and no way around them. Same rules, same database, same answer. | 1.5s **pause** |
| 08 | The panel | 53.9s | 25 | And on the other port, your team gets an admin panel — on the same data, the same rules. Nobody built these views by hand. | 0.4s flow |
| 09 | Every view | 63.5s | 10 | Boards, tables, cards, forms — every view, from your data. | 0.4s flow |
| 10 | The schema | 67.5s | 12 | The schema, read from the running database — never out of date. | 0.1s flow |
| 11 | Studio | 72.0s | 8 | And a database workspace, in the same app. | 1.0s beat |
| 12 | The whole desk | 75.9s | 31 | Three commands. Open source, and it runs anywhere — your laptop, your servers, any cloud. Nobody else holds your data. So build it by lunch. This time, you'll know it's safe. | — |

## Recording notes

- The prompter in `RebaseDesk-VO` lights each word as it should be spoken and
  shows the line **36 frames early**, so you can read ahead rather than
  sight-read.
- A line that starts before the camera has arrived is deliberate. Do not wait
  for the picture.
- "The same scan" means it: the window from the opening re-runs, same
  command, same database. Say it like something you watched happen.
- "Nothing found." is its own sentence. Stop after it; the green line lands
  under the silence.
- The three tour lines (every view, the schema, Studio) are one breath split
  three ways. Do not stop between them.
- Numbers in the script are checked against the repo, not rounded for the
  read. Every terminal line is what the tools print.
- No line refers to Rebase Cloud. "Any cloud" means the viewer's own.
- The timeline is the original sheet stretched by `TEMPO` (1.1) in
  `src/desk/beats.ts`. To slow it again, change one number; the beats, the
  moves and these frames all follow.
