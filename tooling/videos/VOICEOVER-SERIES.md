# Rebase — the series — voice-over scripts

Ten short films, released one at a time. Each one makes **one** case for
Rebase to a developer choosing a stack in 2026, in under a minute, with you on
camera like the desk film. Every film comes in **two shapes from the same
take**: 16:9 (`Series-<id>`) and 9:16 (`Series-<id>-Tall`, a split screen
with you in the lower half).

**The same voice as the desk film.** One engineer showing another something
real. Friendly, professional, present tense. Every sentence has a subject
and a verb. No slogans, no jabs at anyone, and no "this one". Every film
closes on "Rebase is open source", then one sentence about what you get.

**Every claim is checked against the repo**, and every string on screen is
the product's own: a log line, an error, a generated policy, a command. The
*Proof* line under each script says where it comes from. Where a picture is
an illustration rather than product output (the middleware routes in 02, the
three hand-written files in 05), the source comment in the film says so.

**Rebase Cloud is never mentioned.** "Anywhere a container runs" means the
viewer's own infrastructure.

## Recording

```bash
pnpm live
```

Open http://localhost:3500/?film=typed in Chrome, swapping `typed` for the
film's id below. The **Film** menu on the page switches films too. Everything
else is the desk film's routine (see `VOICEOVER-DESK.md` → *Recording a take*):
Space to start, read at your pace, the film follows your voice, → if the
prompter loses you, Esc to stop. The page saves the take and prints the
render commands, **one for each shape**.

Try a film without a camera first: `?film=<id>&simulate` (or
`&simulate=140` for another pace).

**Pace.** Each script runs 91–111 words. At a natural 130–150 words a minute
that is **42–58 seconds** with the end card. The film waits for you, so a
slower read only makes a longer film. Don't rush to fit a clock.

**Where to look.** You open large in the centre, to camera, for the hook.
Then you move to the corner (16:9) or the lower half (9:16) while the proof
plays. You come back for the last line, which is always to camera.

## Release order

| # | id | Film | Its device |
|---|----|------|------------|
| 01 | `typed` | Typed, end to end | an editor: tabs, a completion list, a red squiggle |
| 02 | `security` | Security lives in the database | the policy on the blue field; three callers, one door |
| 03 | `agents` | Built for agents | a terminal on the deep field: the agent's world is text |
| 04 | `own` | You hold the keys | a ring of five keys along the foot of the frame, filling in |
| 05 | `one-definition` | One definition, every surface | a constellation: one file, six surfaces, one change running out to all |
| 06 | `zero` | Zero to running | one take: a single terminal that never cuts, a counter that stops at two |
| 07 | `realtime` | Realtime that respects your rules | two phones, Robert and Dana, and one new row |
| 08 | `panel` | The panel is optional | a switch, off then on, over a stack that never changes |
| 09 | `backend` | The rest of the backend | the file tree, growing one file a scene |
| 10 | `existing` | Bring the database you have | a read-only beam passing down the tables you already have |

---

## 01 · Typed, end to end — `typed`

| Line | Script |
|------|--------|
| hook | What if your editor knew your database as well as you do? |
| schema | In Rebase, a collection file describes each table once. |
| generate | From it, Rebase writes the types for your client, and keeps them current while you work. |
| query | So your editor checks every query as you write it. |
| typo | A typo is a red line in your editor, not an error in production. |
| server | Your server code gets the same typed API, so the backend and the frontend agree. |
| close | Rebase is open source. Point it at your Postgres, and your types come with it. |

**Proof.** The collection is an excerpt of the CLI template's `posts.ts`. The
generator lines are `rebase generate-sdk`'s own. `rebase dev` regenerates the
types on save. The error is what `tsc` printed against a generated `Database`
(tests/e2e/baas-typecheck): *TS2551: Property 'post' does not exist on type
'TypedDataLayer<Database>'. Did you mean 'posts'?* Server code is typed through
`defineFunction<Database>` and `rebase.dataAsAdmin`.

## 02 · Security lives in the database — `security`

| Line | Script |
|------|--------|
| hook | Most apps keep their access rules in middleware. Miss one check, and the data is open. |
| rule | Rebase puts the rule in the collection, right next to the table it protects. |
| policy | Then it becomes a real Postgres policy, and the database checks it on every request. |
| everyone | Your app, your admin panel and your agents all reach the data through those policies. |
| lock | If a table can't get row-level security, Rebase locks it rather than serve it unprotected. |
| close | Rebase is open source. Your rules live in Postgres, where nobody can forget to call them. |

