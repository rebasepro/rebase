# Rebase intro — voice-over script

Read at **180 words per minute** (3 words/second, 10 frames each). That is a
brisk conversational pace, not an announcer's.

**Each line is written to a budget.** The scenes are as long as their content
needs — several are still revealing items two hundred frames in — so the script
is sized to the film rather than the film to the script. A line written shorter
than its budget does not buy a pause; it buys dead air.

The silence that remains is spent deliberately: **three pauses**, at the three
act joins (after the problem lands, after the schema, after the agent). Every
other line starts 24 frames *before* its own cut and carries across it, so the
narrator is not stopping at every edit.

Total: **3671 frames = 122.4 seconds** at 30fps · 312 words · speech is 85% of the running time.

## The script

Every line is plain English on purpose. If a word could mean two things in two
different scenes, it is the wrong word — see the note in `src/vo-script.ts`.

| # | Scene | Starts | Words | Line | Join |
|---|-------|--------|-------|------|------|
| 00 | ColdOpen | 0.0s | — | *(silent — the mark assembles)* | — |
| 01 | Plausible | 4.2s | 19 | An agent built this backend in an afternoon. A ten-second check found two ways anyone could read the data. | 1.9s **pause** |
| 02 | Claim | 12.4s | 19 | So Rebase puts the rules about who sees what inside the database itself, where nothing can get around them. | 0.7s beat |
| 03 | OneDefinition | 19.4s | 23 | You describe your data once, and the API, the code and the security rules all come from it. Change it, all three change. | 0.8s beat |
| 04 | Headline | 27.9s | 17 | It's one install, and it brings you everything you're about to see. Nothing else to set up. | 0.3s flow |
| 05 | Headless | 33.9s | 15 | Logins, file storage, real-time updates, scheduled jobs and backups — all of it already running. | 0.8s beat |
| 06 | Stream | 39.7s | 23 | Real-time updates, so when data changes your app sees it immediately — and only the records that this person is allowed to see. | 0.3s flow |
| 07 | Panel | 47.7s | 29 | And your team gets a real admin panel. It runs on the same data and the same rules as your app, so you never build the same thing twice. | 0.3s flow |
| 08 | Everything | 57.7s | 22 | Boards, tables, cards, forms, filters and search — nobody built these by hand. They come from your data, and they all work. | 0.7s beat |
| 09 | Studio | 65.7s | 15 | Run a query, change a field, or fix a permission, without opening a database tool. | 0.8s beat |
| 10 | SchemaMap | 71.6s | 20 | This diagram is read from the running database, so it is never out of date. Nobody has to update it. | 2.0s **pause** |
| 11 | TwoUsers | 80.2s | 23 | The same request, sent by two different people, returns two completely different sets of records. Neither of them can see the other's data. | 0.3s flow |
| 12 | Proof | 88.2s | 18 | Try it on the database you already use today. It works on any Postgres, anywhere you run it. | 0.7s beat |
| 13 | Agent | 94.9s | 11 | An agent gets your permissions, and it cannot go around them. | 1.8s **pause** |
| 14 | OneCommand | 100.4s | 19 | Three commands and it's running on your own machine. No account to make, and nothing to sign up for. | 0.5s beat |
| 15 | Ownership | 107.2s | 19 | It's open source, it runs on your own machine, and nobody else ever has a copy of your data. | 0.7s beat |
| 16 | Close | 114.2s | 20 | So go and build it by lunch, if you like. The difference is that this time, you'll know it's safe. | — |

## Recording notes

- The prompter in `RebaseIntro-VO` lights each word as it should be spoken and
  shows the line **36 frames early**, so you can read ahead rather than sight-read.
- A line that starts before its cut is deliberate. Do not wait for the picture.
- Numbers in the script are checked against the repo, not rounded for the read.
