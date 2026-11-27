# The 2026 series, in a Fireship tone — proposed scripts

The eleven films in `src/series/v2`, rewritten for tone only. **Not wired into
the films yet**: each film still reads its own `SCRIPT`. To adopt one, paste its
`lines([...])` over the film's `SCRIPT` and run `pnpm lint:film <id>`.

What stays fixed:

- **Line ids.** Every film times its cues off the hook's end and the close line
  (`toCorner`, `close`), so a rewritten line with the same id drops straight in.
- **Claims.** No new facts. Every claim is one the current script already makes,
  and each film's `Proof & Repo Sources` in `VOICEOVER-2026.md` still apply.
- **Length.** About the same word count as today, so scene lengths barely move.
- **Lint.** Every script below passes the `lint:film` rules: banned phrases,
  repeat-word, repeat-run, same-start.

## The tone, in rules

Taken from the transcripts of fourteen Fireship episodes ("in 100 Seconds" and
"The Code Report"). Only the patterns are kept; no lines are copied.

1. **Open on the noun or the disaster.** Either "Thing: what it is" or a flat,
   concrete worst case. No greeting, no "in this video".
2. **Deadpan, not excited.** State absurd things flatly. No exclamation marks,
   no hype words. A number beats an adjective.
3. **One joke per three or four facts, riding on a fact.** The joke is a tag at
   the end of an informative sentence ("…which is a bold security model").
   It never carries a line on its own.
4. **Then the catch.** After the praise comes a limit, stated plainly ("Now the
   catch:"). It makes the rest believable.
5. **Rhythm.** Long sentences built on commas, broken up every few lines by a
   three-to-six word punch ("Trust, but rotate.").
6. **Second person and confessions.** "You" for the viewer, "I" for small
   admissions. Punch at yourself or at the situation, never at the viewer or a
   competitor's users.
7. **Close on a verdict.** A short aphorism plus the product name. One call to
   action at most.

What to avoid: the show's own catchphrases (a timed-sign-off that isn't timed is
an imitation), a meme in every line, and explaining a joke.

---

## 00 · `intro`

```ts
const SCRIPT = lines([
    ["hook", "Rebase, an open source backend for Postgres, built for a year when a coding agent writes your API in twenty minutes and nobody trusts it in production."],
    ["problem", "Agents optimize for green tests, not locked doors. Audit a typical agent-built database, and half the tables are wide open, which is a bold security model."],
    ["schema", "So the access rules live in Postgres itself, not in middleware you forget to call at two in the morning. Declare each table and its policies once in TypeScript, push, and the engine enforces them on every single query."],
    ["panel", "From those same files you get a typed REST API, realtime, auth, storage, functions, and a full admin panel on day one. Your team gets Rebase CMS, developers get Studio, and every click still obeys row-level security, even your manager's."],
    ["agents", "Agents touch live data now, so they're treated as first-class callers. Give one a scoped key, stage its writes for human approval, or open the real admin table inside Claude, where nothing saves until you confirm."],
    ["cloud", "It's MIT licensed, so self-host it on any Postgres you already run. Want zero ops? Rebase Cloud runs that exact image on dedicated hardware, with no per-seat tax and an exit door that actually opens."],
    ["close", "Keep your database, let the agents type, and stop hand-building the back office. Start free, or request Cloud access at rebase dot pro."],
]);
```

## 01 · `claim`

```ts
const SCRIPT = lines([
    ["hook", "My coding agent just shipped a production backend, and I still don't have an account. That's either the future or a lawsuit."],
    ["run", "One Rebase Cloud command spins up Postgres, pushes the schema, and puts the API on a real public address."],
    ["locked", "Here's the catch: until a human claims the project, mail ports remain shut, secrets stay hidden, and the whole stack self-destructs after seventy-two hours, like a spy gadget with a database attached."],
    ["handover", "When the app works, my agent hands me a single-use link. I click it, and the backend moves into my org."],
    ["rotate", "Claiming also revokes the agent's bootstrap token and rotates the service key behind its back, with exactly one restart. Trust, but rotate."],
    ["close", "Let agents build at full speed, then take the keys away. Rebase Cloud."],
]);
```

## 02 · `review-queue`

```ts
const SCRIPT = lines([
    ["hook", "Give a support agent write access to your orders table, and you'll wake up to four hundred accidental refunds and a very short meeting."],
    ["stage", "The Rebase review plugin takes that power away. Agents never hold write scopes; their key can only propose changes."],
    ["hold", "Every insert, update, or delete lands in a staged table that regular users can't even see, a waiting room for bad ideas."],
    ["diff", "Your ops team opens the admin panel, reads a cell-level diff of what the bot wants, and clicks approve. Or doesn't."],
    ["apply", "Approved edits run in one Postgres transaction under the reviewer's own row-level security, so nobody approves past their pay grade."],
    ["close", "Agents do the legwork, humans make the call. Self-hosted Rebase or Rebase Cloud."],
]);
```

## 03 · `claude-panel`

```ts
const SCRIPT = lines([
    ["hook", "Internal dashboards: you vibe-code fifty of them, and every last one breaks the next time somebody renames a column."],
    ["blind", "Meanwhile Claude is editing production rows blind, in plain text, and everyone is somehow fine with that."],
    ["open", "Connect Rebase to Claude, ask for your orders, and your real admin table opens inside the chat, with live search, filters, and forms."],
    ["app", "Need a custom view? Ask Claude to sketch an interactive app over those records and run it right there, which takes less time than the meeting about it."],
    ["confirm", "Every edit, deploy, rollback, or cron trigger shows the exact plan first and waits for your click, signed in as you, not as some all-powerful robot."],
    ["close", "Use it on Rebase Cloud from a laptop or a phone, or link any self-hosted server in seconds."],
]);
```

