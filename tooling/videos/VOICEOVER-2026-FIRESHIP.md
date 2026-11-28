# The 2026 series, in a Fireship pace — proposed scripts

The eleven films in `src/series/v2`, rewritten for pace and directness. **Not
wired into the films yet**: each film still reads its own `SCRIPT`. To adopt one,
paste its `lines([...])` over the film's `SCRIPT` and run `pnpm lint:film <id>`.

What stays fixed:

- **Line ids.** Every film times its cues off the hook's end and the close line
  (`toCorner`, `close`), so a rewritten line with the same id drops straight in.
- **Claims.** No new facts. Every claim is one the current script already makes,
  and each film's `Proof & Repo Sources` in `VOICEOVER-2026.md` still apply.
- **Length.** About the same word count as today.
- **Lint.** Every script below passes the `lint:film` rules.

## What is taken from Fireship, and what is not

Taken: the structure and the pace. Open on the product or the failure, no
warm-up. Problem before solution. Fast lists of concrete capabilities. A plain
"here's the catch" where there is one. Short sentences between long ones. Close
on a one-line verdict.

Not taken: the jokes. This is a serious product for people trusting it with
production data, so no gags, no sarcasm, no memes. A number beats an adjective.

---

## 00 · `intro`

```ts
const SCRIPT = lines([
    ["hook", "A coding agent builds your backend in twenty minutes, and it ships with every table wide open."],
    ["problem", "That happens all the time now: writing the code got fast, and trusting it in production stayed hard."],
    ["schema", "Rebase, an open source backend for Postgres, puts security inside the database, so there is nothing to forget."],
    ["panel", "One definition gives you a typed REST API, realtime, auth, storage, functions, and an admin panel on day one, Rebase CMS for your team and Studio for developers, with every click obeying row-level security."],
    ["agents", "Agents are first-class callers. They get scoped keys, their writes are staged for human approval, and the real admin table even opens inside Claude, where nothing saves until you confirm."],
    ["cloud", "MIT licensed, it self-hosts on any Postgres you already have. But here's the catch: Rebase Cloud is in private beta, so you request access. We run the exact same image on dedicated hardware, no per-seat pricing, clean exit anytime."],
    ["close", "Fast was solved; trust is the product. Start free, or request Cloud access, at rebase dot pro."],
]);
```

## 01 · `claim`

```ts
const SCRIPT = lines([
    ["hook", "My coding agent just deployed a production backend, and I haven't created an account yet."],
    ["run", "One Rebase Cloud command spins up Postgres, pushes the schema, and puts the API on a real public address."],
    ["locked", "Until a human claims the project, mail ports remain shut, secrets stay hidden, and the whole stack deletes itself after seventy-two hours."],
    ["handover", "When the app works, my agent hands me a single-use link. I click it, and the backend moves into my org."],
    ["rotate", "Claiming revokes the agent's bootstrap token and rotates the service key, with one restart."],
    ["close", "Let agents build at full speed, then take the keys back. Rebase Cloud."],
]);
```

## 02 · `review-queue`

```ts
const SCRIPT = lines([
    ["hook", "Give a support agent write access to your orders table, and one bad prompt means four hundred accidental refunds."],
    ["stage", "With the Rebase review plugin, agents never hold write scopes. Their key can only propose changes."],
    ["hold", "Every insert, update, or delete lands in a staged table that regular users can't see."],
    ["diff", "Your ops team opens the admin panel, reads a cell-level diff of what the agent wants to change, and approves or rejects it."],
    ["apply", "Approved edits run in one Postgres transaction, under the reviewer's own row-level security."],
    ["close", "Agents do the legwork, people make the call. Self-hosted Rebase or Rebase Cloud."],
]);
```

## 03 · `claude-panel`

```ts
const SCRIPT = lines([
    ["hook", "Internal dashboards: teams vibe-code dozens of them, and they break the next time somebody renames a column."],
    ["blind", "Meanwhile, AI assistants edit production rows blind, in plain text."],
    ["open", "Connect Rebase to Claude, ask for your orders, and your real admin table opens inside the chat, with live search, filters, and forms."],
    ["app", "Need a custom view? Ask Claude to build an interactive app over those records and run it right there."],
    ["confirm", "Every edit, deploy, rollback, or cron trigger shows the exact plan first and waits for your click, signed in as your own account."],
    ["close", "Use it on Rebase Cloud from a laptop or a phone, or link any self-hosted server in seconds."],
]);
```

## 04 · `db-branch`

```ts
const SCRIPT = lines([
    ["hook", "Before an agent runs a risky migration or backfills ten thousand rows, clone the database."],
    ["clone", "One CLI command makes a full copy in under a second, with every table, index, row, and security policy."],
    ["how", "It doesn't copy records one by one. Postgres clones the files on disk through native templates, right after Rebase evicts idle connection pools."],
    ["wild", "Point your coding agent at that copy and let it work. Production never sees it."],
    ["merge", "Then inspect every changed row in the terminal diff, and merge back only the updates that look right."],
    ["close", "Instant database branches, without moving your Postgres to a proprietary vendor."],
]);
```