**Proof.** The rule `{ name: "own_orders", operation: "select", ownerField:
"customer_id" }` and the SQL on screen are exactly what
`generatePostgresPoliciesDdl` printed for it on 2026-10-25: `CREATE POLICY
"own_orders" … USING ((customer_id)::text = (SELECT rebase.uid()))`. Requests
run as the `rebase_user` role, which cannot bypass RLS. The lock line is
PostgresBootstrapper's: *"Its privileges have been revoked from rebase_user,
so the table is unreachable rather than unprotected."* Not claimed: "nothing
bypasses RLS" (`rebase.sql` and migrations do), so the script says "every
request".

## 03 · Built for agents — `agents`

| Line | Script |
|------|--------|
| hook | Your next teammate is an agent. So what is it allowed to touch? |
| mcp | Rebase ships an MCP server. One file connects your agent to your backend, with forty-four tools for data, schema, branches, functions and cron. |
| key | You give it a key that holds exactly what it needs, like reading articles. |
| refuse | When it tries to write, the API refuses, and names the permission it is missing. |
| guard | Its destructive tools refuse to touch a remote backend unless you switch that on. |
| skills | Twenty-three skills teach it how Rebase works, so the code it writes fits your project. |
| close | Rebase is open source. Your agents get the same API and the same rules as everyone else. |

**Proof.** `.mcp.json` as `rebase init` writes it; 44 local tools in
packages/mcp; `rebase api-keys create --scopes data:read:articles`; the 403
`SCOPE_MISSING` body; *Refusing to run "delete_document": … which is not
local.* unless `REBASE_MCP_ALLOW_REMOTE_WRITES=true`; 23 skills in
`@rebasepro/agent-skills`.

## 04 · You hold the keys — `own`

| Line | Script |
|------|--------|
| hook | Before you pick a backend, ask who holds the keys. |
| licence | Rebase is MIT licensed. The code is yours to read, change and run. |
| data | Your data lives in plain Postgres tables, in a database you choose: your own server, Neon, Supabase, RDS or Cloud SQL. |
| run | You can deploy it anywhere a container runs, with guides for AWS, Google Cloud, Azure, Fly, Railway and Hetzner. |
| backup | Backups are standard Postgres dumps: one command takes them, and another restores them. |
| eject | And rebase eject writes the entry point, the Dockerfile and the compose file into your repo. |
| close | No vendor sits between you and your data. Rebase is open source, and the backend is yours. |

**Proof.** MIT licence. The deploy guides in docs/deploy. `rebase build` and
`docker compose up -d`. `rebase db backup` shells out to `pg_dump`; its line
*✓ Backup written to …* and the file name format `rebase-<db>-<stamp>.dump`
are backup-cli.ts's and pg-tools.ts's. `rebase eject` prints the five files
on screen (commands/eject.ts).

## 05 · One definition, every surface — `one-definition`

| Line | Script |
|------|--------|
| hook | How many times have you described the same table? Once for the database, once for the API, and once more for the types. |
| once | With Rebase, you describe it once, in a single TypeScript file. |
| becomes | From it come the Drizzle schema, the REST routes, the OpenAPI spec, the typed SDK and the Postgres policies. |
| panel | If you want one, the same file also renders an admin panel. |
| change | Change a field, and every surface follows, because there is no second model to keep in sync. |
| close | Rebase is open source. You write the table down once, and the rest is generated. |

The repeated "once" in the hook and the close is deliberate.

**Proof.** `pgEnum("orders_status", …)` from `rebase schema generate`; the
route `/api/data/orders`, operationId `listOrders`, and enum values in the
spec (openapi-generator.ts); `status?: "pending" | "shipped"` from
generate-sdk. The policy `FOR SELECT … USING (true)` comes from the rule
`{ operation: "select", access: "public" }`. The policy card says "still
applied" after the change, because adding an enum value does not change it.

## 06 · Zero to running — `zero`

| Line | Script |
|------|--------|
| hook | Here's everything it takes to start a Rebase backend. |
| init | One command creates the project. You pick a template, and it writes the collections for you. |
| agent | It can set up the MCP server and the Rebase skills for your coding agent, too. |
| dev | Then run dev. With no database configured, Rebase runs a development Postgres inside your project. |
| up | There's no Docker, no cloud account and nothing else to install. The API and the admin panel are up. |
| own | When you're ready for your own Postgres, you set one line in the env file. |
| close | Rebase is open source. Two commands, and you're building. |

**Proof.** init's prompts as inquirer prints them once answered
(commands/init.ts, agent-setup.ts); *✓ Project my-app created successfully!*;
the dev server's lines and its ready banner (commands/dev.ts), including
*↳ Database = the managed development database (PGlite)*. The `.env` comment
is the template's own: *DATABASE_URL: unset means the managed database; set
means yours.* The two ports are examples: real ones are derived from the
project path. No speed is claimed.

