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
built. Brisk, warm, present tense. Every sentence has a subject and a verb:
no imperative standing in for a sentence ("You push it", not "Push it"),
no list standing in for one, no participle where a verb should be.

**Read at your own pace — the film follows you.** Nothing is timed to a
clock any more. Every beat hangs off a word of the script: the camera moves
when you start a line, and each window waits for its word — the scan's tally
for "nine critical", the clean report for "comes back clean", the 403 for
"nothing more". Pause where a picture needs a moment; it will wait.

**It opens on you, already talking.** No logo, no pause. You are on screen
from the first frame and the first word is half a second in.

The tables below are the **authored** timing — nine frames a word, 3510
frames = 117.0 seconds — which the film falls back on while there is no
take. A take replaces all of it with its own (see *Recording a take*).

## The script

| # | Beat | Starts | Words | Line | After |
|---|------|--------|-------|------|-------|
| 01 | You, to camera | 0.5s | 13 | Anyone can build a backend in an afternoon. But can you trust it? | 0.6s |
| 02 | The evidence | 5.6s | 35 | A coding agent built this one. It says it's done: auth, CRUD for nine tables, a REST API, deployed. And a ten-second scan of the same database finds nine critical issues. Every table is open. | 1.5s — the tally sits |
| 03 | What Rebase does | 17.5s | 28 | Rebase starts from the database you already have. One command reads every table and writes a typed collection file for each one. Your schema becomes code, in seconds. | 0.6s |
| 04 | The rule | 26.5s | 40 | Access rules live in that file, right next to the table they protect. This one says customers only see their own orders. Rebase compiles it into a Postgres policy, so the database enforces it on every query, from every client. | 0.7s |
| 05 | The same scan | 39.7s | 10 | You push it, and the same scan comes back clean. | 1.2s — the clean report sits |
| 06 | Run it → two people | 44.0s | 33 | Then you run it, and every request is answered by the database itself. Robert sees his own orders. Dana, in support, sees them all. It is the same query. Postgres decides who sees what. | 1.2s |
| 07 | The agent | 54.2s | 25 | You give an agent a key, and it gets exactly those permissions, and nothing more. The rules hold no matter what the prompt says. | 1.2s |
| 08 | The panel | 63.2s | 24 | And your team gets an admin panel on day one, generated from the same files, with the same rules. Nobody had to build it. | 1.9s — the montage plays |
| 09 | Every view | 72.3s | 13 | Every collection gets the views that fit it: boards, tables, cards and forms. | 2.1s — the bento plays |
| 10 | The schema | 78.3s | 13 | The schema view shows every table and relation, as your collections declare them. | 1.9s |
| 11 | Studio | 83.8s | 17 | And you can work on the database itself in the same app: SQL, schema, policies and logs. | 0.9s |
| 12 | The wall | 90.1s | 40 | And that's the short version. There's also realtime sync, one isomorphic SDK with the same shape on the server, in the browser and in an agent, a visual collection editor that writes your TypeScript, storage, functions, jobs, search and cron. | 0.4s |
| 13 | Close | 102.8s | 42 | Rebase is open source, and runs on your laptop, your own servers or any cloud. You point it at the Postgres you already have, and you get the whole backend: a typed API, an admin panel, and rules the database itself enforces. | — |

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
| Studio | 6.3s | the SQL editor: a real query run, the rows, a row's related customer opened |
| The wall | 12.7s | twenty-four things the film leaves out, cascading; six of them named |
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

- Head and shoulders, eyes on the lens. The best camera you can plug in as
  a webcam: an iPhone through Continuity Camera beats a laptop's, a camera on
  a capture card beats both. 1080p is plenty — the window is never wider
  than 880 px of a 1080p frame.
- **Do not key it.** A real room, slightly out of focus, on the dark side.
  Plain top, no stripes — they moiré at 260px.
- Your audio is the narration. Record it well (a lav or a close mic). The
  page records it as it is: no gain riding, no noise gate.

## Recording a take — the film follows you

```
pnpm live          # in tooling/videos → http://localhost:3500, open it in Chrome
```

1. **Allow the camera and the microphone**, and pick them in the two menus
   (the page remembers). Chrome's speech recognition listens to the
   *system* microphone, so make that the same one (System Settings → Sound →
   Input).
2. **Frame yourself.** The film under the prompter shows you where the take
   will be: large in the centre, as it opens.
3. **Press Space and read.** The recording starts and the film waits for
   you. The prompter is at the top, under the camera, so you are looking at
   the lens: the word you are on is underlined, the next line is under it.
   The film plays live, following you — you see what the viewer will see
   as you say it.
4. **If the prompter stops following** (a word it cannot make out), press →
   — or a presenter clicker — at the end of the line. The line ends there,
   and the next starts when you next speak.
5. After the last line the take **stops on its own**. Esc stops it any
   time; R throws it away and starts over.
6. The page **saves and measures the take**: each line's start and end are
   snapped to the speech in the recording itself, so the render's timing is
   the recording's, to the frame — the page's live guess only steers the
   search. It shows a report (every line, its words a minute, anything the
   page misjudged) and the command to render it:

   ```
   pnpm exec remotion render src/index.ts RebaseDesk out/rebase-desk-<id>.mp4 \
       --props=takes/<id>/props.json --scale=2 --timeout=120000
   ```

   `pnpm take <id>` measures a take again; `pnpm take` lists them. The
   takes are footage — `takes/` and `public/takes/` are git-ignored.

**Try it without a camera first:** http://localhost:3500/?simulate — a
simulated presenter reads the script at 155 words a minute (`?simulate=180`
for another pace) and you can watch the film follow.

How it works, in the code: `src/desk/timeline.ts` (every beat and cue as a
word of the script, and why a live cue never starts before its word is
heard), `src/live/follow.ts` (keeping place in the script from recognition
and the voice's onsets), `scripts/take.mjs` (measuring the recording).

## What is on screen is real

- The scan window prints rls-check 0.18.1's own report, verbatim, captured
  against a database built to the story's shape (`windows/scan-output.ts`).
- The terminal prints lines init, push and dev actually print, with the
  real file list for these nine tables. Lines are left out, never made up.
- The collection file is the head of the one introspection generates; the
  policy is the one `db push` writes to `drizzle/policies.sql`.
- The wall's twenty-four entries are the docs' own page titles
  (`website/src/content/docs/docs`): nothing on it is a plan.
- Studio's window is a real query in the demo's SQL editor — orders joined to
  their VIP customers — typed, run, and a result row's customer opened from
  the row's action menu. The panel's first two shots are one continuous
  take with no cut between them.
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
- The ribbon runs the site's **loud register** (the home hero's since
  2026-09-10: colour 0.85, saturation 1.2), on a leash: a held slide shows
  it at a beat's own low `reveal`, and it comes up to 0.5 on a sine bump
  across every camera move, when nothing has to be read (`DeskPlane.tsx`).
- Render the deliverable at 4K: `remotion render src/index.ts RebaseDesk
  out/rebase-desk-4k.mp4 --scale=2`. A 1080p render throws the reshoot
  away.

`TEMPO` in `src/desk/beats.ts` stretches the whole sheet — beats, moves and
the narration's frames alike. It is 1 now. To slow it, change one number.