## 05 · `time-machine`

```ts
const SCRIPT = lines([
    ["hook", "Sooner or later, an agent script with a bad filter deletes the wrong customer records. What matters is whether you can undo it."],
    ["on", "In Rebase, entity history is on out of the box. Every create, update, and delete records what changed, who did it, and what was there before."],
    ["privacy", "Reading that audit trail checks the exact policy protecting the record, and never leaks columns from related tables."],
    ["cli", "Open a terminal, pull the timeline for the broken order, and compare every version in seconds."],
    ["revert", "One revert command writes the previous values back through the API, with hooks and permissions intact."],
    ["close", "Mistakes happen faster with agents. Ship a backend with undo built in."],
]);
```

## 06 · `rls-simulate`

```ts
const SCRIPT = lines([
    ["hook", "Almost nobody tests row-level security across five roles and fifteen tables, because doing it by hand takes days."],
    ["guess", "So teams eyeball the SQL, push to production, and hope one buyer can't read someone else's invoices."],
    ["sim", "With Rebase, run the simulator from the terminal, or turn on Simulate Access inside Studio."],
    ["matrix", "Pick any person, role, or scoped agent key, and see, across every table, what Postgres serves and what comes back forbidden."],
    ["loop", "Before you deploy, the verifier also catches policies that reference each other in a loop, which would otherwise crash with infinite recursion."],
    ["close", "Stop guessing what your rules allow. Prove it before launch."],
]);
```

## 07 · `leave-supabase`

```ts
const SCRIPT = lines([
    ["hook", "Move off Supabase by hand, and the first migration fails on proprietary auth functions before a single table loads."],
    ["why", "Your schema is tangled up with custom Postgres roles, UUID user links, and service-role shortcuts."],
    ["cmd", "Point the Rebase schema introspector at your live Supabase connection string. It takes one flag."],
    ["translate", "It rewrites user defaults into server hooks, turns authenticated and anon rules into clean policies, and drops the service-role backdoors."],
    ["honest", "Here's the catch: triggers, custom SQL functions, and check constraints aren't translated. They're saved to a file you can run directly on Rebase Cloud."],
    ["close", "Every user ID carries over, the stack is yours, and lock-in stays behind."],
]);
```

## 08 · `safe-previews`

```ts
const SCRIPT = lines([
    ["hook", "When four coding agents open backend pull requests before lunch, a shared staging server stops being safe."],
    ["deploy", "On Rebase Cloud, pass a preview name when you deploy, and that branch gets its own live address in seconds."],
    ["isolated", "Each preview boots in an isolated pod on a fresh, empty Postgres, with a separate service key."],
    ["why", "Production tables stay untouched, live security policies never get overwritten, and scheduled jobs can't fire against real users."],
    ["guard", "Even the upload route fails safe: hit an older control plane by mistake, and it returns four-oh-four instead of touching live traffic."],
    ["close", "Ship ten agent branches at once, and keep production out of it. Rebase Cloud."],
]);
```

## 09 · `one-cli`

```ts
const SCRIPT = lines([
    ["hook", "Agents are fast in a terminal, until a piped script misreads a flag and deletes production."],
    ["reach", "The Rebase CLI drives your whole running app: query rows as JSON or CSV, tail logs, run crons, upload files, or run remote SQL."],
    ["proxy", "Target any Cloud project by slug, and requests go through the Studio proxy, so the live service key never reaches local memory."],
    ["guard", "Pipe a destructive command with no terminal attached, and it stops with confirmation required until you explicitly approve."],
    ["token", "For CI and background bots, mint a ninety-day token scoped to deploys and logs. It can't create keys or overwrite live backups."],
    ["close", "One CLI, for humans at a keyboard and agents in a shell."],
]);
```

## 10 · `honest-cloud`

```ts
const SCRIPT = lines([
    ["hook", "Two habits in cloud pricing need to end: thirty dollars a seat for an admin panel, and reserved compute on databases that can't reserve anything."],
    ["physics", "Postgres has no per-tenant CPU quotas, so a shared cluster can't guarantee you anything. On Rebase Cloud, every project gets a dedicated engine."],
    ["dials", "Set three dials for app, database, and storage, read the itemized price, and invite fifty teammates to Rebase CMS at no extra cost."],
    ["signin", "Owners click Open CMS in the console and land in their panel already signed in, with no bootstrap passwords to set up."],
    ["region", "Put an app in Germany and an external Postgres in Belgium, and the form warns you about latency and double egress up front."],
    ["close", "Because Cloud runs our exact MIT image, a standard dump plus eject moves everything onto your own server the same day."],
]);
```