## 04 · `db-branch`

```ts
const SCRIPT = lines([
    ["hook", "Database branches: clone production before an agent runs a risky migration or backfills ten thousand rows."],
    ["clone", "One CLI command makes a full copy in under a second, with every table, index, row, and security policy included."],
    ["how", "It isn't copying records one by one. Postgres clones the files straight on disk through native templates, right after Rebase evicts idle connection pools."],
    ["wild", "Point your coding agent at that copy and let it go feral. Production won't notice, which is more than you can say for whoever is on call."],
    ["merge", "Then inspect every changed row in the terminal diff, and merge back only the updates that look right."],
    ["close", "Instant branches, and your Postgres stays yours. No proprietary vendor required."],
]);
```

## 05 · `time-machine`

```ts
const SCRIPT = lines([
    ["hook", "Statistically, an agent script with a bad filter is going to delete the wrong customers. The only question is whether you can undo it."],
    ["on", "In Rebase, entity history is on out of the box. Every create, update, and delete snapshots what changed, who did it, and what was there before."],
    ["privacy", "Reading that audit trail checks the exact policy guarding the record, so history never leaks columns from related tables."],
    ["cli", "Open a terminal, pull the timeline for the broken order, and compare every version in seconds."],
    ["revert", "Then one revert command writes the old values back through the API, hooks and permissions intact. Control Z, but for Postgres."],
    ["close", "Mistakes happen faster in twenty twenty-six. Ship a backend that can take them back."],
]);
```

## 06 · `rls-simulate`

```ts
const SCRIPT = lines([
    ["hook", "Row-level security: everyone says they test it across five roles and fifteen tables. Nobody does, because by hand it's miserable."],
    ["guess", "So teams eyeball the SQL, push to production, and pray one buyer can't read someone else's invoices."],
    ["sim", "With Rebase, run the simulator from the terminal, or flip on Simulate Access inside Studio."],
    ["matrix", "Pick any person, role, or scoped agent key, and see, across every table, what Postgres serves and what comes back forbidden."],
    ["loop", "Bonus: before you deploy, the verifier catches policies that reference each other in a loop, which would otherwise recurse until your database gives up on life."],
    ["close", "Stop guessing what your rules allow. Prove it before launch."],
]);
```

## 07 · `leave-supabase`

```ts
const SCRIPT = lines([
    ["hook", "Moving off Supabase by hand goes great, right up until the first migration dies on proprietary auth functions before a single table loads."],
    ["why", "Your schema is quietly tangled up with custom Postgres roles, UUID user links, and service-role shortcuts."],
    ["cmd", "Point the Rebase schema introspector at your live Supabase connection string. That's one flag."],
    ["translate", "It rewrites user defaults into server hooks, turns authenticated and anon rules into clean policies, and drops the service-role backdoors."],
    ["honest", "Now the catch: triggers, custom SQL functions, and check constraints aren't translated. They're saved to a file you can run straight on Rebase Cloud."],
    ["close", "Every user ID survives, the stack is yours, and lock-in stays behind."],
]);
```

## 08 · `safe-previews`

```ts
const SCRIPT = lines([
    ["hook", "Four coding agents open backend pull requests before lunch, and your shared staging server becomes a crime scene."],
    ["deploy", "On Rebase Cloud, pass a preview name when you deploy, and that branch gets its own live address in seconds."],
    ["isolated", "Each preview boots in an isolated pod on a fresh, empty Postgres, with a separate service key."],
    ["why", "Production tables stay untouched, live security policies never get overwritten, and scheduled jobs can't fire at real users at three in the morning."],
    ["guard", "Even the upload route is paranoid: hit an older control plane by mistake, and it returns a four-oh-four instead of touching live traffic."],
    ["close", "Ten agent branches at once, zero sweating. Rebase Cloud."],
]);
```

## 09 · `one-cli`

```ts
const SCRIPT = lines([
    ["hook", "Agents are brilliant in a terminal, right up until a piped script misreads a flag and deletes production."],
    ["reach", "The Rebase CLI drives your whole running app: query rows as JSON or CSV, tail logs, run crons, upload files, or fire remote SQL."],
    ["proxy", "Target any Cloud project by slug, and requests go through our Studio proxy, so the live service key never lands in local memory."],
    ["guard", "Pipe a destructive command with no terminal attached, and it stops cold with confirmation required. The robot has to ask."],
    ["token", "For CI and background bots, mint a ninety-day token scoped to deploys and logs. It can't create keys or overwrite live backups, however politely it begs."],
    ["close", "One CLI, for humans at a keyboard and agents in a shell."],
]);
```

## 10 · `honest-cloud`

```ts
const SCRIPT = lines([
    ["hook", "Cloud pricing has two habits that need to die: thirty dollars a seat for an admin panel, and reserved compute on databases that can't reserve anything."],
    ["physics", "Postgres has no per-tenant CPU quotas, so a shared cluster's reservation is basically a vibe. On Rebase Cloud, every project gets its own dedicated engine."],
    ["dials", "Turn three dials, app, database, and storage, read the itemized price, and invite fifty teammates to Rebase CMS for nothing extra."],
    ["signin", "Owners click Open CMS in the console and land in their panel already signed in. No bootstrap password on a sticky note."],
    ["region", "Put an app in Germany and an external Postgres in Belgium, and the form warns you about latency and double egress before you pay for either."],
    ["close", "And because Cloud runs our exact MIT image, a standard dump plus eject puts everything on your own box the same day."],
]);
```
