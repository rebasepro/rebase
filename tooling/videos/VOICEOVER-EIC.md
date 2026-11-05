# Rebase — EIC Accelerator video — script and recording

The pitch video for the EIC Accelerator short proposal. Francesco and Marian
on camera together, in English, with burned-in subtitles, under 3:00.
Source: `src/eic/EicFilm.tsx` (composition `EIC`, live page `?film=eic`).

Every figure on screen comes from the application brief: FireCMS 10,000+
projects, MedicalMotion, DearDoc's 100M+ patients, Unfeigned and
SustenTalent, revenue €65k (2025) and €77k (2026 to date), the BaaS market
($8.4B in 2024 to $31.1B in 2030), and the ask (€1.5M grant + €1M equity,
TRL 9 in 24 months). If a number changes, change it in the film too.

## Recording

```bash
pnpm live
```

Open http://localhost:3500/?film=eic in Chrome. Allow the camera and the
microphone and pick them in the two menus. Chrome's speech recognition uses
the *system* input, so make that the same microphone.

- **Sit side by side, one camera, both in frame.** The take of 2026-11-04
  has Francesco on the RIGHT of the picture as a viewer sees it, Marian on
  the left; `SEAT` says so. The page's preview is a mirror, so there it
  looks the other way round. Sit the other way and you flip `SEAT`.
- Fill the frame with the two of you, eyes at the top third. In the corner
  the film crops to whoever is speaking (each half of the frame), so each of
  you should be roughly centred in your half.
- One microphone between you, close. The take's audio is the narration.
- **Space** starts. The prompter shows whose line comes next
  (FRANCESCO yellow, MARIAN cyan, BOTH pink). Read the words exactly as
  written: the subtitles are the script, so a changed word makes the
  subtitles wrong. If the prompter stalls, press **→** at the end of the line.
  **Esc** stops, **R** throws the take away.
- **Pace.** About 140 words a minute. Keep the handoffs short. The REC clock
  should read about 2:45 or less at "Thank you" (the 2026-11-04 read of the
  previous 278 words took 2:03). Over 2:55 is too long, so record it again a
  little faster.

When the take stops, the page measures it and prints a render command. Use
this one instead (1080p, small file, AAC):

```bash
pnpm exec remotion render src/index.ts EIC out/REBASE_EIC_Video.mp4 --props=takes/<take-id>/props.json --timeout=120000 --crf=20
```

Then master the sound: the take is recorded raw, room and all.
`scripts/master-audio.sh` removes rumble and room noise, and brings it to
-16 LUFS with peaks under -1 dBTP; the picture is copied untouched. The last
number is the start of one second with nobody speaking (1:18.6 in the take of
2026-11-04: the pause after "…admin panel and AI agents"):

```bash
scripts/master-audio.sh out/REBASE_EIC_Video.mp4 out/REBASE_EIC_Video-mastered.mp4 78.6
```

Last, the music: a quiet bed of piano and strings (no lyrics, as the call
asks), composed on the launch films' engine and ducked under the voices.

```bash
node scripts/compose-eic-bed.mjs
scripts/mix-bed.sh out/REBASE_EIC_Video-mastered.mp4 out/REBASE_EIC_Video-final.mp4
```

## The script

| Line | Who | Script |
|------|-----|--------|
| intro | Francesco | Hi, I'm Francesco Gatti, co-founder and CEO of Rebase. |
| marian | Marian | And I'm Marian Moldovan, co-founder and CTO. |
| firecms | Francesco | Together we created FireCMS, an open-source CMS used in over ten thousand projects. |
| health | Marian | Between us, we've built the technology behind a certified medical device, and a healthcare platform serving a hundred million patients. |
| missing | Francesco | Today we're building something Europe is missing: its own Supabase or Firebase. |
| baas | Francesco | A backend-as-a-service is everything behind an app: the database, APIs, logins and file storage, ready to use, so teams build the product, not the plumbing. |
| leak | Francesco | And most backends leak the same way. |
| paths | Francesco | Access rules live in application code, so cron jobs, scripts, dashboards and AI agents go straight around them. |
| forgotten | Francesco | One forgotten check exposes every customer's data. And the leading platforms are American. |
| schema | Marian | With Rebase, you describe your data in one small schema file. |
| generate | Marian | Rebase generates the whole backend: APIs, a typed SDK, realtime, authentication, storage, and an admin panel. |
| breakthrough | Marian | The breakthrough is where security lives. Your rules compile into native Postgres row-level security. |
| every | Marian | The database enforces them on every path: API, jobs, scripts, admin panel and AI agents. |
| policy | Marian | A table without a policy simply isn't served. |
| agents | Marian | Agents edit one verified file, not thousands of lines, and act through scoped keys and human approval. |
| own | Marian | Rebase is open source and runs on your own Postgres: self-hosted, or on Rebase Cloud on European infrastructure. |
| production | Marian | It's already in production: the full backend of a certified medical device, a retail loyalty programme and a marketplace. |
| profitable | Francesco | And we're profitable and bootstrapped. |
| market | Francesco | Backend-as-a-service is heading for thirty billion dollars, and Europe has no leader. |
| scale | Francesco | Now we need to scale: launch Rebase Cloud across Europe, certify it for health, public sector and finance, and build our sales team. |
| eic | Francesco | That's why we're applying to the EIC. |
| help | Marian | Help us build Europe's sovereign backend. |
| thanks | Both | Thank you. |

## What the viewer sees

| Lines | Picture |
|-------|---------|
| intro, marian | both of you, large; a name tag under each |
| firecms – missing | both of you on the left; FireCMS 10,000+, MedicalMotion, 100M+ patients on the right |
| baas | your app on top of one backend-as-a-service block: database, APIs, logins, file storage, admin |
| leak – forgotten | five callers and one database: only the API passes the checks in app code, the rest go around |
| forgotten (end) | Supabase and Firebase, US-based; Europe, no equivalent |
| schema, generate | the collection file, the parts it generates, the admin panel running |
| breakthrough | on blue: the rule and the native Postgres policy it compiles to |
| every, policy | the same five callers, every one through the policy inside the database; a table without one, not served |
| agents | coding agents (one verified file) and runtime agents (scoped key, awaiting review) |
| own | MIT, your own Postgres, Rebase Cloud on Hetzner, OVHcloud and Scaleway |
| production, profitable | MedicalMotion, Unfeigned, SustenTalent; profitable, bootstrapped, revenue |
| market | $8.4B to $31.1B; Supabase and Firebase US-based, no European leader |
| scale | €1.5M grant + €1M equity to TRL 9 in 24 months, and the three steps |
| eic – thanks | both of you, large |
| end | the mark, rebase.pro, FireCMS S.L. · Madrid, Spain |

From "A backend-as-a-service is" to "bootstrapped", the camera sits in the
corner, cropped to whoever is speaking, with their name on it.