## 07 · Realtime that respects your rules — `realtime`

| Line | Script |
|------|--------|
| hook | Realtime is easy to demo, and hard to secure. |
| listen | In Rebase, a client listens to a query, and gets new results whenever the data changes. |
| keys | When a row is written, the database announces which row it was, never what's in it. |
| rerun | Then each subscriber's query runs again, as that subscriber, under their own policies. |
| hidden | So a row someone isn't allowed to see never reaches their screen. |
| nothing | The rules are the same Postgres policies as before, so realtime needs no rules of its own. |
| close | Rebase is open source. Live data, under the same rules as every other request. |

**Proof.** The `.where().orderBy().limit().listen()` chain is the client's.
The change trigger sends keys only on `rebase_cdc`. The server re-runs each
subscription's query as its subscriber, debounced, and sends nothing when the
result is unchanged; that is Dana's "no change · nothing sent". Not claimed:
"instant", the WAL. The announcement card on screen is a diagram, not a
payload.

## 08 · The panel is optional — `panel`

| Line | Script |
|------|--------|
| hook | Some projects need an admin panel. Plenty of them never will. |
| headless | So Rebase can start without one. With one flag, you get an API over your database and no UI at all. |
| add | When you do want a panel, it's a React app that sits on top of the same backend. |
| same | Its data goes through the same API as your app, under the same policies. |
| views | It gives you tables, cards, kanban boards, and views you write yourself in React. |
| close | Rebase is open source. Add the panel, or skip it. Your API doesn't change either way. |

**Proof.** `rebase init --headless` and the choice it prints (*Backend only —
headless API over your database. No collections, no UI*); the headless
`rebase.json`; the panel's `<Rebase>` tree; the panel reads through
`client.data` over `/api/data`. The panel also has admin routes, so "only the
public API" is not claimed. The table, cards and kanban tiles are captures of
the demo. `admin.customViews` is the real option, with `key`, `name` and
`Builder`.

## 09 · The rest of the backend — `backend`

| Line | Script |
|------|--------|
| hook | Tables are the easy part of a backend. Then come the endpoints, the scheduled jobs, the queues and the files. |
| function | In Rebase, a function is a file. You drop it in the functions folder, and it becomes an endpoint. |
| cron | A cron job is a file too, with its schedule written right in it. |
| queue | Queues and background jobs run on Postgres, with retries, so there's no Redis to run. |
| storage | File storage is a field on your collection, with local disk, S3 or Google Cloud Storage behind it. |
| close | Rebase is open source. The whole backend lives in one repo, and runs in one process until you choose to split it. |

**Proof.** `backend/functions/hello.ts` is mounted at `/api/functions/hello`
(the template's own). A cron file default-exports `defineCron` (cron-loader.ts),
and the scheduler logs *⏰ Loaded cron job: … in the process's local time)*.
`queue<T>()` is declared in `config/resources.ts`; its jobs are Postgres rows,
and the worker logs *failed on attempt 1/3; retrying*. Storage is a
property's `storage` block. `REBASE_ROLE` splits api, functions and worker
processes.

## 10 · Bring the database you have — `existing`

| Line | Script |
|------|--------|
| hook | You already have a database. Moving it somewhere new is the last thing you want. |
| point | Rebase doesn't ask you to. You point it at the Postgres you have, and it maps the schema. |
| read | Introspection only reads. Your tables and your rows stay exactly where they are. |
| files | Each table becomes a typed collection file in your repo, with its relations included. |
| surface | From those files you get the API, the typed SDK and an admin panel, on the data you already have. |
| close | Rebase is open source. Keep your database, and add the backend. |

**Proof.** `init --database-url … --introspect` and the introspector's lines
(introspect-db.ts): *Connected to database*, *Introspecting schema
'public'...*, *Found 6 tables.*, the role summary, *✓ Introspected 6 tables —
generated 5 collection(s).* It runs SELECTs only. The relation excerpt is the
shape the introspector writes, `kind: "belongsTo"` with a `localKey`. Not
claimed: that the database is never written. `rebase db push` later adds
the rebase schema and policies, so the script says only that introspection
reads.

---

## Previews and checks

- Stills of every scene in both shapes: `out/series-stills/`.
- Preview renders with the placeholder presenter at the authored pace:
  `out/series-preview/`. The authored pace is 200 words a minute, so the
  previews run 30–40 seconds. A real read is slower, and the film stretches
  to fit it.
- `pnpm exec tsx scripts/lint-series.ts` prints every script and flags a
  content word said twice within twelve words.
