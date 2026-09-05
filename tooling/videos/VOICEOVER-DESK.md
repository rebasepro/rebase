# Rebase intro — the desk cut — voice-over script

Read at **164 words per minute** (11 frames a word at 30fps). A brisk
conversational pace, not an announcer's — it was 180 and played a shade fast.

**One story, one desk.** There are no cuts. The camera moves across one
workspace and the windows appear where the story needs them. The backend in
the first line is the backend that gets fixed; "the same scan" in the fourth
line is the scan from the first, re-run in the same window. Every line follows
the camera: it starts a few frames before the move so the words are already
going when the picture arrives.

Total: **2578 frames = 85.9 seconds** at 30fps · 203 words · speech is 87% of
the running time. Two real pauses: after the problem lands, and after the panel.
The last line runs into the address.

## The script

| # | Beat | Starts | Words | Line | Join |
|---|------|--------|-------|------|------|
| 00 | Cold open | 0.0s | — | *(silent — the mark assembles)* | — |
| 01 | The hook | 3.2s | 19 | This backend was built by an agent in an afternoon. It works. A ten-second scan found three ways in. | 1.9s **pause** |
| 02 | The rule | 12.0s | 26 | That's what Rebase is for. You describe your data once, and every rule about who sees what is enforced by Postgres — not by your code. | 0.7s beat |
| 03 | Push, and the same scan | 22.2s | 24 | Push it, and run the same scan again. Fifteen checks, nothing found. It's free, it works on any Postgres, and nothing leaves your machine. | 0.1s flow |
| 04 | Two people | 31.2s | 23 | The same request, from two different people, gets two different answers. Robert sees his own orders. Dana, on support, sees all of them. | 0.2s flow |
| 05 | The agent | 39.8s | 16 | An agent gets your permissions, and no way around them. Same rules, same database, same answer. | 1.2s beat |
| 06 | The panel | 46.9s | 22 | And your team gets a real admin panel — on the same data, the same rules. Nobody built these views by hand. | 1.5s **pause** |
| 07 | Every view | 56.5s | 10 | Boards, tables, cards, forms — every view, from your data. | 0.1s flow |
| 08 | The schema | 60.3s | 12 | The schema, read from the running database — never out of date. | 0.1s flow |
| 09 | Studio | 64.8s | 8 | And a database workspace, in the same app. | 0.6s beat |
| 10 | Three commands | 68.3s | 16 | Three commands, and it's running on your own machine. No account, nothing to sign up for. | 0.7s beat |
| 11 | The whole desk | 74.8s | 27 | Open source. Runs anywhere — your laptop, your servers, any cloud. Nobody else holds your data. So build it by lunch. This time, you'll know it's safe. | — |

## Recording notes

- The prompter in `RebaseDesk-VO` lights each word as it should be spoken and
  shows the line **36 frames early**, so you can read ahead rather than
  sight-read.
- A line that starts before the camera has arrived is deliberate. Do not wait
  for the picture.
- "The same scan" means it: the window from the opening re-runs, same
  command, same database. Say it like something you watched happen.
- The three tour lines (every view, the schema, Studio) are one breath split
  three ways. Do not stop between them.
- Numbers in the script are checked against the repo, not rounded for the
  read. "Fifteen checks" is rls-check's own count; "nothing found" is its own
  green line.
- No line refers to Rebase Cloud. "Any cloud" means the viewer's own.
- The timeline is the original 78-second sheet stretched by `TEMPO` (1.1) in
  `src/desk/beats.ts`. To slow it again, change one number; the beats, the
  moves and these frames all follow.
