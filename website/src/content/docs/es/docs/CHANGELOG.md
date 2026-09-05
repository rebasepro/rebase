---
slug: es/docs/changelog
title: Changelog
description: Every released change to Rebase — new features, fixes, and the breaking changes each version asks you to migrate.
---

:::note[Esta página solo está disponible en inglés]
La traducción está pendiente. El contenido siguiente está en inglés.
:::
# Changelog

## [Unreleased]

### Breaking

- **A required `belongsTo` no longer defaults to `ON DELETE CASCADE`. It is
  `RESTRICT`.** `validation: { required: true }` on a relation says the child
  cannot exist without a parent. It does not say that deleting the parent should
  delete the child — but that is what the generator inferred, so `onDelete`, a
  field nobody has to write, quietly turned every `DELETE FROM authors` into a
  cascade through posts, their comments, and anything hanging off those. The
  default is now `RESTRICT`: the delete fails and names the constraint, and
  `onDelete: "cascade"` is something an author asks for on purpose. Optional
  relations are unchanged (`SET NULL`), and a `manyToMany` junction is unchanged
  (`CASCADE` — the row it deletes is the link, not the target).

  **This is a DDL change for existing projects.** The next `db push` will plan a
  constraint rewrite (`DROP CONSTRAINT` / `ADD CONSTRAINT`) for every required
  relation that never named an `onDelete`, and after it those parent deletes
  start failing where they used to cascade. To keep the old behaviour, write it
  down: `onDelete: "cascade"` on the relation. Review the plan before applying
  it — `db push` prints the statements.

  All three generators moved together (the `CREATE TABLE` DDL, the desired state
  boot-ensure diffs the live database against, and the generated Drizzle schema),
  so the default cannot differ between them and make every boot plan the same
  rewrite forever.

### Added

- **`rebase status` — what this project declares, and whether it is configured.**
  The model a developer has to hold is three files: `rebase.json` says where the
  code is and who runs the server, `config/resources.ts` says what the project
  needs, and the environment says how to reach each thing. Everything else —
  `rebase.resources.json`, the bundle manifest — is generated from the middle one
  for readers that cannot run your code.

  None of that was visible in one place. `rebase resources` listed declarations,
  the variables lived in a `.env`, and the rule joining them was a suffix
  convention you had to know. So the question people actually arrive with — *why
  does uploading to `media` answer 501* — could only be answered by deriving the
  variable name by hand. It is now printed, per resource, with the consequence
  spelled out:

  ```
    buckets
    ✓ media  s3 · account:minio
        ✓ S3_BUCKET__MEDIA
        ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
    ○ exports  s3
        · S3_BUCKET__EXPORTS not set
        └ declared, not configured — uploads here answer 501
  ```

  It shows three things nothing showed before: which shared-account variable a
  bucket is *actually* reading, a source that is declared but not configured
  (before a 501 in production rather than after), and a `local` bucket, which
  resolves happily and is dropped in production because a container's filesystem
  is erased on restart.

  The verdicts come from `resolveDataSources` and `resolveStorageBackend` — the
  functions that run at boot — rather than from a second implementation of what
  "configured" means, which would eventually reassure someone about a deployment
  that is about to refuse to start.

### Fixed

- **`rebase resources --check` failed every project that declares nothing.** A
  backend has a default database and a default bucket whether or not anyone says
  so, and a project with no declarations has nothing to record — but the check
  demanded a `rebase.resources.json` saying exactly that, and reported its
  absence as stale. This surfaced the moment the check was put in a gate: it
  failed this repository's own reference app, which declares nothing, and would
  have failed every scaffolded project until someone declared a second bucket.

- **Nothing ran `rebase resources --check`.** Not CI, not a package script, not
  another gate — while the comment introducing it said it "is what keeps it
  honest". `rebase build` rewrites the file, so a project that builds is honest
  by construction; a `runtime: "custom"` project never runs `rebase build`,
  because it builds its own image. So for exactly the projects where the
  committed graph is the only record of what they need, it could drift in
  silence. `pnpm check:resource-graphs` now runs it over every installed project
  in the repository, in CI.

- **A bucket's shared credentials worked on the managed runtime and silently
  did nothing in an ejected one.** Turning a declaration into a source
  definition was two field-by-field maps — `graphToStorageSources` in
  `@rebasepro/server`, which the managed boot path uses, and
  `declaredStorageSources()` in `@rebasepro/types`, which an ejected project's
  entrypoint and the frontend use. The server's copy carried a bucket's
  `account`; the types copy dropped it. So
  `bucket("media", { account: "minio" })` found `S3_ACCESS_KEY_ID__MINIO` on the
  managed runtime and found nothing after `rebase eject` — the source was
  skipped as unconfigured and every upload to it answered
  `501 STORAGE_SOURCE_NOT_CONFIGURED`, having never asked for the credentials
  the project had set. There is now one mapper, and a test that the two readers
  return identical definitions.

- **An ejected backend ignored every database but the first.** The emitted
  entrypoint was one hardcoded
  `createPostgresDatabaseConnection(env.DATABASE_URL)`, so a project declaring
  `database("analytics")` ejected into a server that never opened a second
  connection: collections routed there fell back to the default driver and their
  rows landed in the wrong database, behind a boot that logged a warning and a
  health check that stayed green. It now uses `resolveDataSources` +
  `initializeDataSources` — the same resolvers the managed runtime uses — binds
  one bootstrapper per declared database, and closes every pool on shutdown
  rather than only the first.

- **`bucket({ engine: "s3" })` threw "a bucket needs a non-empty key".** The
  options-only form `database()` has had since it shipped was missing here, so
  configuring the *default* bucket meant writing the internal sentinel
  `bucket("(default)", { … })`, and passing options where a key belongs failed
  with a message naming neither the mistake nor the fix.

- **The bucket and database kinds advertised environment variables nothing
  reads.** `ResourceKindSpec.envBases` is what a generator or control plane
  binds from, and the bucket kind named `STORAGE_BUCKET`, `STORAGE_ENDPOINT`,
  `STORAGE_REGION` and `STORAGE_PUBLIC_URL` — none of which the runtime has ever
  read — while omitting `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, without
  which a bucket cannot be reached at all. The database kind named
  `REBASE_DB_POOL_MAX` for a resolver that reads `DB_POOL_MAX`. Both lists now
  match `boot/sources.ts`, and a new test holds them to it by reading the
  resolver's own source.

- **A test's registry reset was a silent no-op.** `storage-account-scope.test.ts`
  called `resetResourceRegistry?.()`, which is not an export — so the optional
  call did nothing and the test ran against whatever an earlier test had
  declared.

- **Every `rebase db` failure exited 1 without saying anything.** The driver's
  entry point ended in `.catch(() => process.exit(1))`, which discarded the
  error. So a branch that could not be created, a name Postgres would silently
  truncate, a duplicate, a branch that was not there — each printed its header
  and then nothing, with an empty stderr:

  ```
  $ rebase db branch create feature_auth
    🌿 Creating database branch...
    Name:   feature_auth
                                  ← nothing. exit 1.
  ```

  This was the whole `db` namespace, not only `branch`. The messages existed and
  were carefully worded; none of them had ever reached a terminal. A child
  process that already wrote its own diagnosis through inherited stdio still
  stays quiet, and a bare Drizzle `Failed query:` wrapper now carries the
  PostgreSQL error it hides in `cause`.

- **`rebase db branch info` exited 0 for a branch that does not exist.** It
  printed `✗ Branch "x" not found.` in red and reported success, while `delete`
  — answering the same question — exited 1. So
  `rebase db branch info "$b" && deploy_against "$b"` ran the deploy against a
  branch that is not there, with the reason already on the terminal.

- **`rebase db branch create alpha beta` created a branch called `alpha`.** The
  extra word was discarded silently, so an unquoted name (`create my feature`), a
  flag written without its dashes (`create feat from main`), or a shell splitting
  a token you thought was one all succeeded and made a branch you did not ask
  for — under a name you then type to switch, delete, or point a deploy at. Words
  the command cannot account for are now refused before anything connects, with a
  suggestion of the hyphenated name you probably meant.

- **A branch could not be created while the dev server was running, and would
  not say why.** `CREATE DATABASE ... TEMPLATE` needs the source quiescent, and
  `DatabasePoolManager` only disconnects pools inside the process doing the work
  — `rebase db branch` is its own process, so a `rebase dev` in another terminal
  was never touched by it. Wanting a branch and running the app are the same
  moment, so this was the common path, and the advice on failure was "close
  other clients and try again" for the one case where you do not know what is
  connected. The failure now lists the sessions by `application_name`, and
  `--force` disconnects them for you, on create and delete alike.

### Added

- **`rebase db branch prune` — branching shipped with no cleanup story at all.**
  No TTL, no prune, no `delete --all`, and every branch is a full-size copy:
  `CREATE DATABASE ... TEMPLATE` duplicates the files on disk, so five branches
  of a 100 GB database cost 500 GB. The only way to reclaim any of it was to
  remember every name you had ever typed.

  ```bash
  rebase db branch prune                   # orphans only — always safe
  rebase db branch prune --older-than 2w   # and anything past two weeks
  ```

  It also finds the two ways branches drift from their metadata, which drift in
  opposite directions: an entry whose database was dropped outside Rebase, which
  `list` would keep reporting forever while `switch` and `info` fail against a
  database nothing can find; and a branch database whose entry was never
  written, because `create` makes the database first and records it second.
  Nothing expires unless asked, ages are floored so a cutoff never catches
  something younger than it says, and `--older-than 7h` is refused rather than
  read as seven days. Atlas's `<db>_dev_diff` scratch databases are reported
  alongside but removed only with `--include-dev-diff`.

- **`rebase db branch` reported branches the managed database had not made.**
  PGlite serves exactly one database, so `CREATE DATABASE ... TEMPLATE` wrote a
  `pg_database` catalog entry and copied nothing. Every step then agreed:
  `create` answered `✓ Branch "feature_x" created successfully.`, and `list`
  showed it at 7.1 MB because the catalog entry makes its `JOIN pg_database`
  succeed and `pg_database_size` answer for the one real database. Connecting to
  `rb_feature_x` reported `current_database()` = `postgres`, and a table created
  "in the branch" appeared in the parent — so every write made in the belief
  that it was sandboxed landed in the developer's own database. Measured on a
  fresh `rebase init` scaffold, which is the default path. The whole `branch`
  domain is now refused there, before the database is started, naming
  `rebase dev --docker` and `DATABASE_URL` as the two things that work.

- **`rebase db pull` handed back a database the application could not read.**
  `pg_dump --no-privileges` strips every GRANT, so the copy arrived with the
  source's RLS policies and its `FORCE ROW LEVEL SECURITY` intact and nothing
  behind them. Measured on a 30-table project: 68 policies and 60 grants in, 68
  policies and **0** grants out, and the first read as the role Rebase serves
  every request through failing with `permission denied for table leads` — after
  a green `✓ Local database now holds a copy of …`. Anyone who pulled and then
  opened `psql`, ran `rls-check`, or pointed a test suite at the copy hit a wall
  with no hint of the cause. The pull now re-provisions the app role through the
  same `ensureAppRole` boot and `db push` call, so internal tables stay revoked
  as well. The backup path already guarded this hazard; the newer command people
  are told to use did not.

- **`rebase db pull --database-url` was accepted and ignored.** The flag never
  reached the resolver, so the pull went ahead against the `.env` database
  anyway: `rebase db pull --from prod --database-url scratch --yes` destroyed the
  working database while naming a different one. It is now refused rather than
  honoured — the target is the local development database by construction, since
  a command that can copy in both directions eventually copies the wrong way, and
  the wrong way here is a laptop over production. The refusal points at `--from`.

### Added

- **`rebase db branch switch` — branching stopped one step short of being a
  feature.** `create` copied a 12 MB database in 1.2s and then printed
  `Database: rb_feature_auth` and nothing else: there was no `switch`, no
  `--branch` on `rebase dev`, no `REBASE_BRANCH`, and not even a connection
  string to paste. The only way to work on a branch was to hand-edit
  `DATABASE_URL`, while the documentation said the CLI updated your local
  development configuration — it did not, and the `.env` was byte-identical
  afterwards.

  ```bash
  rebase db branch switch feature_auth   # every later command follows
  rebase db branch switch                # which branch am I on?
  rebase db branch switch --off          # back to the main database
  ```

  The branch is recorded in `.rebase/branch.json` as a name, never a connection
  string, so credentials stay in `.env` alone. It outranks `DATABASE_URL` in
  `.env` — any lower and switching would do nothing on a project that sets one —
  and loses to `--database-url` and a `DATABASE_URL` in the shell, so a flag on
  the command line still beats a switch made yesterday. Deleting the branch you
  are on returns the checkout to the main database instead of leaving it aimed
  at a database that no longer exists.

### Documentation

- **The branching page promised three things the feature does not do.** It said
  the CLI updates your local development configuration when you create or switch
  to a branch — there is no `switch`, and `create` leaves `.env` byte-identical.
  It presented `DatabasePoolManager`'s pool eviction as the guard against
  `is being accessed by other users`, when that only reaches pools inside the
  process doing the work and `rebase db branch` is its own process — so a running
  `rebase dev` blocks branching and always did. And nothing said branching needs
  a real PostgreSQL server: on the managed PGlite database
  `CREATE DATABASE ... TEMPLATE` writes a catalog entry and copies nothing, so
  the "branch" resolves to the database it was cloned from. `rebase db branch
  info` and `--from` were missing from the CLI reference as well.

### Security

An external audit of the framework and Rebase Cloud on 2 September 2026. Every
item below was reproduced before it was fixed. Read the first one if you read
nothing else: it is the only one that can have been silently true on a
deployment you already run.

- **A server's first boot on an empty database served every request with RLS
  effectively off.** The driver decides whether to drop to the restricted
  `rebase_user` role by asking whether its connection role is a superuser, has
  `BYPASSRLS`, or owns any tables. On a fresh database with an ordinary owner
  the answer to all three is no, so no role switch was configured — and the
  same process then created and owned every table, which makes it exempt from
  every non-`FORCE` policy for the rest of its life. It logged "subject to RLS
  natively; no role switch needed" while it did so. The next restart answered
  differently and quietly fixed it, which is why it survived: the window is one
  process lifetime, and it is the first one, when a deployment has its first
  users and nobody is looking yet. Reproduced end to end — a second user
  listed, counted and rewrote the first user's rows under an `ownerField` rule.
  The posture is now decided after the schema is provisioned, from ownership
  Postgres would actually recognise (`pg_has_role`), and a connection that just
  created tables and still reports "no switch needed" fails the boot instead of
  logging past it.

- **`excludeFromApi` was a read-side rule that stopped at the top-level row.**
  It was stripped from a row and from an inline relation target, but the "ref"
  rendering used by WebSocket fetches and by every realtime subscription frame
  copied the target's columns unfiltered — so a `posts.author` relation to
  `users`, which is what the scaffold ships, delivered password hashes to
  anyone subscribed. REST was clean the whole time, which is why it was not
  noticed. It was also read-side only in the other direction: any caller who
  could write a row could write the columns it hid, and the OpenAPI generator
  documented that as intended. Both directions now hold, in every rendering.

- **`storagePublicRead` satisfied the production access-control gate and left
  write, delete and list open.** The boot check treated it as "access control
  is configured", after which no authorize hook was required — but public read
  only relaxes reads. Writes fell back to the global `requireAuth`, which is
  off in exactly the public-site configuration the docs recommend alongside it.
  Proven anonymous: upload over another user's key, list, read, delete. Public
  read without a hook now installs one that denies write, delete and list to
  anyone who is not an admin.

- **Resumable uploads were not bound to their owner.** `HEAD`, `PATCH` and
  `DELETE` looked an upload up by id and never compared the recorded owner, so
  a leaked upload id let somebody else finish or cancel it under the owner's
  authorized key. The per-upload ceiling was 5 GB regardless of the
  controller's `maxFileSize`, which was checked only after finalize had read
  the whole temp file into memory. Ownership is now checked, the declared
  length is refused up front, and the file is streamed.

- **Revoked and demoted admin tokens kept working on the most valuable
  routes.** The user-management routers re-read roles and the revocation
  watermark on every request; the gate in front of backups, cron, logs, the
  schema editors, the RLS audit and dev mail did not, and neither did the
  API-key router or the auth router's self-service routes. So a revoked token
  still downloaded a full database dump and read captured reset emails for up
  to an hour; a demoted admin could still mint an `admin: true` API key that
  never expires; and a stolen access token could still link an attacker's
  GitHub identity to the account *after* the victim had reset their password
  and signed out everywhere. All of them re-read now.

- **The DDL builders interpolated schema and table names straight into
  `CREATE TABLE` and `ALTER TABLE`.** Identifier validation ran on the
  introspection reads and not on the statements built from them, and the
  live-schema router is mounted regardless of `NODE_ENV`, so a crafted table
  name executed on the owner connection — which bypasses RLS entirely. The AST
  schema editor had the matching hole on the TypeScript side: top-level keys
  were emitted unquoted into a collection file and a relation target containing
  an arrow was emitted verbatim, and `rebase dev` re-imports on change, so the
  payload ran as soon as it was written. Names that become SQL identifiers or
  source are now validated where they are used, not only where they are read.
  Database introspection had the same shape — a table name from `pg_class` went
  into both a query and a file path — so a hostile table in a database you
  onboard could run SQL as your role and write outside the collections
  directory.

- **A fresh deployment gave admin to whoever registered first.** No shipped
  artifact set `DISABLE_SELF_REGISTRATION` — not the compose file, the Helm
  chart, the platform blueprints, or the Hetzner module whose README brings DNS
  and TLS up before the operator has had a chance to register. The first
  administrator is now seeded from `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`
  and self-registration ships off. The address is checked against the same rule
  the login route parses its body with, and a boot refuses one that rule would
  reject — an admin nobody can sign in to is worse than the race it replaced,
  because the account existing is also what removes the first-run path.

- **The same window, closed in the framework and not only in the artifacts.** An empty
  user table admitted the first registration and promoted it to admin — the
  right rule for a laptop, and an open window on every host with a public
  hostname, since the shipped artifacts bring DNS and TLS up before the
  operator has typed anything. `GET /auth/config` advertised `needsSetup:
  true`, so the unclaimed hosts were also easy to find. `POST /admin/bootstrap`
  offered the same prize one request later, to the earliest-registered user.

  The window now exists only outside `NODE_ENV=production`. In production an
  empty table refuses the bootstrap registration with `SETUP_REQUIRED` and says
  what to do instead, a first account created through open registration is an
  ordinary account, `needsSetup` is never advertised, `/admin/bootstrap`
  refuses, and boot warns when the table is empty and `REBASE_ADMIN_EMAIL` is
  unset. The two ways in — the named admin seed (`REBASE_ADMIN_EMAIL` /
  `REBASE_ADMIN_PASSWORD`, which every shipped blueprint already sets) and the
  service key — are the ones nobody can race for. Development, `rebase dev`
  and the test suites keep first-registration-is-admin.

- **`GET /api/functions` handed anyone the inventory of custom endpoints.**
  Functions themselves stay anonymous-callable by default (a webhook receiver
  has to be), but the listing now requires a resolved identity — a signed-in
  user, an API key or the service key. `rebase cloud debug` already read a
  401 there as "mounted".

- **Two audit reports named internal infrastructure.** A private database
  address and a cluster-internal service hostname in `docs/audits/` are
  replaced with placeholders, and the webhook audit carries a dated status
  line, since the SSRF guard it says does not exist has existed since
  2026-08-08.

- **Smaller, and all reproduced:** preview URLs were sanitized by a blocklist
  that tab and newline variants walked past, and the rich-text editor assigned
  AI completions to `innerHTML`; a download token could mint itself a fresh one
  for the same path, which on a trailing-slash key is a perpetual folder-wide
  grant; static SPA serving returned dotfiles and followed symlinks out of the
  build directory, so `/.env` and `/.git/config` answered 200; 4xx responses
  echoed Postgres `DETAIL` in production, an existence oracle for rows RLS
  hides; image transforms decoded at sharp's defaults with no pixel ceiling and
  trusted the uploader's declared content type; the email-OTP send route
  reintroduced timing enumeration and had no per-recipient limit; and
  `customizeAccessToken` could overwrite `uid` and `roles`, because custom
  claims were spread over them.

- **`rebase auth reset-password` with no password set a constant.** Both reset
  paths used the literal `NewPassword123!` and `--help` printed it as the
  default — a string that is in a public repository and in a published package.
  Reset is the documented way back into an account nobody can sign in to, which
  in practice means an admin. A password is now generated and printed, and one
  you supply is masked rather than echoed back.

- **Published tarballs carried their own tests.** Sixteen packages ship
  `files: ["dist", "src"]` on purpose; seven of them keep tests beside the code
  in `src/`, so `src` swept them in — `@rebasepro/client` published 27 test
  files. `check:package-contents` now asks npm what it would pack and fails on
  anything test-shaped.

- **Dependency advisories.** `fast-uri` (four highs, all of them the parser's
  idea of a host disagreeing with the fetcher's — malformed IPv6, a
  percent-encoded scheme, a repeated hostname, skipped IDN canonicalization) and
  `qs` both reach `@rebasepro/mcp` as runtime dependencies, not only build
  tooling. Both raised, with `browserslist` alongside them.

### Added

- **`policy.registered()`.** `POST /auth/anonymous` mints a real user row with a
  real uid, so a guest satisfies `policy.authenticated()` — which is the point
  of the feature, and also means "signed in" was true for anyone who pressed
  *Continue as guest*. `registered()` is `authenticated()` plus "not a guest";
  reach for it wherever a rule is about somebody who could be held responsible
  for something. The flag travels in the access token and reaches the database
  as `rebase.is_anonymous()`, so a policy can ask without a lookup.

- **`rls-check` gained `policy-authenticated-tautology`.** Correcting an
  anonymous tautology by excluding the sentinel is where people stop, and what
  remains — "every account may read every row" — is the shape that made a
  customer's `users` table readable by anyone who could sign up. It is a
  separate id from the anonymous finding on purpose: different severity,
  different fix, and `--skip` should be able to silence one without the other.
- **In production, whoever registered first owned the deployment.** An empty
  user table admitted the first registration and promoted it to admin — the
  right rule for a laptop, and an open window on every host with a public
  hostname, since the shipped artifacts bring DNS and TLS up before the
  operator has typed anything. `GET /auth/config` advertised `needsSetup:
  true`, so the unclaimed hosts were also easy to find. `POST /admin/bootstrap`
  offered the same prize one request later, to the earliest-registered user.

  The window now exists only outside `NODE_ENV=production`. In production an
  empty table refuses the bootstrap registration with `SETUP_REQUIRED` and says
  what to do instead, a first account created through open registration is an
  ordinary account, `needsSetup` is never advertised, `/admin/bootstrap`
  refuses, and boot warns when the table is empty and `REBASE_ADMIN_EMAIL` is
  unset. The two ways in — the named admin seed (`REBASE_ADMIN_EMAIL` /
  `REBASE_ADMIN_PASSWORD`, which every shipped blueprint already sets) and the
  service key — are the ones nobody can race for. Development, `rebase dev`
  and the test suites keep first-registration-is-admin.

- **`GET /api/functions` handed anyone the inventory of custom endpoints.**
  Functions themselves stay anonymous-callable by default (a webhook receiver
  has to be), but the listing now requires a resolved identity — a signed-in
  user, an API key or the service key. `rebase cloud debug` already read a
  401 there as "mounted".

- **Two audit reports named internal infrastructure.** A private database
  address and a cluster-internal service hostname in `docs/audits/` are
  replaced with placeholders, and the webhook audit carries a dated status
  line, since the SSRF guard it says does not exist has existed since
  2026-08-08.

### Fixed

- **Creating a user in the panel never showed the temporary password.** The
  server mints one, returns it beside the columns on the create response, and
  will not repeat it; the dialog that shows it to the administrator was
  installed as an `afterSave` on the collection's `callbacks` — the server's
  block, which nothing in the browser runs and whose bodies the bundler strips
  on the way in. So the callback was never called, by anything, and the
  credential was returned to a panel that dropped it. It is injected onto
  `admin.browserCallbacks` now, written to both the block and its flattened
  form so re-resolving a collection cannot undo it. Resetting a password was
  never affected: that dialog fetches and renders the result itself.

- **Four of the seven showcase cards on the homepage rendered blank.** A
  key sweep on 2026-09-02 deleted the strings for the presupuestos, Prospector,
  Unfeigned and Edith cards because the carousel builds its keys dynamically
  and the sweep only saw literal `t("…")` calls. The four locales get their
  copy back, and the built page no longer carries `alt="undefined …"`.


- **`rls-check` reported clean on a table the whole internet could read.** The
  `policy-anonymous-tautology` check bailed out whenever it saw the literal
  `<> 'anonymous'`, so a policy guarding against `'anon'` instead fell past the
  bail — and then no longer matched the bare null-test shape either, so the check
  returned nothing at all. `rebase.uid() IS NOT NULL AND rebase.uid() <> 'anon'`
  reads as "signed in", is true for every anonymous caller, and was scanned and
  passed. The guard is now parsed rather than string-matched: the expression is
  split on `AND` counting parens, `<> ALL (ARRAY[…])` and `NOT IN (…)` are read
  as the exclusions they are, and a policy only clears when it excludes an id a
  signed-out caller can actually arrive with. Excluding some other literal is now
  the loudest finding of the three, because it is the one that survives review.
  Severity also rises a step for `ALL`, `UPDATE` and `DELETE` policies, where the
  same predicate decides who may write.

- **A bundle that vendors its own `node_modules` booted two copies of the
  framework.** New pods crash-looped with `Could not load the database driver
  "@rebasepro/server-postgres": Resource kind "database" is already registered
  with a different definition` — while the driver was installed the whole time.
  The process held the image's `@rebasepro/types` and the bundle's vendored
  copy; `registerResourceKind` keys off `globalThis` deliberately, so both
  registered into one registry, and the two specs for kind `database` had
  diverged by a single `optionKeys` entry. It threw during the driver's import,
  so the driver got the blame. The dedupe that exists to prevent this was
  unreachable on three of the four paths into a running pod. (#38)

- **`zod` was missing from the runtime-provided list, so a managed app ran no
  crons and reported success.** A bundle shipped its own zod beside the image's;
  `loadEnv({ extend })` then parsed a schema built by a different module
  instance, and every field carrying a `.default()` was rejected. Nothing in
  that failure mentions zod. Added to all three lists, and the agreement test
  that should have caught it no longer filters to `@rebasepro/*` — which is why
  a non-scoped entry could diverge for four releases unseen.

- **Every failure on a first cloud deploy said what it was, or said nothing.**
  The boot ensure built its message from `err.message`, which for drizzle is
  `Failed query: <sql>` and not one word of Postgres's answer — the SQLSTATE,
  message, detail and hint all sat in `.cause` and were discarded. Four
  unrelated boot failures read identically. Fixed here and in the RLS-policy
  sibling, where the swallowed reason explains a table that is now denying every
  request. Also: `storage create` 404'd because `invoke()` percent-encoded a
  function name the CLI had folded a project id into, so
  `storage-provision%2F<id>` matched a route that had been live for six weeks.

- **A restored, empty scroll entry asked the API for `limit=0`.**
  `initialItemCount` fell back with `??`, which catches `null` and `undefined`
  but not `0` — and `0` is exactly the value that means nothing was restored.
  Any filter combination matching no rows saved `data: []`, so returning to that
  view rendered `Invalid limit: 0` instead of a table, and a client bug wore an
  API failure's clothes. (#37)

- **The default scaffold's first data read returned 500.** `rebase init` writes
  no `DATABASE_URL`, so `rebase dev` takes the managed PGlite path — and nothing
  on that path replaced the template's stub `schema.generated.ts`
  (`export const tables = {}`). The database was fine: boot created every table,
  `/health` answered 200 and auth worked, while every `GET /api/data/*` returned
  `Table not found`. `rebase dev` now generates the Drizzle schema before
  starting anything, whichever database is behind it.

- **`rebase db push` against the managed database failed twice over.** First
  `pq: SSL is not enabled on the server`, because PGlite's socket server speaks
  no TLS — its remedy box then told the reader to append `sslmode=disable` to
  `DATABASE_URL`, the variable that is unset precisely because the managed
  database is in use. Past that, Atlas needs a second empty database to diff
  against and PGlite serves exactly one. The managed DSN now disables SSL, and
  `push`, `generate` and `migrate` stop up front on that database with the two
  things that do work.

- **A `--headless` project read as misconfigured on a clean boot.** The source
  bundle's manifest declared `entry.collections` and `entry.schema` from the
  conventional layout whether or not those paths existed, so a correct project
  warned that a file "does not exist" and that no tables would be created. The
  manifest now states what the project has.

- **`/api/data/*` answered a plain-text 404 when a project served no
  collections.** The surface was not mounted at all, so Hono's default replied —
  which reads as a wrong URL when the truth is that there is nothing to serve
  yet. It now returns a JSON `NO_COLLECTIONS` 404 saying tables must exist
  first.

- **The welcome email was in Spanish, and linked the wrong port.** Subject and
  body, on an English project, while every other template is English. And
  `rebase dev` left the frontend port to Vite while the backend was started with
  the scaffold's fixed `FRONTEND_URL=http://localhost:5173`, so the link named a
  port the app was not on. The frontend port is now derived per project, like
  the backend's, and handed to the server that builds the link.

- **Twenty lines of ERESOLVE before the CLI printed anything.**
  `@electric-sql/pglite-socket` pins its peers to exact versions per release, so
  `^0.2.9` floated to 0.2.11, which demands `pglite-pgvector` 0.0.9 while the
  CLI asked for 0.0.7. The family is pinned exactly.

### Changed

- **A collection's `callbacks` runs on the server, and only there. The panel's
  own callbacks are `admin.browserCallbacks`.** The Vite plugin has always
  stripped that block's bodies out of the admin bundle, so a `beforeSave`
  calling a vendor with a key from `process.env` does not ship to every visitor
  — but two keys were exempt, on the grounds that the panel ran them. Both
  exemptions were wrong, in different directions. `afterSave` had no
  client-side call site at all: the body shipped and never ran. `afterRead` did
  run, unconditionally, on top of the server having already applied it — so
  every server-backed collection transformed its rows twice, and anything not
  idempotent compounded. Meanwhile a collection on a `direct` transport, where
  the panel talks to the store itself and no server sees the operation, got
  read callbacks while its write callbacks were stripped out from under it,
  silently. The strip is total now, with no allowlist to fall out of date, and
  callbacks the panel runs live under `admin.browserCallbacks`: a separate key,
  so which runtime a callback belongs to is a fact about the collection file
  rather than about a `dataSources` declaration in another one — which is the
  thing a build-time transform cannot see. Move a browser-side `afterRead` into
  the new block; a server-side one already worked and needs no change.

- **`saveEntityWithCallbacks` and `deleteEntityWithCallbacks` run callbacks.**
  Both have been named for callbacks they never ran, since they were written,
  and `deleteEntityWithCallbacks` went as far as accepting a `callbacks` prop
  and dropping it on the floor. They run the collection's
  `admin.browserCallbacks` around the write: `beforeSave` can block a save the
  way the server's does, `beforeDelete` can block a delete, and `afterSave`
  receives the row *as saved* rather than the values submitted. That prop is
  gone, as is the `callbacks` prop on `DeleteEntityDialog` that fed it — both
  were being passed the server's block, in the browser, where it does nothing.

- **The ERD has one layout, and it reads top to bottom.** The LR/TB toggle
  offered a choice the canvas cannot honour: the visualizer's pane is tall and
  narrow, so the left-to-right default pushed the graph off both sides on open.
  The machinery went with the buttons rather than being left behind.

### Documentation

- **`docs/compatibility.md` publishes the readiness table it promised** — one
  row per subsystem, dated, rated stable / beta / experimental, each with what
  the rating rests on. Realtime is beta because subscriptions are matched by
  collection path, the data table's missing grid semantics are listed as the
  defect they are, and `@rebasepro/server-mongo` is marked experimental with no
  row-level security.

- **One first run.** The README, the docs index and the quickstart page
  described three different sequences, none of which matched what happens.
  Converged, in six locales, with the derived ports and the `init` flags
  documented and "use your own Postgres" as a named variant.

- **The self-hosting page stops publishing a compose file that cannot work.**
  Its inline YAML mounted `/var/lib/postgresql/data` (which the pg18 image
  refuses) and set `POSTGRES_USER: rebase_app` against a `postgres://rebase:`
  connection string. It now points at the compose file in the repository, the
  one the acceptance gate boots on every push.

- **Rebase Cloud has a documentation page**, and `rebase cloud`'s
  twenty-eight command groups are in the CLI reference. So are `resources`,
  `apps init`/`config`, six `db` subcommands, and every `init` flag.

- **`@rebasepro/server-mongo` and `@rebasepro/firebase` have pages**, each
  leading with what it does not do.

### Removed

- **`loadDeclaredStorageSources`** (`@rebasepro/server`), **`normalizeStorageSources`**
  and **`DeclaredStorageSources`** (`@rebasepro/types`). All three served the
  `storage` block of `rebase.json`, which the manifest validator now refuses:
  buckets are declared with `bucket()` and the graph is generated into
  `rebase.resources.json`. The loader parsed a block that can no longer exist and
  the merge resolved a conflict between two homes there is now one of. Pre-release,
  a breaking change is just a change — the runtime contract stays at 1, as it did
  for the declaration change itself.

## [0.17.3] - 2026-08-31

### Fixed

- **Three releases published without `@rebasepro/agent-skills`, and nothing
  failed.** On 2026-08-24 `rebase-agent-skills/` moved under `tooling/`. Both
  release paths named their publishable packages as literal paths; the shell
  loops were updated and four `pnpm --filter './rebase-agent-skills'` were not.
  pnpm treats a filter that matches nothing as a **warning and exits 0** — it
  prints `No projects matched the filters "…"`, then does the work for the
  filters that did match. So the bump ran for `packages/*`, silently skipped the
  skills package, and every job stayed green.

  The package was last published on 2026-08-23. 0.17.0, 0.17.1 and 0.17.2 each
  shipped without it. Worse, and far less visible: `packages/cli` depends on it
  as `workspace:*`, which pnpm resolves at publish time against *that package's
  own manifest* — so all three published CLIs carry a hard
  `"@rebasepro/agent-skills": "0.16.0"`, a pin nobody wrote, four versions
  behind. `rebase skills install` has been writing the 0.16.0 set ever since,
  which means every agent skill authored or edited in that window — including
  the whole `rebase-cloud` skill — reached no user at all.

  Nothing in the pipeline could have caught it: every check asked whether the
  packages it *found* were correct, and none asked whether it had found them
  all.

  **A release no longer enumerates its own contents.** `publishable-packages.mjs`
  derives the set from `pnpm-workspace.yaml` — every member that is not
  `private` — and it is the single derivation used by the workflow, by
  `release.sh`, and by the workspace-protocol validator, all three of which held
  their own copy of the list. Publishing takes no `--filter` at all, since
  `pnpm -r publish` already publishes exactly the non-private members wherever
  they live, so there is nothing left for a directory move to invalidate.

  `pnpm check:publishable-set` is the guard, and it runs on **every PR** rather
  than at release time, because a release-time check is discovered during a
  release. It fails when publishable packages fall out of version lockstep (the
  symptom), when any release file enumerates packages by hand (the cause), when
  a publishable `@rebasepro/*` package sits outside the workspace globs where
  nothing would see it, when a package declares no `files`, or when its
  `repository.directory` no longer matches where it lives — which the same 2026-08-24
  move had also left stale.

  This does not repair the published 0.17.2: `workspace:*` was resolved at
  publish time and cannot be rewritten after the fact. The next release is what
  puts the skills package back on npm and points the CLI at it.

  A fourth copy of the list surfaced when CI ran against this fix, and it is the
  one that could not be repaired by correcting a path: the registry-install e2e
  built its set with `readdirSync("packages")`, so it structurally could not see
  the package under `tooling/`. `@rebasepro/agent-skills` was therefore never
  packed, the CLI's dependency on it was never rewritten to a local tarball, and
  the install fetched it **from the public registry** — which worked only
  because 0.16.0 is the version this very bug had stranded there. It packs the
  derived set now, and a first-party package that is not in it is a thrown error
  rather than a warning: an e2e that reaches the real registry for our own
  package is not testing the tree it was given.

- **The API key dialog described the widest grant in the product as a narrower
  one.** A permission row's collection field addresses three namespaces, not
  one: `*` matches every collection *and* every custom function *and* storage,
  while `storage` and `functions`/`functions/<name>` reach the other two. The
  dialog labelled that field "Collection slug or *" and the detail panel
  rendered the wildcard as "* (all collections)" — so a key granting everything
  read as a key granting only the collections, and two namespaces were
  undiscoverable from the UI that creates them.

  `permissions.ts` is now the single place that knows the mapping; the picker
  labels, row descriptions, grant summary and detail panel all read from it, so
  they cannot drift from each other or from the server guard. The free-text box
  became a grouped picker (Everything / registered collections / Functions /
  Storage / a free-text escape for anything unregistered), and a live read-back
  under the rows spells the grant out in English as it is built. A row granting
  nothing used to be dropped silently at submit and now says so, and operation
  toggles are neutral when off — `delete` rendered red whether or not it was
  checked, so a read-only key looked destructive.

- **`Select` announced every option list as "Select an option".** Its trigger
  hardcoded that string whenever `label` was not a string, so every such select
  in the API key panel was identical to a screen reader. It takes an
  `aria-label` passthrough now.

- **The demo has been un-deployable, not merely stale.** `scripts/` moved under
  `tooling/`, and `app/backend/Dockerfile`'s `COPY scripts ./scripts` kept
  naming the old path while the `RUN` two lines below it already used the new
  one — the two halves of one rename disagreeing, so every `pnpm deploy:demo`
  since died at that layer with "file not found in build context". It copies
  `tooling/scripts` rather than all of `tooling/`, since only the scripts are
  needed in the image. Same move, same shape as the entry above.

### Added

- **API keys can be created as admin keys, and are labelled as such.** The wire
  has carried `admin` all along and this view could neither set nor show it: the
  local `ApiKeyMasked`/`ApiKeyPermission` copies had drifted from
  `@rebasepro/types` and never gained the field, so an admin key was
  indistinguishable from a scoped read-only one. The types come from the package
  now, and admin keys are badged in the list, the detail panel and the
  created-key confirmation.

## [0.17.2] - 2026-08-31

### Fixed

- **`rebase db push` was impossible for any collection declaring a
  `{ type: "vector" }` property.** The column compiled to `VECTOR(n)` in
  `drizzle/schema.sql`, and Atlas computes its desired state by materialising
  that file in a scratch database it creates empty and empties again at the
  start of every run — so the type was resolved against a database that
  structurally cannot have pgvector, and every push died with
  `pq: type "vector" does not exist`. Not intermittently: permanently, for the
  framework's own embedding property.

  Nothing in userland got past it. Seeding the extension does not survive
  Atlas's clean (measured: present before the run, gone after), a
  `CREATE EXTENSION` in the desired state is refused as a paid feature, an
  extension in a non-`public` schema makes the scratch database "not clean",
  and `--exclude` filters the diff only after the file has been parsed and
  applied.

  Vector now takes the carve-out full-text search already had. The column, its
  ANN indexes and the extension are generated into `drizzle/vector.sql`, Atlas
  is told to exclude them, and Rebase applies the file itself after
  `schema apply` and appends it to migrations. Excluding the column turns out
  to be enough on its own — a `NOT NULL` or `UNIQUE` on it is a property *of*
  the column and goes with it.

- **`rebase db generate` and `rebase db migrate` were both down for any project
  with a `search` block.** `--exclude` is accepted by `atlas schema apply` and
  by nothing else, and the guard that added it read as a subcommand test
  without being one: `migrate apply` matches `args.includes("apply")` exactly
  as `schema apply` does. Atlas rejects an unknown flag before doing any work,
  so both commands exited with `unknown flag: --exclude`. Present since the
  same commit that started appending search DDL to migrations, which means that
  append had never once run.

- **A migration could carry a `DROP COLUMN` for a search or vector column
  nobody asked to lose.** `migrate diff` computes the current state by
  replaying the migration directory — which builds those columns, because that
  DDL is appended to migrations — and diffs it against a `schema.sql` that
  deliberately omits them, so Atlas plans a drop. Nothing caught it: the
  destructive gate reads the *push* plan, and this is a file applied days
  later. Those statements are now removed from the file Atlas writes, clause by
  clause because Atlas folds the phantom drop into whatever real change shares
  the table. A drop the CLI cannot rewrite stops `db generate` rather than
  being guessed at.

- **A no-op `rebase db generate` grew the last migration every time it ran.**
  The `CREATE SCHEMA` rewrite and the RLS policy append were not gated on Atlas
  having written a new file, so a run that found nothing to diff appended
  another copy of the policies to a migration that had already been applied in
  production — changing a hash Atlas had recorded, while the appended SQL ran
  nowhere.

- **Live schema editing left behind a `schema.sql` that `db push` chokes on.**
  The commit generated it whole, so it carried the RLS policies, the search
  helpers Atlas will not parse, and the vector column. It now writes the same
  split `rebase db generate` does.

- **`rebase dev` could not host a vector column at all.** The managed
  development database derived every extension bundle's module path as
  `@electric-sql/pglite/contrib/<name>`, which does not exist for pgvector — it
  is a package of its own, and it was not declared. `CREATE EXTENSION vector`
  failed there with `extension "vector" is not available`, which reads like a
  broken database rather than a missing import.

- **`rebase db push --help` applied the schema.** The flag printed usage and
  then ran the command it was documenting, against whatever database the project
  was pointed at. Asking what a destructive command does is the one moment you
  are most certain not to want it to happen.

- **A first deploy deadlocked on a step nothing named.** A project created with
  `rebase cloud projects create` had no database, was written
  `status: "provisioning"`, and stayed there: nothing was in progress, the
  platform was waiting for `rebase cloud db create`, and no output, help page or
  skill named that command. "Provisioning" reads as work underway, and the
  correct response to work underway is to wait — so the correct response to this
  state was the one thing guaranteed never to resolve it. Measured at 43 minutes
  of polling on a real first deploy; an unattended agent would still be polling.

- **`cloud deploy` meant two different things depending on the runtime.** The
  managed-bundle path stopped at "deploy started" and told you to run
  `cloud logs`, while the source path waited and made its exit code the verdict —
  so the same command returned 0 for builds that went on to fail. It now follows
  on both paths unless `--no-follow` says otherwise, and takes `--wait` and
  `--timeout`.

- **A cluster's refusal was printed as if it were yours.** Failures arrived as a
  whole Kubernetes `Status` object with request headers, an audit id and a
  flowschema uid. Worse than the noise: a `403` naming a
  `system:serviceaccount:` is the control plane's OWN credentials being refused,
  which nothing in a user's project can grant — and printed raw in a failed
  deploy it reads exactly like a project fault. Someone acting on that reading
  deletes working code. Failures are now classified before they are summarised,
  carry `platform: true` in the JSON, and say in words when retrying and
  changing the project will not help. The untouched body stays behind `--debug`.

- **`clusters verify` never saw the id it was given.** It selected one from
  `rawArgs`, which is the whole of `process.argv`, so the first match was the
  node binary path: every invocation asked about a cluster called
  `/usr/bin/node`, got a 404, and read as "this diagnostic is not deployed yet".
  It is the one command that reports `permissions.allowed` / `permissions.denied`
  for a cluster, so the diagnostic for a missing RBAC grant was itself
  unavailable.

### Added

- **`rebase cloud projects create --db managed|byodb|none`**, defaulting to
  `managed`, so the sequence every project needs is one command rather than two.
  `--db none` is the deliberate opt-out and still prints the command that
  finishes the job.

- **`blockedOn` and `nextAction` on `cloud status`.** `blockedOn: null` is the
  load-bearing value — it is the CLI saying that waiting is correct, and the only
  condition under which polling `status` makes sense. Every other value names a
  command.

- **`db create --wait`**, which polls a bring-your-own database until it answers.
  For a managed one it reports that there is nothing to wait for and returns,
  since a loop there would be the same non-terminating wait in a new place.

- **A `rebase-cloud` agent skill**, and `rebase-deployment` now points at it.

- **`database({ extensions: ["vector"] })`.** Declared in `config/resources.ts`,
  it lets `rebase db push` and the boot schema-ensure run
  `CREATE EXTENSION IF NOT EXISTS vector` for you.

  A permission rather than a request: the statement is issued only where
  something in the schema needs it, so naming an extension nothing uses
  installs nothing. It is opt-in because everything that decides whether the
  install can succeed — the image shipping the library, the role's grant, a
  managed provider's allow-list — is invisible from inside the connection.
  Saying nothing withholds the install, never the column, so a database where
  pgvector was installed by hand keeps working with no configuration.

  `database()` also accepts options in place of a key, since the default
  database has no name to pass.

### Changed

- A changed `dimensions` on a vector property is no longer silent. Atlas used
  to own the column and plan the type change; now that it cannot see it,
  `ADD COLUMN IF NOT EXISTS` would have done nothing and left the old width
  behind a config that says otherwise. The generated DDL widens the column when
  it holds no values and refuses — naming the statement to run — when it does.

### Removed

- `seedDevDatabaseSearchHelpers`, which never did anything. Its docstring
  claimed an excluded column is still materialised in Atlas's scratch database;
  it is not. Measured with a real generated `tsvector` column: a seeded scratch
  database and an empty one produce byte-identical output in every
  configuration, and Atlas wipes that database before it plans. The `--exclude`
  patterns were always the whole protection.

## [0.17.1] - 2026-08-30

### Fixed

- **A managed pod could not unpack its own bundle.** 0.17.0 shipped a fix for a
  `tar` failure and the fix did not work; every managed pod rolled onto that
  image crashlooped on the bug it was meant to close. An archive rooted at `.`
  carries the mode of the directory it was packed from, and GNU tar applies that
  to the extraction root as its last act — refused where the process does not own
  the directory, and refused *after* every file has been written, so a complete
  bundle is reported as a corrupt one. A Kubernetes emptyDir is exactly that
  case: `root:node` 0775 setgid against a runtime running as uid 1000.

  No flag avoids it. `--no-overwrite-dir`, `--no-same-permissions`,
  `--delay-directory-restore` and `--exclude=./` were each measured against GNU
  tar 1.34 extracting into a directory owned by another uid, and all four still
  fail on the root: it is not an entry the archive can be told to skip, and it
  fails even when the mode being set is the mode the directory already has,
  because the refusal is about ownership rather than change.

  The runtime now unpacks into a directory it creates and moves the entries up,
  so the root `tar` chmods is one it owns. Staging sits inside the destination,
  which keeps the moves renames within a single filesystem rather than a second
  copy of a tree that is already the largest thing in a pod's ephemeral-storage
  grant.

- **A failed fetch no longer discards a bundle that works.** The runtime threw
  away the bundle already on disk when a download or unpack failed and then
  exited, so a pod holding something serviceable died anyway. It now falls back
  to it. Had this been in 0.17.0 the unpack bug above would have degraded the
  fleet rather than crashlooping it.

- **A collection whose name collides with an internal table keeps its grants.**
  Such a collection had them revoked.

### Changed

- `check:runtime-image:boots` boots the image a fourth way: `mode=url` into a
  directory the runtime does not own, which is the shape every managed pod
  actually has. The gate previously only ever unpacked into `/bundle` as the
  image ships it — the one arrangement in which the failure above cannot occur,
  which is why it stayed green through 0.17.0.

## [0.17.0] - 2026-08-29

### Breaking

Under 0.x the minor is the breaking position: `^0.16.0` resolves
`>=0.16.0 <0.17.0`, so nothing here reaches a project until it deliberately moves
to 0.17. The entries below say what stops working and what to do; the reasoning
for each is in the detailed section it links to.

- **`@rebasepro/admin` is now `@rebasepro/cms`, and `@rebasepro/admin-types` is
  `@rebasepro/cms-types`.** "Admin" named two things at once — the whole panel,
  and the content-management half of it — and the ambiguity had already cost
  something: spreadsheet views, entity history, users & roles and CSV import were
  being sold as Studio features because there was no other name for the half they
  actually belong to. The structure is now three peers under Rebase — Backend,
  CMS, Studio — rather than a parent with two children. "Admin panel" survives
  only as a lowercase phrase for CMS and Studio rendered together.

  ```diff ts
  - import { RebaseAdmin } from "@rebasepro/admin";
  - import { defineCollection } from "@rebasepro/admin-types";
  + import { RebaseCMS } from "@rebasepro/cms";
  + import { defineCollection } from "@rebasepro/cms-types";
  ```

  **Who this breaks, and what to do.** Anyone importing either package: change the
  specifier, and `RebaseAdmin` to `RebaseCMS`. There is no alias and no
  deprecation period — a shim would keep both meanings of "admin" alive, which is
  the defect being fixed. `@rebasepro/admin` and `@rebasepro/admin-types` stop at
  0.16.0 on npm and receive nothing after it, so a range like `^0.16.0` keeps
  resolving to the last release rather than breaking; it simply stops moving.

  **Your collection files do not change.** The `admin:` config key is deliberately
  untouched, along with every identifier named after it (`AdminCollection*`,
  `Admin*Options`, `ADMIN_COLLECTION_KEYS`), `DatabaseAdmin`/`databaseAdmin`,
  `wsAdmin`, the `admin` auth role, and `/api/admin`. Those name something other
  than the CMS product: the `admin:` block feeds a nav drawer Studio shares, and
  `/api/admin` serves the RLS audit and API keys, both of which are Studio's.
  Renaming them would have doubled the churn to no one's benefit.

  The panel's mode value moved with the package, `"content"` → `"cms"`. It is
  persisted per browser and migrates on read, so a browser that used the panel
  before this keeps working instead of holding a mode nothing matches and
  rendering neither half of the drawer.

- **Resources are declared, not configured.** `RebaseBackendConfig`'s
  `dataSources` and `storageSources` are gone; declare them in `rebase.json` and
  the config package instead. **A bundle built before this will not boot on a
  current runtime — rebuild it with `rebase build`.** The runtime contract stays
  at 1 deliberately; see the note under *Removed*.

- **A collection still carrying `admin.titleProperty` is rejected at boot.**
  Use `admin.display.title` — the same string works there. This can stop a project
  that starts today, which is the point: silence would mean a title quietly
  reverting to the derived one with nothing to explain why. Details under
  *Removed*.

- **`ctx.client` in a cron handler is now `ctx.rebase`**, and `userId` is no
  longer an accepted identity spelling anywhere — `uid` everywhere. Both under
  *Removed*, with the reason each alias was more dangerous than the rename.

- **`rebase eject infra` is gone**, along with `rebase.infra.json` and the
  `{"$env": "..."}` indirection. Resources bind from the environment on the
  `<BASE>__<KEY>` convention, which is the path every deployment already used.

- **`rebase build --legacy` and `rebase start --legacy` are now `--workspace`.**
  The mode is supported, not retired, and the old name said otherwise.

- **Every deprecated API alias is deleted rather than warned about**, including
  `WhereValue<T>` (use `WhereValueFor`) and `RENAMED_SLOTS`. The full list is
  under *Removed*.

- **An incoherent Kanban board now fails at boot.** A board is two declarations
  that have to agree, and every way of getting it wrong used to parse, boot,
  serve rows and render — the only symptom being that dragging did not stick.
  `checkBoardConfig` now runs wherever collections load, so the runtime,
  `rebase schema generate`, the policy generator and `rebase doctor` all say it.
  An `orderProperty` naming a property that does not exist, **or one that is not
  a string, is fatal**; `kanban` with no `orderProperty` only warns, and the
  board still boots without reordering.

  **This can stop a project that boots today, and the docs are why.** An order
  key is a `fractional-indexing` key in base36 (`"i0"`, `"i1"`, `"i0i"`), so a
  `number` can never hold one — but the documentation said
  `sortOrder: { type: "number" }` in every locale, and five translated copies
  additionally nested `orderProperty` inside `kanban`, where nothing reads it.
  All of that is corrected. If you followed it, change the property to a string:

  ```diff ts
  - sortOrder: { type: "number" }
  + sortOrder: { type: "string" }
  ```

- **A static app can no longer claim a path the backend serves.** One process
  serves the API and however many static apps a project declares, and mounting is
  longest-path-first — so an app declaring `path: "/api"` outranked the API
  itself, and every request to it was answered with that app's `index.html`: a
  200 carrying HTML where the caller wanted JSON, from a project that looked
  deployed and healthy. `rebase.json` validation, the control plane at deploy
  intake, and the router's own mount ordering now enforce the same reserved list
  from `@rebasepro/types`. Matching is at segment boundaries, exactly as the
  router matches: `/apidocs` is still fine, `/api/v2` is not.

`PUT` on the data API is **not** in this list: it was removed during this cycle
and put back before release, because every published SDK still sends it. See
*`PATCH` is the update verb* under Changed.

### Removed

- **`rebase eject infra` and `rebase.infra.json`.** The command wrote a file
  documented as being "read *before* the environment", and nothing read it:
  `loadInfraConfig` and `bindResources` had no caller outside their own tests,
  in either repository. The three-tier binder they implemented — file, then
  environment, then a local provisioner — never ran, and the header claiming
  the control plane injected such a file was contradicted by the control plane's
  own comment saying it deliberately does not.

  Resources bind from the environment on the `<BASE>__<KEY>` convention, which
  is the path every deployment has always used. Running the command now names
  the removal rather than failing as an unknown app. `packages/server/src/boot/local-provisioner.ts`
  went with it — it returned `STORAGE_BUCKET` and `REBASE_STORAGE_ENGINE`, names
  the resolver has never read.

  Removing this drops the `{"$env": "..."}` indirection with it. A self-hoster
  wiring secrets from Vault or SOPS renders them into the environment, which is
  what everyone was already doing — the alternative was maintaining a second
  binding path no deployment has ever exercised.

> **Breaking: resources are declared, not configured.** `RebaseBackendConfig`'s
> `dataSources` and `storageSources` are gone; declare them in `rebase.json` and
> the config package. A bundle built before this will not boot on a current
> runtime — rebuild it with `rebase build`.
>
> The runtime contract stays at **1**. Pre-release, a breaking change is just a
> change: there is no population of old bundles to protect, so a major would buy
> nothing and invalidate the `rebase` range in every manifest and template.

### Added

- **`pnpm check:portable-core` — what the request path depends on Node for.** A request this server can answer without touching the database pool is a request an isolate could answer, and that set is larger than it looks: token verification, rate limiting, idempotency, storage URL signing, and every custom function. Eight modules on that path needed a Node process, for nine separate reasons. Five of those modules needed it for no reason anyone had chosen: `randomUUID` from `node:crypto` where the `crypto` global would do, `node:path` to fold `.` out of a storage key that never touches a filesystem, SHA-256 and a constant-time compare that WebCrypto does just as well.

  Those five are gone, and the gate records what is left in `contracts/portable-core.txt`. It is a ratchet rather than a wall: the file may shrink and may never grow, so a branch that puts a fresh dependency on Node in front of every request has to say so in review instead of a year later. Nothing has to reach zero for that to be worth having — `drizzle-orm` and `pg` need a TCP socket, and that is a driver decision. What it buys is that a later port is a scoping exercise against a list, not an excavation.

  Three lines remain, each with its reasoning in the file: the JWT library, PEM key parsing, and the client's socket address — a per-adapter capability rather than something a portable module can reach, since Hono has no runtime-agnostic `getConnInfo`.

  The SSRF guard joined the same list and needed two changes to clear it. `net.isIP` became `utils/ip-address.ts`, a transcription of Node's own grammar held to it by a property test comparing the two directly — a validator that is stricter than `net.isIP` sends a literal down the resolution path, and one that is looser judges bytes nobody else agrees with. And its default resolver is loaded on use rather than imported, so a runtime with no `node:dns` can be handed one instead of being unable to load the module at all. A host with neither fails closed and says which of the two it is missing: the alternative to resolving a name is not "allow it", it is "do not send".

- **Custom functions have their own entry point: `@rebasepro/server/functions`.** `import { defineFunction } from "@rebasepro/server"` reaches the whole framework — the boot sequence, the collection loader, the backup routes, the SPA server, `@hono/node-server`, `ws`, `jsonwebtoken`, Drizzle. On Node that costs a little start-up time and nothing else, which is why it stood. It also meant a function file could only ever resolve inside a Node process, however portable the function's own code was — and since that import line is in every function file, every template and every documentation page, it is not a thing that can be changed later without breaking everyone who wrote one.

  The new entry point carries the authoring surface and nothing else: `defineFunction`, the `rebase` singleton, route guards, typed context accessors, configuration readers, `waitUntil`, `ApiError`, `HonoEnv`. Its published bundle imports exactly two things, `hono` and `hono/adapter`, and the build refuses to ship it otherwise — a test walks the import graph from source and names the chain that broke the rule, and a second check evaluates the emitted file in a context holding web globals and no `process`, `Buffer` or `require` at all. Importing from the package root still works and still behaves identically; it is now the second-best way to write a function rather than the only one.

- **Typed accessors for the request context.** `getUser(c)` returns `{ uid, roles, …claims }` or `undefined`, with `roles` always an array. Every documented example used to open with `const user = c.get("user") as { uid: string; roles?: string[] } | undefined` — an assertion in a security-relevant position, copied once and never re-examined, and wrong for at least one auth path that reaches it. `getUserId`, `getRoles`, `hasRole`, `isAdmin`, `isAuthenticated`, `getDriver`, `requireDriver`, `getApiKey` and `getRequestId` come with it. `requireDriver(c)` replaces `c.get("driver")!` and, when there genuinely is no driver, says that the app was mounted outside the functions router instead of failing twenty lines later on `undefined`.

  `requireRole("editor", "admin")` joins `requireAuth` and `requireAdmin`. All three read the identity the platform already resolved rather than parsing a token, which is what makes them portable — and is a distinction with no behavioural difference inside a function, where both auth middlewares have already run. Outside one, where nothing has, they answer 500 naming the wiring rather than 401 blaming the caller's token.

- **`waitUntil(c, promise)` for work that outlives the response.** An un-awaited promise looked equivalent and was not, in both directions. At `SIGTERM` a floating promise is dropped mid-flight, so a rolling deploy has always been able to lose the webhook a request had already answered 200 for; shutdown now waits for tracked work, bounded, and says how much it had to drop. And on any host where the process does not outlive the request, an un-awaited promise is not slow but cancelled — silently, behind a clean 200. `waitUntil` is the one construct both cases honour.

- **Configuration is read from the request: `getEnv`, `env`, `requireEnv`, `lazyResource`.** `const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)` at the top of a function file is a live defect today, not merely an unportable one: it is evaluated while the file is being imported, so an unset variable throws before any request exists and the loader reports the whole file as a *skipped function*. The route 404s, and the reason is one line in a boot log. `lazyResource(env => new Stripe(env.STRIPE_SECRET_KEY!))` builds the same client once, on first use, from that request's configuration. `rebase doctor` and `rebase build` now report module-scope `process.env` reads in the functions directory.

- **`rebase build` records what each function needs from its host.** The bundle manifest gains a `functions` array — name, file, and whether the function's own source reaches a Node built-in or a package that needs one. Purely descriptive: nothing fails, and a function that opens a file or runs raw SQL is a fine function. It is recorded because the name is already the function's identity everywhere (`/api/functions/<name>`, the `functions/<name>` API-key permission, `REBASE_FUNCTIONS_ONLY`), and a host that wants to know what is in a bundle should not have to boot it to find out.

- **Live schema editing, from the collection editor to the database.** A running backend can now plan a schema change, show what it would do, and apply it only once somebody agrees. `planSchemaChange` reads the live catalogue before it plans, because whether a `NOT NULL` can be added is a question about rows and whether an enum value will land is a question about the type — neither is answerable from the collections alone. The editor's save path shows the verdict in a sentence, then each change with its remedy, and does nothing until confirmed.

  Applying is a **second** privilege, not the same one that opens the editor: it alters the database and it writes a commit into the project's repository under somebody's name, and an admin credential is not an author. For deployments with no working tree — a Cloud tenant runs a built bundle and its repository lives elsewhere — the commit goes through GitHub's Git Data API instead of `git`.

- **A managed development database, so `rebase dev` needs no Postgres.** Getting a project running was `docker compose up -d db`, then `db push`, then `dev` — three steps, each a place to bounce, plus a compose file the developer then maintains. `rebase dev` now starts the database and pushes the schema itself. The managed database is PGlite behind a multiplexing socket server, and `db pull`, the schema flows and the rest of the CLI were wired through to meet it.

  Realtime was the one thing it could not do, and it failed in the worst way available: every query succeeded, `LISTEN` returned cleanly, and change events simply never arrived. It now works through a notification proxy.

- **`REBASE_DB_POOL_MAX`, a ceiling every pool honours.** The managed database is a single session, where two pooled clients holding overlapping transactions deadlock rather than error.

- **The RLS audit runs on a schedule, and the backend serves what it found.** Also `rls-check --html`: the text report is written for a terminal, and the person who has to act on it is usually not the person who ran the scan. A `--fail-on` exit code stops a pipeline; it does not survive being forwarded to whoever owns the database.

- **`rls-check --role`, because a check can only gate on a role it knows about.** Every check reports a table as exposed only when a role an untrusted caller can arrive as holds privileges on it, and that set was hardcoded to `PUBLIC`, `anon`, `authenticated`, `web_anon` and `rebase_user`. A stack whose app role is called `app_user` gave every check nothing to gate on, so the scan printed a clean report for a database it had not cleared. The report now also lists `unrecognizedGrantees` — write-holding roles it can neither recognise as exposed nor explain as trusted — so it says "clean as far as I could tell" rather than "clean".

- **Storage: byte-range requests and per-object access control.** Media can be seeked, and who may read an object is declared rather than coded.

- **Bot protection on the auth endpoints that cost something to hit**, development secrets that survive a restart, and auth email captured in development instead of refused.

- **An ANN index for every vector column**, with pgvector shipped in the scaffolded database image.

- **Collections declare their indexes, and a hand-written index stops
  disappearing.** The collection model had no `indexes` key: the DDL generator
  emitted index statements for exactly two things, both structures a *feature*
  owns rather than queries anyone wrote — the GIN index behind a `search` block
  and the ANN index behind a `vector` property. The plain case, the btree behind
  a `where` clause, had no declaration site at all.

  ```ts
  indexes: [
      { on: ["status", { prop: "publishDate", direction: "desc" }],
        reason: "admin list: filter by status, newest first" },
      { on: ["publishDate"], where: { prop: "status", op: "=", value: "published" },
        reason: "public feed is published-only" },
      { on: ["author"], reason: "an author's posts, and the ON DELETE cascade" }
  ]
  ```

  So the only way to have one was to write it by hand — which is the other half
  of this. `rebase db push` is declarative, so an index on a managed table that
  is absent from `schema.sql` is drift and Atlas plans `DROP INDEX` for it.
  `DROP INDEX` is not in `DESTRUCTIVE_PATTERNS`, so the auto-approved apply took
  it with no prompt. Measured against atlas v1.2.3 and Postgres 18, not
  inferred: create an index by hand, re-run an unchanged push, and the plan is a
  bare drop. Every hand-written index in the field has been living on borrowed
  time, and since a hand-written index was the *only* kind there was, that was
  the only outcome.

  Adding `DROP INDEX` to the destructive list would have been the wrong fix —
  once indexes are declarable, removing one from your config *should* remove it
  without a scare. Ownership is decided by the name instead, the arrangement
  policies already use. An index is named `<table>_<columns>_ix_<7 hex>` (`_ux_`
  when unique), which no other namer here can produce, so a declaration you
  delete drops as intended and an index Rebase did not create is excluded from
  the diff and never touched. That also settles the introspection round trip:
  the existing indexes of a database you point Rebase at are foreign until
  somebody declares them.

  The hash is over the index's *semantics*, not its rendered SQL, so
  reformatting the generator never renames a live object — and it is what makes
  a redefinition take effect at all, since `CREATE INDEX IF NOT EXISTS` matches
  on the name. (That bug is shipped today one layer over: `vector-index.ts`
  leaves `WITH (m, ef_construction, lists)` out of its name, so retuning an HNSW
  index is a permanent silent no-op.)

  `prop` takes a **property key, never a column name**, because the two differ
  in exactly the case people index most: a `belongsTo` resolves to its
  `localKey`, so `author` becomes `author_id`. `where` is structured rather than
  a SQL string — a string could not be checked against the collection's
  properties and could not be fingerprinted without putting its own text in the
  index name. And `reason` is required, and deliberately not hashed: an index is
  the only thing a config can declare that costs money forever and whose benefit
  is invisible from the config, so rewording the justification must not rebuild
  it.

  Both producers emit them — `db push` on the ordinary Atlas path, and
  boot-time schema ensure with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. The
  first cut only did the former, which a managed-runtime tenant never runs; the
  derived-names contract caught it, with the whole suite green and the round
  trip through real Atlas clean.

  Not included, each its own subsystem: the deferred `CONCURRENTLY` builder for
  a redefinition (today a DROP + CREATE holding a lock), a size-based push gate,
  `doctor`'s index categories, introspection adoption, and the drizzle-schema
  side. See [Indexes](/docs/backend/indexes).

- **A pod contract the chart and the control plane both answer to.** Probe paths, shutdown budgets, the bundle mount and the set of topology variables a deployer owns now live in one place that both pod builders read, instead of two hand-written lists that had already disagreed.

- **`rebase cloud resources` is priced, with no plan left to name**, and `rebase cloud projects info` prints a Storage line — plus a warning or a lockout notice when the project is near or past its limit. The shared pools already enforced a per-tenant disk ceiling by setting `CONNECTION LIMIT 0`; the tenant's first signal used to be their database refusing connections, with no number anywhere that would have warned them.

- **One-click deploy blueprints, an MCP registry manifest, and the security post.**

- **The eight documentation pages every locale was missing are translated**, with validation of what the model returns, and the landing page has a translation script of its own — the marketing pages read no markdown, so nothing had ever translated them.

- **Resources are declared, not configured — and there is one way to do it.** A
  database, a bucket and a topic are all spelled the same way, in the project's
  own config:

  ```ts
  // config/resources.ts
  export const main    = database();
  export const media   = bucket("media", { engine: "s3" });
  export const signups = topic<{ userId: string }>("signups");
  ```

  Before this, storage topology was hand-written into `rebase.json` while
  database topology lived in TypeScript, and the boundary between them was a
  fact about what the control plane could read before a build — a platform
  implementation detail a developer had no way to derive. Worse, a bucket could
  be declared in *both*, and the runtime merged them: one engine was kept and
  the other silently discarded. A declaration accepted and then ignored, which
  is the class this release removed everywhere it appeared.

  Kinds are **registered**, not hardcoded, because the cost of adding one is
  exactly why the last two ended up in different homes — a new kind needed a
  manifest schema edit, a validator edit and a switch statement, so the cheapest
  thing was always to bolt it onto whichever home was nearest. `cache`, `queue`
  or `search` now need none of that. Each kind owns its engine list and
  `custom:<id>` is always accepted, which fixes `engine` having been a free
  string: `"s2"` used to pass every check and fail far from the typo.

- **`rebase resources`** lists what a project declares; `--write` regenerates
  `rebase.resources.json` and `--check` fails on drift. That file is generated
  and committed, and it is what a host reads to decide what to provision
  *before* running anything — which is how a console can say "wants a `media`
  bucket, has none" on a first deploy, and how a `custom` runtime (which emits
  no bundle manifest) is visible to the platform at all.

- **Binding is separate from declaration, and identical everywhere.** A
  declaration says a resource exists; the environment says where it lives, on
  the `<BASE>__<KEY>` convention. Baking the address into the repository is how
  a project ends up with its staging credentials in git, and it is why staging
  and production can run the same commit against different infrastructure.

  The cloud is not a second mechanism: the control plane binds the same
  variables a self-hoster sets, so a managed tenant runs exactly the code path a
  self-hoster runs.

- **Several buckets can share one account.** `bucket("media", { account: "minio" })`
  reads its own `S3_BUCKET__MEDIA` while the provider-level variables —
  credentials, endpoint, region — fall back to `S3_ACCESS_KEY_ID__MINIO` and so
  on. Fifteen buckets on one install go from ninety variables to eighteen, and
  rotating a key is one edit rather than fifteen paired ones.

  The bucket name itself never falls back, and neither form falls through to the
  unsuffixed variable: that one belongs to the default source, and letting a
  named bucket inherit it would mean a mistyped key silently signs with another
  source's credentials.


- **Topics, delivered through the durable job queue.** Publishing writes one
  row *per subscription*, so each subscriber retries on its own schedule and a
  broken one neither blocks the others nor makes them run again. Delivery is
  at-least-once and says so — `at-most-once` is refused at declaration rather
  than quietly given the other guarantee. A publish inside a transaction that
  rolls back never happened. Declaring a topic turns the job queue on by itself,
  and a driver that cannot carry the queue refuses to boot rather than starting
  a backend where every publish throws.

- **The managed tier provisions what a project declares, and charges for it.** A
  second database is created on the project's own pool, owned by the same role,
  and billed as a second shared-database line. The disk quota moved from
  per-database to per-project for it: the ceiling used to be keyed on `datname`,
  so five declared databases would have held five full quotas against a volume
  sized to budget one each — the pool would have run out of space with nothing
  naming the cause. Sizes and allowances are both summed per project now, so a
  second database brings its own space rather than splitting the first one's.

- **Six-digit sign-in codes by email.** A magic link opens the session on
  whichever device holds the mailbox, which is the wrong device on a television,
  a terminal, a kiosk or a second browser — the flow simply cannot be completed
  there. `auth.emailOtp` (or `AUTH_EMAIL_OTP=true`) adds `POST /auth/otp` and
  `POST /auth/otp/verify`, and `rebase.auth.sendEmailOtp` / `verifyEmailOtp` in
  the client.

  Six digits is a million possibilities, so what is stored is a hash of the
  address *and* the code together: a guess is a guess against one named account
  rather than against every account in the table, which is what a code-only
  lookup would have made of it. Five verification attempts per address per
  window, keyed on the address rather than the caller's IP because an IP is the
  attacker's to rotate and the account under attack is not. Ten minutes, single
  use, uniform digits. `POST /auth/otp` answers identically for an address with
  no account, so it cannot be used to ask whether somebody is a customer.

  `AUTH_MAGIC_LINK` arrives with it: both flows were code-level flags only, so a
  bundle deployment — the shape every self-hosted and managed project runs —
  could not turn either on without rebuilding.

- **Storage triggers: run something when an object lands.** A row has
  `beforeSave` and `afterSave`, a schedule has a cron job, and an upload had
  nothing — so everything an upload implied had to be a second call from the
  client, which means it does not happen when the client goes away between the
  two. `storageTriggers` fires on `finalize` and `delete`, matched with the same
  pattern language `storagePolicies` uses, for the multipart and resumable paths
  alike. Handlers are awaited before the response, because a floating promise is
  one a serverless runtime may freeze mid-flight; a handler that throws is
  logged and does not fail the request, because the object is already stored and
  an error would tell the client to repeat a write that succeeded.

- **Image renditions can live in the storage source instead of one process's
  memory.** The transform cache was per-instance and did not survive a restart,
  so every replica computed every variant and every deploy threw the lot away.
  `storageRenditionCache: { enabled: true }` writes each rendition back to the
  source's own bucket under `_rebase/renditions/`, keyed by the source object's
  version so a replaced image serves the new one. Off by default, because
  turning it on makes a `GET` write to somebody's bucket — and when that write
  fails the request still succeeds from memory, with the reason logged once.

- **The development mailbox is readable over HTTP.** Auth mail with no SMTP
  configured is captured and its links printed, which completes the flow for
  somebody watching a terminal and leaves it incomplete for a server in Docker,
  in another window, or one line above where the log has scrolled to.
  `GET /api/admin/dev/emails` serves the same capture, `DELETE` empties it. What
  it hands out is a working login, so it is gated three times over: admin-only,
  a sink must be registered, and the handler re-reads `NODE_ENV` per request —
  there is no configuration that makes it readable in production.

- **A pooled Postgres port for the callers that cannot hold one.**
  `docker compose --profile pooler up -d` adds pgbouncer on 6432, for the
  serverless functions, scheduled scripts and BI tools that would otherwise
  exhaust `max_connections` long before the database is busy. Documented with
  what transaction pooling takes away — `LISTEN`/`NOTIFY`, session-level `SET`,
  cross-statement advisory locks, prepared statements — which is why the runtime
  keeps its direct connection. `SET LOCAL` survives, so RLS behaves identically
  through it.

- **The runtime keeps a little history of itself, and `rebase cloud metrics`
  prints it.** Drawing "CPU over the last hour" from Cloud Monitoring would have
  made the panel unportable the day the platform moves, for a feature every
  self-hoster also wants; metrics-server cannot help either, since it stores only
  the latest sample by design. So the process samples *itself* —
  `process.cpuUsage()` and `process.memoryUsage()`, no cluster and no vendor —
  into its own database, and anything that can read the database can draw the
  chart. A laptop, a Hetzner box and a Cloud tenant keep the same history from
  the same code. One row per series per minute, five series, swept to a
  fourteen-day window at boot, beside the job and cron stores and for their
  reason: it is the moment the schema is reachable and nobody is mid-request.

- **`rebase cloud resources set --replicas` and `--autoscale-max`.** Autoscaling
  had columns and no flags, so the console form was the only way to reach it.
  Two flags on the command that already writes every other dial, rather than a
  `rebase scale` verb — a second CLI surface writing the same row, whose
  `--size medium` form would have had to carry a t-shirt→cpu/memory mapping
  client-side, which is exactly what substrate differences (Autopilot's
  250m/512Mi floor and 1:1–6.5:1 band do not exist on Hetzner or EKS) make
  wrong. `--replicas` is the floor and the spend a project is guaranteed to
  incur; `--autoscale-max` is the ceiling and the worst case it may be billed.
  There is deliberately no `--autoscale on|off`, which would admit the
  incoherent state where autoscaling is on and the range is a single point.

- **A Terraform module for Hetzner**, and a Hetzner page that is true. The old
  page described a Rebase that no longer exists — Docker building a Node.js
  backend from a local Dockerfile, and boot creating only auth tables so
  collections 404 until someone runs `db push`. Both were wrong, in all six
  locales, and that page is where a reader lands from `/docs/deployment`. It is
  rewritten against the contract the self-host compose file implements, and
  points at that file rather than carrying a copy that can drift again. The
  module provisions the host — server, firewall, a primary IP that survives a
  rebuild, and a volume holding Postgres data, Caddy's certificates and the
  bundle cache. The volume is the reason it exists: replacing the host must not
  destroy the database, which the shell recipe cannot promise.

- **Live schema editing works on MongoDB.** `isSchemaEditingAdmin` is a
  structural check — a driver either offers `planSchemaChange` or it does not —
  and the Mongo driver did not, so a Mongo project fell back to the source-only
  editor, which is off in production. A schemaless database is the one place
  where changing a collection against a running backend cannot fail, and it was
  the one place it did not work. `planMongoSchemaChange` is short by the whole of
  its difficulty: no table to alter, so every change is applicable, nothing is
  refused, and there are no statements. What each change still carries is what
  happens to the **data**, because that is where a reader imports the wrong
  intuition — removing a property on Postgres is refused because it would drop a
  column, while on MongoDB the field stays in every document that has it and the
  API stops serving it. Saying so is the difference between knowing the data is
  there and assuming it is gone.

### Changed

- **JWT verification and signing are asynchronous.** `verifyAccessToken`, `generateAccessToken`, `verifyDownloadToken`, `generateDownloadToken`, `hashRefreshToken` and `extractUserFromToken` return promises. Nothing about their behaviour moved; the signatures did, and on purpose, before anything forced it.

  Every portable JWT implementation is asynchronous, because `crypto.subtle` is. So a later swap of `jsonwebtoken` — for `jose`, or for WebCrypto directly — is not the expensive part: the expensive part is going from synchronous to asynchronous verification, which touches every caller of every function that reads a token. That was 22 call sites in `src` and about 190 in the suite. Paying it now, with the tests green and nothing else moving, costs a day; paying it as a line item inside a runtime port, on top of everything else changing at once, is how a port stalls.

  `jsonwebtoken` is now confined to one module, `auth/jwt-crypto.ts`, which is what makes the eventual swap a one-file change with no caller affected. The one trap in that swap is written down where the swap will happen: `jsonwebtoken` stamps `iat` on every token it signs and `jose` does not, and `iat` is what the revocation watermark is compared against — tokens minted without it would verify perfectly and simply stop being revocable.

  `RateLimiterOptions.keyGenerator` and `resolveLimit` accept a promise as well as a value, since a limiter that buckets by user has to verify a token to find one. Passing a synchronous function is unchanged.

- **`EmailService.send()` reports what the provider said, and carries headers.** It returned `Promise<void>`, which meant an application that sent a message could not learn the id the server assigned it — so threading a reply back to the message that prompted it was impossible through this interface, and any app that needed it had to bypass the service and hold its own transport. It now resolves with `{ messageId, accepted, rejected }`, every field optional because not every backend reports them: an absent `messageId` means "not reported", never "not sent", which is still signalled by a throw. `messageId` comes back **without** angle brackets, since it is a value to store and compare against a reply's `In-Reply-To`, and one that sometimes carries brackets is a bug waiting in every comparison.

  `EmailSendOptions` gains `headers`. Several things a real sender must do are only expressible as headers and had no route through this interface at all: `List-Unsubscribe` and `List-Unsubscribe-Post`, which give a mail client its own one-click opt-out and which the large providers weigh when deciding whether bulk mail reaches an inbox; `In-Reply-To` and `References`, without which a reply starts a new thread. Values are **validated, not escaped** — a value containing CR or LF is rejected, because a newline ends the header and begins another one, so any field built from data the sender did not write is a way to add a `Bcc:`. Stripping the newline instead would deliver a message the caller did not write and tell nobody. Header names are checked against RFC 5322 too, and both checks run before a custom `sendEmail` provider is reached, so the custom path is not a way around them.

  Breaking only for code that *implements* `EmailService`: a `send` returning `Promise<void>` no longer satisfies it. Callers are unaffected — they may ignore the result — and the `auth.email.sendEmail` hook stays permissive (`Promise<EmailSendResult | void>`), so an existing `async () => {}` provider still works and simply reports nothing. The development mail sink now reports a synthetic id, so a flow that stores one and later matches a reply against it takes the same path in development as in production.

- **A vendored tree too large to upload is not vendored.** The control plane refuses a bundle over 100 MB, and vendoring is the one thing that can push a bundle near it — so a build that crossed the line shipped a bundle whose deploy would be rejected, with the remedy (`--no-vendor`) only discoverable by knowing that had happened. Past 200 MB on disk the tree is now thrown away and the bundle ships unvendored: 40–60s of cold start, and a deploy that works. `--vendor` keeps it regardless, for a deploy that builds from source and never uploads the tree at all.

  The ceiling assumes a pessimistic 2× floor on compression, because the limit is on the *compressed* upload while this measures the tree on disk. The warning below it now says which quantity is which — "201 MB, close to the 100 MB upload limit" was two different numbers described as one, and read as nonsense.

- **`GET /api/auth/config` answers one question once, from one handler.** Two handlers claimed that path: `init.ts` registers it directly and only afterwards mounts the auth router, so the router's copy never ran — and the two returned different payloads, one reporting `emailServiceEnabled` and `magicLinkEnabled` where the live one reported `passwordReset` and `magicLink`. A fix aimed at the wrong copy therefore changed nothing, which had already happened once. The router's copy is gone, the payload is assembled in one function, and the surviving route is rate-limited like the rest of the unauthenticated auth surface — it counts users on every call.

  In the payload itself, `registration` and `registrationEnabled` were the same boolean under two names, both advertised. `registrationEnabled` is the only one now, and it is required rather than optional: it says whether self-registration is open *right now*, first-user bootstrap window included. `anonymousLogin` is required for the same reason. `AuthConfig` in `@rebasepro/client` and `AuthConfigResponse` in `@rebasepro/app` are aliases of `AuthAdapterCapabilities` instead of near-copies of it — the SDK's copy listed an `emailServiceEnabled` flag no backend has ever sent, and marked as optional fields every backend always sends. A test pins the exact key set, because the drift that started this was a field *name*, and no per-field assertion can see one.

- **`PATCH` is the update verb for the data API.** `PUT` was mounted on the same handler and the generated OpenAPI spec described the operation twice — once as `patch`, once as `put` marked `deprecated` — so a client generated from the spec had to choose, and the verb it chose meant "replace" for a handler that merges. The SDK's `update()` now sends `PATCH`, which is what the spec has advertised since 0.14; `updateMany` was already there.

  `PUT` still answers, on the same handler, carrying `Deprecation: true` (RFC 8594). It was removed during this cycle and put back: every published SDK up to and including 0.16.0 sends `PUT`, so removing it broke clients that had no fixed version to upgrade *to* — see *`PUT` on a collection answers again* under Fixed. There is no `Sunset` date, because the removal is gated on which SDKs are in the field rather than on a calendar.

### Removed

Nothing below was deprecated in the usual sense of "still works, please stop". Each was a second name for something that already had one, and every one of them is gone. There is no compatibility mode.

- **`admin.titleProperty`** → `admin.display.title`. The same string works there, and `display.title` also takes a resolver. The old key had grown seven readers that disagreed about the fallback; a collection still carrying it is now rejected at boot, by name, with the replacement in the message — silence here would mean a title that reverts to the derived one with nothing to explain why.

- **`ctx.client` in a cron handler** → `ctx.rebase`. Its type re-exposed `client.data`, the alias `RebaseServerClient` omits on purpose so that the privileged plane is spelled `dataAsAdmin` on every server surface. A reader who learned `client.data` in a cron carried it into a collection callback, where `context.data` is the *user-scoped* plane: same spelling, opposite privilege.

- **`userId` as an identity spelling.** `AuthResult` advertised `uid` or `userId` from a custom validator, and the middleware had already half-removed it — the normalisation read `("uid" in r ? r.uid : undefined) || ("uid" in r ? r.uid : undefined)`, the same clause twice — so the documented `userId` had stopped working there while `getUser()` and the JWT verifier still honoured it. `uid` everywhere.

- **`RENAMED_SLOTS`**, the rewrite that quietly redirected the retired `collection.insights` and `home.card.insight` slot names, and the console warning beside it.

- **`WhereValue<T>`**, superseded by the operator-correlated `WhereValueFor`.

- **`tooltipsOpen` and `adminMenuOpen`** on both drawer components, **`error` and `padding`** on `RelationSelector`, and the ignored second parameter of `getEntityTitlePropertyKey` — all declared, all documented, none of them read.

- **`isBootstrapCompleted` / `setBootstrapCompleted`** on the auth route module and the admin users route. No caller ever supplied them; the bootstrap gate is "does this backend already have an admin", asked of the rows.

- **The websocket client's `subscriptions` map** and the "legacy subscription handling" branch that read it. Nothing ever wrote to it.

- **Three modules that only forwarded exports**: `@rebasepro/types/controllers/database_admin` (already exported from `types/backend`), `server-postgres/utils/table-classification` (from `@rebasepro/common`), and the `unflattenObject` re-export in the admin's `file_to_json`.

- **`rebase build --legacy` and `rebase start --legacy`** are now `--workspace`. The mode is supported, not retired, and the name said otherwise.

- **`UploadFileResult.storageUrl` is required.** Every controller returns one — S3, GCS and local alike — so the `??` fallback behind it was dead code.

- **`dataSources` and `storageSources` on `RebaseBackendConfig`**, and the
  `storage` block in `rebase.json`. All three were ways to declare a resource
  somewhere other than a declaration. Each is refused at boot, by name, with the
  replacement in the message — not ignored, because a key that still parses and
  no longer does anything is the failure this replaced.

  `<Rebase dataSources>` and `<Rebase storageSources>` are unaffected: those are
  props on the React provider, a different surface. Hand them
  `declaredDataSources()` and `declaredStorageSources()` so the list is not
  written twice.

### Fixed

- **`PUT` on a collection answers again, because every published SDK still sends it.** PATCH became the update verb and the PUT alias went with it. That reached a control plane before it reached any client: `collection.update()` sends PUT in every release up to and including 0.16.0, which was tagged three days before the change landed, so upgrading to `latest` did not help either. Three CLI commands are one `update()` — `rebase cloud stop`, `start` and `restart`, all through `setStatus` — and all three answered `404 No PUT route on collection 'projects' at this path`, which reads as a fault in your own data model rather than a verb that was withdrawn. Worst on `restart`, the thing you reach for when a deploy has gone wrong.

  PUT is mounted on the same handler and carries `Deprecation: true` (RFC 8594). It is deliberately **not** in the OpenAPI document: PATCH remains the single update operation, so anything generated from the spec still sends the verb the server means, and a spec-validating gateway still sees one operation. There is no `Sunset` date, because the removal is gated on which SDKs are in the field rather than on a calendar — it goes one release after the first published client whose `update()` sends PATCH.

- **`executeSql({ role })` answered a refused role switch with owner rows.** The option exists so a statement can run *as* a database role, which is the only way to see what a table looks like with RLS binding. When `SET LOCAL ROLE` came back `42501` — the connection user not being a member of the role — the driver logged a warning and ran the statement on the unswitched connection anyway, then latched a process-wide flag so every later call skipped the switch too, in silence.

  Owner output is not a degraded answer to that question, it is a confident wrong one: a policy spot-check reads a protected table as exposed. The WebSocket audit line recorded `role` as the role that had been *asked for*, so the trail agreed with the mistake rather than catching it. The same subsystem already fails closed twice over — `applyAuthContext` aborts the transaction when the switch errors, `scopeDataDriver` refuses the request rather than proceed unscoped — so this was the one door left open, and the only one whose fallback changed which rows came back.

  It now throws `RoleSwitchUnavailableError`, naming the role and both ways out. `DISABLE_DB_ROLE_SWITCHING=true` is unchanged and remains the sanctioned way to run SQL Editor queries as the connection owner: that is an operator's decision, not a failure. `effectiveSqlRole` reports which of the two actually applied, so the audit line no longer restates the request as the outcome. Asking for the role the session already holds needs no switch and still runs — that is the Studio role picker's default, and it never went near the failing path.

  Not an escalation, and worth saying so: every caller that can pass `role` already holds owner — `rebase.sql` is trusted server code whose default is the owner connection, and the `EXECUTE_SQL` WebSocket verb is admin-gated. This is a correctness and assurance fix, not a patched hole.

- **`rebase cloud deploy` read its own command word as the app name.** The command parsed `process.argv.slice(2)` permissively and took the first positional as the app to deploy — but that slice removes only `node` and `rebase.js`, so the first positional is always the string `cloud`. Every documented invocation therefore refused itself: `rebase cloud deploy --bundle` answered *This repository declares no app named "cloud". It declares: backend, web.* — on any project that did not happen to declare an app called `cloud`, which is all of them. `rebase cloud deploy <app>` was unreachable for the same reason: the app argument landed at `_[2]` and was never read.

  The failure pointed away from itself, which is what made it expensive. The refusal comes from `selectDeployApp` and names the apps the manifest really declares, so it reads as a fault in the user's `rebase.json` — and `rebase apps list` calls the same manifest valid and eligible. The only route through was `--bundle-dir`, which skips app selection by skipping the build and the static fold with it, so it uploads whatever is already on disk: correct immediately after a `rebase build` and a stale site at any other moment.

  `deploy` now parses through `parseCloudArgs` like the rest of the family, with `commandWords: 2`, so the command words are dropped from the *parsed* positionals — a flag written before the group no longer shifts the app either. Being a strict parse, it also refuses a flag nobody declared (`--bundel` no longer deploys) and a second positional, rather than treating either as the app name. `--url` joins `GLOBAL_CLOUD_FLAGS`: `resolveCloudUrl` honours it on every line in this family, so a strict parse had to accept it. The tests assert the resolved app name directly rather than through a fixture manifest — a fixture that happened to declare an app named `cloud` would have passed against the broken parse.

- **The published types were `any` for anyone using modern Node module resolution.** Every package here is `"type": "module"`, and `tsc` writes relative specifiers into `.d.ts` exactly as the source wrote them — extensionless, because the source is compiled by a bundler. Under `moduleResolution: "nodenext"` (or `"node16"`) an extensionless relative specifier inside an ESM declaration file is an error, and TypeScript's response is the part that matters: it does not fail at the consumer's import. It resolves the package, discards every declaration it could not follow, and types the whole import `any`.

  So there was no diagnostic anywhere near the cause. The first thing a consumer saw was an implicit-any error in **their own file**, pointing at their code, in a project that had done nothing wrong. Measured on `@rebasepro/server`: `bundler` resolution saw 170 value exports, `nodenext` saw **zero**. It had been that way for the entire life of the packages and was never reported, which is what a silent failure looks like from the outside.

  Fixed by appending the extension the declarations always needed — `./init` → `./init.js`, and `./auth` → `./auth/index.js` where the target is a directory, resolved against the filesystem rather than guessed. This is not a trade: TypeScript maps a `./x.js` specifier onto `./x.d.ts` under `node10`, `bundler` and `nodenext` alike, so nothing that worked before stops working. The rewrite runs as a build step in all twenty-one published packages.

  Nothing in this repository could have caught it, and that is the more interesting half. `pnpm typecheck`, the docs verifier and the template checks all map `@rebasepro/*` onto **source**; the API-surface gate reads a single `.d.ts` in isolation. Every gate looked at something other than the artifact a stranger installs. `pnpm check:dts` now looks at that: it installs each built package into a throwaway directory by symlink, imports it, and asks the type checker whether the result is `any` — a question that needs no knowledge of any package's API, and so keeps working as they change. It runs in CI after the build.

- **`bundle.mode: url` had never worked, and three independent things blocked it.** The runtime's fetch looked for a `rebase-bundle.json` that nothing has ever written — the CLI writes `manifest.json` — so no unpacked directory was ever recognised as a bundle; the entrypoint exited 1 before `@rebasepro/server` was imported; and the chart rendered a pod missing what the working path expects. Removing any one of them changed nothing, which is how the mode stayed dead while being documented, validated by the gate, and offered in the values file.

- **The runtime image stripped four packages it never supplied.** `packages/cli/src/bundle.ts` removes five `@rebasepro/*` packages from a bundle's declared dependencies on the grounds that the image supplies them; `docker/entrypoint.mjs` supplied one. Custom functions and cron jobs therefore failed to load with `Cannot find package`, the routes 404'd, and the container reported itself healthy — only a boot-log warning separated a deployment whose code ran from one where none of it did. The entrypoint's dedupe step also only *repaired* a duplicate and never *provided* a missing copy, which is the common case.

  The same gap was then live on the fetch path, which does its own stitch after the download and carried a one-package list of its own. All three lists are now checked against each other.

- **The published image could not load its own Postgres driver.** The driver's barrel eagerly imported a file watcher used by exactly one `--watch` branch of a CLI, and the image's hand-maintained dependency list does not include it — so `@rebasepro/server-postgres` failed to load entirely and every `/api/data/*` route 500'd behind a green container. Found by a new acceptance run that builds the image from source, brings the documented compose file up, and asserts from outside the container.

- **A static app dropped requests on every rollout**, and a killed bundle install left a tree the next boot mistook for a finished one — at a 128Mi limit npm is OOMKilled holding 124 of 156 packages, which is indistinguishable from success unless something records completion.

- **The chart's probes contradicted the runtime, and the api counted every caller as one caller.** `TRUSTED_PROXY_HOPS` was set on the functions unit and never on the api, so a default install ignored `X-Forwarded-For` and keyed every rate limit to the ingress. The chart also stopped offering `migrationJob.mode: push`, which the image refuses outright.

- **`REBASE_RLS_AUDIT` was a topology variable the pod contract did not claim.** The runtime reads it to decide which process owns the RLS audit scan, beside `REBASE_CRON_SCHEDULER` and `REBASE_JOB_WORKERS`, but it was never added to the list a deployer owns — so a tenant could set it to `false` and stop their own audit with no error anywhere.

- **Two auth gaps on the WebSocket path.** `ADMIN_ONLY_TYPES` held nine strings while the handler answers ten privileged verbs; the tenth ran `SELECT DISTINCT unnest(roles)` over the users table ungated.

- **A storage key containing `#`, `%` or an encoded slash addressed the wrong object.** Every storage URL interpolated the key raw and the server decodes what it receives.

- **Three ways a legal database name generated a file that will not parse.** A hyphenated collection slug, a search column with a hyphen, and a table name legal in Postgres each produced a JavaScript identifier that is not one. The same file already defined `quote`, `propKey` and `member` with docblocks explaining exactly this; they were applied in some positions and not others.

- **Seven presentation keys were accepted at boot and then ignored.** `fixedFilter`, `includeId`, `includeEntityLink`, `widget`, `sortable`, `canAddElements` and `previewProperties` were still listed as top-level keys on the four property types they used to live on, so on exactly those types the key was accepted, the migration hint was never reached, and nothing read the value — while the identical key on any other type failed with a helpful message.

- **The history prune could delete below `maxEntries`.** It decided how many rows to drop and which rows to drop in two separate reads, and the prune runs unawaited once per write — so two in flight both counted three rows, both decided to drop one, and the second re-read and took a row that was never surplus. Silent data loss, worst exactly where history matters: a record being written concurrently.

- **Reading a UI preference could crash the whole render.** Four call sites guarded `localStorage` with `typeof window !== "undefined"` and then used the bare global, which answers "am I in a browser" rather than "can I read storage". Safari in private mode, a blocked cookie policy and a sandboxed iframe all throw on the property *access*, so a user in that state got a blank admin panel instead of the default theme.

- **`rebase cloud billing` and `resources` never printed a price.** Both called `invoke("pricing/quote", …)`, and `invoke` URL-encodes the function name, so the slash became `%2F` and the route 404'd — every time, since the commands shipped.

- **`pg` was imported at runtime and declared dev-only**, so `rebase db pull --anonymize` would fail in a published CLI under pnpm's isolated layout while resolving fine in this workspace.

- **The realtime `vectorSearch` refusal existed and could not fire**, `clearFilter` reset to `defaultFilter` so a collection defining one could never clear its filters, and the admin decided from whether an answer had arrived rather than from the answer — a save in the first round trip after mount silently took the unconfirmed branch.

- **A dead local proxy is not a TLS problem.** `rls-check` translated every `ECONNRESET` into advice about `sslmode=require`, which is right for a managed provider and actively misleading for a loopback proxy that has died.

- **The agent-skills subpath could never reach a skill** — `exports` declared a trailing-slash directory export that Node has deprecated and cannot resolve a file through — and a scaffolded project had no schema resource, because two helpers assumed this monorepo's `app/` layout.

- **"Cancelled deployment null" was the fix reported as a bug**, the auth bootstrap probe swallowed its own failure and answered "already set up" in silence, and `rebase dev` announced the database twice during start-up.

- **Storage delivery**: a replaced image no longer serves its old rendition, private objects are no longer marked public, `Content-Length` is declared so a player can work out what to seek to, and cacheable responses say so.

- **The snapshot recorder produced snapshots that could not restore**, which is why the upgrade gate had decayed to two hand-written files while 0.14, 0.15 and 0.16 shipped without one.

- **`frameworkVersion` meant two different things** — the framework the runtime image ships, and the framework a bundle installed — so `cloud status` and `cloud deployments` read as contradicting each other.

- **The schema dialog is no longer downloaded before login**, 14 kB of eager JavaScript for a dialog that only opens when somebody edits a collection.

- **Two documentation routes only non-English readers reach were dead**, 124 landing strings whose English had moved on are resynced, and `--refresh-stale` stopped reporting ten keys that were already correct.

## [0.16.0] - 2026-08-20

### Added

- **A relation picker can create the row it is looking for.** The list ends in an *Add …* action that opens the target collection's form in the side panel, over the form you are already filling in; saving it closes the panel and leaves the new row selected, with no second trip through the picker. Until now a relation could only point at something that already existed, so a company that was not in the list meant abandoning the form, going to that collection, creating the row and starting again — and on a record being created, everything typed so far was lost.

  A search that matched nothing is the name you were looking for, so it seeds the new row: typing `EDU.MX` into the picker and choosing *Add "EDU.MX"* opens the form with that already in the title field. Only when the collection's title lands on a plain string property — putting free text into an enum or a relation would be worse than not prefilling — and the action itself appears only when the user could actually insert into the target, the same permission the selection dialog's own *Add* button checks.

  The create form does **not** take the URL. It is a detour inside the form you are in, and a record that does not exist yet has no address to restore; pushing one made closing it a *pathname* change, which is exactly what the unsaved-changes blocker watches — so a successful save raced the panel clearing its own dirty flag and often answered with "There are unsaved changes", with the URL stranded on the target collection.

  The dialog widget already worked this way — except for the URL, which it took too. Its *Add* button is fixed with it, so both create-in-place paths now leave the address bar where the form is.

- **A unit of a split deployment can be released on its own.** `functions.image.tag` in the Helm chart (and the `api` / `worker` equivalents, or `bundleUrl` under `bundle.mode: url`) holds one unit at a build of its own, so a fix to a custom function no longer restarts the API. Empty by default: every unit renders one image and one bundle, which is still the shape to prefer. Pinning only the tag inherits the repository, because the common case is one project and one image with one unit held back.

  Two units on different builds are two sets of collections against **one** database, and only one unit provisions it. So the rule, stated in the values file and in the docs: **the unit that owns the schema rolls first, and a unit may lag but must never lead.** A unit running ahead queries columns that do not exist yet and relies on RLS policies nobody applied — the first is a SQL error on one route, the second is an empty result with a 200. A unit running behind is the ordinary state of any rollout in progress. The migration Job renders the release-wide image, so it always leads the pinned units by construction.

- **The Helm chart is published.** `helm install rebase oci://registry-1.docker.io/rebasepro/rebase` — an OCI artifact beside the runtime image, pushed by the same release job under the same credentials and verified pullable from outside with no credentials, exactly as the image is. Until now the chart existed only inside the repository, so installing it meant cloning first: the same defect the runtime image had in 0.13.0, when the first command a new self-hoster ran answered `pull access denied`. A guard asserts an automated workflow publishes it, so it cannot regress quietly the way its predecessor did.

  The chart carries the **same version as the runtime** rather than its own. It ships with the runtime and its default image tag was already held to the runtime's version; two numbers would mean working out which pairs with which, and there is no useful answer to that question. Both are gated against `@rebasepro/server`.

- **The runtime records the collections schema version it applied, and every other process checks itself against it.** The process that provisions writes a version into `rebase.schema_meta`; every other process computes its own from the collections it loaded and compares. On a disagreement it names both versions, says which way is safe, and serves anyway — during a rollout that disagreement is *correct*, because the units that have not rolled yet are supposed to be behind. `REBASE_REQUIRE_SCHEMA_MATCH=true` (or `sharedState.requireSchemaMatch` in the chart) refuses the boot instead, for a deployment that would rather not serve at all than serve wrong.

  The stamp lives in the database rather than behind an HTTP call to the api, and the difference is not stylistic. Asking the api needs its address configured on every other process — a variable whose absence disables the check silently — and makes booting depend on another process already being up. It also asks the wrong question: two processes can agree with each other while both disagree with the database, and the database is what they are all about to query. It is additionally the only form that works for a `worker`, which has no reason to know any URL, and for a single `all` deployment scaled to three, where there is no api to ask.

  Both sides of the comparison are **computed** from the collections in hand, never read from a bundle manifest. A version a build declares about itself is not evidence that the database agrees with it — `/api/meta/schema-version` returns exactly that declared value, which is why comparing that endpoint to that manifest is a check that passes on a bundle whose declared version is nonsense.

  What it cannot do is tell you which side is ahead: a schema version is a hash, so it reports disagreement and never direction. That is why the rollout order is a documented rule rather than something the runtime enforces.

  A driver older than the runtime has neither hook — the image supplies `@rebasepro/server` while the driver comes from the bundle — and that is treated as "this driver does not record a version" rather than as a boot failure. The check starts working when the project's driver is next updated.

- **An entity view can sit in front of the record's own tab.** `position: "start"` on an `EntityCustomView` meant "first among the custom views", which placed it after a tab it was already after — the record's own tab is drawn unconditionally first, so `start` and `end` only ever ordered the custom views against each other and no collection could open on anything but its form. That contradicted `defaultSelectedView`, which has always been able to name a custom view as the landing tab. A cover — a read-only summary of a record, the thing an operator opens a row to see — now renders before the form that edits it. A view that says nothing still lands after the record, so nothing moves for a collection that never asked.

- **The record count sits in the collection toolbar.** It lived in the breadcrumb trail, which the app bar owns, so a collection rendered without an app bar simply had no count and no way to see how many rows a filter resolved to. It now ends the toolbar's leading group, after the filter, sort and preset controls — the count is what those resolve to, and it reads as one sentence with them. Hidden wherever the toolbar goes icon-only, because a passive readout is the first thing that should give up its room on a strip that scrolls.

- **`rebase cloud resources` shows what a project is given, and changes it.** The dials print with "plan default" where one is unset, so *chosen* and *inherited* are visible rather than inferred, and `resources set` sends only the dials named — a patch carrying every field at its default would overwrite dials set from another client. Nothing here validates a value on purpose: the rules belong to the target cluster (Autopilot bills a 250m/512Mi floor and rewrites anything outside a 1:1–6.5:1 memory:CPU band; a Hetzner or EKS node has neither), so a CLI carrying those numbers would be wrong for two of three providers the day it shipped.

- **A cluster can be registered and verified from the command line.** `rebase cloud clusters` was list-only, so registering one meant inserting a row by hand and finding out whether it worked when a customer's first deploy failed inside provisioning. `clusters add` registers from a kubeconfig and points straight at `clusters verify`, which reports what the control plane found — reachable, what the identity may do, what is installed, and a verdict — and exits non-zero on `unusable` so it works as a gate in a runbook. Registration stays admin-only, matching the collection's RLS: a cluster record carries a credential that can create namespaces and read every secret in them.

- **`rebase doctor` reports a connection string libpq cannot parse.** Fixing the generator does nothing for the projects it already generated, and this defect is invisible day to day — node-postgres accepts the string, so `rebase dev` and `rebase db push` work while `rebase db backup` has never once succeeded. Doctor now scans `.env`, `.env.local` and the compose files for `DATABASE_URL` and `ADMIN_CONNECTION_STRING` and prints the corrected string to paste back. The compose files are checked on their own account: a deployed stack's scheduled backup cron reads its connection string from there, so it stays broken after `.env` is repaired.

- **The default auth emails carry your logo.** All five built-in templates — password reset, verification, invitation, welcome and magic link — render `email.logoUrl` above the card, and the six auth call sites that each carried their own `appName || "Rebase"` line now resolve branding in one place. The fallback is asymmetric on purpose: `appName` falls back to "Rebase" because an unconfigured app has no better name to show, and the logo does not follow it, because the alternative is mailing Acme's users a Rebase mark from Acme's domain. It must be a PNG on an http(s) URL — mail clients do not render SVG and block `data:` URIs, so a non-http(s) `logoUrl` renders no logo rather than a broken image.

### Changed

- **Discarding an edit is undoable.** *Discard* and *Clear* sit beside *Save*, throw away everything typed since the record was opened, and until now did it permanently: the reset replaced the form's undo history with a single entry, so the ⌘Z that would have brought the edit back had nothing to step into. The identity bar's version does not even stop to ask — one click, one lost form. Both now go *through* the history rather than around it, and both raise a confirmation carrying an **Undo**, which is the only place the way back can be offered: the form has no undo button, only a shortcut nobody has a reason to guess at.

  What is stepped back into is the edit, not just its values. The entry the reset leaves behind carries the touched map as well, because the draft backup is extracted *through* that map — restore the values alone and the record comes back looking pristine to everything that asks, including the backup that is supposed to survive a reload. The step also re-publishes the form's version, so a field holding state of its own — a markdown editor, which re-seeds only when that moves — comes back with the rest instead of staying cleared over a value that has already returned.

  Ordinary undo is untouched: stepping back over a keystroke deliberately does *not* re-seed every field, which is why the two are distinguished at all. A reset the form performs on its own — after a save, on a new record — still clears the history, since there is nothing behind it worth returning to.

- **The form's metadata rail widens a little where there is room for it.** 304px to 336px past `@7xl` of *form* width — the same container signal the content column already widens on, so a side panel inside a large window keeps the narrow rail rather than taking a viewport breakpoint's word for it. 304 was picked against the narrow end, where the extra 32px went to the gap beside a chip; on a full-screen form it comes out of the gutters instead, and the status select and date picker in there are the same controls as in the column.

- **Realtime is a runtime surface now, and the roles that serve no websockets no longer pay for it.** It was neither a surface nor role-aware, so every role ran it — including `functions` and `worker`, whose entire claim is that they touch nothing. Both mounted a websocket server no client could reach, both held a dedicated `LISTEN` connection outside the pool for the life of the process, and both installed the change-capture machinery at boot: a schema, a trigger function, and a `DROP`/`CREATE TRIGGER` pair per collection table.

  That last part contradicted the invariant the runtime otherwise refuses to boot without. `REBASE_ROLE=functions` and `REBASE_ROLE=worker` are rejected unless `REBASE_MIGRATE_ON_BOOT=none`, on the grounds that exactly one process owns schema DDL — and then the driver ran schema DDL from all of them anyway, from a code path that never asked the role. Nothing was corrupted (each statement is idempotent, and the multi-statement string is atomic), but every rollout took an `ACCESS EXCLUSIVE` lock per table per pod for no reason.

  Writes made by those processes are still heard. Capture is database triggers, so a change is published by the database rather than by whichever process made it: a function that writes a row still wakes every subscriber on the `api`.

  The driver is told two things separately — whether this process consumes change events, and whether it owns the DDL — because they genuinely come apart. An `api` behind an external migration Job subscribes without provisioning.

- **A bundle's dependencies are installed once, by `rebase build`, not on every pod start.** A managed pod's bundle lives on an emptyDir, so it was re-fetched and re-installed on every start — an eviction, a node failure, an OOM, a runtime rollout — and that install is 35–55 seconds of a 40–60 second cold start. It is therefore the price of every unplanned restart a tenant suffers, not a startup detail. The pod side needed no change: the init container already skips installing when `node_modules` is present. Native code is never vendored (a compiled binary is only valid for the platform it was built for), and a failed install is never fatal — an unvendored bundle is what every project shipped before this existed. Nor is an *incomplete* one accepted: if the installed tree does not contain the database driver — which happens when the project declares it at a version no registry can serve, a `workspace:` range in a monorepo — the tree is thrown away and nothing is vendored, because the init container skips installing when `node_modules` is present, so a partial tree does not start slowly, it does not start at all. `--os=linux --cpu=x64` is the load-bearing flag, and not because of native modules: the dangerous case is a pure-JS package whose real work lives in a platform-specific *optional* dependency, esbuild being the one everybody meets.

- **A new logo and mark, everywhere the panel draws one.** `RebaseLogo`, the favicon it sets, the docs header, the site's own icons and the example apps'.

- **Semibold is the ceiling of the type ladder — no weight above 600.** `h1`/`h2` had already been walked back to `font-medium` when the site and the panel were reconciled, leaving the stat variant as the last `font-bold` and a comment announcing a "display tier" rule nothing implemented any more. The display end separates itself by size and tracking, not by weight: a 30px 700 beside a 30px 500 elsewhere in the same product reads as two type systems rather than one ladder, which is exactly what shipped — the marketing site at 500, the panel's stat tiles at 700. Swept, because a ceiling nothing enforces is a preference: every hand-written `font-bold` is now `font-semibold`, and the `font-black` / `font-extrabold` above it came down with it.

- **A driver *ahead* of the runtime is reported too.** Version skew was one-directional: a driver behind the runtime was named at boot, a driver ahead by a minor was silent — and that is the pairing a floating runtime range produces when the image lags the packages a project builds against, with half a feature present in the bundle and the other half missing from the harness, in a process reporting itself healthy. Patch leads stay silent on purpose: pinning one fix forward is deliberate, and warning about it trains people to ignore the line.

### Fixed

- **A select in a side panel opens where you can see it.** The panel hands its descendants a portal host — itself — so their popups open inside the modal, where the focus and scroll locks let them be used at all. It also carried `will-change: transform` for the slide-in, and that (like `transform`, `filter` or `perspective`) makes an element a *containing block* for its `position: fixed` descendants. A select dropdown is fixed and positioned in viewport coordinates, so inside the panel those coordinates resolved against the panel instead and every list came out displaced by the panel's own left offset — far enough, on a right-hand panel, to open past the edge of the screen. Open, correctly stacked, and nowhere anyone could see it, which is indistinguishable from a select that ignores clicks.

  Popovers, menus and date pickers in the same panel were unaffected: their positioning measures the offset parent and subtracts it. Only the select's item-aligned placement does the arithmetic against the viewport itself, which is why one control looked broken while its neighbours did not.

- **A collection's default sort survives its own mount.** `admin.sort` had no effect on any collection view: rows arrived in the table's natural order however the sort was written, while REST and the realtime socket both ordered correctly when asked directly — which is what made it look like a transport bug. It was not. The table controller subscribed twice, once with the sort read off the collection and then immediately again with no `orderBy` at all, and the second answer replaced the first. The URL-sync effect mirrors the sort with `history.replaceState`, which react-router does not observe, so `useLocation()` kept reporting the search string the view mounted with — the empty one — and a re-render caused by nothing more exotic than a caller passing `fixedFilter` as an object literal parsed it and cleared a default no user had touched. An explicit `?__sort=` in the URL still outranks the collection's default, and back/forward still syncs.

- **A card no longer prints the row id above its own title.** Every card in the grid led with a truncated uuid sitting over the product name; `isId: "uuid"` is the default for a Rebase collection, so that line was noise on most of them, and at a card's width it is too short to copy — which is the only thing an id on screen is good for. The card was the odd one out: a list row and a board card show an id only when nothing else names the record. That fallback is untouched, so a record with no readable name still gets its id. `hideIdFromCollection` is not the lever for this and stays exactly what it was: the table reads the same flag for its ID column, where an id is genuinely useful.

- **One signed-URL request per file, not one per thumbnail.** A collection view draws one thumbnail per row and rows share images far more than not — 200 blog posts illustrated by 20 hero files. Each thumbnail minted its own download token on mount, and the URL cache is only written when a response *lands*, so it deduped nothing during the burst: 100+ requests for 20 distinct files, which spent the whole rate-limit budget on one page view and made every image on the screen fail together with a 429. The in-flight promise is now shared per cache key — 20 requests, all 200. Deliberately not a longer-lived cache: a signed URL is temporal, so a later mount refetches exactly as before and only the concurrent duplicates are removed.

- **The storage limiter counts a signed-in caller as signed in.** A request to `/api/storage/*` carrying a valid admin JWT came back `x-ratelimit-limit: 300` and shared an `ip:` bucket with unauthenticated traffic — everyone behind one NAT together — where a signed-in caller should have had 1000 keyed by uid. The same token on `/api/data/*` reported 1000 correctly, which is what made it look like a quirk of the demo. The limiter reads the user off the context; on the storage router it is registered before the routes, and the JWT middlewares live inside them, so both the key and the limit fell through to their anonymous arms. It now derives the uid from the bearer token itself when the context has none, and uses it **for bucketing only** — pre-resolving the user into the context instead would change authorization, not just accounting, letting a Rebase-signed JWT satisfy a deployment that delegates auth to Firebase or Clerk. An unverifiable token buckets by IP exactly as before.

- **`rebase db backup` works on a generated scaffold.** `rebase init` wrote a `DATABASE_URL` whose `options` value carried a literal `=` (`?options=-c%20search_path=public&sslmode=disable`). libpq splits a URI query parameter on the first `=` and rejects any further one, so every libpq caller failed on a fresh project — `pg_dump`/`pg_restore` behind `db backup|restore`, and a plain `psql "$DATABASE_URL"` copied out of the generated `.env`. It shipped because node-postgres parses URLs itself and accepts the literal form, so `rebase dev` and `rebase db push` worked and nothing exercised the URL; the `--database-url` branch had always encoded it, and no test compared the two. Fixed in `init`, `.env.example`, both compose templates and the deployment skill — the compose files on their own account, since a self-hosted stack's backup cron failed the same way. A failed `pg_dump` also no longer leaves a 0-byte artifact behind, which `backups list` showed as an ordinary backup and pruning ranked by timestamp alone, so the corpse held a protected slot while a real backup aged out under it.

### Testing & CI

- **Type names claimed in prose are checked, not just the ones in code fences.** Every doc verifier so far read *fenced code* — `check-api-names` greps imports, `typecheck-snippets` compiles the fences outright. A markdown **table** is neither, and a reference table is the shape nobody runs: it is where the agent skills had drifted furthest. `check-prose-types.mjs` reads backticked `*Props` / `*Config` / `*Options` / `*Hooks` / `*Context` / `*Callbacks` names *outside* fences and requires that something in `packages/*/src` declares them.

  It found, and the sweep removed: `BackendHooks`, `UserHooks`, `DataHooks` and `BackendHookContext`, taught across two skills together with a `hooks.data` config block — none of the four types exists and `RebaseBackendConfig` has no `hooks` key at all, so an agent following it wrote configuration that type-errored or, in plain JavaScript, was silently ignored; `AdminCollectionConfig`, deleted on purpose and still the annotation one skill told agents to write; `EntityOverrides`, for a collection option no config type has; and six `*Props` names in the component-override table, in all six locales, for an override map that is not typed per key at all.

  The suffix filter is the whole design. A bare capitalised word in backticks is as likely to be a product name, an HTTP verb or a column type as an identifier; `SomethingConfig` is a claim about this repository's types nearly every time. That is what makes it precise enough to be blocking rather than a backlog.

- **The documented CLI is checked against the CLI.** `check-doc-commands` had globs for the agent skills, the example READMEs and the repository's own agent instructions — and never for `website/src/content/docs/`, the published documentation. Two commands lived in that gap for as long as the pages have existed: `rebase db studio` had a section of its own in both the CLI reference and the schema page, and `rebase auth create-user` was the first line of the auth example. Six locales each, because the translations are generated from English and inherit whatever it says. Neither command has ever existed; both exit 1. Pointing the existing check at the docs needed no new parser, only the glob nobody had added. `CHANGELOG.md` is exempt — a changelog records what *was* true.

- **A first-party GitHub URL must name the repository the package declares.** `rebase-agent-skills/README.md` offered six ways to install and five routed through `github.com/rebaseco/agent-skills`, a standalone mirror that does not exist: `npx skills add`, `gemini extensions install`, `claude plugin marketplace add` and a `git clone` all answered 404, and both plugin manifests advertised the same address as their `homepage` and `repository`. The one path that worked, `rebase skills install`, was Option 1 and the only one needing no repository at all. Checking that a URL *resolves* would need the network, which a gate must not; checking that it names the repository `package.json` declares needs nothing, and is what actually went wrong. Only first-party-looking URLs are checked — an owner within an edit or two of ours, or a repo named after this bundle — so a skill linking `nvm-sh/nvm` is untouched.

- **The release stamps the Helm chart along with the packages.** Neither `scripts/release.sh` nor the stable publish workflow touched `charts/rebase/Chart.yaml`, so every release moved `@rebasepro/server` and left the chart on the previous number — and `appVersion` *is* the default image tag, so `helm install` with no `image.tag` rendered a version behind the one just published. `check:runtime-image` caught it, but only after the fact, on the next run. Both paths bump it now, beside the package bump, and refuse the release if neither field matched.

- **The Helm chart is checked.** It shipped with no coverage of any kind: no lint, no `helm template`, nothing in CI — and its failure mode is a cluster that comes up looking right. `pnpm run check:chart` lints it, renders the five topologies it documents, and reads the decisions back out of the manifests: the roles, who provisions, that the worker gets no Service, that `/api/functions` reaches the functions unit in one hop through the ingress rather than two through the api's proxy, that a static app takes its own image and carries no Secret. It then extracts every `fail` from `_validate.tpl` and requires a case that reaches it, so a refusal added later fails the check until it is covered.

- **The chart's default image tag is held to the runtime's version.** `appVersion` *is* the default tag — `helm install` with no `image.tag` renders it — so the chart's own documented minimum viable install is an image reference made to a user. It had drifted to `0.15.0` against a `0.14.1` runtime, which renders a tag nothing has built and lands in `ImagePullBackOff`. `check:runtime-image` now treats the chart as the user-facing reference it is, hermetically against `@rebasepro/server`'s version and, under `--live`, against the registry.

- **A third adapter wrapper is held to the capability list.** `createPostgresAdapter` rebuilds the bootstrapper field by field, exactly as the two wrappers in the runtime do, and nothing was holding it to anything. It silently dropped both new schema-stamp hooks: every layer type-checked, nothing threw, and the runtime did what it does with any missing optional capability — skipped — so the stamp was never written on any real boot. A check that never runs is indistinguishable from a check that passes. `packages/server-postgres/test/adapter-forwarding.test.ts` compares the adapter against the bootstrapper's own key set, so the next capability is covered without anyone remembering to list it.

## [0.15.0] - 2026-08-17

### Added

- **A filter can reach through a relation to a column of the related row.** `where: { "applications.status": ["in", ["applied", "reviewing"]] }` — "has a related row whose column satisfies this", which is the form every queue screen is written in and which previously could not be said at all. Relation filters compared the related row's *id* and nothing else, so the only way to ask the question was to fetch every row and filter in the browser: a filter the client applies after paging is not a filter, because the page was already chosen without it.

  Compiled to the correlated `EXISTS` the question already was, with the predicate moved off the target's id and onto one of its columns. A many-to-many reaches one table further than the id filter does — that one stops at the junction, which already holds the value it compares — so its subquery joins the target to the junction *inside* the `EXISTS`, where it cannot multiply the outer rows. `belongsTo` is included: `author.name` is a column of another table either way.

  Every operator works, because the compared value is an ordinary column: `>=` on a date and `ilike` on a name mean here what they mean anywhere else. The negative operators keep the rule the id filter already had, for the same reason — `!=` is `NOT EXISTS` of the **positive** predicate, never `EXISTS` of a negated one. `EXISTS (… AND status != 'hired')` asks "does some application differ from hired", which is true of nearly every candidate with more than one application and answers nothing anybody asked; `NOT EXISTS (… AND status = 'hired')` asks "is there no hired application", and makes `==` and `!=` partition the rows the way a filter implies they do.

  `is-null` and `is-not-null` are deliberately not a complementary pair on a relation column. They mean "has a related row whose column is unset" and "has one where it is set" — both true of a candidate with two applications, one of each. Making the second the negation of the first would make it "no application has an unset status", which is true of a candidate with no applications at all: the very rows a queue exists to exclude.

  A relation that does not exist, or a column the target does not have, is a 400 naming the *target's* real columns — never a dropped condition, which would widen the read to every row.

- **A sort key can be an aggregate over a to-many relation.** `orderBy: [[{ relation: "applications", field: "created_at", agg: "min" }, "asc"]]` — candidates, longest-waiting first. `count` alone answers the other half of the queue family: clients, busiest first. `min`, `max`, `count`, `sum`, `avg`.

  This is the half that could not be worked around. A relation filter can be approximated by denormalising a flag onto the row — a trigger, a backfill, and a promise to keep it correct on every write to the related table. An *ordering* cannot be approximated at all once the result set is paged, because the client only ever holds one page and the page was chosen by the wrong order. It is why a project ends up with a 600-line custom view beside the collection it is about: not because the rendering needed customising, but because the query could not be expressed.

  Compiled to a correlated scalar subquery in `ORDER BY` rather than a `LEFT JOIN LATERAL`, because the same expression has to serve the keyset comparison behind cursor paging — and if the two are not the same expression, paging and ordering disagree and rows are skipped. Cursor paging works: there is no aggregate stored on the cursor row to compare against, so the driver recomputes the cursor row's value in SQL from the id it does have, as a subquery pinned to that id. Pinned rather than correlated, so Postgres evaluates it once for the statement rather than per row.

  Rows the relation reaches nothing from land at a defined end — `NULLS LAST` ascending, `NULLS FIRST` descending. That was already Postgres's default and is now written out in the `ORDER BY`, because `buildKeysetComparison` encodes the same placement and an invariant two functions depend on should be stated in both rather than assumed in one. `count` of nothing is `0`, not null, so those rows sort as zero. The id stays the last key, so the order is total and paging over it neither repeats nor skips.

  The object form is the authoring surface; on the wire the key is a single string, `min(applications.created_at)`. `OrderByTuple` is `[string, direction]`, the REST parameter is `?orderBy=key:direction`, the driver contract takes `orderBy?: string | OrderByTuple[]`, and a cursor names its keys by string — `_score` established the same pattern, and this reuses it rather than widening five signatures to carry an object that would be flattened at the end anyway. `normalizeOrderBy` is where the two spellings collapse into one.

  Both features are declared as capabilities — `supportsRelationFieldFilters` and `relationAggregateSorts` — and both default to **false** for an unclaimed driver. Firestore and MongoDB declare neither. A wrongly assumed filter capability widens a read to every row; a wrongly assumed sort capability answers 200 with rows in whatever order the database pleased, which reads as a sorted list.

  The offline overlay refuses both rather than answering them wrongly. A dotted filter key resolves to `undefined` on every cached row, which would exclude all of them — a 200 with an empty list, indistinguishable from "nothing matched". An aggregate is not a field on the row either, so every cached row reads `undefined` for it, which the sortability check would have read as a column of nulls and called reproducible before handing back rows in id order.

### Changed

- **The `collection.insights` slot is now `collection.widgets`, and `home.card.insight` is `home.card.widget`.** The old names described one plugin's use of the slot rather than the slot, which is any widget strip above the table or on a home card. The prop types follow: `CollectionInsightsSlotProps` → `CollectionWidgetsSlotProps`, `HomeCardInsightSlotProps` → `HomeCardWidgetSlotProps`.

  A contribution registered under an old name is **redirected to the new one and still renders**, with a one-time console warning naming the replacement. Slot names are matched by string equality, so a plain rename would have left every plugin still on the old name compiling, registering, and rendering nothing — the same silent nothing `UNRENDERED_SLOTS` exists to warn about. The old names are retired, not removed, and will go in a future major version.

- **`AdditionalFieldDelegate` says that it is display-only.** `value()` is async and receives the whole `RebaseContext`, so it *can* read another collection and its result is cached per record — which makes it read like a computed column when it is not. It runs in the browser, once per row, after the page has already been fetched and ordered, so its result can never take part in choosing which rows came back or in what order. The doc comment now says so, and points at the two things that can: an aggregate sort or a relation filter for a value derived from a relation, and a real column for anything else.

- **The type ladder spans three weights, and a card's edge is a hairline.** Two visual changes to `@rebasepro/ui` that every app built on it inherits.

  `h1` and `h2` go to **700**. The ladder capped at 600, so a page title and the section heading inside it were the same voice at two sizes and a screen had no clear first thing to read. UI chrome — nav, labels, buttons, table headers — stays at 600, and `h4` steps up to semibold because at 20px medium sits close enough to body copy that a long page reads as one undifferentiated column. This costs nothing on the wire: both faces already load as **variable** fonts, so the whole weight axis ships whether or not it is used. The rule it replaces was written when static weights meant every step was another download.

  `cardMixin` draws `surface-700/60` instead of a solid edge, and rounds to `rounded-xl`. The softer border is not a new opinion — it is the one `defaultBorderMixin` has always carried, and the SaaS console alone was overriding the card's own border to reach it at **53 call sites**. The component was wrong and every caller knew. `paperMixin` is deliberately unchanged: a menu, dialog or popover sits *over* unknown content and needs a definite edge, where a card in the document flow does not. Page surfaces get a hairline; floating surfaces keep theirs.

- **Three type tiers the product kept improvising, and an inset surface for code.** `typography-lead` is the sentence under a page title, which had been borrowing 12px `body2` — so the one line explaining what a page is *for* was smaller than that page's own table rows. `typography-micro` is the uppercase field label above a value: the single sanctioned tier below `text-xs`, and it earns the exception by never carrying a sentence. `typography-mono` carries `tabular-nums`, because proportional digits make a column of measurements ragged and a live counter jitter as its glyphs change width. All three are `Typography` variants, not new components.

  `codeSurfaceMixin` fixes a surface that had been inverted: code blocks sat on `surface-800` (#111) inside `surface-900` (#0a0a0a) cards — *lighter* than the thing containing them, so every inset well read as raised. It is `surface-950` now, which is what "recessed into the card" actually looks like.

### Fixed

- **Chip ink was written down instead of measured, and 63 of 120 hue/tone/mode pairs were below WCAG AA.** The worst was white on `teal.solid` at **1.76:1**, which is not a near miss — it is unreadable. Two causes, and the larger hid behind the smaller: `"#fff"` was hardcoded as the ink on every `solid` background, and this palette is Airtable-shaped, so its bright mid stops want *dark* ink — 14 of 15 hues were wrong. The other 8 came from `onDeep` (defaulting to `pale`) on every `deep` background.

  The ink is derived now. It walks a hue-tinted starting colour toward black or white only as far as it must to clear the floor on the background it will actually sit on, and takes whichever direction has more headroom. **No palette stop moved**, so chips keep their colours; only the ink did. Starting from each hue's own tints rather than flat `#000`/`#fff` keeps the family looking related — `blue.solid` gets a dark navy, not black.

  The part that made this more than a colour tweak: an `outlined` chip drops its fill and sits on the **page**, but the component reused the filled ink for it. One value was being asked to be legible against two different surfaces, and for most hues it cannot be — so flipping the filled ink to dark would have made every outlined chip in dark mode invisible. `outlineText`/`darkOutlineText` are separate now, measured against the real page backgrounds.

  Because it is derived rather than tabulated, a hue added later cannot land below AA: there is no per-tone ink left to forget to check. Asserted for every scheme, filled and outlined, in both modes.

- **The accent was below AA as text on a dark card.** `#0070F4` is tuned as a *fill* — white on it, it on white. Read as type on a `surface-900` card it measures **4.36:1**, and every accent link in the product sits on exactly that surface. Dark mode uses `primary-light` for accent *text* now (7.34:1), which is the same hue lifted in lightness and indistinguishable as "the blue". Fills are untouched; there the contrast question runs the other way and `#0070F4` was already right.

- **A refused Google sign-in left the login screen silent.** Every provider button failed into nothing: a popup the visitor closed, a redirect whose `state` did not match, a Google script that never loaded — none of that reaches the auth controller, which can only record what it is handed, so the screen rendered no error and the button simply appeared dead. `LoginView` keeps its own error for the half of the flow that happens before a code reaches the controller, and renders the controller's for the half after — cleared once a user is present, so a stale failure cannot sit over a screen that has since succeeded.

  Backing out is not a failure. `access_denied`, a closed popup and `immediate_failed` are answers, and showing them in red reads as a broken login, so they are swallowed rather than reported.

  Server side, "Registration is disabled" was a non-sequitur on this path — nobody pressed Create account, they pressed Sign in with Google, and there is no account behind that identity. All three rejection points now say both halves, since the visitor can see neither. The public demo was doing exactly this to every visitor: `--set-env-vars` replaces the whole env block on each deploy and the server defaults `ALLOW_REGISTRATION` to false when it is absent, so the demo advertised "Sign in with Google" and then 403'd the account behind it.

- **Every relation in a project whose collections import each other was reported as broken, by the two commands that load collections from source.** `rebase generate-sdk` and `rebase build` read `config/collections` through jiti, which transpiles ES modules to CommonJS. A CommonJS cycle hands the module entered *second* the namespace object — `{ __esModule: true, default: … }` — and never replaces it with a live binding, so a `target: () => otherCollection` thunk returned the namespace rather than the collection. Resolution saw an object with no `slug` and refused it.

  The measured cost, on a 63-collection project introspected from an existing database: 58 relations rejected, one warning each, and a generated SDK in which **every relation field and every derived foreign-key column was silently missing**. `customerId` and `customer` were simply absent from the row type. Nothing failed — the command exited 0 and wrote a file that looked complete, which is the failure mode you find out about from the compiler months later.

  The value was never lost. The thunk is lazy, so by the time it runs the exporting module has finished and the collection is sitting one level down in `default`. Resolution now takes it — and only when the inner value is itself a collection, because a `default` that is not one is a genuinely wrong thunk and has to keep reaching the error.

  `ResolvedRelation.target` is normalised rather than passed through as written, which is the half that decides whether this is a fix or a patch over one symptom. Resolution reads the target once, to derive `targetSlug` and a join table; the forty-odd callers that matter read it *later* — `PostgresBackendDriver` building a join, the Drizzle and DDL generators, `RelationWriteService`, the doctor, the admin's relation fields and table cells. Handing those the thunk as authored would have left every one of them holding the namespace, so the generated SDK would have come out right while the server that serves it stayed broken. Measured on the same project: 134 resolved relations, 0 still answering with a namespace.

  What made this hard to place is that the warning blamed the author — *"make sure the target is `() => otherCollection` and not evaluated at module load"* — for something the rejected code already did. Cycles between collection files are not an authoring mistake to be designed out: two collections that point at each other **must** import each other, and the lazy thunk is this framework's own answer to that. Native ESM resolves those thunks correctly, which is why the same collections load, relate and serve perfectly under the dev server while the CLI called them broken.

  A thunk that returns a promise — `target: () => import("./other")`, one keystroke away and the mistake the namespace shape resembles — now says so, rather than reporting "not a collection".
- **A write refused by a row-level-security policy answered 500, not 403.** The client could not tell "you may not do this" from "the server is broken" — and a 500's message is sanitized on the way out, so the reason went with it. An operator got paged for access control working correctly.

  Only `INSERT` was affected, and for a mechanical reason: a refused `UPDATE` or `DELETE` simply matches no rows, which was already classified as `403 WRITE_DENIED`, while a refused `INSERT` raises `42501` from a failed `WITH CHECK` and fell through to the unclassified path. All four spellings of the denial now answer the same status and the same code.

  `42501` carries two opposite problems and only the message separates them, so the driver now does too: a policy refusing the caller is a 403, while the connecting role lacking a `GRANT` stays a 500 — telling an operator "forbidden" for a missing privilege would send them hunting for a policy bug that does not exist. The message used to name both causes because it could not tell them apart; it now names whichever happened.

### Changed

- **The admin panel's Logs view streams, instead of polling every three seconds.** The old view re-fetched the whole window on a timer, which was wrong in three ways at once: an entry could sit up to three seconds before appearing, each client cost a request every three seconds to be told nothing had happened, and — because that request passed through the same middleware that fills the log buffer — the view's own polling became the loudest thing in its own output. On a quiet server it was also what evicted real entries out of the ring.

  `GET /api/logs/stream` is server-sent events, admin-only like the query beside it. The backlog and the live entries arrive on **one** connection: a client that fetched its history separately would race its own subscription, and entries logged between the two calls would belong to neither. Appends are batched over a 250ms window rather than sent per line, because a busy server logs faster than a browser can render and one frame per entry would cost a re-render per request served — worse than the poll it replaces, precisely when the logs are worth watching.

  The view says which it is doing. "Live" and "Polling" are not cosmetic: an empty log is ambiguous — quiet server, or a tail that died — and the studio and the server are versioned separately, so a frontend that knows this route will meet servers that do not. A 404 there is an older backend, not an error, and it degrades to the three-second poll rather than showing an empty view.

  A connection holds a bounded number of entries between flushes, so a burst past roughly eight thousand a second leaves a gap — and says so, with a count, rather than presenting a tail with a hole in it as complete.

  Fixed in the same work: a client that disconnected *during* the opening write — a fast navigation, or a reconnect storm against a restarting server — leaked its subscriber and a repeating timer, per attempt, for the life of the process. A listener added to an already-aborted `AbortSignal` is never called, so the handler had no way to learn the reader had gone.

## [0.14.1] - 2026-08-16

### Added

- **Access tokens can be signed asymmetrically, and the public keys are published.** A shared secret cannot do the one thing verification most needs to be: cheap to delegate. Handing a gateway, an edge worker or a neighbouring service the means to *check* a session also hands it the means to *mint* one, so in practice the check moves back to the server that owns the secret — and because rotating that secret invalidates every token at once, it is never rotated.

  `auth.signingKeys` takes PEM private keys. Access tokens are signed by the active one, carry its `kid`, and verify against the matching public half, which is served unauthenticated at `/.well-known/jwks.json` — the URL every verifier already looks for.

  Additive by construction: without keys nothing changes, tokens stay HS256, and the JWKS answers an empty key set rather than a 404, because "this issuer publishes no public keys" is a fact a verifier can act on where a 404 is indistinguishable from a wrong URL. Turning it on signs nobody out, and neither does rotation — list the new key first, keep the old one until the tokens it signed expire, then drop it. Only private keys are configured, so a mismatched pair cannot be expressed; malformed keys, a duplicate `kid`, an algorithm the key cannot sign and an EC curve other than P-256 all fail at boot rather than at the first login.

  `JWT_SECRET` stays required regardless: download, MFA-pending and password-reset tokens are read only by the server that minted them.

- **A durable job queue, and webhook deliveries that survive a restart.** `webhook-service.ts` said it plainly in its own docblock — the queue was in-process and in-memory, so a crash or a deploy between the enqueue and the delivery dropped the event. Nothing recorded that the event had existed, which makes the failure mode silence: the receiver simply never hears about a row that was definitely written.

  A job is now a row in `rebase.jobs`. Workers claim with `SELECT … FOR UPDATE SKIP LOCKED`, so each job goes to exactly one worker and N instances divide the work with nothing elected leader. `rebase.jobs.enqueue(task, payload)` is the public door; `jobs: { enabled: true, tasks: { … } }` registers the handlers.

  The decisions worth knowing: `attempts` increments on *claim*, not on failure, so a job that kills the process cannot retry forever, once per restart. A worker that dies cannot release its own claim, so jobs held past `visibilityTimeoutMs` return to `pending` or dead-letter with an error that says which. An unknown task is returned to the queue rather than failed, because during a rolling deploy the old instance is handed jobs belonging to the new one. Failed jobs are kept for 30 days — a queue that silently drops what it could not deliver looks exactly like one with nothing to do. `idempotencyKey` is unique over *unfinished* work only, or "the nightly digest for user 7" would be sendable once, ever.

- **Aggregates: `count`, `sum`, `avg`, `min`, `max`, optionally grouped.** The query API could return rows and a total and nothing else, so every dashboard question — revenue by status, orders per day — meant hand-written SQL in a custom function, or fetching the rows and reducing them in the client. The second is wrong at any size that matters and *silently* wrong under a `limit`: the numbers look plausible and describe the first page.

  `GET /data/:slug/aggregate?select=count(),sum(total)&groupBy=status`, taking the same filters, `or`/`and` groups and `searchString` as the listing beside it.

  **RLS applies to the rows being aggregated** — an aggregate is an efficient way to learn about rows you cannot select, so it runs through the request-scoped driver like every other read, and a caller whose policies return nothing counts nothing. Aliases are derived rather than accepted (`sum(total)` is `sum_total`), because a caller-chosen alias would have to be checked against the `groupBy` fields. `count`/`sum`/`avg` are parsed to numbers here, since Postgres returns bigint and numeric as strings. A driver without aggregate support answers 501, not an empty list: "no matches" is the wrong thing for a dashboard to conclude from "not supported".

- **Filter inside a jsonb column by path.** Rebase has had jsonb columns for as long as it has had columns and no way to ask a question about what is in one — a filter could compare the whole document and nothing else, so "orders whose metadata says the country is US" meant a custom function or reading the table into the application.

  `metadata->>country` and `metadata->address->>city` now compile to the extraction they look like. The syntax is Postgres's own and PostgREST's, so the filter reads the same as the SQL it becomes.

  The path is bound, never interpolated — it arrives from a query string, and `->>` takes a text parameter perfectly well. The filter *value* picks the comparison, because both obvious readings are wrong on their own: comparing as text puts `"9"` above `"100"`, while casting unconditionally turns any row holding a string into `invalid input syntax for type numeric` — a 500 caused by one row's data on a request that is not wrong. An ordering operator given a number casts, guarded so non-numeric rows are excluded rather than fatal; everything else compares as text. A path into a column that is not json is a 400 rather than SQL Postgres rejects at execution time.

- **One bundle can run as several cooperating processes.** `REBASE_ROLE=api|functions|worker|all` decides what a runtime process serves and what it owns, so a custom function that pins the event loop can be given its own replica count, restarts and blast radius without its code moving anywhere. Same image, same bundle, same database — only the environment differs.

  `all` is the default and is byte-identical to the process this server has always booted, so no existing deployment changes. `REBASE_FUNCTIONS_UPSTREAM` lets the `api` role forward `/api/functions/*` to the functions process, so a split deployment presents the identical URL surface and no client, SDK or API key notices. `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` narrow a process to named functions; a name the bundle does not contain fails the boot and the error lists the names it does have.

  Two combinations refuse to start rather than misbehave quietly: a non-`api` role left on the default `REBASE_MIGRATE_ON_BOOT` (several processes would race to provision one schema), and a variable set on a process that does not read it (it would do nothing at all, leaving a deployment that looks configured and is not). See [Split processes](/docs/deployment/split-processes/) for the compose topology, and for what splitting does *not* give you — shared rate limits, cross-instance channels and scale-to-zero are each called out.

- **A sort is a list of keys, not one key.** `orderBy` accepts `[["category", "asc"], ["created_at", "desc"]]` wherever it accepted `["created_at", "desc"]`, over the SDK, the REST parameter (`?orderBy=[{"field":"category"},{"field":"created_at","direction":"desc"}]`), a WebSocket subscription, and every driver. The second key decides between rows the first calls equal.

  On the fluent builder, `.orderBy()` called twice now **adds a tie-breaker instead of replacing the first key** — the previous behaviour discarded the earlier call, which made a multi-column sort unexpressible. If you were relying on the second call to win, pass the one key you want.

  A bare field name with no direction reads as ascending everywhere. It used to mean DESC on Postgres and ASC on Mongo, so one call described two different queries depending on the database underneath.

- **The admin panel orders by more than one column.** Shift-click a table header to add a column under the sort already there; the header shows each key's rank so a two-arrow header says which one wins. The toolbar's sort menu — now in the table view as well as list and cards — is where a key is re-ranked or removed without rebuilding the sort, and a multi-key sort survives a reload and a shared link.

### Changed

- **Collection tables are created on every boot path, not only the managed one.** `ensureCollectionSchema` and `ensureCollectionPolicies` were called from exactly one place — the managed bundle boot. An app shipping its own image boots by calling `initializeRebaseBackend` directly, never entered that path, and so had its collection tables created by nothing. It came up serving sign-in — auth bootstraps its own tables, which is what made this read as a data bug rather than a boot bug — and 500'd every `/api/data` route, with a green deploy and a healthy `/health`. Found on a tenant that had been in that state for weeks.

  Provisioning now lives in `initializeRebaseBackend`, the one function both paths go through. **If you run a custom image against a database whose tables you manage yourself, set `REBASE_MIGRATE_ON_BOOT=none`** — the additive ensure will otherwise create anything the collections declare and the database lacks. It never drops, narrows or rewrites.

- **A write over the WebSocket now meets the same validation as a write over HTTP.** `assertKnownWriteFields` and `assertWriteValuesValid` were called from the REST generator and nowhere else, so the socket `SAVE` handler took the client's payload straight to `driver.save`:

  ```
  PATCH /api/data/users/1  { age: 999 }             → 400, naming the rule
  ws SAVE { path: "users", values: { age: 999 } }   → written
  ```

  Everything else on the socket path was enforced — it authenticates, it scopes the delegate so RLS binds, and the driver still refuses a column the table does not have. What it skipped is the collection's own `validation` block: `min`, `max`, `matches`, `required`, and the unknown-field check behind `strictWrites`. A realtime write that has been storing values your rules reject will now be refused.

### Fixed

- **A policy compiler that quoted values and no identifiers.** `policyToPostgres` quoted the value side of every comparison and the identifier side of nothing, so a column whose name Postgres does not read back unchanged reached `CREATE POLICY` as a bare word — and there are three ways that goes. `"createdAt"` folds to `createdat`, the statement errors, and the collection keeps RLS on with no policy, which denies every row; `columnName` is used verbatim and `rebase schema introspect` populates it from the live database, so this is what any camelCase table adopted from an existing project did. `order`, `default` and `end` are syntax errors mid-clause. Worst, `user`, `current_user`, `session_user` and `current_date` are *valid bare expressions*, so the policy compiled, applied, and was logged as applied — while comparing against the connected role or the wall clock instead of the column.

- **A backslash in a policy clause was eaten before Postgres saw it.** The Drizzle generator writes each compiled clause into a `.ts` file inside `` sql`…` `` with no escaping, and Drizzle's `sql` tag reads the *cooked* template strings rather than `.raw` — so JavaScript consumed the escapes first. A rule written ``using: "email ~ '^admin\\.user@corp\\.com$'"`` reached the database as `^admin.user@corp.com$`, where each `\.` matches any character. The DDL generator writes the same rule into a `.sql` file, where a backslash is just a backslash, so the two generators produced different policies from one rule — and the difference was always in the permissive direction. `\d`, `\s` and `\w` went the same way.

- **A vector search on a subcollection route was served as a plain listing.** The subcollection routes parse `?vector_search=`/`?vector=` through the same `parseQuery` the root list uses and then built their options without it, so `GET /authors/1/posts?vector_search=embedding&vector=[…]` came back 200 with rows ordered by `id DESC`, no `_distance`, and the threshold ignored — a silent downgrade the caller reads as "these are the nearest neighbours".

- **A vector-search threshold narrowed the rows but not the count.** `countRawEntities` forwarded `filter`, `logical` and `searchString` to `driver.count` and dropped `vectorSearch`. A `threshold` is a WHERE clause, not a hint, so a similarity-filtered listing was served narrowed rows beside the count of the *unfiltered* set — three rows with `meta.total: 25` — and paging forward then handed back empty pages while `hasMore` stayed true, until the offset walked past the inflated total. The standalone `/count` route answered the same inflated number.

- **`?offset=` became a cursor value on every non-Postgres driver.** Two paths serve `GET /api/data/<collection>`: `restFetchService` when the driver has one, and `fetchRawCollection` for everything else — mongo, firebase, anything a developer registers. The second passed `String(offset)` as `startAfter`, which is a cursor *row*, and never passed `offset` at all. The caller got page one every time, with a `meta` block reporting the offset it had asked for.

- **A subscription is a query, and two of its fields never arrived.** `logical` and `offset` were accepted at every type-checked boundary and then dropped, because `CollectionSubscriptionConfig` did not declare them — the client sends both, the type has no slot for either, and the subscription re-fetches a different query than the one that was asked for. An `or(...)` subscription ran with the group gone and was pushed every row the caller's policies allow, rather than the rows it asked for.

- **A subscription's re-fetches raced, and the loser was delivered last.** Every update a subscription delivers is a full re-fetch, and several things start one for the same subscription without coordinating: the initial fetch at subscribe time, the change stream or `NOTIFY`, and the debounced refetch after a mutation. A fetch that started earlier could finish later, and the delivery replaces the subscriber's whole list — so the subscriber went back to the state before the change and stayed there, silently, until something else touched the collection. Fixed on both the Postgres and the MongoDB paths.

- **A LISTEN connection that failed after connecting was never closed.** Both LISTEN clients build a client, connect it, issue `LISTEN`, and only then assign the field the rest of the class cleans up. Anything before that assignment can throw, and when it did nothing knew the connection existed — `stop()` closed the field, the reconnect timer closed the field, and the field was still undefined. A persistent failure (a revoked LISTEN privilege, a pooler that refuses session state) leaked a backend every three seconds.

- **A declared-but-empty `REBASE_FUNCTIONS_TIMEOUT_MS` read as "no timeout".** `Number("")` is `0`, and zero is meaningful on this setting — it disables the ceiling on purpose. Both ways of producing an empty value are ordinary: a compose file with `REBASE_FUNCTIONS_TIMEOUT_MS=${SOMETHING}` and no `SOMETHING` in the environment, and a `.env` line carrying the name and no value. Neither reads like a configuration change, nothing logged, and what it switched off is the only bound on how long code the framework did not write can hold a socket.

- **`PORT=0` announced `http://localhost:0`.** The listen helper resolved with the port it *asked for* rather than the one it bound, so the ordinary "any free port" request wrote `0` into the boot banner, the dev port file and `.rebase/state.json` — pointing the CLI, MCP discovery and any health check at a port nothing listens on.

- **Simultaneous boots abandoned their schema plan.** `CREATE … IF NOT EXISTS` reads the catalog and then writes to it as two steps, so instances starting together do collide — measured at 8 losses in 10 with five peers. The losing statement threw, and the throw abandoned every remaining action in the plan, so a replica that lost one race came up missing tables it had never attempted, with the boot log blaming the one statement that was harmless. The channel-presence and channel-history bootstraps had the same shape with a `REVOKE` as their tail: losing a create race there left the presence roster and every retained broadcast readable by any signed-in user.

- **A double-clicked signup answered 500 instead of "email already registered".** `POST /auth/register` reads before it inserts, and both engines back that check with a unique index, so no deployment ever ends up with two accounts on one address. What was missing is what the loser is told: neither `createUser` mapped its driver's duplicate-key error, so the second request raised a bare `23505` or `E11000`, reached the central handler as an unclassified failure, and came back as a sanitized 500.

- **Enabling MFA on a Mongo backend answered a sanitized 500.** The auth router mounts the MFA routes for every backend, so `POST /auth/mfa/enroll` is live on MongoDB and landed in the repository's stubs — six of which threw a bare `Error`, which the central handler classifies as unhandled. The person turning on two-factor authentication was told "Internal Server Error" while the actual reason sat in the server log, and the operator got a support ticket about a fault that does not exist.

- **`POST /storage/folder` documented a `bucket` field and never read it.** The handler read `path` and `storageId` and derived the bucket from the path prefix, so `POST /storage/folder { path: "reports", bucket: "media" }` answered 201 and created the folder in the default bucket — the parameter accepted, ignored, and the call reported as success.

- **The newsletter opt-in was offered only to people who typed a password.** It sat on the credentials form, under the password field — the screen you reach *after* choosing email — so a visitor who signed in with Google was never shown the checkbox at all. It moves to the provider screen, beside the buttons that choose how to sign in and directly under the consent block a host passes as `topComponent`; the two ticks are now spaced as one block of conditions rather than two unrelated asks.

- **The OpenAPI spec never mentioned the count endpoint.** `GET /data/{slug}/count` is registered for every collection and appeared in no generated document — the word "count" was not in the generator at all. The spec is what a client generator can see, so an endpoint missing from it is an endpoint that client does not have, and this is the one a paginating UI needs to know how many pages there are.

- **A local-first read disagreed with the server about tied rows.** Every server-side sort ends on `id DESC`, which is what makes the ordering total; the offline overlay re-sorted with an ascending id tiebreak, so two rows sharing a sort value came back from the cache in the opposite order to the network — and `isLocallySortable` reported that page as exactly reproducible while it was not.

- **The Mongo driver's sort was not a total order, and could not name the id at all.** It emitted only the keys the caller gave, so two rows sharing a value were returned in whatever order the engine pleased — free to differ between two runs of the same query, which is what makes `offset` paging repeat and skip rows. It now closes on `_id` descending, as the Postgres driver has always done. `orderBy: ["id", …]` also named a field no document carries — rows leave the driver with `_id` renamed to `id`, so `id` is the only name a caller has — and Mongo answered by ignoring the sort. It maps to `_id` now.

- **Six labels in the admin's sort menu rendered as their own key names.** `sort_then_by`, `sort_move_up`, `sort_move_down`, `sort_remove_key`, `sort_ascending` and `sort_descending` were referenced by the control and declared by none of the seven locale files, and i18next answers an unknown key with the key. All seven locales carry them now, along with `save_entity_before_subcollections`, which had the same defect behind a `?? "…"` fallback that could never fire. A test now checks every literal key the panel renders against the catalogue.

- **A list-view column header said "Sort by <column>" whichever state it was in**, so on a descending column it promised a sort where the click removed one — and it said it in English regardless of the panel's language. It now names the next action, the key's rank, and the shift-click that adds a column rather than replacing the sort.

## [0.14.0] - 2026-08-12

### Breaking

- **A `validation.matches` pattern that will not compile is now fatal at boot, instead of silently deleting the rule.** `toPattern` rebuilds the `RegExp` per request and answers `undefined` when the pattern is malformed, and its caller reads `if (pattern && !pattern.test(value))` — so an unclosed bracket did not reject writes, it removed the constraint. Every value passed, for the lifetime of the deployment, while the author went on believing something guarded that column.

  The lenient runtime branch stays: refusing every write over a config typo blames the wrong party. What was missing was anyone telling the author. `validate-config.ts` now compiles every `validation.matches` at boot and refuses to start on one that does not, naming the pattern, the engine's reason, and what it would have cost — the same way this repo already refuses to start on a relation that cannot resolve.

  **This can stop a project that boots today.** If you are carrying a malformed pattern, it has not been validating anything, and the error names it. A `RegExp` literal is unaffected — the engine compiled it where it was written.

- **BREAKING: the API is camelCase throughout. `author_id` is now `authorId`.** The wire carried two naming conventions at once, and which one a field landed in was not inferable from outside. `GET /api/data/users` answered `displayName`, `photoURL`, `createdAt`; `GET /api/data/posts`, next to it, answered `author_id`. Both were "the wire names". These are also the `where` and `orderBy` keys and the keys the generated SDK types, so a developer moving between two collections had to know, per collection, which convention it had happened to land in.

  The rule was never stated because there wasn't one. A field's wire name is its property key, and `columnName` renames only the *column* — that part is right and does not change. But two of the four sources of keys never had a property key to use, and both fell back to the column name:

  - a **foreign key derived from a relation** had no property of its own, so `belongsTo` on `author` served the `author_id` column under its own name;
  - **introspection** wrote the raw column name as the property key, with `columnName` restating it beside it.

  Both now derive a camelCase name and keep the column exactly as it was. **The database does not change.** Columns stay snake_case, because an unquoted Postgres identifier folds to lower case and a camelCase column is reachable only as `"authorId"` forever — in hand-written SQL, in psql, in an RLS policy body, in a dump, and in every third-party tool that touches the database. `\d posts` still shows `author_id`, no migration runs, and `rebase doctor` reports no drift.

  ```diff
  - GET /api/data/posts        →  { "id": 1, "title": "Hello", "author_id": 3 }
  + GET /api/data/posts        →  { "id": 1, "title": "Hello", "authorId": 3 }

  - ?where={"author_id":["==",3]}     400 UNKNOWN_FILTER_FIELD
  + ?where={"authorId":["==",3]}
  ```

  **Who this breaks, and what to do:**

  - **Everyone using the generated SDK: re-run `rebase generate-sdk`.** `row.author_id` stops compiling and `row.authorId` starts. This is the good case — the compiler names every call site for you.
  - **Hand-written `where` and `orderBy` keys.** A filter key that no longer resolves is a 400 with `UNKNOWN_FILTER_FIELD`, and the error lists the valid names. It fails closed on purpose: a dropped condition widens a result set, which is the one failure you do not want to be silent.
  - **Raw `fetch` consumers, and anything reading a row by key.** `row.author_id` is now `undefined`. There is no compiler to find these; grep for the column names your relations derive.
  - **`rebase schema introspect` over an existing database no longer echoes column names on the wire.** A `customer_id` column is generated as a `customerId` property carrying `columnName: "customer_id"`, and is served, filtered and sorted as `customerId`. This is the largest single change for a project that was introspected rather than authored, and re-running introspection is what produces the new collections. The column, the constraints and the policies are untouched.

  No dual-key emission and no compatibility flag: serving both spellings would leave the two conventions in place permanently, which is the defect. The one thing that is *not* camel-cased is a name someone already chose — a property key you wrote is your key, whatever its shape, and a `columnName` you set still names the column.

- **BREAKING: anonymous sign-in is opt-in. `POST /auth/anonymous` answers 403 until you set `auth.allowAnonymous: true`.** Anonymous sign-in is registration that never asked: it inserts a `users` row and assigns `defaultRole` exactly as `POST /auth/register` does. But both anonymous routes were mounted unconditionally and consulted none of the registration gates, and no config key existed to turn them off.

  So a backend that had closed the door still handed out permanent accounts. With `allowRegistration: false` and `disableSelfRegistration: true` — whose own docstring calls it a *"hard kill switch: block self-registration outright"* — `POST /auth/register` correctly answered 403, and two unauthenticated requests produced an email/password account anyway: `POST /auth/anonymous` for the row and the session, then `POST /auth/anonymous/link` to put credentials on it. The second was authenticated only by the token the first had just issued, and carried no rate limiter at all.

  ```diff ts
   auth: {
       allowRegistration: false,
       disableSelfRegistration: true,
  +    // Anonymous sessions are now a thing you ask for.
  +    allowAnonymous: true
   }
  ```

  Opt-in rather than opt-out, and this is the part that will cost an upgrade some downtime: **a project relying on anonymous sign-in today stops working until it sets the key.** Defaulting it to `true` would have preserved that at the cost of leaving the hole open for everyone who never learns the key exists, and the key did not exist before, so no deployment had yet made a choice. The 403 names the key it needs (`ANONYMOUS_AUTH_DISABLED`); `ALLOW_ANONYMOUS` is the env spelling.

  `disableSelfRegistration` overrides it — an account created without credentials is still an account created by the public. `allowRegistration` deliberately does not gate it: a public read-mostly app that wants anonymous sessions and no sign-up form is a real deployment, and `allowAnonymous: true` says exactly that. `/auth/anonymous/link` is gated on the same predicate, so a session minted before the switch cannot finish the upgrade, and it gains the limiter it never had. `GET /auth/config` and `getCapabilities()` now report `anonymousLogin`, so a client can discover the state instead of finding out by calling.

  Still open, and not addressed here: nothing downstream reads `isAnonymous`, so an anonymous user holds the same `defaultRole` as a registered one and no policy can say otherwise. That needs `is_anonymous` in the RLS-visible identity.

### Added

- **`admin.display` — one block for how a record presents itself.** A record shows up as a heading, a card, a row, a board tile and a reference chip, and each of those needs to know which property is the title, which is the image, which is the status. That was `admin.titleProperty` and a great deal of per-surface guessing: the detail view had grown its own copy of the title logic and the two had already drifted, so the same record could be headed one way in the list and another way when you opened it.

  `display` names the roles instead — `title`, `subtitle`, `image`, `status`, `date`, `tags` — and one resolver (`entity-display.ts`, `useEntityDisplay`, cached) answers for every surface: the table, list, board and card bindings, the preview slots, the form, the entity views and `useColumnsIds`. The property paths are checked against your own properties the way the rest of the `admin` block is, so a renamed field is a compile error rather than a column that quietly stops appearing.

  ```diff ts
   import { defineCollection } from "@rebasepro/cms-types";

   export default defineCollection({
       name: "Posts",
       slug: "posts",
       table: "posts",
       properties: { title: { name: "Title", type: "string" } },
  -    admin: { titleProperty: "title" }
  +    admin: { display: { title: "title" } }
   });
  ```

  **`admin.titleProperty` still works.** It is deprecated, not removed: it shipped in 0.13.0 and is still read at runtime, with `display.title` winning when both are set. Postgres introspection codegen emits the new block, and the collections docs and skill are updated in all six locales.

- **The self-host runtime image is published by the release, not by remembering to.** The scaffolded `docker-compose.yml` presents `rebase build` + `docker compose up` as the way to self-host and pins `REBASE_VERSION` to the released version, but nothing published `rebasepro/server` on a release — `cloudbuild-runtime.yaml` has had a Docker Hub push for months and runs only when someone types `gcloud builds submit`. So the first command in the file a new project is handed ended at `pull access denied for rebasepro/server, repository does not exist`. The release workflow now builds and pushes it (amd64 + arm64) after npm and the tag, then verifies the tag is pullable from outside with no credentials.

  `scripts/check-runtime-image.mjs` keeps it honest: every image reference in a shipped compose file must have an automatically-triggered publisher, and a build config only a human can run does not count. `verify-selfhost.mts` could never have caught this — its own header says what it leaves out, "a container and an image tag".

- **`rebase skills install --agent all`**, for scripted and CI use. Without a TTY the command has to be told which agents to install for, because a scaffolded project ships a marker file for every one of them (`.cursorrules`, `CLAUDE.md`, `.windsurfrules`, `AGENTS.md`) and detection therefore has no signal — guessing would install four agents' skills unasked.

- **`updateMany` and `deleteMany`, the counterparts `createMany` never had.** An ETL job could insert 1000 rows in one transaction and then had to delete them one HTTP request at a time. The asymmetry was not a gap in one layer but in all of them — contract, driver, REST, SDK, offline queue and generated spec.

  Both shapes are the conservative reading rather than the inherited one. `updateMany` takes `{ id, data }` entries, not flat rows carrying their own key: on a table keyed on a `sku` or a composite key a flat row cannot say whether a column is the address or a value to write, so naming the address separately mirrors single-row `update(id, data)` and leaves nothing to infer. `deleteMany` takes ids, not a filter — a filter-shaped bulk delete is a different and far more dangerous operation, whose failure mode is an omitted or mistyped condition emptying a table, and unlike an explicit list it cannot be reviewed at the call site. Read first, pass the ids you meant.

  The delete is served at `POST /<collection>/bulk/delete` rather than `DELETE /<collection>/bulk`. A DELETE body is the honest verb and the one request shape the HTTP ecosystem handles unreliably: bodies on DELETE are permitted but widely dropped by proxies, and several OpenAPI generators ignore `requestBody` on a DELETE operation, so a generated client would send the request with no ids at all. "Deletes nothing" is the good outcome of that bet.

  ```typescript
  await client.data.products.updateMany([
      { id: "sku-1", data: { price: 1200 } },
      { id: "sku-2", data: { price: 900 } }
  ]);

  const stale = await client.data.sessions.findAll({ where: { expires_at: ["<", cutoff] } });
  await client.data.sessions.deleteMany(stale.map(s => s.id as string));
  ```

### Removed

- **`@rebasepro/client-postgres` is gone.** It was published on every release since the `client-postgresql` rename — 137 versions, `latest` on npm — and imported by nothing: no workspace package depended on it, no example, template, doc page or skill used it, and its own README's Quick Start did not compile (`<Rebase driver={…}>`, a prop that does not exist). Its description was wrong too: not a direct PostgreSQL client and not PostgREST, but a WebSocket passthrough to the Rebase backend, which `@rebasepro/client` already is.

  It was also quietly broken. `fetchCollection` re-listed seven of `FetchCollectionProps`' twelve fields by hand and dropped `offset` and `logical`, so `find()` returned page one beside a correctly-narrowed total, `hasMore` never went false, and `findAll()`/`iterate()` returned page one N times, terminated cleanly, and reported a plausible row count — silent duplicate data. Four sibling methods had the same shape.

  Use `@rebasepro/client` with a `dataSources` entry; that is what the admin panel does and what `docs/data-sources.md` has always described. The published versions stay on npm and will be deprecated there — nothing is unpublished, so an existing lockfile keeps resolving.

### Fixed

- **A 200 the SDK could not parse was returned as an empty object.** `request()` kept `body = {}` when `JSON.parse` threw. On an error status that is harmless, because the status is the answer; on a *success* it was the whole answer — `find()` resolved to `{}` rather than an array and `getOne()` to an empty object, with nothing thrown. To a caller that reads as "no data", not as "you are not talking to the API".

  The case is ordinary: point `VITE_API_URL` at the frontend's own host and `/api/data/posts` lands on the single-page-app fallback, which answers 200 with `index.html`. So the misconfiguration the 404 branch spends four lines explaining reached callers in its most common form as an empty success, because an SPA fallback returns 200, not 404. A proxy error page does the same.

  A success whose body this client cannot read is now a `RebaseApiError` with `INVALID_JSON_RESPONSE`, quoting the first 120 characters — `<!doctype html>` identifies the sender faster than any wording could. A 200 with no body at all still resolves to `{}`: some endpoints legitimately answer that, and it is a different thing from an unreadable one.

- **Introspected collections opted out of key checking.** `rebase schema introspect` opened every generated file with `const ordersCollection: PostgresCollectionConfig = {`, and that annotation widens `properties` to `Record<string, …>`. Every key-shaped field in the `admin` block is derived from those keys — `propertiesOrder`, `listProperties`, `sort`, `display.title`, `fixedFilter` — so annotated, they accept any string. Introspection was emitting a `propertiesOrder` array that nothing checked: rename a column, re-introspect, and the stale key compiled silently and reordered nothing. Introspected keys are precisely the ones nobody typed and nobody remembers, so this was backwards.

  Generated collections now use `defineCollection`, which `rebase init` has always written, and which keeps the keys literal. A `propertiesOrder` entry naming no property is a compile error, and the compiler names the column the rename left behind.

  Which `defineCollection` is detected per run, from the package manifests above the output directory — the same path Node resolves a bare specifier along:

  | Your project declares | Generated collections use | `admin` block |
  |------|------|------|
  | `@rebasepro/cms-types` | `defineCollection` from `@rebasepro/cms-types` | yes |
  | `@rebasepro/common` (a `--headless` project) | `defineCollection` from `@rebasepro/common` | no |
  | neither | a `PostgresCollectionConfig` annotation, with a warning | no |

  **The headless flavours emit no `admin` block, on the collection or on any property.** That is a fix rather than a downgrade: `@rebasepro/types` declares no `admin` field at all — the augmentation in `@rebasepro/cms-types` is what adds it — so the block introspection used to emit was a type error in every headless project it was ever written into. What is dropped is presentation (`icon`, `propertiesOrder`, `multiline`, `readOnly`) for a project with no panel to present it; nothing about the schema, the API or your data depends on it.

  `@rebasepro/common` is a dependency of the headless config package now, which is what makes that branch reachable. A project scaffolded before this keeps the old annotation and is told what it is missing.

  One thing changed in the generated relations to make inference survive a real schema: the `target` thunk's return type is written out, `target: (): AnyCollectionConfig => authorsCollection`. Without an explicit type on the const, a relation cycle — `posts` belongs to `authors`, `authors` has many `posts`, or a self-referencing `employees.reports_to` — makes the inference circular and every file in the cycle fails to compile.

- **Storage was the one router with no rate limiter, and the one where a request costs money.** `createDataRateLimiter` was mounted on the data router and the functions router and nowhere else. Upload, download and the whole tus sequence were unbounded — and storage is the surface where a single HTTP request buys a metered third-party operation: `PutObject`, `GetObject` and its egress bytes, `ListObjectsV2`.

  The download path was the worst of it. With `storagePublicRead: true` — a documented, ordinary setting — `readAuthMiddleware` resolves to a no-op, so `GET /file/*` was anonymous, unauthenticated and unlimited. One machine looping over a large public object is a full `GetObject` and a full egress charge per request, with no ceiling and no per-caller accounting; the bill arrives a month later.

  Storage now shares the same limiter *and the same store* as data and functions, so a caller has one budget across the product rather than one per router. It is registered after the API-key guard, so a key's identity is on the context and requests bucket by caller rather than by IP. The request limiter is the floor, not the whole answer: storage's cost profile is bytes rather than requests, and a bytes-per-window bound per bucket needs accounting this layer does not have yet.

- **`rebase doctor --policies` reported a clean database with row level security switched off.** `ALTER TABLE posts DISABLE ROW LEVEL SECURITY` leaves every row in `pg_policies` untouched, and `pg_policies` was all the drift checker read. So every expected policy still matched on name, roles, command and clause presence, and doctor printed `✓ RLS policies match your collections` for a table Postgres was applying no filter to at all. Requests run as `rebase_user`, which holds full DML — the table was wide open while the check certified it.

  Nothing else on the declared-collections path covered this either: the only reader of `relrowsecurity` in the driver serves the *introspection* branch, i.e. only when there are no declared collections, and the re-enable runs only on the managed-runtime boot path. A self-hosted project's next `db push` would have fixed it; until then, doctor said it was fine.

  Drift now reports `rlsDisabled` first, because it subsumes every other finding on the same table — if RLS is off, the policies listed under it are not being applied. The same pass closes a second blind spot: `mode: "restrictive"` is a public `SecurityRule` field and the generator emits `AS RESTRICTIVE`, but the DDL parser captured that group into a discarded slot and `pg_policies.permissive` was never selected, so a restrictive rule stored as PERMISSIVE read clean — with its gate being ORed in rather than ANDed, which is the maximally permissive way for it to be wrong. Both are exact catalogue values, so neither can cry wolf; an unreadable value on either side is skipped rather than guessed.

- **A client with generated types could not be passed to `<Rebase>`.** `RebaseProps` was generic over `USER` and not over the database, so its `client` prop was pinned to `RebaseClient<unknown>` — and `RebaseClient<unknown>` is not a supertype of `RebaseClient<Database>`. The untyped branch of `RebaseSdkData` is an index signature (`[slug: string]: SDKCollectionClient`), and no concrete instantiation satisfies it, because `RebaseSdkData`'s own `collection` method is not an `SDKCollectionClient`.

  So the typed SDK path — run codegen, get a `Database`, build a typed client — ended at the provider that every panel is mounted inside, and reaching `data.products` through the prop handed back `Record<string, unknown>` rather than the generated row. `RebaseProps` and `Rebase` now take `DB`, inferred from the client and defaulting to `unknown`, so existing untyped callers are unaffected. `wrapAsEntityData` asks for `Pick<RebaseSdkData, "collection">`, which is all it ever used.

  Pinned by `packages/app/test/rebase_client_prop_types.type-test.ts` — compile-time assertions, written as assignments rather than conditional types, because the first draft used `extends` and went on compiling with the bug restored.

- **Retiring the pre-1.0 `auth` schema could drop a helper still in use.** The cleanup refuses to run while a *policy* calls `auth.uid()`, and that half is safe by construction — Postgres records a dependency for a policy that references a function, so `DROP FUNCTION` refuses on its own. The function half has none: a `LANGUAGE sql` body written as a string literal is never parsed at creation, so nothing is recorded, `RESTRICT` has nothing to refuse on, and the drop succeeds while callers still exist. They fail when a query reaches them rather than at boot.

  If you defined your own helper in the `auth` schema — anything calling `auth.uid()`, `auth.roles()` or `auth.jwt()` from its body — the schema is now kept, and the boot names the functions holding it so you can repoint them at `rebase.uid()`. Our own control plane is the case that found this: two org-membership helpers there, with eleven policies going through them, had nothing protecting them.

- **A date in the future was described in the past tense.** Seven hand-rolled relative-time formatters computed `now - then` and then tested only the positive side, so a timestamp ahead of now fell through to whichever branch came first: a post scheduled for next month read "Just now", and one due this afternoon read "-1d ago" — a negative quantity, printed. These are dates a CMS holds constantly, and the two admin formatters render whatever property the collection points its date slot or date column at.

  `formatRelativeTime` in `@rebasepro/utils` is now the one implementation: the distance is `Math.abs`, so no branch can see a negative number, and the tense comes from the sign rather than being assumed. It returns `null` past a horizon the caller sets, so each site keeps its own absolute format and locale. The cloud CLI and studio's cron and API-key views were already correct and are unchanged.

- **Persisted UI state written by an older release bricked the view that read it.** `JSON.parse(localStorage.getItem(key)!)` has four ways to throw and, in a `useState` initializer, no way to recover from any of them: it throws during the first render, and the value that threw is still in storage on reload. The SQL editor read its open tabs and column widths exactly that way.

  The failure that matters is not corruption but *age*: storage holds whatever version last ran, nothing migrates it, and an older release that wrote an object where this one calls `.map` produces valid JSON that survives `JSON.parse` and fails one line later. `readStoredJson`/`writeStoredJson` cover all four cases — storage that throws on access (Safari private browsing, SSR), text that is not JSON, JSON of a rejected shape, and a `setItem` over quota. Also fixed alongside: an empty stored tab list left no active tab, a stored tab with no `id` could never be closed, and a non-numeric stored pane size laid the editor out at `NaN`.

- **An `orderBy` whose shape was wrong returned unsorted rows and a 200.** The sort *field* has been schema-checked for a while, on the grounds that answering 200 with unsorted rows leaves the caller believing in an order that is not there. The parameter's *shape* was not, and failed the same silent way one layer earlier: whatever `JSON.parse` returned was assigned to an option the REST layer reads as `orderBy[0].field`. So `?orderBy={"field":"name"}` — an object rather than an array, and the most natural thing to reach for — dropped the ORDER BY and answered 200, as did `5`, `true`, `null` and `["name"]`. A direction of `sideways` was silently coerced to ascending.

  These are now a 400 with `INVALID_ORDER_BY`, matching what the published OpenAPI parameter already documented and what `?where=` has always done with a malformed filter. Every shape that worked before still works.

- **`PORT` was parsed but never checked, so `PORT=oops` started the dev server on `NaN`.** `resolveStartPort` range-checked the port *file* it writes itself, with a test naming every value it should refuse — and the environment variable one line above, the source a human or a platform actually sets, had neither the check nor a test. One `parsePort` now serves both; an unusable `PORT` warns rather than being ignored in silence.

- **A blank cell imported as the number zero.** The importer mapped a string column to a number with a bare `Number(value)`. `Number("")` is `0`, so every empty cell in a number column arrived as a real zero — a price of nothing rather than a price nobody filled in — and anything unreadable arrived as `NaN`. Both are absent values and both are now `null`, which is what the importer's own validation exists to catch.

- **An offline read ignored `orderBy` unless a locally-created row was in it.** The overlay sorted only when it had just injected a local row; every other read handed back cache order, which is insertion order. So a caller that asked for `orderBy` got whatever the store happened to hold — in the panel, a collection's `sort` silently dropped on every list served from the offline overlay, while the query carried it and the server honoured it. Order is part of the query, not a detail of how the rows were obtained.

- **A group icon took the icons off every row beneath it.** Declaring `icon` on a `NavigationGroupMapping` did not just label the group header — it switched the whole group to a categorised treatment, stripping the entries of their own icons and indenting them, and stepping the header's own size and contrast up to match. That made a per-app styling choice into framework behaviour: any project that labelled a group lost the icons on its rows, with no way to turn it off.

  The icon decorates the header and stops there. `indented` survives on `DrawerNavigationItem` for an app that wants the categorised look, and nothing in the framework sets it. `DrawerNavigationItem` and `DrawerNavigationGroup` are exported now, with their props types, since overriding `Shell.DrawerNavigation*` is how an app opts in — wrapping the stock row beats reimplementing one and drifting from the framework's hover, active and tooltip behaviour on the next release.

- **The add button kept its English verb in every locale.** The label was built as `Add {name}` in JSX, so only the collection name came from config: a Spanish panel read "Add Mensaje de contacto". An `add_specific: "Add {{name}}"` key already existed in all seven locales and nothing used it; both add buttons go through it now. The Hindi entry had translated the key rather than the label.

- **A save raised two panel navigations, and the second one decided where you ended up.** `SidePanelBinding.onUpdate` reached three navigation-capable calls for one save — the opener's `props.onUpdate`, then a `replace` onto the saved record's address or `closeEditView()`, then `closeAfterSave()`. Against a data router the last call wins, so which of them the user got was settled by statement order across two files that were not written as a pair.

  "Save and close" on an existing record worked, because the close happened to be last. The reference picker's "add new" is the same three in the other order — the picker's own `onUpdate` closes the panel and the `status !== "existing"` branch replaced it afterwards — so the close lost, the new entity's panel stayed open, and the `replace` landed in the picker's slot and destroyed it.

  It raises exactly one panel navigation now. `closeOnSave` is honoured (declared, documented, passed as `true` by the picker, and read by nothing until now, which is the behaviour that flow was failing to get by hand); closing beats replacing, because moving a panel to an address it is about to leave only fights the close; and `props.onUpdate` runs last so the opener's intent is the final word. Reordering alone would have left the other half standing — `close()` pops the top panel and a `replace()` after it writes into the slot below — so the fix removes the pairing rather than sequencing it. Written up as class 28 in `docs/bug-classes.md`.

- **One column the table could not describe took the whole table with it.** `propertiesToColumns` runs inside the memo that builds a collection table's columns, so anything it threw took the header, the rows and the empty state together: a blank pane with no error, no empty state and no data request to attribute it to. Three ways in, all reached by walking a property map with a hole in it — `getColumnKeysForProperty` read `.type` off an undefined map child, `getResolvedPropertyInPath` read `.type` off a missing path root, and `propertiesToColumns` threw outright when a key resolved to no property. A column that cannot be resolved is one column the table cannot offer, not a dead table, so it is named in a warning and the rest carry on — which is the choice `getSortablePropertyOptions` had already made twelve lines below, with a comment saying so.

- **One live subscriber counted for every other subscriber sharing its query.** A live subscription re-counts on every push so its reported total stays honest, and `listenCollection` deliberately collapses identical queries onto a single socket subscription while keeping one callback per subscriber — each of which ran its own count. One `collection_update` fanned out into one identical HTTP count per subscriber.

  Not hypothetical volume: every relation cell in a table mounts a selector that subscribes to the target collection before its dropdown is ever opened, so one message produced one count per visible cell — measured at 11 requests to `/api/data/customers/count` for an 11-row page of orders, and 66 on a wider table, all asking the same question. A count is a property of the query, not of the caller, so concurrent callers share the request; the entry is dropped as soon as it settles, which merges concurrent calls and never serves a cached total. Measured after: 11 requests to 1.

- **A relation column arrived as an id and the preview called it the wrong type.** The REST layer returns a relation column as the foreign key it is — a flat scalar — and only some fetch paths hydrate it into an object, so which form a preview saw depended on how the row was loaded. The preview accepted only one: `normalizeToEntityRelation` returned null for anything that was not an object and `PropertyPreview` read that null as a type error rather than as "not fetched yet", giving a red "Unexpected value" box per row wherever a relation sat in `previewProperties`, and a silently blank column elsewhere. `ArrayOfRelationsPreview` dropped such elements without a word.

  The property already knows the answer — it declares the target it points at — so the id is resolved against it. `getRelationTargetPath` reads the target from either form that carries one, the stamped `resolvedRelation` or the inline `relation`, which is all a preview can reach while holding a property and a value and no collection. The only lever an app had here was to keep relations out of `previewProperties`, which also decides the row title in list view: a choice between an error box and rows that cannot say what they are about.

- **Changing a record's layout met the edit as a stale draft.** The split's "hide list", full screen's "show list" and the side panel's "open full screen" all replace one mounted form with another showing the same record. Only the side panel handed its edit over; the other two left it to the local-changes backup — the channel for a draft left behind by a *closed tab* — so the record reopened clean under an "unsaved local changes" banner offering to apply changes the user had made a second earlier and never walked away from.

  Every control that changes layout calls one `carryEdit` now, and it carries only what was touched here; the side panel used to carry the whole record, which marked every field touched in the receiving form. The stale draft that banner exists to ask about was meanwhile being applied *without* it: the handoff map was hydrated from `sessionStorage` at startup, so after a reload every persisted draft looked like a handoff and the first visit to the record opened silently dirty carrying it. The handoff is in-session only now, and consumed on pickup.

- **The list row's responsive columns measured a ref attached to nothing.** The trimming logic existed, but `containerRef` was never put on an element — the component returned `<ListView>` directly — so the ResizeObserver never fired and `containerWidth` stayed at its 1200 seed forever. That seed resolves to exactly three extra columns at every width, which is why a split panel's list showed the same row as a full-window one and truncated the title to make room for them.

  The ref sits on a wrapper and the width is seeded from `getBoundingClientRect` on mount, so unmeasured means "title only" rather than "assume 1200". The title takes a comfortable 320px before columns bid at all, and each column is charged its own rendered width rather than a flat 160 — a relation no longer costs what a date costs. The first column that cannot be afforded ends the row, so columns drop right to left and never reorder while dragging the splitter.

- **The split view's record panel had no close button.** The only way out of an open record was Escape, or noticing that the collection name ahead of the title was a link. The bar ends in a ✕ now, behind a rule: a ✕ flush against Save reads as the next item in the action row, so the two adjacent controls are "commit this edit" and "abandon it". It needs no confirmation logic of its own — the split closes by navigating, and `useNavigationBlocker` already stands between a navigation and an unsaved edit. "Save and close" reaches the split too, as a `▾` welded to Save rather than the separate filled button the overlays carry: there the list is beside you and j/k walk from record to record, so saving and *staying* is the common case.

- **PATCH is served for updates, and the spec stopped describing a partial write as a replace.** The update handler merges — it writes the columns in the body and leaves the rest, which is what the SDK's `update(id, data: Partial<M>)` means — and PUT was the only route it was mounted on. The generated OpenAPI spec inherited that and made it worse by reusing the *create* input schema for the update body, so every `validation.required` property was marked required on a partial update: a published contract nobody implements, where a generated client sends more than it needs and a spec-validating gateway would reject partial updates the server happily accepts.

  PATCH is mounted on the same handler at both the collection and nested paths, and the spec describes it with a new `<Name>Update` schema derived from the input schema with `required` dropped — derived rather than rebuilt so the two cannot come to disagree about which columns exist. PUT stays, on the same handler, deprecated in the spec: changing its semantics to a true replace would silently start nulling columns callers have omitted for years, which is a data-loss change wearing the costume of a standards fix. The SDK also stays on PUT for now, deliberately and commented at the call site, because a 0.14 client sending PATCH to a 0.13 server gets a 404.

- **An offline `createMany` whose ACK was lost duplicated the whole batch.** `WriteOptions.idempotencyKey` was accepted on `create` and nowhere else, and the bulk route had no idempotency handling at all — so the one path where a replay costs the most was the one with no defence. A client that never sees a response cannot know whether the write committed, so it retries; without a key the server cannot tell that retry from a second genuine import. Through `create` that duplicates one row, through `createMany` every row in the batch up to `maxBulkRows` (1000 by default) — and the offline queue replays `createMany` on exactly this path. `upsert: true` hid it for callers who set it, and upsert is documented for re-runnable imports rather than for crash recovery.

  `POST /<collection>/bulk` claims the key before the write and replays the stored response, the same claim-before-write shape the single create uses and for the same reason: recall-then-write lets two concurrent replays of one key both through. A failed write releases the key, so one dropped connection does not leave a batch that can never be sent. `createMany` accepts `WriteOptions` across the client and the contract, and the offline replay passes `op.mutationId`, which closes the loop.

- **A dead public type, a closed error-code union, and docstrings that had drifted.** `RebaseBrowserClient` was exported and documented as "the shape produced by `createRebaseClient()`", and produced by nothing — that factory returns `CreateRebaseClientResult`. It also hand-duplicated ~16 members of `RebaseClient` rather than deriving from them, so it was a standing drift source as well as a false claim. Deleted.

  `RebaseApiError.code` was a bare `string` while the server emits a known set, so `e.code === "NOTFOUND"` type-checked exactly as well as the spelling that works. It is `RebaseErrorCode` now: the nine codes any route can answer with, unioned with `string & {}` to stay open, since routes define their own (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, a couple of dozen in auth) and closing it would be a lie that broke on the next one. Re-exported from `@rebasepro/client`, where callers catch. Also corrected: `slug` — required, and what the REST path, the SDK accessor, the admin URL and every reference property key on — was documented as "an alias that will be used internally", describing an optional field that no longer exists.

- **`rebase cloud <group> --help` ran the command instead of printing a page.** Two bugs stacked: `cli.ts` rewrote the subcommand to the literal `"--help"` whenever the flag appeared anywhere, so the group never reached the dispatcher, and the dispatcher short-circuited on that value before dispatch. Seven cloud modules carry their own `"--help"` flag that could not run, leaving ~44 flags with no way to be listed.

  Routing `--help` through as the *action* would have fixed only the groups that switch on it; the rest take `rawArgs` and ignore the action, so the flag did nothing and the command ran anyway — `cloud env --help` failed on "No project specified", `cloud deploy --help` began resolving a project, and `cloud link --help` opened an interactive project picker, a prompt from a flag whose whole job is to print text and exit. `--help` is answered centrally now, before dispatch, from a group→page map, so a handler cannot be reached and prompting is structurally impossible rather than merely fixed. `cloud-help.test.ts` asserts that no handler ran, since a regression here does not look like wrong text — it looks like CI hanging on a prompt.

- **One name per privilege level on the server, and the RLS claim the callbacks guide made was wrong.** `RebaseServerClient` omits `data` so the RLS-bypassing plane has exactly one name, `dataAsAdmin` — and cron undid it, typing the same singleton as `RebaseClient` and handing it back as `client`. Its own docstring admitted it ("it is only named `client` here"), and a reader who learned `client.data` there carried it to a collection callback, where `context.data` is a different trust level entirely. Cron exposes `rebase: RebaseServerClient` now, matching the singleton import and `defineFunction`, with `client` kept as a deprecated alias typed to keep its `data` member so existing cron files compile and run unchanged.

  The larger find is the documentation. The callbacks guide stated, in all six locales, that `context.data` bypasses RLS and has "full database access regardless of the triggering user's permissions". It does not: authenticated writes run through `withTransaction`, which builds a fresh base driver bound to the RLS-scoped transaction after the role has been downgraded, so a callback on a user request is user-scoped for reads *and* writes; only server-context work (`dataAsAdmin`, cron) bypasses. Wrong in the unsafe direction, and nothing tested it either way, which is how it stayed wrong.

- **A `hasMany` was declared once and rendered twice.** A many-cardinality relation becomes an entity tab, which is the whole treatment for a list of child rows. It was *also* still a member of `properties` — the only place a relation can be declared — so the form rendered it a second time as a relation picker: a dropdown offering to select a collection's own children, one card per child row. Nothing marked the relation as already consumed, so every `hasMany` and `manyToMany` property in every project grew a stray field.

  `getChildViewRelationPropertyKeys` is the missing half of `getEntityChildViews`: given a collection, it names the property keys the entity view has already taken, and the form's field list (`getFormFieldKeys`, which both the editable form and the read-only entity view build from) drops them. The match is on the resolved `relationName` rather than on the key, so a relation declared in `relations` and pointed at by a differently-named property is recognised too. A relation nested inside a `map` gets no tab, so it keeps its picker; a `belongsTo`/`hasOne` is a foreign key the author edits, and never had a tab to be redundant with.

  The collection table had the same duplication with the halves reversed. Every child view gets a 200px button column that opens its tab, and for a relation declared in `relations` that button is its only presence in the table — but for one declared as a property it was the *second*: the property's own column was already there, hydrated by the list fetch's `include: ["*"]` and showing the child rows themselves, and the button carried the same heading, because a tab takes its name from the declaring property. Two columns called "Vacantes a las que postuló", one of them a button. The property column wins there — it shows what the children are, and each chip in it opens one — so the button is dropped. Unless the author hid that column: `hideFromCollection`, or a `propertiesOrder` that omits it, is a statement about the column and not about the relation, so the button comes back rather than the relation dropping out of the table altogether. `getRedundantChildViewColumnIds` answers this for both the column ids and the delegates that build them, so an id is never displayed without something to render it, and a column order saved before this change stops naming the button.

  Declaring a many-relation as a property is still worth doing — it names the tab and gives the relation a key that a table column and an `include` can address. If you want the inline picker anyway, `admin: { renderInForm: true }` asks for it back.

  ```diff ts
   "talent-applications": {
       name: "Vacantes a las que postuló",
       type: "relation",
       relation: { kind: "hasMany", target: () => talentApplications, foreignKeyOnTarget: "talent_id" }
  -    // …and a second, unusable copy of this relation at the bottom of the form
   }
  ```

- **`conditions: { hidden: true }` did not typecheck.** `hidden`, `readOnly` and `disabled` took a `JsonLogicRule`, which is `Record<string, any>`, so the unconditional case — a field that is simply never shown, never editable — had to be spelled `{ "==": [1, 1] }`. That reads as a puzzle at the call site and as a mistake to the next person. They take a plain boolean now (`ConditionRule`), and because a literal needs no context to evaluate, `isHidden`/`isReadOnly`/`isDisabled` answer it directly — so it is honoured everywhere a field is laid out, not only where a condition context happens to exist. A *rule* is still not evaluated in production; that gap is unchanged and is about needing an entity to evaluate against.

- **A relation preview rendered the target's whole document.** An author card printed the entire Markdown biography — headings, bullet list and all — inside a box built for two lines of text, because three layers each assumed one of the others was keeping the value to a line.

  Selection was positional. `getEntityPreviewKeys` took the first few properties from `propertiesOrder` and read that as a claim that they summarise a record; `propertiesOrder` states the *column* order of a collection table, which is how the third column of an author ended up on the card. Properties are ranked now by whether the value has a one-line form at all (`rankSummaryProperty`): a map renders as a key/value table and an array of maps as a stack of them, so neither takes a slot from a value that fits; long text is an excerpt and sorts behind everything that does fit, but is still used when it is all there is, because an opening line beats a card with nothing under the title. A stated `previewProperties` is returned verbatim, ranking and limit included — asking for the biography still gets the biography. The two diverged copies of the picker are one implementation, in `@rebasepro/app`.

  Rendering was unconstrained: `PropertyPreview` rendered `admin.markdown` as a full document whatever size it was asked for. A preview inside an entity preview now renders a compact form — Markdown and multi-line text as their opening line, a map as its first labelled leaves, an array as a count. The signal is the nesting depth the card already publishes, so nothing between the card and the preview has to forward a prop.

  And the card could not defend itself. `truncate` is `white-space: nowrap`; it clamps a line of text and does nothing to block children, so the box grew to the height of whatever was inside it. Rows are height-capped and the container clips, which also holds for a custom `admin.Preview` component, which can render anything at all and cannot be reasoned about in advance.

  The card fills the same slots as every other surface that renders one record — image, title, subtitle, status — rather than its own list of "the first few properties".

- **A relation in a card slot drew a card inside a card.** `SlotValue` took `textOnly` as opt-in. The list view passed it; the card and board views did not, so a relation filling their title or subtitle slot rendered its own bordered preview, complete with an id line and a side-panel button, wrapped over three lines of a narrow grid card. It is the default now — a slot is one line of a row, and the one caller that would want a card in one is none of them.

- **Editing `@rebasepro/cms-types` did nothing in dev.** The app's Vite config resolves every workspace package to source, with a comment explaining that the one package left out came from its built `dist` and so ignored edits until it was rebuilt. `admin-types` was added later and missed the list, and repeated the same bug.

- **A monthly cron job spun at 112 iterations a second instead of waiting.** `setTimeout` holds its delay in a 32-bit signed integer: past ~24.8 days Node does not wait and does not throw, it clamps the delay to 1 ms and fires immediately. `scheduleNext` had a floor on the delay and no ceiling, so a job like `0 4 3 * *` — whose next slot sits about 30 days out for most of the month — woke at once, claimed its own future slot, lost the race against that claim on the next wake, logged *claimed by another instance*, and rescheduled into the same overflow. A tenant ran this way for a day and a half: 1.9 GB of logs, a `cron_claims` INSERT every 9 ms, and the job itself never running. Pod restarts did not clear it, because the claim that makes it skip is a persistent row.

  Three things were wrong and all three are fixed. Delays past the ceiling are now slept in hops and re-derived on waking, so the cron expression stays the source of truth. A fire that arrives **before** its slot no longer claims — an early wake is also what a backwards NTP step or a resumed VM looks like, and claiming on one is unrecoverable, because the claim is permanent and the real run is skipped when it comes due. And startup now releases claims on slots that have not happened yet, which can only come from an early fire, so a database already poisoned by this heals on the next deploy rather than silently skipping one run.

- **A collection whose slug contains slashes rendered a blank page.** `getCollection("content/de-DE/podcasts")` never tried an exact match. It split on `/`, read the pieces as collection/entityId/subcollection, looked for a root collection called `content`, found none and threw — and the catch logged at `console.debug` and returned undefined, which `RebaseRoute` renders as `null`. The result was an empty content pane inside working chrome: the sidebar, the nav highlight and the breadcrumb all still resolved, because those read the collections array directly rather than the registry. One app had thirty-five collections unreachable this way, seven content types across five locales.

  A slug is allowed to contain slashes and some drivers need it to — a Firestore collection partitioned by locale is *named* `content/de-DE/podcasts`, it is not a path to walk. An exact slug match now runs before the path walker, on the id-trimmed path, so a record inside such a collection still resolves to it. And an unresolved collection renders "Collection not found" naming the path, and warns at `console.warn`: returning bare `null` is what made a one-line lookup bug look like missing data, with nothing above `debug` to search for.

- **`optionalAuth` returned 500 on backends that do not issue JWTs.** A backend authenticating through an adapter — Firebase, Clerk, anything with its own tokens — never calls `configureJwt`, so verifying a bearer token threw. That turned a route which had already decided anonymous callers were fine into a 500 for every request that happened to carry a token. The tolerate-the-absence-of-auth paths ask `isJwtConfigured()` first now. The signing paths still throw when it is false, because asking a server that cannot mint a token to mint one is worth hearing about.

- **The read-only record kept the layout the form left behind.** Reading a record and editing it drew the same data two different ways. The form resolves sections, grid spans and a metadata rail from the collection; the read-only view was a flat two-column table of every value — 4/12 label against 8/12 value, no grouping, no second column. A boolean and a markdown body got the same room, an email wrapped over two lines while half the pane beside it stayed empty, and pressing Edit rearranged the record you were just looking at.

  It resolves its layout with `resolveFormLayout` now — the same call the form makes — and renders each field through the same `FieldBlock` and grid span, with a `PropertyPreview` where the form puts a control. So it gets the configured sections, the derived grouping when there are none, the per-type widths with row filling, and the rail with the sidebar fields and the id/created/updated block, folding into a trailing group on a pane too narrow for it. Two things fell out of sharing the resolver: `additionalFields` need a form context the delete dialog has none of, so they are dropped before the layout resolves rather than skipped while rendering (skipping left a hole where a full row had been allocated); and previews take `hideLabel`, because `BooleanPreview` printed the property name beside its checkbox, which under a field label read as "VIP" above a checkbox saying "VIP".

- **The X that hid the list looked like it closed the record.** The split view's list-hiding control sat on the record's own app bar wearing an X, which every convention reads as "close the thing I am attached to". It is a double chevron now, pointing at what actually moves, matching the sidebar toggle. Hiding the list had also been a one-way trip — `#full` replaced the collection and left browser Back as the only route back — so showing it again is the same single route (dropping the hash), offered only where the URL would genuinely resolve to a split.

  The detail view's back arrow moves from the trailing edge, where it sat among the record's own actions, to the leading edge the edit view has always used; where the chevron renders it goes entirely, since both reach the same collection and the chevron keeps the record open. And the breadcrumb is a link now rather than inert text that looked like one, carrying the view mode so a collection reached from one of its own records comes back as you left it. Overlays keep plain text: they already sit on top of that collection, and navigating would dismiss the record as a side effect.

- **The drawer's tooltips were on in the one place they were noise, and off everywhere they were needed.** The collapse/expand toggle carried a tooltip saying "Collapse" while the row it was attached to already said *Collapse* in plain text beside the chevron — the tooltip only backed off while the drawer floated open under the pointer, which is the other state where the word is already on screen. It now shows up only on a bare rail, where the chevron stands alone.

  The navigation entries had the opposite problem. Their tooltip's `open` was controlled by a flag that was true only while the drawer was hovered-but-not-open — and in exactly that state the entries are told the drawer *is* open, which forced the same tooltip shut. The two conditions could never both hold, so no entry tooltip could ever appear in any state. That went unnoticed while hover-expansion was unconditional, because the floating panel's labels covered for it; with `autoOpenDrawer={false}` now a real setting, it left a rail of unlabelled icons with nothing to identify them. Each row now owns its own tooltip state, so they follow the pointer one at a time rather than firing in unison, and they answer to keyboard focus as well. `tooltipsOpen` and `adminMenuOpen` are deprecated no-ops on `DrawerNavigationGroup` and `DrawerNavigationItem`.

  Both tooltips are *masked* where the label already says the same thing, rather than unmounted or switched to uncontrolled — either of those moves a Radix tooltip between controlled and uncontrolled mid-life, which strands whatever it was last told. The first attempt at this fix did exactly that and left a tooltip hanging beside the rail, naming a row the pointer had left seconds earlier. Masking has its own version of the trap: a hidden tooltip never hears the pointer leave, so the stale `true` is dropped on the way *into* the masked state rather than waiting for a close that will not come.

- **An open dropdown left the drawer floating indefinitely.** The collapse-on-mouseleave already declined to fire while a popover was up — its content is portalled outside the drawer, so reaching for it registers as leaving. But nothing fires a second `mouseleave` when that popover finally closes, so the drawer just stayed expanded over the content until the pointer happened to cross it again. The collapse is owed now, not cancelled: the drawer watches for the popover to go and collapses then, unless the pointer came back in the meantime.

- **Two admins on one origin shared a drawer, and the stored state broke server rendering.** The persisted open/closed state used one flat `rebase-drawer-open` key, so a second admin on the same origin — a different `basePath`, its own navigation — silently overwrote the first one's. The key is namespaced by base path now. Reading it also happened during the first render, which is a client-only fact and made the first client render disagree with server-rendered HTML; it is applied in a layout effect instead, before paint, so nothing flashes and nothing mismatches. The unreleased flat key is not migrated: a drawer starts collapsed once, and the next toggle sticks.

- **The drawer's collapse control was a `div` pretending to be a button** — `role="button"` plus a hand-rolled Enter/Space handler, where a `<button>` gets all of it from the platform.

- **Resizing across the layout breakpoint dropped the navigation over the content.** One piece of state drives two different things: the expanded rail on large layouts and the modal sheet on small ones. Narrowing the window with the rail expanded carried that `true` across the breakpoint, so the sheet — overlay and all — appeared over the content unasked, which is the exact outcome the persistence rules were written to avoid. Crossing to a small layout now resets it, and widening again restores the stored choice.

- **The navigation drawer remembers whether you collapsed it, and stops expanding on its own.** Two separate reasons the drawer kept turning up open. First, `autoOpenDrawer` was destructured in `Scaffold` and then never read, so the hover handlers were attached unconditionally: an admin passing `autoOpenDrawer={false}` still got a rail that floated open whenever the pointer crossed it. It is honoured now. Hover expansion remains the default — it is what every admin has always had — and `autoOpenDrawer={false}` genuinely turns it off. Second, the open/closed state was plain `useState` — every reload threw the choice away. It is persisted in `localStorage`, keyed by the admin's base path, so the last toggle is what you get back. `defaultDrawerOpen` still seeds the very first visit and is ignored after that. Small layouts are excluded from persistence on purpose: there the drawer is a modal sheet, and restoring it would drop an overlay over the content on load.

- **Upgrading from 0.12 renamed the foreign-key column and then refused to boot, permanently.** 0.13 derives `category_id` where 0.12 derived `categorie_id`, and boot-ensure renames the database column to match — that half worked, data intact. Then relation validation read the project's checked-in `backend/src/schema.generated.ts`, which the previous release generated and which still says `categorie_id`, and killed the boot. Restarting could not help: the rename was already applied, so every boot failed the same way. The message made it worse by describing the wrong artifact — "`through.targetColumn: "category_id"` is not a column on the junction table", about a column the database *did* have — and advising `through.targetColumn: "categorie_id"`, which by then existed nowhere. Following the fix instructions broke the relation for good.

  Three changes. `rebase dev` now detects a generated schema that names foreign keys under the old rule and regenerates it before the backend starts, so the upgrade does what the 0.13 note said it did. `rebase schema stale` reports the same thing for a build or a CI step, and exits non-zero. And when a stale schema does reach the runtime, the boot error names the generated file as the stale artifact, says to run `rebase schema generate`, and no longer suggests pinning the migrated-away column. `rebase build` was never affected — it regenerates the schema from the collections already.

  Both halves of this had unit tests that passed. The ensure-plan test proved a RENAME is emitted, from a hand-written schema map; the relation-validation test proved a missing junction column is reported, from a registry built to agree with its collections. Neither could see the bug, because it only exists where the two disagree — and no test built a registry from a *stale* generated schema. `legacy-fk-rename-boot-seam.test.ts` is that seam.

- **`rebase.dataAsAdmin.projects.find()` did not typecheck** — nor did `data.products.find()` on the Entity accessor — for any project without a generated `Database` type. The untyped branch of `RebaseSdkData` and `RebaseData` declared their index signature as `SDKCollectionClient | ((slug: string) => SDKCollectionClient)`, unioning in the `collection` method's own signature on the theory that a named property must satisfy the index signature it sits beside. It does not here: `collection` is declared in a separate member of an intersection. The union bought nothing and cost property-style access — the form the type's own `@example` shows, the scaffolded function template uses, and the 0.13 `rebase.data` migration note tells you to write. `collection("projects")` was the only spelling that compiled.

  The migration note shipped uncompiled because it is a ```diff fence, and the docs verifier only ever typechecked `ts`/`js` blocks. Language-tagged diffs (```diff ts) are compiled now — the added lines, with removed lines blanked so diagnostics keep pointing at the right line of the doc.

- **A scaffolded project could not build its own `config` workspace.** `config/tsconfig.json` pins `types: ["node"]` — deliberately, to stop tsc sweeping pnpm's virtual store — but `config/package.json` never depended on `@types/node`, and under pnpm's isolated layout there is none reachable from that directory. `pnpm -r build`, and the workspace's own `build` script, failed with `TS2688: Cannot find type definition file for 'node'` one minute after `rebase init`. `check:templates` could not catch it: it compiles the collection files with its own `typeRoots` pointed at the repo, which is right for what it checks and is exactly why the omission survived. It now also asserts that every ambient type a template tsconfig pins is a declared dependency of the workspace pinning it.

- **A project scaffolded by a prerelease CLI pinned a runtime image tag that cannot exist.** `.env` pins `REBASE_VERSION` to the version of the CLI that scaffolded, which is right for a stable release and wrong for every canary: only stable publishes `rebasepro/server`, so `docker compose up` died on `manifest unknown` — the same dead end as the missing-repository bug the pinning was added to prevent. A prerelease falls back to `latest` now, with a comment in the file saying that it floats and to pin an exact version before deploying. That fallback is correct rather than merely available: a bundle declares the runtime range it needs (`^1`), the image supplies only `@rebasepro/server`, and the framework a bundle runs is installed from its own `deps.declared` at boot, so the current stable runtime boots a canary bundle by design.

- **`/api/health` answered 404.** Health lives at `/health`, outside `basePath`, because that is what an orchestrator probes — but every other route a developer touches is under `/api`, so the first place anyone looks returned "not found" and read as a broken server. It is served at both paths now.

- **`rebase init --headless --introspect` contradicted itself**, announcing "collections generated!" and then "There are no collection files" in the next paragraph. The closing note now depends on whether introspection actually produced them.

- **A long table and column name made boot re-issue the same `ADD CONSTRAINT` forever.** Postgres truncates an identifier to 63 bytes silently, so a foreign key on a long table plus a long column was stored under a name the generator never derived. Boot-ensure compares its planned constraints against the catalogue, and that comparison could therefore never match: every boot planned the constraint again, and got "already exists" again. Non-fatal — a foreign key is the one action allowed to fail — and so permanent, an error in the log on every restart for the lifetime of the project.

  The name is truncated at construction now, in bytes rather than characters, so the code agrees with what the database already stored. Five places derived that name independently — one in the ensure planner and four written out by hand in the DDL generator — and all five go through one helper, which is how the halves came to disagree in the first place. This changes what Rebase *derives*; it changes nothing about what any deployed database *contains*, which is the test that makes it a legitimate exception to the freeze below.

### Testing & CI

- **Derived database identifiers are frozen, and there is a gate that says so.** A column name is an API — the kind that is written into a customer's database on the day they deploy and cannot be changed afterwards by anything this repository ships. 0.13 improved the foreign-key derivation, and every aged database with an irregular plural disagreed with the code the moment it upgraded: the column was migrated, the project's checked-in generated schema was not, and the boot died. Three commits to recover from a nicer-looking column name nobody had asked about.

  `contracts/derived-names.txt` now pins every identifier the framework derives rather than is told — foreign key columns and their constraints, junction tables and their key columns, enum types, policy names, `camelCase` → `snake_case` columns — rendered from a fixture built to make every naming rule fire at once. `pnpm check:derived-names` classifies a difference rather than just reporting it: a moved name fails as a contract break naming the old and new spelling, and even a purely additive change fails with "regenerate", so the baseline cannot drift underneath anyone. The rule it enforces, and the one legitimate exception to it, are contract 6 in `docs/compatibility.md`.

  It pins a second contract hiding inside the first: that `rebase db push` and the managed runtime's boot-ensure derive the *same* names. They compile the same collections through different code, and a project pushed once and booted later must not end up with two schemas. That check is what found the truncation bug above — the two producers had been disagreeing about one constraint name.

- **The upgrade corpus records aged *projects*, not just aged databases.** `schema-snapshots/` records a database and is why several one-way auth migrations are safe. It could not have caught the 0.13 boot failure, and neither could any database-only corpus, because that bug lived in the disagreement between a migrated database and the un-migrated artifact beside it — a state no hand-written fixture produces, since a fixture author writes both sides and writes them agreeing. That is exactly why the unit tests on either side of it both passed.

  `project-snapshots/` records both halves from the same release: the database with its rows, the tables and columns that release's codegen declared, and the collections that produced them. `project-upgrade-e2e.test.ts` replays each through the current code and asserts the upgrade converges, the rows survive, any renamed relation column brought its data (compared across the rename, since a renamed column is *supposed* to have a different name), the tables are still locked, and a stale generated schema is diagnosed rather than followed.

  `scripts/release.sh` records one per release, from a Postgres it starts itself — no live database of the right vintage required. That is the point: "record one per release" was already a documented step, and it had been skipped three releases running, so the only version worth building is the one nobody has to remember. A release that cannot record one says so loudly and continues.

- **The gates that would have caught this release's bugs.** Each of the fixes above had passing unit tests on both sides of it and none in between, because every fixture built its own input and so could never let the two sources of truth disagree. Five gates close that shape: `legacy-fk-rename-boot-seam.test.ts` builds a registry from a *stale* generated schema while the database has been migrated; `generated-schema-staleness.test.ts` pins the detector including its no-false-positive cases; `check:runtime-image` refuses a shipped compose file naming an image no automatically-triggered workflow publishes; `check:templates` additionally asserts every ambient type a template tsconfig pins is a declared dependency of the workspace pinning it; and the docs verifier compiles language-tagged ```diff fences, so migration guidance is checked rather than just written.

- **The driver floor is measured rather than discovered.** Two capabilities, not one: serving tables that already exist is the fleet-rollout case and every driver back to 0.10.0 manages it, which is what the skew pass asserts. *Creating* them at boot is separate, and drivers before 0.13.0 do not expose it — the runtime logs "Collection tables will NOT be created" and every `/api/data` route 500s on a missing relation the moment a project adds a collection or deploys fresh. CI now measures both.

- **The bundle corpus boots against every driver a project may still carry.** `stage()` lent the whole donor `node_modules`, so both halves came from this checkout and every run booted current-driver against current-server — a pairing that exists on no tenant anywhere. Production is the opposite: `docker/entrypoint.mjs` symlinks only `@rebasepro/server` from the image over a bundle's own copy, so a managed project runs today's server against whatever driver it was built with.

- **`@rebasepro/server`'s API surface is frozen.** It is the one package the entrypoint substitutes into an already-built bundle, so its exports are the only ones that change underneath tenant code on a schedule nobody rebuilding chose. Changes to it now have to be declared.

- **Two dead paths deleted, and what they knew kept.** `FetchService.fetchWithDrizzleQuery` was private with no callers, kept alive only by a test reaching in through `(service as any)` — the worst arrangement available, since the guarantee read as covered while the path that actually serves it had none. That guarantee (a null belongsTo must not inline as a row) moved to `row-pipeline-null-relation.test.ts` against `toRestRow`, which is what production runs, and was checked by deleting the guard and watching it fail. `resetConsole` went too: it snapshotted "the originals" after `configureLogLevel` had already replaced them, so it captured the no-ops and restored them over themselves. Neither was public — `api-surface/server.api.txt` is unchanged. Corpus fixtures are renamed after the `bundleFormat` they carry, since `v2` collided with the runtime contract major, which decides something else entirely.

## [0.13.0] - 2026-08-03

### Breaking

- **Rebase creates exactly one schema in your database, and it is called `rebase`.** The RLS helpers move from `auth.uid()` / `auth.roles()` / `auth.jwt()` to `rebase.uid()` / `rebase.roles()` / `rebase.jwt()`, and the `auth` schema is removed.

  `auth` was Supabase's name, borrowed so that a developer who had written Supabase RLS would recognise `auth.uid()`. The familiarity was real; the name was not ours to take. Pointing Rebase at a database that already had an `auth` schema meant applying `CREATE OR REPLACE FUNCTION auth.uid() RETURNS text` over Supabase's `RETURNS uuid`, which Postgres refuses outright — and at boot that landed in a catch-all, leaving a database with auth tables, no helper functions, and policies calling functions that did not exist.

  Migrating is meant to be uneventful. Structured rules (`policy.authUid()`, `policy.rolesOverlap()`) never spelled a schema and need no change at all. Raw policy SQL written against `auth.uid()` is rewritten on compile, and the boot names the collections carrying it rather than rewriting in silence. Policies already in a database are recompiled by the next push or boot, and keep their names, because policy names hash the rule's semantics rather than its SQL. The `auth` schema is then dropped — each function matched on its own result type and body first, and the schema by `RESTRICT`, never `CASCADE`, so anything else living there keeps it.

- **The scaffolded database role is `rebase_app`, not `rebase`.** Postgres resolves unqualified names through `"$user", public`, so a role named `rebase` put the new `rebase` *schema* ahead of `public` for any tool that does not pin `search_path` — psql, pg_dump, drizzle-kit, a hand-written migration — and statements silently landed in the wrong schema.

  Existing projects are unaffected and stay covered by `pinSearchPath`, and a boot-time check reports the collision for any project that picks a colliding name of its own. **New** projects get `rebase_app` in the generated `docker-compose.yml` and `.env`. If you are following a deployment guide you had already copied, the connection string is the thing to update — a stale `postgresql://rebase:...` against a freshly generated compose file fails with `password authentication failed for user "rebase"`.

- **`rebase.data` is gone — use `rebase.dataAsAdmin`.** The server singleton had two names for one accessor, and the shorter one gave no hint of what it does: `rebase.data` and `rebase.dataAsAdmin` were the same admin-scoped, **RLS-bypassing** driver. `data` is the name a browser client uses for its *user-scoped* accessor, so the same expression meant "whatever this user may read" on the client and "everything, no policies" on the server. That is a bad thing to have to remember at a call site that reads fine either way.

  ```diff ts
   import { rebase } from "@rebasepro/server";

  - const { data: rows } = await rebase.data.projects.find();
  + const { data: rows } = await rebase.dataAsAdmin.projects.find();
  ```

  `RebaseServerClient` now extends `Omit<RebaseClient, "data">`, so this is a compile error rather than a silent privilege. **The property still exists at runtime**, aliasing `dataAsAdmin`, so an untyped JavaScript caller keeps working instead of failing on `undefined` mid-upgrade — the type is the contract, and it is the type that changed.

  Unaffected, because their accessor is genuinely user-scoped and was never deprecated: `context.client.data` in entity callbacks, and `client.data` in a cron handler — both are `RebaseClient`. Also unaffected: `rebase.data` in a **generated SDK** or browser app, which is a different object entirely.

  For user-scoped queries inside a request handler, neither name is right: use the request-scoped driver (`c.var.driver`), which carries the caller's identity so RLS applies.

- **Every other deprecated export is gone too.** Ten more symbols carrying `@deprecated`, removed rather than carried across the 1.0 line. After 1.0 a deprecated export costs a major to remove, so the choice was to drop them now or keep them until 2.0 — and each one was an alias for something already exported under a better name, so keeping them only bought a second way to write the same line.

  | Removed | From | Use instead |
  | --- | --- | --- |
  | `buildCollection` | `@rebasepro/common` | `defineCollection` |
  | `buildProperty` | `@rebasepro/common` | a plain property object |
  | `RebaseUser` | `@rebasepro/client` | `User` from `@rebasepro/types` |
  | `RebaseTokens` | `@rebasepro/client` | `AuthTokens` from `@rebasepro/types` |
  | `UserInfo` | `@rebasepro/app` | `User` from `@rebasepro/types` |
  | `Session` | `@rebasepro/app` | `DeviceSession` from `@rebasepro/types` |
  | `AuthApiError` | `@rebasepro/app` | `RebaseApiError` from `@rebasepro/types` |
  | `DatabaseConnection` | `@rebasepro/server` | `DriverConnection` |
  | `createApiKeyRateLimiter` | `@rebasepro/server` | `createDataRateLimiter` |
  | `resolveChannelBusConfig` | `@rebasepro/server-postgres` | `resolveChannelBusSetting` |

  Every one is a rename at the import site. The three that are not purely cosmetic:

  `createApiKeyRateLimiter` **skipped every request that was not API-key-authenticated**, which on a normal deployment is nearly all of them — a limiter that reads as protection and passed the traffic you would want limited. `createDataRateLimiter` covers signed-in users and anonymous callers too, and has been the wired default since it landed.

  `buildCollection` / `buildProperty` were **announced as removed in 0.11 and were not** — the note went into the changelog and into the collections docs, and both functions kept shipping from `@rebasepro/common` for two more minors. Anyone who read the note migrated; anyone who did not kept a working build. Now the code matches what was published, and the collections docs no longer name a version the removal did not happen in.

  `DatabaseConnection` is still a name you can import from `@rebasepro/server` — that is the point of removing it. Two different shapes answered to it: a local alias for `DriverConnection`, and the canonical `DatabaseConnection` from `@rebasepro/types` that the package re-exports. Deleting the alias leaves one. If your import resolved to the alias, it was the driver connection and wants `DriverConnection`; if it type-checks unchanged, it was already the canonical one.

- **Default foreign-key column names were mangled for irregular plurals, and are fixed.** `generateForeignKeyName` singularized by chopping a trailing `s` off the snake-cased name, which produced `categorie_id` for `categories`, `addres_id` for `addresses`, never `child_id` (it gave `children_id`), and — because `toSnakeCase` splits on every capital before the chop — `ur_l_id` for `URLs`. It singularizes first now, with the package's real `singular()`, then snake-cases. Two guards: a double-`s` ending is never a plural marker, and a name that singularizes to nothing keeps its original.

  **This changes the default column name for affected relations**, so an existing database has the old name. Boot-ensure migrates it: when a table carries the relation column under its pre-singularization name and not its current one, it emits `ALTER TABLE … RENAME COLUMN "categorie_id" TO "category_id"` rather than `ADD COLUMN`. In Postgres a rename is metadata-only — the values stay put and the column's indexes and constraints travel with it. Adding was the actual bug: it created the new column empty beside the populated old one, every statement succeeded, and the relation then read the empty one.

  If you named the column explicitly, nothing changes — this is only the default.

- **`firestoreToCMSModel` and `cmsToFirestoreModel` are renamed** to `firestoreToRebaseModel` and `rebaseToFirestoreModel` in `@rebasepro/firebase`. They reached consumers through the package barrel's `export *`, so this is a breaking rename with no alias — a shim would keep the word in the API it is being removed from. (`toCmsRow` → `toFlatRow` moves with them, but is internal to `server-postgres`.)

- **MongoDB search matched no field.** `buildSearchConditions` selected searchable columns with `prop?.dataType === "string"`. No property in `@rebasepro/types` has ever had a `dataType` field — a real collection carries `type` — so the loop matched nothing for every collection a user could declare, `orConditions` came back empty, and the fallback turned every search into a `$text` query, which needs a text index and throws `IndexNotFound` without one. The suite passed because its fixtures were written with the same wrong key.

- **`admin.widthPercentage` is gone — use `admin.span`.** Field width is a span over a shared four-column grid now, so two fields line up whatever order they were declared in. A raw percentage could not line up with anything: `33` and `35` produced different widths that looked like a mistake, and nothing snapped to a common edge.

  ```diff
  - admin: { widthPercentage: 50 }
  + admin: { span: 2 }
  ```

  If you are migrating: `≤30 → 1`, `≤55 → 2`, `≤80 → 3`, otherwise `4`. Spans are ignored where the form is too narrow for two columns — the side panel, the split pane, a phone — which was also true of percentages.

- **`RebaseAuthConfig` is gone from `@rebasepro/cms-types` — use `RebaseAuthViewConfig`.** It was a compatibility alias for a name that collides head-on with `RebaseAuthConfig` in `@rebasepro/server`, which configures the *backend* auth: JWT secrets, OAuth providers, password hooks. Two unrelated shapes under one name, exported from two packages whose whole job is to be imported together.

- **`react-router` 8, and `react-router-dom` is gone** — react-router 8 deletes the `react-router-dom` package outright. It was only ever a v6-compatibility shim: everything DOM-specific had already collapsed into `react-router` itself in v7.

  `@rebasepro/cms`, `app`, `studio` and `plugin-ai` now peer `react-router ^8.3.0`. Two imports move, and only one of them is a rename:

  ```diff
  - import { createBrowserRouter, RouterProvider } from "react-router-dom";
  + import { createBrowserRouter } from "react-router";
  + import { RouterProvider } from "react-router/dom";
  ```

  Everything else — `useNavigate`, `useLocation`, `useSearchParams`, `useParams`, `Link`, `NavLink`, `Outlet`, `Navigate`, `Route`, `Routes`, `MemoryRouter`, `useBlocker` — is the same name from `react-router`. `RouterProvider` is the exception: it lives in `react-router/dom`.

  The floors underneath move with it, because react-router 8 requires them: `react` and `react-dom` peers go to `>=19.2.7` (were `>=19.0.0`), and `engines.node` on `@rebasepro/cms` and `app` to `>=22.22.0` (was `>=20`). Declaring `>=20` while a mandatory peer needs 22.22 is a promise the package cannot keep.

  This closes GHSA-qwww-vcr4-c8h2, which has no fix on the 7.x line. That advisory is an RSC-mode CSRF bypass and nothing here uses RSC mode, so the vulnerable path was unreachable — but 8.3.0 is the only patched release, and the alternative was staying on a package that no longer exists.

  **If you test with Jest**, budget for this: react-router 8 is ESM-only, and it breaks ts-jest's CommonJS output in two unrelated ways. react-router guards a Vite HMR hook with `import.meta.hot`, which is a *syntax* error in CJS — and ts-jest cannot fix it, because TypeScript emits `import.meta` verbatim under `module: commonjs`. Separately, react-router depends on `cookie-es` 3, which ships `.mjs` only, and TypeScript keys module format off the file extension, so it will not emit CJS for a `.mjs` input whatever `module` says. Every affected suite dies at module load with zero tests run, which reads as a broken config rather than a dependency-format problem. `scripts/jest/react-router-esm-transform.cjs` in this repo handles both and is a reasonable thing to copy. Vitest is unaffected.

- **`rebase cloud deploy --source` on a managed project now needs `--force`.** It ejects the project to a custom container image, and until now it did that on the strength of `--source` alone — read as self-evidently a deliberate eject. It is not. `--source` answers *which source gets built* — this directory, rather than the months-old archive the control plane is holding — and the eject is a side effect of that answer, not something the caller named. Someone reaching for `--source .` because they want their working tree deployed has the right instinct and no reason to expect a runtime change.

  That is how a live project got flipped from `runtime.mode: managed` to `custom`, discovered afterwards from `rebase cloud status` showing `frameworkVersion: null`. The bare form had been refused for the identical reason since the release below; `--source` was the hole left in it. Both forms are now the same rule: a container-image build of a project the platform runs as managed happens only when `--force` says to.

  ```diff
  - rebase cloud deploy --source .        # ejected, with a warning
  + rebase cloud deploy --bundle          # stay on managed — almost always what was meant
  + rebase cloud deploy --source . --force  # eject on purpose
  ```

  The refusal carries `code: "managed_project"`, which is what it already used, so a caller already branching on that code needs no change.

- **`rebase db branch` keeps the name you give it.** Branch names were stripped of everything outside `[a-zA-Z0-9_]`, so `rebase db branch create my-feature` answered `✓ Branch "myfeature" created` — a different name than the one asked for, and the only one `list` would ever show.

  ```diff
  - $ rebase db branch create my-feature
  -   ✓ Branch "myfeature" created successfully.
  + $ rebase db branch create my-feature
  +   ✓ Branch "my-feature" created successfully.
  ```

  Nothing needed the stripping: every identifier the branch service builds is double-quoted, which is what makes a hyphen safe, and the validator used for `--from` had always accepted hyphens — the two disagreed about the same character class. A name that *cannot* be represented (a space, a dot, a slash) is now refused with `Invalid branch name: only letters, digits, underscores, and hyphens are allowed.` rather than quietly turned into a different one. Names are also capped at 60 characters, because Postgres truncates identifiers past 63 bytes silently, which is the same rename by another route.

  **Branches created before this keep the name they were stored under.** `my-feature` from an older release is recorded as `myfeature`, and that is what `list` shows and what `delete` takes. `delete` and `info` now read the database name from the metadata row instead of re-deriving it, so those older branches drop the database they actually own — re-deriving would have aimed at `rb_my-feature`, which is either nothing or somebody else's database.

### Security

- **`realtime.requireAuth: true` opened the socket instead of closing it.** The connection handler seeds every session with `authenticated: !requireAuth`, so a `requireAuth` that resolves false does not skip a later check — it marks each connecting client as *already authenticated*. Both sockets computed it as

  ```ts
  authConfig.requireAuth !== false && !!authConfig.jwtSecret
  ```

  which ANDs the one setting whose entire purpose is to demand authentication together with the presence of a **local** secret. On a server that authenticates through an `AuthAdapter` — or through anything other than `auth.jwtSecret` — that expression is false, so asking for authentication was what granted it, silently, to everyone who connected.

- **The socket answered the opposite of the HTTP routes.** One product decision — "does this server require an authenticated caller?" — with two enforcement points that each computed it. `init.ts` had `resolveRequireAuth`: no auth configured means auth is required, an `AuthAdapter` always means required, and only an explicit `requireAuth: false` opens it. The socket carried its own copy, and the two disagreed on the case that matters most: with no auth configuration at all, `/api/data` answered 401 to every read while the socket admitted everyone and served the same rows. Not a weaker gate on the socket — the opposite answer.

  The socket's expression is gone rather than corrected; both enforcement points call `resolveRequireAuth`, and the tests pin that they agree rather than restating each answer separately.

- **`policy.authenticated()` admitted anonymous visitors.** There were two sentinels for "nobody is signed in". The types, the policy compiler, the JavaScript evaluator and the anonymous-grant linter were all built on `ANONYMOUS_USER_ID` (`'anonymous'`); the request path scoped unauthenticated callers as `'anon'`. So `policy.authenticated()` — the sanctioned, documented way to write "signed in", the thing the linter *tells you to use* — compiled to `auth.uid() <> 'anonymous'` and was true for every signed-out caller.

  The linter had it exactly backwards, too: it flagged `auth.uid() <> 'anon'` as a Supabase habit comparing against "a string no caller ever has", when `'anon'` was the only spelling that worked.

  This is worse than a default that fails open, because it inverts a rule the author wrote deliberately. A policy that reads as a lockdown was a full grant, and nothing about it looked wrong at any layer — in one deployment it left `INSERT` on companies, company memberships and jobs open to anonymous callers, and a membership row is a privilege boundary: every anonymous visitor shares one uid, so a single claim is a membership held by the internet.

  The request path now reports `ANONYMOUS_USER_ID` everywhere it scopes a caller — the JWT and adapter middlewares, the websocket handshake, the realtime service, and the rate limiter's "is this a real user" check. New: `ANONYMOUS_USER_IDS` (every spelling, newest first) and `isAnonymousUid()`.

  **Existing databases are fixed by upgrading the server**, without regenerating a single policy: a stored `auth.uid() <> 'anonymous'` starts excluding anonymous callers the moment they report that id. `policy.authenticated()` now compiles to `NOT IN ('anonymous', 'anon')` rather than a single literal, because a policy is written into the database and outlives the server that generated it — one spelling is a hole in whichever direction the versions happen to skew.

  **What breaks:** a policy that *grants* to anonymous callers by comparing `auth.uid() = 'anon'` stops matching. That fails closed, and `policy.not(policy.authenticated())` is the supported way to say it.

- **`auth.requireAuth: false` no longer un-gates cron, logs, backups and the schema editor.** That flag answers a question about the data plane — must a caller present a token to read `/api/data`, or does RLS alone decide? — and `false` is the answer the server itself recommends at boot to anyone serving a public website from their own backend. It was also, silently, the switch that decided whether the admin surfaces were gated at all.

  So the documented configuration for a public job board or marketing site mounted `POST /api/cron/:id/trigger`, `GET /api/logs` and `/api/admin/backups` for anyone who could reach the service. A single `warn` per surface at boot was the only notice, and on a `--allow-unauthenticated` Cloud Run deployment "anyone who can reach the service" means the internet. Anyone whose cron jobs spend a metered third-party quota was paying for that.

  Admin surfaces are now gated whenever there is authentication to gate them with — an `AuthAdapter`, or a `jwtSecret` — independent of `requireAuth`. Whether anonymous callers may read your posts has no bearing on whether they may run your cron jobs.

  **If you deploy with `requireAuth: false`**, calls to these routes that previously succeeded unauthenticated now answer 401. They accept what every other admin surface accepts: an admin JWT, the service key, or an `rk_` API key created with `admin: true` — the API-key pre-auth runs ahead of the JWT check, so a scheduler holding an admin key keeps working. Point Cloud Scheduler (or whatever triggers your jobs) at an admin key before upgrading.

  One thing comes *back*: `/api/meta/contract` is served again on these deployments. It is only mounted when it can be gated, so a public-data-plane project had been 404ing it, and with it typed client generation from another repository.

- **A backend with no authentication at all now refuses its admin surfaces instead of serving them open.** With no `AuthAdapter` and no `auth.jwtSecret` there is no credential this server could check a caller against, so it cannot tell an admin from the internet. It used to mount cron, logs, backups and the schema editor anyway, ungated, with one `warn` per surface at boot as the entire defence.

  They now answer **501 `ADMIN_SURFACE_UNAVAILABLE`**, with a message naming the missing switch. They stay mounted rather than disappearing on purpose: an unexplained 404 on `/api/cron` reads as a broken path or a failed deploy and gets debugged as one. A token does not change the answer — there is nothing to verify it against.

  This is unlikely to touch you: every scaffolded backend and the bundle runtime configure `auth.jwtSecret` (the runtime *requires* it, and auto-generates one in development), so the affected shape is a hand-rolled entrypoint that passes no `auth` — or one whose `JWT_SECRET` quietly failed to reach the container, which is precisely the deployment that should not be serving a cron trigger to anonymous callers.

  The data plane is unaffected and still answers 401 there: "show me a token" is a truthful thing to say about `/api/data`, and a dishonest one about a surface no token can open.

- **Every `overrides:` entry is a bounded security floor now.** An override replaces each transitive consumer's own range, so a bare `>=X` is not a floor — it is a floating pin that drags in the next major to publish, whatever asked for what.

  One of them had inverted completely: `js-yaml: ">=4.2.0 <5"` pinned the tree *at* 4.2.0, which is precisely the version GHSA-52cp-r559-cp3m says to leave (patched in 4.3.0). The pin meant to protect was the thing holding the exposure. `uuid` had meanwhile floated from its 11.x floor to 14 unnoticed.

  Closes 12 further advisories across `brace-expansion` (three live majors, so its floors are keyed per-major rather than forcing one on every consumer), `js-yaml`, `react-router`, `shell-quote` and `protobufjs`. Re-resolving moved no package version, so the bounds themselves are hardening only.

- **`@hono/node-server` in the scaffolded backend goes from `^1.19.12` to `^2.0.12`**, closing GHSA-frvp-7c67-39w9 (a `serve-static` path traversal on Windows via an encoded backslash). The 1.x line has no patch, and `@rebasepro/server` already peered `^2.0.12` — a new project was being handed an adapter two majors behind the server consuming it.

### Fixed

- **`customProps` in the collection editor was marked deprecated by accident.** It carried a `@deprecated Superseded by span` tag that belonged to `widthPercentage` and slid onto the next field along when that one was deleted. `customProps` is live — it is how a custom `Field` or `Preview` receives its props, and `PropertyFieldBinding` reads it on every render. Nothing about the behaviour changed; the tag is gone, so editors stop striking through a supported field and suggesting a replacement that does something else entirely.

- **The eject warning was suppressed exactly where it mattered.** The warning above the refusal — the one that exists because ejecting "is not something to discover from a runtime version going blank" — was printed behind `!isJsonMode()`. JSON mode latches on whenever stdout is not a TTY, so piping the command, or running it from CI or a coding agent, deleted the warning outright, and the deploy's JSON payload carried no equivalent field. The one case with nobody watching the terminal was the one case that said nothing.

  Warnings now go to stderr in every output mode — stderr is not the JSON stream, so it cannot corrupt a parser — and only their *formatting* depends on the mode. Whether a warning is emitted at all no longer does. The deploy payload gains `warnings: [{code, message, hint}]` and a denormalised `ejectsManagedRuntime` boolean for CI to test directly; both fields are always present, so `false` never has to be told from absent.

- **`deploy` printed human progress to stdout in JSON mode**, ahead of the result object, breaking any parser reading it — the `🚀 Triggering deployment…` banner on both the source and managed-bundle paths, the source upload's size line, and on the bundle path the entire build transcript (`Building bundle…`, the compiler's own log lines, frontend folding, `Uploading bundle…`). Progress goes through one `progress()` helper now, which drops it in JSON mode. The rule it settles: progress is not a result and disappears when stdout belongs to the JSON; a *warning* is not a result either, but goes to stderr and never disappears.

- **A project that had never deployed reported `custom · your own image`.** `projects.runtime_mode` is a record of what the last deploy made a project, and it carried `DEFAULT 'custom'` from the migration that added it — which was a true statement about the projects that existed *then*, and applied to every row created ever after. So a project created seconds ago, which had never built anything, named a container image nobody had built. Most visibly right after the console's create wizard, whose runtime step defaults to Managed and says outright that the choice is intent and writes no mode.

  It also blunted the one signal that catches an accidental eject: `custom` was equally the resting value of a project nothing had happened to, so it could not distinguish "a source build moved you off managed" from "nothing has happened here yet."

  The column stops defaulting (control plane migration `0040_runtime_mode_undecided`), making NULL the honest third state, and `rebase cloud status` and the console's overview, infrastructure and apps headers all read it as "not deployed yet" rather than inventing an image. Every non-display reader already coerced absent to `custom` before use, so nothing else changes. Existing rows are deliberately **not** backfilled — a row saying `custom` today may be a project that really did ship source, and there is no way to tell those apart from the ones the default flattened.

- **Several concurrent realtime subscriptions hung on a cold page load.** A view that opens more than one at once — a Kanban board opens one per column — reported `Subscription timed out` for all but one of them, thirty seconds in. The socket was healthy: probed directly, six concurrent `subscribe_collection` frames all answered inside 15ms. The frames were never sent.

  `ensureAuthenticated` published its in-flight guard only *after* awaiting the token getter, so every caller arriving in that gap started an attempt of its own — and the message queue flushing on connect delivers exactly that. Each attempt then registered under ``auth_${Date.now()}``, the one request id with no random suffix, so attempts in the same millisecond collided in a `Map` and only the last survived. One promise settled; the frames waiting behind the others never reached the socket. Client-side navigation skips the path (`isAuthenticated` is already true), which is why the same view worked on every visit after the first.

- **Kanban drag-and-drop put cards in the wrong place, and did not persist a column change at all.** `handleDragOver` moves the card between columns while the pointer is still down, so looking it up by id at drop time finds it in its *destination* — the board reported every cross-column drop as a same-column reorder and never wrote the column property. Separately, the drop handler passed every card in every column to `onItemsReorder`, whose consumer reads it as the target column and takes the moved card's neighbours from it to compute a sort key.

  Also: releasing over a column rather than a card no longer forces an append (which sent a card dropped mid-column to the bottom), dropping onto an empty column no longer aborts the save, and collision detection is `closestCorners` — the default only reports a target while the dragged rect overlaps one, so a card held over a gap reported nothing.

- **Board sort keys are `fractional-indexing` keys the database can sort.** The library's default base62 output only orders correctly under byte comparison, and the sort is done by Postgres, whose default collation is not byte comparison: under `en_US.UTF-8`, `"aa"` sorts before `"aC"`. A board dragged around enough to reach the upper-case digits stopped agreeing with its own keys. Keys are base36 and single case now. Existing keys no longer validate, which is what surfaces the board's **Initialize** bar — and that bar works now: it only ever looked for a *null* order value, so a column full of unusable-but-present values offered a button that updated nothing and never went away.

- **Kanban columns could not be scrolled.** A `flex-1` item defaults to `min-height: auto`, so the view holding the board grew to the board's full content height — 1230px inside an 883px area — and the ancestor's `overflow-hidden` cut off the rest. Each column had a working scroller that never reached its limit.

- **A failed column subscription rendered as an empty column.** Entities cleared, no error surfaced, "No items" under a header still counting eleven of them. It falls back to a one-shot read, reports a failure only if that fails too, and no longer waits out the client's full 30-second watchdog before painting anything.

- **Date previews required a `Date` instance**, so every audit column in every revision-history entry rendered as a red "Unexpected value" box. History is raw API payload, where a timestamp is still the string Postgres sent. Any value that unambiguously names a date is accepted now.

- **Chips lost three quarters of their palette.** A cleanup flattened `CHIP_COLORS` from four tones per hue to one, which left every `colorScheme="blueDark"` resolving to `undefined` — a chip with a colour in its config rendering with no colour at all — and made seeded chips pick from ten schemes, so a five-value enum routinely drew the same background three times. The tones are generated from a per-hue table now, and `ChipColorKey` is a real union rather than `keyof Record<string, …>`, which is why none of it was a type error.

- **The Firebase example compiles again.** It had not built since the property-options split, which made `url` a statement about the data — it feeds `format: "uri"` into the OpenAPI contract — and moved presentation to `admin.urlPreview`. The example's `admin: { url: "image" }` had both halves in the wrong place, and `expanded` likewise belongs in the `admin` block.

### Added

- **`User` is exported from `@rebasepro/client` and `@rebasepro/app`.** The removals above tell a caller to import `User` from `@rebasepro/types`, which was not an instruction a browser app could follow: it installs the client (or app) package alone, and `@rebasepro/types` is *that package's* dependency, not a specifier resolvable from its own project. So the deprecated aliases were removable in a monorepo and stranding anywhere else. `User` now sits beside `RebaseSession`, `AuthTokens` and `DeviceSession`, which were already re-exported for exactly this reason.

- **The entity form has a layout.** It had exactly one — a single centred column of full-width cards in declaration order — and one escape hatch, `formView.Builder`, which replaces the whole form. Nothing in between.

  There is now a four-column grid, titled sections that collapse, and a metadata rail for the fields that describe a record rather than constitute it. All of it is derived by default: a collection that configures nothing gets a two-column form, its id and audit timestamps in the rail, long text and arrays full width, short enums and booleans narrow. `admin.form` is for when the derived answer is wrong. See [Form Layout](/docs/frontend/form-layout).

  On the demo's products form this is 2932px of scroll down to 1587px, and 219px of dead space above the first field down to 24px.

- **The record's identity and its actions live in persistent chrome.** The title, the id and the Save/Discard buttons used to sit *inside* the scrolling form, so the moment you touched the wheel nothing on screen said which record you were editing. They are in a bar above it now, which is also what let the 320px footer holding two buttons go away entirely.

- **JSON and revision history moved out of the tab strip and into a record inspector.** They were the first two tabs — icon-only, unlabelled, ahead of the record you opened the page to edit. They are developer tools, so they sit behind the overflow (`⋮`) menu and open in a panel beside the form; the tab strip is for destinations. Old `#json` / `#history` URLs open the inspector on the pane they name.

- **Two gates for things that were rotting silently.** `pnpm check:examples` typechecks `examples/*`, which were in no pipeline and no root script — `pnpm build` covers `./packages/*` and `./app` only — which is why the Firebase example above stayed broken for weeks. They resolve `@rebasepro/*` to built output the way an installing user does, rather than to source the way `pnpm typecheck` does, so they catch a class of drift the source-resolving gate structurally cannot see.

  `pnpm check:generated` regenerates the committed website artifacts (`llms.txt`, `sitemap.md`, the changelog mirror) and fails on a diff. `llms.txt` had been sitting a commit behind the docs it summarises.

## [0.12.0] - 2026-07-29

### Breaking

- **`rebase.json` is rebuilt around one authored runtime** — the manifest had four unrelated fields named `mode`, an app type (`admin`) with no mechanism behind it, and a managed-vs-custom distinction nobody had written down.

  A backend now declares `runtime: "managed" | "custom"` — who owns the process, independent of where it runs. It used to be *inferred* from the presence of `backend/src/index.ts`, which every scaffolded project had, so every project predating the manifest silently landed on the custom runtime. App types reduce to `backend` and `static`: the admin is an ordinary static app, because `RebaseCMS` takes its collections as a build-time prop, so a platform-hosted admin was precluded by the component's interface rather than merely unimplemented. Top-level `runtime` becomes `rebase`, so the word means exactly one thing. In the bundle manifest, `mode` becomes `kind: "backend" | "static"`, `entry.static` becomes a list, and `entry.admin` is gone — format-1 bundles still boot, and the format is 2.

  `backend.mode` (`cms`/`baas`) is deleted outright. Where collections come from was never an independent choice: it is whether `<config>/collections` exists.

  Static apps declare a `path` and several are served from one process — the API at `/api`, a site at `/`, the admin at `/admin`, one container. Three ways that could fail silently are now caught: an app built with Vite's default `base: "/"` but served at `/admin` (blank page, every asset 404, no server error) fails `rebase build`; `serveSPA` orders longest-path-first *and* excludes siblings, so a miss under `/admin` can no longer be answered with the site's index.html; and folding appends to `entry.static` rather than overwriting it, which used to let a second app silently replace the first in a bundle that still looked complete.

- **`mode: "cms" | "baas"` is gone from the server as well** — removing `backend.mode` from the manifest left the identical pair standing one layer down: `RebaseBackendConfig.mode`, authored by anyone who ejects and passed to every driver, plus a wire field, a dev env var and an init flag.

  It was never independent of the collections. The Postgres bootstrapper already guarded `mode === "baas" && collections.length === 0`, so the flag could only agree with them or contradict them — and when it contradicted, the server warned and threw the declared collections away. Everything derives from one question now: did any collections resolve?

  - `RebaseBackendConfig.mode` — deleted, and derived *after* the collections directory is loaded, so a `collectionsDir` pointing at nothing falls through to introspection instead of serving an empty API and never looking at the database.
  - `DriverInitConfig.mode` → `introspectCollections`. A driver may contribute collections only when it was asked to describe the schema, so it can no longer inject whatever the database happens to contain into a project that declared its own.
  - `RebaseProjectContract.mode` — removed from `/api/meta/contract` and `/api/meta/schema-version`. Nothing in the CLI, codegen, client or console ever read it.
  - `REBASE_DEV_MODE` — deleted.
  - `rebase init --flavor cms|baas` → `--headless`.

  One behaviour change: declaring collections alongside what used to be `mode: "baas"` now **serves** them instead of discarding them.

- **The CMS-named exports are called what they are** — `useCMSContext`/`CMSContext` → `useAdminContext`/`AdminContext`, `registerCMS`/`unregisterCMS` → `registerAdmin`/`unregisterAdmin`, `CMSBasePropertyNoName` → `AdminBasePropertyNoName`, `CMSNavigationContent` → `AdminNavigationContent`. Smaller than it looks: outside `packages/cms` and `admin-types` these had no consumers.

  Seven locale files did say "CMS" in user-visible strings — "CMS Users", "CMS View" and translated sentences in es/pt/de/fr/it/hi — and the two keys carrying it in the public `RebaseTranslations` type are renamed with them. One collision worth knowing about: `studio_sql_admin` already existed as a different string, so `studio_sql_cms` became `studio_sql_collections_label` rather than being merged onto it.

  `packages/firebase` is deliberately untouched: `FireCMS`, `firestoreToCMSModel` and the optional `DataDriver.delegateToCMSModel` are heritage from a different product, and renaming an optional method on a public driver contract breaks a third-party driver *silently* — an unimplemented optional method is simply never called. That waits for a driver-contract major.

- **A scaffolded project self-hosts the same artifact Rebase Cloud runs** — the template declared `runtime: "managed"` and shipped a compose file that built two custom images, one of which ended in `CMD ["pnpm","start"]` — running the entrypoint the managed runtime never loads, and which is no longer scaffolded. `docker compose up` on a fresh `rebase init` was not merely inconsistent with the project's own manifest; it was broken, building an image around a file that did not exist.

  The scaffolded compose now runs the managed shape — Postgres, plus `rebasepro/server` with `./dist-bundle` mounted — so one container serves the API at `/api` and the admin at `/`, same origin, no CORS between them and no nginx. The frontend image and its `nginx.conf` are gone for the same reason the backend one is: the runtime serves those assets.

  Image-building moves into `rebase eject`, which writes the Dockerfile and a `docker-compose.custom.yml` together and does **not** touch the scaffolded compose — so going back stays a one-line change in `rebase.json` rather than a restore from git.

- **Nine presentation options move into a property's `admin` block** — `fixedFilter`, `includeId` and `includeEntityLink` on a reference or a relation; `widget` on a relation; `sortable` and `canAddElements` on an array; `previewProperties` on a map. The collection half of that split shipped in 0.11 and moved all 38 keys; the property half moved most of its options and left these behind, under a section marker in `properties.ts` that read `─── UI configuration ───`. A backend-only install went on shipping them with nothing to render them.

  ```diff
    tags: {
        name: "Tags",
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection },
  -     widget: "dialog",
  -     includeId: false,
  +     admin: { widget: "dialog", includeId: false },
    }
  ```

  Writing one at the top level is now a config error naming the fix, the same way the 0.11 collection keys are — `validate-config` reads them off `ADMIN_PROPERTY_KEYS`, so nothing is silently ignored.

  `widget` is the one to check first, because it was never working: `AdminRelationOptions` already declared it and the admin only ever read *that* one, so every top-level `widget: "dialog"` had been quietly rendering a `select`. Moving it into `admin` is what makes an existing declaration take effect.

  Two options that look like the same case stayed on the property, and deliberately: `propertiesOrder`, because `sortProperties` in `@rebasepro/common` reads it recursively and a driver calls that — a core package cannot see the `admin` block at all; and `keyValue`, because it says the map has no declared shape, which is what the OpenAPI generator emits `additionalProperties` from.

- **The SQL-only fields are rejected on a document-store collection** — `table`, `relations` and `disableDefaultPolicies` are declared on `PostgresCollectionConfig` alone, and `columnType`/`columnName` are omitted from the Firestore and MongoDB property maps. A MongoDB collection could be written with a table name and a `columnType: "bigserial"`, and nothing anywhere read either.

  `DataSourceCapabilities` had been reporting this all along — `supportsRelations` and `supportsColumnTypes` are both `false` for the document engines — and the engine-specific collection and property types existed too. The two were never joined, so call sites checked the capability at runtime and then read a field the base type had to declare for them. That is why the fields were on the base.

  Engine-agnostic code narrows with the new `isRelationalCollectionConfig`, which *is* that capability check with the narrowing attached, so a custom SQL engine registered through `registerDataSourceCapabilities` is included rather than excluded by a hardcoded `"postgres"`.

  `securityRules` is **not** part of this and stays driver-agnostic. It is a contract about who may read and write which rows, and each engine keeps it its own way: Postgres compiles it to `CREATE POLICY`, MongoDB translates it into a filter AND-ed into every read and write. `supportsRLS` answers whether an engine *generates policies*, which is a different question from whether it honours a rule.

### Added

- **`rebase cloud deploy` needs no flag on a managed project** — a bare deploy used to be refused with "redeploy it with `rebase cloud deploy --bundle`". The refusal existed because forgetting the flag meant the command built a container image and ejected the project — a plausible mistake with an expensive outcome. Now that the backend *declares* `runtime: "managed"`, the flag is redundant and the bare command builds and ships a bundle. `--source` and `--bundle-dir` are explicit acts and still win, and the refusal stays for the case it was written for: a manifest that says `custom` deploying over a project the platform runs.

- **`rebase cloud status` says which runtime and which framework a project is running** — it reported no runtime information at all, so "what is actually serving this project" had to be assembled by hand from a Docker tag, a manifest and a pod. Three numbers are in play and two of them look interchangeable: the runtime version is the contract line a bundle's range resolves against, the framework version is the `@rebasepro` release the runtime image ships, and a project can legitimately run runtime 1.2.0 — whose image was built against framework 0.10.0 — while its own bundle installs 0.11.0 at boot.

- **The login screens can offer a newsletter opt-in** — `LoginView` takes an `onNewsletterOptIn` prop and renders a checkbox on the sign-in, register and bootstrap forms, translated in all seven locales. It fires only once the credentials are accepted: a ticked box on a *failed* attempt must not subscribe an address whose owner never proved they control it. The state lives in `LoginView` rather than the form, so switching between login and register does not drop the tick. Entirely opt-in — a panel that passes no handler renders no checkbox.

- **A drawer group can carry the icon, and its entries indent beneath it** — a long navigation rendered as one flat column: every entry had an icon of its own, and the group headers organising them sat at 11px in `surface-400`, *below* the contrast of the rows they label. The thing you scan to find anything else was the quietest element on screen, and thirty entries gave no visual sign of which belonged together.

  `NavigationGroupMapping` takes an `icon` now — a Lucide name, like every other icon in a collection. Declaring one moves the anchor from the rows to the group: the header takes the icon, and the entries below trade theirs for an indent of the same width, so labels stay on the original grid and the rail does not change size. The label steps up to 12px `surface-600` to match, since it is now what carries the hierarchy.

  Strictly opt-in, and per group. A group that names no icon renders exactly as it did — same classes, entries keep their icons — so an existing panel sees no change until it asks for one. Two cases stay flat regardless of configuration: a group with no header has nothing to indent under, and a drawer collapsed to a rail keeps its entry icons, because there they are the only thing left to click.

- **`defaultDrawerOpen` — open the navigation expanded** — the drawer started collapsed to a rail with no way to change it. `autoOpenDrawer` looks like the prop for this and is not: it expands on *hover*, and always has, though `RebaseLayout` documented it as "auto-open the drawer on load" while `Scaffold` documented the same prop as "open the drawer on hover". Both docs now say the same true thing.

  The new prop seeds the initial state and nothing more — no effect syncs it afterwards, so a user who collapses the drawer is not re-expanded underneath them on the next render. Ignored on small layouts, where an expanded drawer covers the content it exists to navigate.

- **The shell takes a `logo`** — `Scaffold` accepted one and rendered it in the drawer and top bar, but nothing passed it down, so the prop was unreachable from `RebaseShell` — the component a scaffolded app actually mounts. Threaded through `RebaseShell` → `RebaseLayout` → `Scaffold`.

- **An entity action's icon can be a Lucide name** — `EntityAction.icon` was `React.ReactElement`, alone among a collection's icons; `admin.icon` and `entityViews[].icon` were strings already. An element cannot be written in the `config` package at all: it is plain `.ts`, and a backend loads it for its schema, so importing the UI layer just to name an icon drags React into the server's module graph. Both forms are accepted now and resolved through `getIcon` at every render site.

- **A collection's `entityActions` may name an app-level action by key** — `resolveEntityAction` has always accepted `string | EntityAction`, the collection editor stores exactly these keys, and the sibling field `entityViews` is typed `(string | EntityCustomView)[]`. Only this field's type disagreed, so the documented approach — register the action on `<RebaseCMS entityActions={…}>`, then name it from the collection — required a cast to write.

  It matters most where the action *cannot* be imported. An action carries an `onClick` and usually opens a dialog, so a collection file that imports one pulls the admin bundle into any backend that loads it; naming it costs nothing there.

- **A full-screen entity has a way back to its collection** — every other layout can be dismissed: a side panel and a dialog close, a split keeps the list beside it. Full screen replaces the collection outright, leaving browser Back as the only route out — which the page never shows as an affordance, and which is wrong anyway once the reader has moved between tabs inside the entity.

- **A project declares its storage buckets in `rebase.json`** — storage had one destination and three ways in, and which buckets a project has was declared in compiled config code, so nothing outside the running container could learn it. The console could only ever configure the default bucket, and a named source was reachable only by hand-writing `S3_BUCKET__MEDIA` — and only on the managed runtime, because the ejected template parsed `STORAGE_TYPE` itself and knew nothing about suffixes.

  Topology moves to `rebase.json`, the one artifact a host can read *before* running a build. The CLI resolves it into the bundle manifest for managed runtimes; a custom runtime reads the same file out of the image it already ships. Both end at the same list, so the console and the tenant cannot describe different topologies. A declared bucket is a topology rather than a boot requirement — declaring one does not fail the boot if its credentials are not present yet.

- **`iterate()` and `findAll()`, so nobody hand-rolls the paging loop** — `find()` with manual `limit`/`offset` was the whole pagination API, so every consumer wrote the same loop and wrote it wrong in the same two ways: terminating on `rows.length >= limit`, which mistakes an exactly-full final page for a middle one and drops everything after it, and capping `findAll`-style helpers by silently truncating.

  `iterate()` is an async generator that fetches a page at a time and yields rows as they are consumed. `findAll()` is the same walk collected under a ceiling that **throws** when hit, because a short array that reads like a complete one is the bug this exists to prevent. Termination comes from `meta.hasMore` alone. Offset paging is the default and drifts under concurrent writes — `cursor: "id"` switches to keyset seeking, built out of parameters `find()` already takes, so it needs nothing new from the server and works on every transport.

- **Filters on a relation, for every kind the driver can compile** — `isFilterableRelation` allowed only `belongsTo`, the one kind with a column on this row. The driver compiles `manyToMany`, `hasMany` and `hasOne` into a correlated `EXISTS` now, so the affordance returns for them; `via` stays out, its join path having no stated inverse. A to-many relation also answers `array-contains` and `array-contains-any` — a to-many *is* the list, so "contains X" is `==` and "contains any of" is `in`, the same `EXISTS` under a different name. Before, the admin rendered those controls and the driver returned a 400 behind them.

- **`supportsVectors` on a data source's capabilities** — `VectorProperty` carries a `dimensions` and is pgvector-shaped, and it was the one driver-specific property kind with no flag to gate it, so unlike every other field in that descriptor there was not even a runtime answer to appeal to: a Firestore collection could declare an embedding and no driver would do anything with it. Postgres claims it; the document stores do not, and `vector` is now excluded from their property maps alongside `relation`.

- **Every collection config is strict-parsed at boot** — nothing checked these files. A config written against an older version loaded clean and whichever keys had moved were ignored: no warning, no log line, no failed boot. The collection still served rows, so the only signal was the feature quietly not being there — an icon that never appeared, a `readOnly` field the panel let you edit, a relation that answered `[]`. The renames were never the problem; a rename with no runtime signal is.

  `assertCollectionConfigs` runs at the loader — the one definition of "the collections" — so the runtime, the drizzle generator, the policy generator and the doctor reach the same verdict. It is also what turns the property-block move above into an error naming the fix rather than a silently ignored key.

- **The cron scheduler warns when in-process timers cannot fire** — jobs are driven with `setTimeout`, and on a platform that freezes or evicts the instance between requests (Cloud Run at `--min-instances=0`, Lambda, Vercel) those timers never fire. The failure was completely silent: the server booted, logged the jobs as registered, and ran nothing. Detected from documented runtime env vars and warned once at scheduler start. Kubernetes pods are excluded, so a GKE Deployment never warns. Nothing here can fail a boot.

### Fixed

- **The API docs disappeared from every project the runtime boots** — `REBASE_ENABLE_SWAGGER` defaulted to a flat `"false"`, which reads as a safe default and was not one: the runtime is how every scaffolded project boots, so `/api/docs` and `/api/swagger` 404'd for projects that never asked for that. `rebase init` prints "docs are at /api/swagger" on completion, the headless README repeats it, and the console's API Explorer fetches `/api/docs` — all three were broken against a project running the runtime.

  The variable is tri-state now and resolved against `NODE_ENV`: unset means on in development and off in production, and an explicit `true` or `false` wins in both. Unset in development resolves to *undefined* rather than `true`, which hands the decision to the server's own policy — the one that already knows to serve the spec while withholding the Swagger UI. Two defaults that can disagree about the same route is the bug this replaces, so there is only one now.

- **A backend with `allowRegistration: false` was a dead end on a fresh database** — `GET /auth/config` reported `registrationEnabled` while `needsSetup`, the login UI showed the first-admin form on the strength of that, and `POST /auth/register` then refused it. `POST /admin/bootstrap` could not break the tie either, since it requires an authenticated caller and an empty database cannot produce one. Hit live on a deployed project.

  The register gate now admits the first registration when the user table is empty — a paginated count, not an unbounded list, since this path serves anonymous callers — and the existing auto-promote makes that user an admin. One user in and the flag binds again; a racer that slips past the empty check is deleted and refused, so the window can never mint a second account. `disableSelfRegistration` stays a hard kill switch above even bootstrap, and `/auth/config` stops advertising registration when it is set instead of pointing the UI at a form that can only 403.

- **`@rebasepro/server` loaded twice in one process left every custom function without a singleton** — under the managed runtime this is the normal layout, not an edge case: the image ships the framework at `/app/node_modules`, while a bundle installs its own dependencies into `/bundle/node_modules`, where `@rebasepro/server` arrives transitively. Every custom function imports `defineFunction` from `@rebasepro/server`, so functions held the bundle's copy while `initializeRebaseBackend()` initialized the image's. With the instance in a module-local variable, `rebase.data`, `rebase.dataAsAdmin` and `rebase.storage` threw "server not initialized yet" on every request to every custom function — in a process that booted cleanly, served `/api/data/*` fine and reported itself healthy. Observed in production as 100% of one tenant's document routes 500ing while the rest of the app worked.

- **The documented `where` query parameter was never read** — the OpenAPI document publishes `where` on every `GET /api/data/{slug}` and the relations docs use it to narrow a subcollection list, but `parseQueryOptions` never looked at it. It was also missing from `reservedQueryKeys`, so it fell through to the per-field `?field=op.value` loop and compiled as a filter on a column literally named "where", which no table has — meaning the documented way to filter a list returned the entire table, bounded only by whatever RLS allowed, until unresolvable fields started failing closed and it became a hard 400 instead. It is parsed as JSON and normalized through the same `deserializeFilter` the querystring dialect uses, so `{"status":["==","active"]}`, `{"status":"eq.active"}` and `{"status":"active"}` compile to one condition — and unlike the querystring, JSON carries types, so `[">=", 18]` stays a number.

- **`serveSPA` 404'd routes that merely shared a prefix** — exclusion was a `startsWith`, so `/api` excluded `/apidocs` and `/admin` excluded `/administrators`. Both are ordinary client-side routes of an app rooted at `/`, and both 404'd: the SPA fallback declined them and nothing else claimed the path. `apiBasePath` is always in the exclusion list, so this was never limited to the multi-app setups the list was added for — a single SPA with a route under `/api<something>` hit it too. Matching is by path segment now.

- **A deliberate 400 was reported as a database failure** — `sanitizeErrorForClient` only knew how to unwrap Postgres errors, so a thrown `ApiError` lost its message, its code and its status on the way to the client and took a `logger.error` line with it. That is the whole diagnosis for a realtime subscription: the admin list prefers `accessor.listen`, so an unknown filter field arrived as an opaque failure and every notify-triggered refetch logged at error as if the database had gone down. A 4xx short-circuits ahead of the Postgres extraction now and passes its message and code through untouched, logging at debug or warn per the error's `expected` flag. 5xx is unchanged: still a generic message, still logged at error, so internals stay server-side.

- **`rebase schema generate` emitted a schema that does not compile** — `rel.localKey` is a *column* name and the generated Drizzle object is keyed by *property*. They coincide until a property is camelCase — `userId` stored in `user_id` — and then the emitted relation references a key that is not there: `Property 'user_id' does not exist on type … Did you mean 'userId'?`. Three of the four relation-emission sites already normalised through `resolvePropertyKeyForColumn`; the `belongsTo` branch did not. It hid because the existing test's collection declares no property matching the FK column, so the resolver fell through and returned the column unchanged — identical output either way.

- **The runtime image did not ship the S3 and SMTP drivers it loads** — the runtime implements S3 object storage and SMTP email and pulls their drivers in with `await import(...)`, but the image never installed them, and the import resolves relative to the runtime's own location: a project declaring `@aws-sdk/client-s3` in its bundle does not satisfy it, because that copy lands off the resolution path. The failure is nasty precisely because it is so narrow — the tenant boots clean, passes every health probe, serves every other route, and fails only on storage *writes*.

- **The runtime deduped every `@rebasepro` package, not just the one that needs it** — the first cut of the singleton fix redirected every `@rebasepro` package the image ships, which took tenants down: the image installs only the narrow dependency set the runtime itself needs, while a bundle's own install resolves each package's full tree, so redirecting `@rebasepro/server-postgres` pointed the database driver at a copy with no `chokidar` and the pod crash-looped. `@rebasepro/server` is the only package that both needs the redirect and is provably safe to redirect.

- **Two published packages imported dependencies they never declared** — `@rebasepro/firebase` declares `firebase` as a peer dependency, but every source file imported the *scoped subpackages* — `@firebase/app`, `@firebase/auth`, `@firebase/firestore` and four more — which appeared only in devDependencies. Rollup externalises every bare specifier, so those imports survived into the published `dist` verbatim. They resolve by accident under npm and yarn, whose hoisting puts them at the top level, and fail under pnpm's isolated layout — so the package type-checked, built and tested green, then broke on first import for an installing user. `@rebasepro/inference` shipped the same way with two packages.

- **A scaffolded project could not run `rebase build`** — `backend/tsconfig.json` and `config/tsconfig.json` left `types` unset, so TypeScript swept every reachable `node_modules/@types` and treated each folder as an implicit type library. Under pnpm that reaches the virtual store, where packages hoisted for peer resolution live — `dompurify` among them, pulled in transitively by the admin editor — and every scaffolded project failed with `TS2688: Cannot find type definition file for 'dompurify'`.

- **A custom runtime was built a bundle it never deploys** — `rebase build` had no `runtime` check, so an ejected project — whose artifact is an image built from its own Dockerfile and entrypoint — still got a `dist-bundle/` produced for it. That is worse than doing nothing, because the bundle looks like the thing that ships. A custom backend is skipped now, naming the two commands that actually build it; static apps in the same repo still build, since an ejected entrypoint serves them itself via `serveSPA`.

- **The headless scaffold's backend had nothing to compile** — moving `storage.ts` into the config package left `backend/src/` empty in the headless flavour: it declares no collections, so there is no generated schema, and the entrypoint moved behind `rebase eject`. The tsconfig still said `include: ["src/**/*"]`, and tsc reports an include matching nothing as `TS18003` — an error, not a no-op — so the backend workspace failed to build on every headless scaffold.

- **The client SDK could not create an admin API key** — `admin: true` is what grants a key the `admin` role: the admin-gated routes, and the RLS `default_admin` policies. `@rebasepro/client` declared its own `CreateApiKeyRequest` without the field, under a comment saying these types lived in the server package rather than in `@rebasepro/types` — which had stopped being true, and the copy had drifted. Passing `admin: true` was an excess-property error, so the one privileged thing about a key was unreachable. There is one declaration now, in `@rebasepro/types`; the client and the server both re-export it.

- **A history entry's `updated_at` was a `string` from Postgres and a `Date` from MongoDB** — the same interface name in two driver packages, plus a third spelling in the admin's `useHistory` hook, so nothing could read history without first choosing a driver. `EntityHistoryEntry` in `@rebasepro/types` is the wire shape and carries a `string`. MongoDB's `Date` was never the contract, only its storage: the driver keeps that for its own document and converts on the way out.

- **The collection editor dropped fields on save** — it round-trips a collection through a hand-written serializable mirror whose whitelist had fallen behind the core types by six fields. Editing a collection in the panel silently unset whichever of them it had.

  Two mattered. `excludeFromApi` is the server-side guarantee that a column — a password hash, a verification token — never reaches an API response; opening such a collection in the editor and saving published it. And collection-level `relations` had no serializer at all, so importing an existing table detected its foreign keys and junction tables, showed them on the form, and discarded every one on save. The other four were `strictWrites`, `disableDefaultPolicies`, `filterOperators` and `urlPreview`; `url` was being dropped too, and it feeds the generated OpenAPI contract.

- **Importing a table wrote a relation shape the framework no longer accepts** — `pgColumnToProperty` existed in two copies. The one the collection editor called emitted the pre-union flat relation (`cardinality`/`direction`, replaced by the `kind` tagged union) and CRUD verbs where `SecurityOperation` takes SQL ones, typed `any[]` at both sites so neither showed up. The correct copy was the one in `@rebasepro/studio`, which had the tests and was called from nowhere. There is one now, in `@rebasepro/common`.

- **The Studio JS editor autocompleted a query shape the server rejects** — its ambient SDK declarations are hand-mirrored and had drifted: ten Firestore-era filter operators with no `like`/`ilike`/`is-null` family, `where` as `Record<string, string>` where a filter is an `[operator, value]` tuple, and `orderBy` as a bare string rather than a `[field, direction]` pair. A bare string reaches PostgREST and builds a malformed query. The operator union is now interpolated from `ALL_WHERE_FILTER_OPS`, so that part cannot fall behind again.


- **A many-to-many child listing failed on a column that does not exist** — the junction's columns were passed into the `EXISTS` subquery as bare Drizzle columns. A column object carries no table qualifier of its own; it renders against whatever table the surrounding builder believes is current. Inside `db.query.findMany`, which aliases the root table, that produced

  ```sql
  EXISTS (SELECT 1 FROM "body_area_podcast"
          WHERE "podcast"."podcast_id" = "podcast"."id" AND "podcast"."body_area_id" = $1)
  ```

  — the junction's columns wearing the *target's* alias. Postgres aborts the transaction on the unknown column, and the fallback read then fails on `25P02 current transaction is aborted`, three frames away from anything to do with the relation.

  The junction is aliased and referenced by identifier now, exactly as the `joinPath` branch beside it already did; only the correlation stays a column object, because that one has to bind to the outer row. The alias also disambiguates a self-referential many-to-many, where the junction and the target are the same table. The old form rendered *correctly* in isolation and only corrupted inside the query builder, which is why unit tests asserting on result counts never saw it — the new ones assert the emitted SQL.

- **An auth collection that named `reset_password` got two Reset Password buttons** — the injector skips its action when the collection already has one, but it read `.key` off every entry, and an entry may be the key itself. A collection that named the action rather than importing it was therefore never recognised as already having it, and the injection ran on top.

- **An empty `in` list returned every row** — `filter: { id: ["in", teamIds] }` with no teams is how a caller asks for nothing, and it answered with the whole table: an empty list built no condition, and an absent condition is not a restriction. It needs no typo to reach, because an empty array is exactly what a correct program produces when the set it derived came out empty.

  `in []` is FALSE now and `not-in []` is TRUE, which is what excluding nothing means; `array-contains-any []` overlaps nothing. A non-array operand was dropped too, and that one arrives over the wire — `?filter=id.in.5` parses to the string `"5"`, since the REST dialect only builds an array when the value is parenthesised, so an ordinary REST query ran unfiltered. A scalar is now the one-element list it means.

- **An unresolvable filter field widened the read** — a filter key matching no column was logged and dropped. Dropping a condition can only widen a result set, so a typo'd or renamed key ran the query without it and returned everything RLS happened to allow. Inside `or(...)` it was worse: the leaf vanished from the disjunction, so the surviving branches matched on their own and the widening was not bounded by the condition that went missing.

  Both sites resolve through one helper now, which throws a 400 `UNKNOWN_FILTER_FIELD` naming the field, the collection and the table's real columns. `unknownFilterFields: "warn"` on the driver config restores the old drop-and-continue behaviour verbatim.

- **An owning relation's key is its `localKey`, not `<field>_id`** — the filter resolver guessed the column name. The real one is the relation's `localKey`, whose default is snake-cased *and* singularised, so `userProfile` is `user_profile_id` and `users` is `user_id` — and an explicit `localKey` is anything at all. With unresolvable fields now failing closed rather than widening, that guess turned an ordinary `belongsTo` filter into a 400. It resolves through the collection's relations, keeping the two derivable shapes as a last resort.

- **The SDK answered in two different relation shapes** — `data.jobs.find()` and `data.jobs.find({ include: […] })` disagreed. With `include` the accessor ran the REST pipeline, which inlines a relation as the target's own columns; without it, the driver eagerly loaded every relation and put a `{ __type: "relation" }` envelope where the foreign key was. `findById` was always the second. The generated types described only the envelope, so a column the schema calls a foreign key was typed `string` and arrived as an object — twice, in production, before anyone traced it here. Every SDK read goes through the REST pipeline now, which is what the HTTP API already serves for the same query.

- **"Posts with no tags" returned no posts** — the null checkbox was hidden on a to-many relation, and asking which rows have *no* link is the question a filter on a link is most often for. Showing it was not enough: the design is that the operator carries the sense and the checkbox supplies the value, and on a to-many the multi-select can only produce `in`/`not-in`, neither of which carried a null — the relation path read `["in", null]` as membership of an empty list.

- **The filter UI asserted Postgres on every engine's behalf** — `isFilterableRelation` hardcoded the four kinds *the Postgres driver* compiles. Only Postgres declares `supportsRelations` today, so the claim happened to be true, but it was a fact about a driver stated where no driver could see it. It moves to `DataSourceCapabilities` beside `filterOperators`, where the same question is already answered for operators. The field is optional, so a third-party driver registered before it existed still compiles. Two related fixes: the operator now decides how many values a relation filter takes, and a relation with no column to filter on is no longer offered one.

- **A relation declared inline on the property rendered an error instead of a field** — `RelationFieldBinding` demanded a top-level `relations` array before it would render, and the inline form — `relation: { kind, target }` on the property, which is what the docs show — produces no such array. Every collection declaring a relation that way threw and rendered the error boundary where the field should be. The guard was redundant as well as wrong: `resolveRelationProperty` handles all three forms and reports a real error naming the property and the collection when it genuinely cannot resolve.

- **A server-side client with no credential now says so** — a `createRebaseClient` built with no token off-browser is silently anonymous, and RLS answers it with whatever is public: usually nothing, occasionally the wrong thing. Warned once per client on the first request rather than at construction, since `setToken`, `setAuthTokenGetter` and a server-side sign-in all land after the constructor. Deliberately narrow: anonymous is an ordinary state in a browser, and warning there is noise that teaches people to ignore the warning.

## [0.11.0] - 2026-07-27

### Breaking

- **`buildCollection` and `buildProperty` are removed** — not deprecated, removed. Both were FireCMS-migration shims that had been superseded by `defineCollection`, and keeping a deprecated alias around in a framework that has not shipped 1.0 only buys two ways to write the same thing.

  `buildCollection` was a plain identity function whose generic had to be supplied by hand, so it gave up the property inference that is the entire reason to wrap a collection literal at all. `defineCollection` uses a `const` type parameter to capture the literal, which is what puts your property keys into completion for `admin.titleProperty`, `admin.sort` and `admin.propertiesOrder`. `buildProperty` wrapped a single property in a conditional type that resolved to the type the property already had — a no-op once the surrounding collection is inferred.

  ```diff
  - import { buildCollection, buildProperty } from "@rebasepro/common";
  + import { defineCollection } from "@rebasepro/cms-types";

  - export default buildCollection({
  + export default defineCollection({
        name: "Posts",
        slug: "posts",
        table: "posts",
  -     properties: { title: buildProperty({ name: "Title", type: "string" }) }
  +     properties: { title: { name: "Title", type: "string" } }
    });
  ```

  A plain `const posts: CollectionConfig = { … }` annotation still works and is still typechecked — it just infers nothing, so prefer `defineCollection` in new code. The scaffold templates and every docs example now use it.

- **`where` and `orderBy` are now checked against the row type** — `FindParams` was not generic, so its `where` was `FilterValues<string>` and its `orderBy` an untyped `OrderByTuple`. Passing a generated `Database` to `createRebaseClient` typed the *rows* correctly but not the *query*: `find({ where: { nonexistent_column: ["==", 1] } })` compiled, then came back as a 400 from the API — or matched nothing at all, which is worse. `FindParams<M>` now carries the row type, and a column that does not exist is a compile error.

  A dotted path (`"meta.tag"`) still works for reaching into a `map`/jsonb column; its **root** must be a real column. `include` is unchanged — relation names come from `relations`, not from the row type, so nothing in `Database` can check them.

  `M` defaults to `Record<string, unknown>` all the way through, so an untyped `createRebaseClient()` behaves exactly as before. The chain that has to stay intact is `createRebaseClient<DB>` → `SDKCollectionClient<M>` → `FindParams<M>` → `FilterValues<FieldPath<M>>`; a non-generic alias anywhere along it silently flattens `M` back to the default, which is precisely how the re-export in `client/src/transport.ts` (`export type FindParams = TypesFindParams`) hid this. `e2e/baas-typecheck/src/sdk.ts` now pins it with `@ts-expect-error`, so `pnpm check:baas-types` fails if the check ever comes back off.

  The fluent builder is unaffected: `.where("status", "==", "draft")` was already typed on its parameters. Its internal accumulator stays keyed by `string`, because a `Partial<Record<FieldPath<M>, …>>` is read-only under a generic `M` (TS2862) and cannot be built up in place.

- **The `admin` block's key fields are now checked against the collection's properties** — `titleProperty`, `sort`, `propertiesOrder` and `listProperties` reject a name that is not one of your properties. Previously they accepted any string, so a removed or misspelled field was found by noticing a column had quietly vanished from the panel.

  The cause was one line. `augment.ts` merged the block on as `admin?: AdminCollectionOptions` with **no type arguments**, so `M` fell back to its default `Record<string, unknown>`, `Extract<keyof M, string>` widened to `string`, and every key-shaped field accepted anything. `defineCollection` computed the property-key inference correctly the whole time; it was dropped at that seam, one line short of the field that needed it. The completion those fields' docs promised had therefore never worked.

  Three non-property forms are still accepted: a dotted path into a `map` property (`"profile.displayName"` — the root is checked, the path below it is not), a child-collection column (`"subcollection:orders"`), and an `additionalFields` key. That last one needs an explicit cast, because `AdditionalFieldDelegate.key` is a plain `string` and nothing carries those keys into the type:

  ```diff
  + import type { AdditionalFieldKey } from "@rebasepro/cms-types";
  -     propertiesOrder: ["title", "score"]
  +     propertiesOrder: ["title", "score" as AdditionalFieldKey]
  ```

  Only `defineCollection` turns the check on — it is what supplies `M`. A plain `const x: PostgresCollectionConfig = { … }` annotation infers nothing, so these fields stay permissive there, exactly as before. A type-level test in `packages/cms-types/test/admin_collection.test.ts` now pins all four fields with `@ts-expect-error`, so the seam cannot reopen without a build failure.

- **`CollectionConfig` reports Postgres in its type errors** — `CollectionConfig` is a union discriminated on `engine`, and Postgres collections omit `engine` because it defaults to `"postgres"`. An incomplete Postgres literal therefore matched no member, and TypeScript elaborated the failure against the last constituent — MongoDB. Leaving out `name`, the most common mistake there is, told a Postgres user of a Postgres-first framework that they were missing `engine` on a `MongoDBCollectionConfig`. Postgres is now last in the union, so the same mistake names `PostgresCollectionConfig` and only the field actually missing. No runtime or assignability change; error text only.

- **Admin-panel presentation moved into an `admin` block** — a collection carried two unrelated concerns in one flat object: what the data *is* (table, schema, properties, relations, validation, security rules, callbacks) and how an admin panel should *draw* it (`icon`, `group`, `listProperties`, `kanban`, entity views, selection controllers, …). Ninety-five fields of the second kind sat beside the first, and twelve React view-model types were exported from `collections.ts` — so a backend that never renders anything still pulled the React layer into its type graph, and `@rebasepro/types` could not be a backend contract while it depended on React.

  `@rebasepro/types` is now the React-free BaaS contract; the presentation layer lives in a new `@rebasepro/cms-types` that depends on it, and nothing in core depends back. `pnpm check:baas-types` typechecks a full BaaS project — backend, driver, collection file, SDK reads and writes — with `react` mapped to a stub, which is the invariant that keeps it that way.

  **What to change.** Move presentation fields into `admin`:

  ```diff
   export default {
       slug: "posts",
       table: "posts",
  -    icon: "FileText",
  -    group: "Content",
  -    propertiesOrder: ["id", "title"],
  -    sort: ["updatedAt", "desc"],
       properties: { /* … */ },
  +    admin: {
  +        icon: "FileText",
  +        group: "Content",
  +        propertiesOrder: ["id", "title"],
  +        sort: ["updatedAt", "desc"]
  +    }
   };
  ```

  The backend loads the block and never reads inside it, so a project with no admin panel can drop these fields entirely. For completion and checking inside `admin`, author with `defineCollection` from `@rebasepro/cms-types` — it captures the property literals, so `admin.titleProperty`, `admin.sort` and `admin.propertiesOrder` complete over your own property keys instead of `string`.

- **A relation declares a `kind`, and carries only the fields that kind uses** — a relation was one open interface with every join field optional at once: `cardinality`, `direction`, `localKey`, `foreignKeyOnTarget`, `through`, `joinPath`, `inverseRelationName`. Nothing stopped you combining fields that cannot coexist, so the type accepted several relations that could not work — and two of them corrupted data rather than erroring. `cardinality: "many"` with a `localKey` wrote the foreign key onto the *parent* row, because a to-many has no single row to point at; a many-to-many carrying `foreignKeyOnTarget` claimed a column on the target that the junction table owns. Both compiled, and both were shipped.

  `Relation` is now a closed union discriminated on `kind`, and the link moves under a `relation` field on the property:

  ```diff
   author: {
       name: "Author",
       type: "relation",
  -    target: () => usersCollection,
  -    cardinality: "one",
  -    direction: "owning",
  -    localKey: "author_id"
  +    relation: {
  +        kind: "belongsTo",
  +        target: () => usersCollection,
  +        localKey: "author_id"
  +    }
   }
  ```

  The five kinds, and where each keeps its key: **`belongsTo`** (one row, key on this table, `localKey`), **`hasOne`** / **`hasMany`** (one or many rows, key on the target, `foreignKeyOnTarget`), **`manyToMany`** (many rows through a junction, `through`), and **`via`** (reached by joining across several tables, `joinPath`). Offering a field its kind does not own is now a compile error, so the two corrupting shapes above are unrepresentable rather than merely discouraged.

  `via` is the only kind that still states a `cardinality`, because a join chain cannot imply one, and it is read-only — Rebase will not guess which hop of a chain a write belongs to. `direction` is gone: which side holds the key is what the kind says. `inverseRelationName` is gone with it; the schema generator finds the counterpart by scanning the target's relations.

  `scripts/codemod/relations-tagged-union.mjs` migrates a codebase — it rewrote 232 declarations across 46 files here. It refuses to guess: anything it cannot decide is marked `kind: "AMBIGUOUS"` for you to resolve, rather than being given a plausible default.

  Internally this splits the authored surface from a resolved form. Every consumer now reads a `ResolvedRelation` with defaults already filled in and `writable` / `shared` decided once, instead of each site re-deriving them from optional fields — which is how the write guard and the admin had drifted into disagreeing about whether a `via` could be written through.

- **A relation whose names do not exist now fails at boot instead of returning nothing** — the union settles a relation's *shape*; it cannot know whether `posts_tags` is a table, whether `author_id` is a column, or whether a `joinPath` actually connects the tables it names. Those are facts about the database. Nothing checked them until a query ran, and the failures were the quiet kind: a missing junction table logged a warning and returned no rows, so `posts/1/tags` answered `[]` — the same answer a correct relation gives for a post with no tags. The tab rendered, the tab was empty, and nothing said why.

  The registry now validates every resolved relation against the schema it will run on and refuses to start if any of them cannot resolve, listing all of them at once with the columns actually available and the edit that fixes each. Fatal rather than a warning deliberately: a server that will not boot costs a minute, and a relation that quietly answers "nothing" costs however long it takes someone to notice their data is missing.

  It fails open wherever it cannot see enough to be sure — a collection with no registered table, a target belonging to another backend — because blocking boot on a working project is worse than missing one bad relation. The sharpest case it catches is the junction default: `through.table` is derived from the two table names sorted and joined, so renaming a table silently re-points the relation at a name that was never created.

### Added

- **`rebase-rls-check` — audit row-level security on any Postgres** — a standalone, read-only CLI that reads a database's catalog and reports what is actually exposed. It runs against any Postgres — Supabase, Neon, RDS, a self-managed server — and needs no Rebase project, which is the point: it has to be worth running for someone who will never adopt the framework.

  Fourteen checks, three of them taken straight from bugs this codebase shipped and debugged: a bare column inside an `EXISTS` subquery binding to the inner table, junction tables left open while both endpoints were locked, and RLS enabled with no policies serving an empty collection for weeks.

  Two constraints the design treats as non-negotiable. **False positives are worse than misses** — checks that cannot see intent are marked heuristic, rendered separately and phrased as questions, and severity is calibrated per platform (`policy-anonymous-tautology` is critical on Rebase and PostgREST but only low on Supabase, where `auth.uid()` genuinely returns NULL for anonymous callers, so flagging it there would fire on nearly every Supabase database alive). And **credentials never surface** — the connection string is redacted everywhere including the auth-failure path, and the redactor refuses to guess when an unencoded `@` or `/` makes the authority boundary ambiguous rather than printing part of a password as a host.

  See [RLS Check](https://rebase.pro/docs/rls-check).

- **Existing rows can be attached to a many-to-many tab** — a junction-backed relation reads as set membership on write: `PUT parent/:id/child/:childId` links a row idempotently. Previously the junction row was written only alongside an insert, so a linked tab could create new rows and never attach one that already existed. Unlike an owning foreign key this takes the row from nobody — its other parents keep it — which is why linking is safe here where reparenting would not be. The admin surfaces it as **Add existing** on a linked tab, opening the picker over the whole target collection.

- **`geopoint` and `binary` are real field types in the admin panel** — both were in the property model with nothing behind them. `geopoint` was missing from the widget lookup altogether, so it resolved to no field: the column never rendered on a form, and its property dialog opened showing a name, a description and no type-specific settings — indistinguishable from a property that has none. `binary` resolved to the plain text field, which offers multiline, markdown and email (none of which mean anything for bytes) and whose editor merges `type: "string"`, so touching a binary property's widget silently changed its type.

  Both now have a field binding, a widget config and a place in the property picker. Geopoint is two coordinate inputs rather than a map, because a map needs a tile provider, an API key and a network, none of which belong in a field that has to work offline; it holds a half-typed location rather than committing it, since sending the empty side through `Number("")` yields a perfectly finite `0` and would drop the point in the Gulf of Guinea. Binary shows a collapsed card with the decoded size and expands only when someone wants to edit the base64.

  `vector_input` joins them in the picker. It had a binding and an editor already and was simply never listed, so a vector property rendered correctly once it existed but could only be created by writing code.

- **A project is a bundle, and the runtime is the platform's** — `rebase build` now emits `dist-bundle/`: compiled collections, functions, crons and schema plus a generated `manifest.json` recording the runtime range it needs, a `schemaVersion` hash, its declared dependencies, and whether it uses native modules. `@rebasepro/server` boots it (`bootFromBundle`, bin `rebase-server`), and `docker/server.Dockerfile` publishes that as an image. The consequence is the point: **the engine can be replaced under a project without rebuilding it** — upgrading is a new image tag against the same bundle — and self-hosting becomes "run the image with your bundle" rather than "build and maintain your own container". `docker/docker-compose.selfhost.yml` is that, ready to run.

  A repo-root `rebase.json` declares topology only — the runtime compatibility range and the apps this repository contributes (`backend`, `static`, `admin`, `mobile`). Schema, rules, hooks and functions stay TypeScript in `config/`, which is the point of the product and does not move into JSON. `rebase link` accepts a self-hosted base URL wherever it accepts a cloud project, and writes an uncommitted `.rebase/cloud.json`, because a project reference is per-checkout.

- **Remote SDK generation from a running project** — `GET /api/meta/contract` (admin, service-key or admin API-key gated; fail-closed 404 when no auth is configured) serves the collection contract, and `rebase generate-sdk --from <link|url>` reads it instead of importing local `config/`. A second repository can therefore build a typed client against a backend it does not contain, which is what makes the multi-repo case work at all. The SDK records the `schemaVersion` it was generated against so drift is detectable; `GET /api/meta/schema-version` is deliberately unauthenticated and returns only that hash.

- **Collection tables are created at boot, additively** — the runtime ensured its auth tables and nothing ensured the project's, so a backend booted against a fresh database answered sign-in and then `500` on every data route. `REBASE_MIGRATE_ON_BOOT=ensure` (the default) now creates missing tables, columns and enum types before serving. **Additive only, permanently**: it never drops, narrows or rewrites, so it is safe to run unattended on every start and re-running is a no-op. A removed field leaves its column behind and a rename reads as an addition — destructive changes stay a deliberate `rebase db push`, with its dry-run and confirmation gate. `none` opts out.

- **Storage authorization can look up ownership** — `storageAuthorize` received a key, a bucket, an operation and a user, and no way to answer the only question that matters: *who owns this object?* Ownership lives in a row, so a hook limited to prefix arithmetic on the key expresses no real multi-tenant rule — and it could not fetch that row itself, because the hook is declared in the project's `config` package, which depends on `@rebasepro/types` alone and cannot resolve `@rebasepro/server` at runtime. The context now carries a trusted, read-only, RLS-bypassing reader (`ctx.data`). It bypasses RLS deliberately: the hook *is* the authorization decision, so making it decide through a reader already narrowed by the caller's permissions is circular.

- **Multiple data and storage sources** — declare `dataSources` / `storageSources` as exports of the config package and configure each by suffixing its env var with the source key: `DATABASE_URL__ANALYTICS`, `S3_BUCKET__MEDIA`. Two underscores, because one collides with real variable names (`S3_BUCKET_NAME`). A source that is declared but not configured fails boot rather than silently falling through to the default database.

- **Prometheus metrics** — `/metrics` in Prometheus text format, off unless `REBASE_METRICS=true` and gated by `REBASE_METRICS_TOKEN`: request counts and latency histograms per surface, plus process heap, RSS and uptime. Self-hosters can scrape it directly.

- **`rebase build` folds a single static app into the backend bundle** — the runtime already served a SPA from `entry.static`; nothing put the assets there. So a project whose container served its site at `/` and its API at `/api` lost the site when it moved to a platform-run runtime: the API answered and every page 404'd. The frontend now travels in the bundle and one runtime serves both, which is the shape the scaffolded template produces. `--no-static` opts out.

- **Local-first sync in the client SDK (`offline: true`)** — the data layer keeps a normalized local database of rows rather than a cache of responses, and answers queries against it. A row written offline therefore appears in *every* filtered list it belongs to (filters, sorting and pagination are evaluated locally), a row edited in one view updates in all of them, and `findById` answers for a row only ever seen inside a `find`. Server responses merge into that database instead of replacing it, so a row carrying unsynced local writes keeps them — the user's own change never flickers away underneath them.

  Writes are decided locally: once the client knows the connection is gone it stops attempting requests, so an offline write costs nothing instead of a timeout, and it applies immediately and replays in order when connectivity returns. A write the server *rejects* is rolled back, along with the queued edits that were built on it — but not a later create or delete for the same row, which stands on its own. Temporary failures (429, 503, a dropped connection) are retried on an exponential backoff instead, up to `maxRetries`.

  `observe()` / `observeById()` are the new reactive reads, on every collection client: local-first, de-duplicated, and re-emitted on any local write, replay, rollback, realtime event, or change from another tab. Each result carries `fromCache`, `hasPendingWrites` and `partial`, so an interface can say what it is showing. Tabs share the local database and the outbox over a `BroadcastChannel`, and only one replays the queue at a time. `client.offline` gained `status()` and `onStatusChange()` for a sync indicator, and `isOfflineError()` distinguishes "offline with nothing local to answer with" from a request that genuinely failed.

  A replayed write is recognised rather than repeated. The queue names each
  mutation with an idempotency key, and the server records what that key
  answered, so a create whose response was lost to a dropped connection comes
  back with the row it already made instead of inserting a second one — the case
  the client cannot detect for itself on a table with a server-assigned id,
  which is what the scaffold's collections use. Keys are scoped to the
  authenticated user and honoured for 24 hours; a backend that cannot store them
  ignores the header rather than refusing the write, and auth signups are
  excluded because their response can carry a temporary password.

  Writes made while another is in flight are safe too: an edit is no longer
  folded into a request already on the wire (where it was dropped, unsent, when
  that request was acknowledged), a delete no longer cancels out a create the
  server is in the middle of reading, and an update or delete now queues behind
  a pending write for the same row instead of racing ahead of it to a server
  that has not seen the row yet.

  **Not yet:** conflicting concurrent edits are still last-write-wins — there is
  no row version, so two clients editing the same row overwrite each other with
  no conflict reported. `createMany` is not keyed, only `create`. Where
  `navigator.locks` is unavailable two tabs may both replay the queue.

  See [Offline & Local-First Sync](https://rebase.pro/docs/sdk/offline).

### Changed

- **No bucket means no file storage, rather than a crash or a disappearing disk** — 0.10.0 made a production backend *refuse to boot* on `type: "local"`, which stopped the silent data loss but replaced it with a crash-looping rollout for anyone who simply had not configured storage — a project that never uploads a file was taken down by a feature it does not use. Storage is now opt-in instead: with no bucket configured in production, no storage backend is registered, `/api/storage/*` answers `501 STORAGE_NOT_CONFIGURED` with the fix in the message, and everything else — data, auth, realtime — keeps serving. `501` and not `503`, so the client's offline queue does not retry uploads that can never land.

  The scaffolded backend matches: it configures S3 for `STORAGE_TYPE=s3` and now GCS for `STORAGE_TYPE=gcs`, and falls back to local disk only outside production (or with `FORCE_LOCAL_STORAGE=true`, for a deployment with a real volume mounted). A named backend that is local-in-production is dropped from a multi-backend map without taking the durable ones with it.

### Fixed

- **`rebase db pull` wrote collection files that would not compile** — introspection emits collection *source code* as template strings, which put it outside every check the relations refactor relied on: the codemod rewrites real declarations and never saw these, `tsc` checks the generator rather than the code it prints, and the existing tests asserted with `toContain`, which passes happily on a field the type no longer has. So introspection went on writing `cardinality`, `direction` and a top-level `target` long after `Relation` stopped accepting any of them.

  Fixed at every emission site, and the many-to-many case got simpler rather than merely renamed: with no owning and inverse side to choose between, it no longer guesses one from table-name ordering, and no longer hands the losing side a relation with no `through` and a comment asking the reader to finish it by hand. Introspection knows both junction columns already; each side now names them from its own end.

- **The relation editor wrote kinds that do not exist** — the relation property form still carried its pre-union `Cardinality` (one/many) and `Direction` (owning/inverse) selects. Both had been pointed at `relation.kind` without the controls being rethought, so their options went on writing the old vocabulary: choosing "One (has-one)" set `kind: "one"`, choosing "Owning" set `kind: "owning"`. Both also rendered from `value={kind}` while comparing against `"one"`, so a `belongsTo` relation displayed as "Many (has-many)" *and* "Inverse" at once — the form disagreed with itself, disagreed with the stored value, and offered no way to pick a real kind.

  It is one Kind select now, driven by a table shared with the relations tab so the two surfaces cannot describe the same thing differently, and typed so a sixth kind cannot be added to the union without failing to compile there. Three more in the same dialog: saving cast the draft straight to a `Relation`, so a junction table filled in and then abandoned by switching to "Belongs to" was persisted alongside a `localKey` — exactly the shape the union exists to forbid, smuggled past it by a cast; picking "Via" offered no way to enter a join path while Save stayed enabled, producing a relation with an empty `joinPath` that joins nothing; and the relations table declared five header cells while rendering four, so `kind` appeared under a "Cardinality" heading and "Direction" had no cell at all.

  The JSON path was never affected — `validateCollectionJson` checks `kind` against the union and rejects fields a kind does not own. Only the form drifted, because nothing typechecks a select's option values against what its handler writes.

- **The collection editor could not round-trip a relation** — `target` is a `() => CollectionConfig` thunk, which cannot be written to JSON, so it travels as a collection slug. Nothing rebuilt it on the way back: the deserializer had no branch for relations, so one fell through to the pass-through default and returned with `target` still a *string*, while every consumer in the codebase calls `target()`. The cast to `Property` at the end of that function erased the difference, so it compiled and shipped. Serialization is now switched on `kind` and assigned without a cast, and `fromSerializableCollectionConfigs` rebuilds the thunks against the whole set — resolving lazily, so collections may reference each other in any order.

- **Generated OpenAPI documented none of a collection's subcollections** — the spec read `relationName` straight off the authored `relations` array. That name is optional and defaults to the property key or the target's slug, so every relation relying on the default was skipped, and relations declared inline on a property were never seen at all, since they are not in that array. A collection could show three subcollection tabs in the admin panel and document zero. The routes now come from the resolved relations — the same names the nested-path router matches — in a second pass after every component schema exists, which also fixes subcollections whose target appeared later in the array silently degrading to an untyped `object`. To-one relations are left out: `posts/1/author` resolves, but documenting it as a paginated list describes a response the client never gets.

- **A custom `Field` or `Preview` attached as a lazy import rendered nothing** — the documented way to attach one is `admin: { Preview: () => import("./MyPreview") }`. JavaScript names an anonymous function after the property key it is assigned to, so that arrow's name is `"Preview"`, and component detection treated "zero arguments, starts with a capital letter" as proof of a component — which is true of every loader written that way. The thunk went to React as a component, React called it, got a Promise, and rendered nothing: an empty cell with no console error. Detection now leads with what the function does — a dynamic module load in the body outranks the name — and matches both `import(...)` and the `require(...)` that CommonJS transforms produce.

- **`rebase dev` could print a URL served by a different process** — when the first port was busy, the port-retry helper bound the next one but reported the port it had just *failed* to bind. It passed its success handler to `server.listen(port, host, cb)`, and that form registers the handler as a one-shot `listening` listener which a failed attempt never removes; the next attempt's success then ran both, and the earliest won. So with something already on 3001, the server listened on 3002 and announced `http://localhost:3001`. Whatever was already there answered normally, out of its own database, and nothing logged a warning.

  Two consequences are fixed with it. The port file recorded the wrong number as well, and port *affinity* from that file used to outrank an explicitly requested port — so setting `PORT` in `.env` had no effect while a file from an earlier run existed. The file now records the bound port and the requested one, affinity applies only when the same port is requested again, and this matches the precedence the CLI already used (`--port`, then `PORT`, then affinity).

- **A bundle build said nothing about ignoring `backend/src/index.ts`** — `rebase dev` runs that file whenever a project has one, so throughout local development it *is* the server and every route in it works. A bundle has no entrypoint of its own: the runtime boots the bundle and mounts what the manifest points at — the config package, functions, crons and the schema. So a project with custom routes in its entrypoint built clean, deployed green, and answered 404 on every one of them, with the file still sitting in the repository looking exactly like the server. `rebase build` and `deploy --bundle` now name the file, say it is neither compiled nor shipped, and give the two ways forward: move the routes into `backend/functions/`, or declare the app as `"type": "custom"` to keep your own entrypoint (which is already what a manifest-less repo carrying one is inferred as).

- **`rebase cloud deploy` with no flags did not say what it was about to build** — the bare form uploads nothing. It asks the control plane to rebuild what it already holds: a git checkout, or the newest source archive some earlier `--source` deploy left in object storage. Both are legitimate and neither is the working directory, so a deploy shipping month-old code was indistinguishable from one shipping today's. It now prints the source first — the repository and branch, or the archive's deployment id and age, with a reminder that `--source .` is what uploads this directory — and says plainly when the control plane holds neither.

  On a managed project it was worse than stale. A successful source build sets `runtimeMode: "custom"` server-side, so the bare form silently swapped a project off the platform runtime and back onto a container image. That case is now a refusal naming `--bundle` as what was meant; `--source .` and the new `--force` both eject deliberately, and an explicit `--source` deploy of a managed project warns before it does.

- **`deploy --bundle` could not skip type checking** — `rebase build` has `--skip-type-check` and `buildBundle` already accepted the option; only the deploy argument spec lacked it, so iterating meant building by hand and then pointing `--bundle-dir` at the result. The flag is accepted on `deploy` now and threaded through.

### Testing

- **A stable release now runs the full gate before publishing anything.** Publishing was not gated on tests: the canary job ran a build and published, and `publish.yml` had no dependency on CI at all — the two workflows fired in parallel on the same push, so a release could go out while CI was still running, or after it had already failed. The stable job ran unit tests but no end-to-end suite, which meant the failures those suites exist to catch — a broken `rebase init`, RLS not isolating rows — were exactly the ones a green build could not see.

  The whole gate (type checks, headless/BaaS guards, init-template check, unit tests, and every e2e suite) now lives in a reusable `verify.yml` that CI and the stable release both call, so the release path cannot drift from the one that runs on every push. A stable release stops before any version bump, tag or publish if any of it fails. Canary is deliberately unchanged: it still publishes on a green build alone.

- **The template e2e suite could test a server it had not started.** It took the backend's address from the announced banner, which is trustworthy only if the server announces the port it bound — see the fix above. Each backend is now given a port the OS reports as free, and the run fails loudly if the banner disagrees rather than continuing against an unknown server and a database it does not control. It also talks to `127.0.0.1` rather than `localhost`, which resolves to `::1` first on macOS while the server binds `0.0.0.0`.

- **The CLI init e2e leaked its frontend.** `rebase dev` supervises a Vite that ends up outside the process group the teardown signals, so a frontend survived every run — one held port 5173 for hours with its project directory already deleted. Teardown now also reaps whatever still holds the dev server's own ports, restricted to processes that were not already listening there when the run began (a developer's `tsx watch` server gets a new pid whenever it restarts, so "any new listener" would have been a way to kill it).

- **`rebase cloud link` was broken from a fresh checkout** — three prompts still used inquirer's removed `list` type, so running it interactively died with `Prompt type "list" is not registered`. Prompts are only constructed when a command actually asks something, so every non-interactive test passed and CI stayed green while the first command anyone runs did not work.

- **`rebase build` produced bundles that could not boot** — TypeScript emits import specifiers untouched, so a project on `moduleResolution: "bundler"` compiled `from "./posts"` and Node ESM refused it. Specifiers are rewritten after compilation. Bundle tarballs no longer carry macOS extended-attribute headers, which GNU tar warned about once per file on extraction and which buried real errors.

## [0.10.0] - 2026-07-20

### Breaking

- **The authenticated principal is `uid` everywhere** — the identity had two names. `uid` was the domain model's: the `User` type, the `AuthenticatedUser` adapter contract, the driver scope, and the RLS layer, where policies read `auth.uid()`. `userId` was the JWT claim's, inherited by the Hono request context because it was populated straight from the decoded payload. A request crossed that boundary twice, so a route handler and a collection hook two frames apart saw the same person under different keys — and three unrelated places had independently grown the same defensive `a ?? b` read to cope. `uid` wins because `userId` was confined to four server-side packages while `uid` is the vocabulary of twelve, and because the two ends of the stack — Postgres policies and the client SDK — already agreed on it.

  Tokens now carry a `uid` claim and `c.get("user")` returns `{ uid, roles }`. Anything reading `payload.userId` or `user.userId` must move.

- **ESM only — the CJS/UMD output is gone** — the packages shipped both, but the output banner injects `import` / `import.meta.url`, which a UMD bundle cannot parse as CommonJS, so the CJS half was never loadable. `main`, `module` and the `import` condition all point at `index.es.js`; the `require` condition is removed. A CommonJS consumer must `import()` or move to ESM.

- **`id` is an address, not a column** — the synthesized `id` was written into rows on the way out, where it collided with the data three ways: it renamed the key (a `sku` primary key was served as `id`, with `sku` absent entirely), it changed the type (an integer key reached the SDK as `"42"`), and it destroyed real values, because `drizzleResultToRow` spread it last so it would win over a raw `id` column. Rows now carry their own columns under their own names and types. Code reading `row.id` on a table not keyed on `id` must read the real key.

- **A write naming a field the collection lacks is a 400** — unknown keys used to travel into the INSERT, so a typo came back as `column "titel" does not exist`, phrased by Postgres from a stack the caller cannot see, and only when the column really was absent. The `id` case is called out specifically: `create(data, id)` writes the id argument as an `id` column, which is meaningless for a table keyed on `sku`, so the error names the real key instead of sending someone hunting for an `id` they never wrote. Bulk writes are checked before the transaction opens and report the offending row index.

- **`policy.authenticated()` no longer matches anonymous requests** — it compiled to `auth.uid() IS NOT NULL`, a tautology on the user path: `applyAuthContext` coerces a blank user id to the `'anonymous'` sentinel precisely so it cannot read back as NULL and pass for the trusted server context. So a rule reading as "logged-in users only" granted full access to anonymous visitors, and neither the type system, the DDL generator nor — at the time — the drift checker said a word. `not(authenticated())` was separately special-cased to mean "is the server context", which the default policies leaned on — so both spellings moved together. Review any rule built on either.

  **Upgrading does not change your database.** The compiled SQL lives in `pg_policies`, so an existing app keeps the permissive `auth.uid() IS NOT NULL` until `db push` runs again — nothing re-applies policies at container boot, so redeploying and restarting change nothing. `rebase doctor --policies` reports it: alongside the name-keyed diff it scans the live `qual`/`with_check` of every policy on a managed schema and flags the bare tautology as *Insecure*, and it flags a policy an earlier push superseded but never dropped as *Orphaned* — the two ways this fix fails to land. It exits non-zero, so CI can gate on it. The scan is narrow by design: it matches that one expression shape and treats an `<> 'anonymous'` guard anywhere in the clause as the corrected form, so a hand-written fail-open policy spelled another way (`USING (true)`, `USING (1 = 1)`) is not flagged — read the qual out of `pg_policies` directly to confirm those. Then run `db push`, which re-applies the current policies and drops the superseded ones. See [Upgrading](https://rebase.pro/docs/upgrading).

- **RLS is the whole authorization model — reads are bound too** — enforcement used to split by operation: writes ran through app-layer callbacks while reads leaned on RLS `SELECT` policies. But a privileged connection — superuser, `BYPASSRLS`, or the table owner — bypasses RLS unconditionally, so on any such connection (the common case) tenant read isolation was silently dead. Authenticated, user-context requests now run as a restricted, non-owner `rebase_user` role, so Postgres RLS binds *every* statement: `SELECT`, `INSERT`, `UPDATE`, `DELETE`. A collection's `securityRules` are now the entire authorization model; callbacks (`beforeSave` and friends) are validation and side-effects, not a security boundary. The server context — auth flows, migrations, `dataAsAdmin` — stays the trusted owner plane and bypasses RLS by design. Default policies are locked-by-default for every collection (a permissive server-or-admin read/write baseline; auth collections also get a self-read and keep the restrictive admin write gate), so RLS-on does not default-deny everything; `FORCE ROW LEVEL SECURITY` is gone, since the user role is already a non-owner. The opt-out is `disableDefaultPolicies`. Isolation is provisioned at boot and on `db push` / `migrate`; a privileged connection that cannot be isolated fails boot with the exact setup SQL, and connecting as superuser or `BYPASSRLS` warns loudly — the auth-collection write gates do not bind those.

- **22 retired package names deprecated on npm** — the names the repo no longer publishes now carry a deprecation notice pointing at their replacement, so an install of an old name says so instead of silently resolving to an abandoned version.

- **Package renames** — packages are now named for their role, not their position. `core` was frontend-only React while `server-core` was the actual core of the product; they shared a word and were otherwise unrelated. `client-firebase` depended on `admin`/`core`/`ui`, so it was a UI integration wearing a client-SDK name. Import paths are the only change — no behavior moved with them.

  | Old | New |
  |----------|----------|
  | `@rebasepro/core` | `@rebasepro/app` |
  | `@rebasepro/server-core` | `@rebasepro/server` |
  | `@rebasepro/server-postgresql` | `@rebasepro/server-postgres` |
  | `@rebasepro/server-mongodb` | `@rebasepro/server-mongo` |
  | `@rebasepro/client-postgresql` | `@rebasepro/client-postgres` |
  | `@rebasepro/client-firebase` | `@rebasepro/firebase` |
  | `@rebasepro/formex` | `@rebasepro/forms` |
  | `@rebasepro/sdk-generator` | `@rebasepro/codegen` |
  | `@rebasepro/schema-inference` | `@rebasepro/inference` |
  | `@rebasepro/mcp-server` | `@rebasepro/mcp` |
  | `@rebasepro/plugin-data-enhancement` | `@rebasepro/plugin-ai` |

  Unchanged: `types`, `utils`, `common`, `client`, `ui`, `admin`, `studio`, `cli`, `plugin-insights`.

- **`@rebasepro/auth` removed** — it was one hook and an API helper whose only dependency was `@rebasepro/types`, and it always had to be installed alongside `core` anyway. `useRebaseAuthController`, `fetchAuthConfig`, `createAuthConfigCache` and `clearAuthConfigCache` now come from `@rebasepro/app`, beside the `RebaseAuth` and `LoginView` components they are used with. The auth *system* was never here — it lives in `@rebasepro/client` (`client.auth`) and `@rebasepro/server`.

- **`defaultSecurityRules` moved off the server config** — it lived on `RebaseBackendConfig`, was applied to the in-memory registry, and enforced nothing: `db push` generates the Postgres policies — the only thing that actually enforces access — from the collection *files*, and never sees the running server. Declare it in `config/collections/index.ts` instead, where the loader reads it and both the runtime and `db push` see the same thing. Its old doc also claimed collections without rules were "unrestricted"; they are locked to admin-only by the generator. In `baas` mode there are no collection files and no `db push`, so the database's own RLS is the whole model and there is nothing to default.

  ```ts
  // config/collections/index.ts
  export const defaultSecurityRules: SecurityRule[] = [
      { operation: "select", access: "public" },
      { operations: ["insert", "update", "delete"], roles: ["admin"] }
  ];
  ```

- **A collection file that fails to import is now a hard error** — the loader used to log and continue, which turns a broken file into a missing API route and a missing policy, with a successful exit code. Both read as "no data" rather than as a failure.

- **`RebaseCMS` → `RebaseCMS`** — the component now matches the package it ships from. `mode: "cms"` on `RebaseBackendConfig` is unchanged: it describes where collections come from (config vs database), not the UI.

- **BaaS mode does not serve tables without row-level security** — see Fixes. A table with RLS disabled is skipped and named at boot; `baas: { unprotectedTables: "serve" }` restores the old behavior.

### Features & Improvements

- **Presence and broadcast channels in the SDK** — the realtime engine had supported `join_channel`, `broadcast` and the presence messages for a while, but the client could only send them fire-and-forget: no methods to call them, and no way to receive channel events, since `on()` handled only connect/disconnect/reconnect/error. Anything wanting presence opened a second socket and reimplemented the authenticate handshake, the reconnect backoff and the presence heartbeat — a couple of hundred lines per app, duplicating this package. `client.realtime.channel(name)` now provides `track` / `onPresence` / `broadcast` / `onBroadcast` / `leave`, with channels as per-name singletons so two components cannot cut each other off by leaving. It also hides two protocol details discoverable from neither the message list nor the docs: a joining client is told only about its own join, so `join()` sends an explicit `presence_state` to get the roster; and presence expires after 30s, so tracking is re-sent on a heartbeat.

- **Ordered, replayable per-channel history** — broadcast was fire-and-forget to whoever happened to be connected. Enough for presence and for "someone saved"; not enough for op-based collaborative editing, where a client that blinks out for two seconds had to resync a whole document rather than catch up on the four operations it missed. Every broadcast on a retained channel now gets a per-channel sequence number, allocated by the same statement that stores it, so a reconnecting client can say where it got to and receive only what it missed. Retention is server-side and opt-in (`realtime.channels`, matching exact names or a trailing `*` prefix) — a channel is created by whoever names it, so a client-supplied history depth would let any visitor commit the backend to unbounded storage. With no rules configured nothing is written, no table is created, and broadcast runs the same synchronous path as before.

- **Database-level realtime — change data capture** — realtime events were application-level: only writes through the Rebase API emitted them, so a change made with `psql`, another service's cron, a raw SQL statement or Studio's SQL editor committed silently and no subscriber heard it. A database-level CDC source now feeds the existing `RealtimeService`, matching Supabase Realtime's WAL-tailing model: an idempotent `AFTER INSERT/UPDATE/DELETE` trigger per managed table emits `pg_notify`, a dedicated `LISTEN` client fans the events in, and delivery is RLS-safe — a change is marked invalidated so every subscriber re-reads under its own auth context rather than trusting the publisher's row. `REALTIME_CDC` is `auto` by default: on where the connection supports it, silent fallback to app-level otherwise (`wal` degrades to `trigger` — native WAL streaming is not bundled). An 8KB-overflow guard means CDC can never abort a write.

- **Per-object authorization for storage** — storage routes authenticated but did not authorize. `requireAuth` and `publicRead` are global switches: they decide whether a caller must be signed in, not what that caller may touch, so any authenticated user could read any key they could name. For multi-tenant apps the only thing between two tenants' files was key unguessability, which is not an access-control model. `storageAuthorize({ key, bucket, operation, user })` is the storage analogue of a collection's security rules; denials are 403, and a hook that throws denies too, so a failed ownership lookup cannot fall open. The load-bearing placement is `/metadata` rather than `/file/*`, because `/metadata` mints the short-lived path-scoped download token that `/file/*` trusts — and it minted one for any authenticated caller for any path. Listing is gated on the prefix, since a listing is how you discover keys nobody told you about, and TUS is gated at create time so a denied upload leaves no temp file to resume.

- **Bulk writes and upsert** — only single-row create/update/delete existed, so a ~10k-row ETL had no way to express itself and dropped to `admin.executeSql` with hand-bound parameters, which is where injection bugs live. `createMany(rows, { upsert: true })` is available on both the HTTP and server-side clients, and as `POST /api/data/:collection/bulk`. Every row still runs the normal pipeline — callbacks, relations, RLS — because `saveMany` reuses `save()`; the win is that the batch shares one transaction and one round trip. `upsert` is `INSERT ... ON CONFLICT DO UPDATE` on the primary key, one statement, so it cannot lose the race a read-then-write can.

- **Junction tables inherit the security model instead of escaping it** — a `through` relation makes the generator create a table nobody declared, and those were the one kind of generated table with no RLS at all. Since `rebase_user` holds full DML grants, any signed-up user could read or wipe every edge between two locked-down endpoints (3,648 rows on the live demo), and there was nowhere to write rules for a junction anyway. A junction's security is now derived: the same locked server-or-admin baseline every collection gets; reads follow the endpoints via two correlated `EXISTS` subqueries that run under the caller's role, so visibility is delegated rather than copied and endpoint policy changes propagate with no junction change; and writes follow the owning side, because linking an edge is editing the owning row.

- **Account linking** — the `EMAIL_NOT_VERIFIED` rejection on OAuth sign-in told users to link the provider from their profile, but no such endpoint existed; the only link route was anonymous→password, so the error was a dead end. An authenticated `POST /auth/link/:provider` now attaches a provider identity to the current account, with a matching client `linkProvider()`. Linking deliberately does not require a verified email or matching addresses: on sign-in the provider's email is the only evidence tying an identity to an account, so an unverified address would allow takeover, but here the caller already proved ownership with a valid session. Refuses with 409 `IDENTITY_ALREADY_LINKED` when the identity belongs to another user, and is idempotent for the caller's own.

- **Cron is coordinated across instances** — every app instance ran every cron job, since the scheduler is in-process `setTimeout` and the executing flag only guards within one process, so N replicas meant N executions per tick. Handlers stay app-level closures; only the mutual exclusion moves to the database, where each instance derives the same scheduled fire time from the cron expression and atomically claims the slot.

- **First-class database backups** — `rebase db backup` / `restore` / `backups`, writing to a local path or an `s3://` / `gs://` destination. Restore is confirmation-gated into a fresh database (`--create-db` / `--target-db`) so it cannot clobber a live one. Backups can run on a schedule from a cron file (`createBackupCron`, `backupCronConfigFromEnv`) with retention pruning (`BACKUP_RETENTION_DAYS` / `BACKUP_KEEP_MINIMUM`). A `rebase.backups` client surface and server routes expose the same operations, and the scaffold's `.env.example` documents the settings.

- **`rebase cloud` reaches operational parity** — project slugs replace UUIDs across every user-facing surface (`--project` takes the subdomain the console URLs show; raw UUIDs still resolve for old scripts and link files), plus `rebase cloud debug` for diagnosing deployed projects and `rebase cloud storage create` / `attach`. `rebase init` gains real `--project` / `--setup-key` handling — the setup page advertised both flags while permissive arg parsing silently swallowed them.

- **Tail-follow logs explorer in Studio** — sticky auto-scroll with a new-entry pill.

- **Admin: the RLS editor offers the roles that actually exist** — it listed native PostgreSQL roles from `pg_roles` when picking values for `SecurityRule.roles`, which matches the strings on the users table via `auth.roles()`. Choosing `public` or `rebase_user` there compiled to a condition no user could satisfy. `fetchApplicationRoles` now sits alongside `fetchAvailableRoles` across the `SQLAdmin` surface, and the doc comments on both fields spell out which is which.

- **Admin: an unsaved-changes guard for split and entity views**, with shared view-mode routing.

- **`pnpm verify:docs`** — typechecks documentation code fences against the workspace SDK, so a doc that names an API the code does not have fails instead of aging quietly.

- **BaaS mode — a REST API over your database with no collections at all** — `mode: "baas"` derives collections from the live database at boot instead of loading config files. Every protected table becomes a REST resource, with types, primary keys and relations read from `information_schema`; the drizzle tables the query layer needs are built in memory, so no generated `schema.generated.ts` is required either. Change the schema with a migration and the API follows. Join tables are skipped, the schema editor is off (it exists to write config files), and no React enters the backend's module graph. `introspectionSchema` on the Postgres adapter selects a schema other than `public`.

- **The SDK works with no collections** — `rebase.data.collection("posts").find()` needs only a table name against a BaaS backend: no collections map, no generated types, nothing to declare. The optional `collections` option exists only to pin non-obvious slugs.

- **`rebase init --flavor baas`** — scaffolds a headless project: `backend/` alone, no `config/`, no `frontend/`, and no UI package in the install tree. Without `--flavor`, `init` asks: *BaaS + admin* (default) or *BaaS only*.

- **`rebase doctor --policies`** — diffs `pg_policies` against the policies your collections generate, reporting missing, orphaned, diverged and insecure, and exits non-zero so CI can gate it. Policies live in Postgres and the config is only their source; nothing reconciled the two, so a stale policy outlived every config fix. Reuses `generatePostgresPoliciesDdl` — the same function `db push` applies — so it compares against what would really be written. It also reports policy roles this server can never assume, without booting one. Policy *expressions* are not diffed against the generated DDL: Postgres rewrites `qual`/`with_check` on storage, and a check that cries wolf gets ignored. They are still *scanned*, for one shape — the fail-open `auth.uid() IS NOT NULL` tautology, without the `<> 'anonymous'` guard — which is the one drift no other field here can see, since a policy carrying it matches its expected counterpart on name, roles, command and clause presence alike.

- **One definition of "the collections"** — the runtime, the drizzle-schema generator, the policy generator and the doctor each scanned the collections directory themselves, four copy-pasted filters agreeing by discipline rather than construction. A drift between them would serve one set of collections while pushing policies for another. They now share one loader, exported from `@rebasepro/server`.

- **Guards for the two failure modes that ship silently** — `pnpm run check:headless` imports every collection file and server package under a loader hook that rejects React, so a UI import cannot creep back into the backend. `pnpm run check:names` fails on references to renamed packages and duplicate dependency keys. Both run in CI. A new BaaS e2e installs a scaffolded project from real tarballs and boots it against tables it was never told about — the only place `workspace:*` resolves, so the only thing that proves the templates rather than the library.

### Fixes

- **A signup with a typo'd field is now a 400, not a silent 201** — a write to an auth-enabled collection skipped unknown-field validation entirely, because a signup body carries `password` and provider fields the users table does not declare as columns. The skip was total, so `POST /api/data/users` with an undeclared `emial` returned 201 and dropped the field, while the same typo on `posts` was a 400 — directly contradicting the Breaking note above. The exemption is now scoped to exactly the fields the auth adapter consumes (the built-in one names `password`); everything else is validated as on any collection. An auth collection with a custom `onCreateUser` hook opts out, since the hook then owns the body's shape.

- **`POST /auth/refresh` with no session is a 401, not a 400** — clients refresh on page load before they know whether a session exists, so a first-time visitor with no token is the most common way the route is called. It answered `400 INVALID_INPUT` and logged a warning for every anonymous page view. Absent-token is now `401 NO_SESSION`, logged at debug; a present-but-malformed token is still a 400. `ApiError` gained an `expected` flag (and an `unauthenticated()` factory) so a routine outcome no longer looks like an incident in the logs.

- **The generated `docker-compose.yml` could not boot** — `63108aa90` made the server refuse to start with local storage under `NODE_ENV=production`, on the grounds that the container filesystem is destroyed on the next restart and uploads go with it. The scaffold's compose file sets `NODE_ENV=production` and *does* mount a durable named volume at the storage path, which is the exact case the check tells you to acknowledge with `FORCE_LOCAL_STORAGE=true` — but the template never set it. So `docker compose up`, the "recommended for production" path in every scaffolded README, crash-looped the backend with `Failed to start server`. The flag is now set in the template, next to the volume that justifies it. This was invisible for days because the e2e step that would have caught it sits behind a step that was already failing.

- **`init --database-url` shipped a compose stack with the password `changeme`** — `DATABASE_PASSWORD` was only written on the branch that generates a local database. Supply your own `--database-url` and it was omitted entirely, so `docker-compose.yml`, which interpolates `${DATABASE_PASSWORD:-changeme}` into both `POSTGRES_PASSWORD` and the backend's connection string, fell back to the literal default — on a `db` service that publishes a host port. The password is now generated in both cases; the supplied URL is untouched.

- **`rebase init` told you things that were not true** — the next steps were assembled from the flags you passed rather than from what actually happened. `--introspect` without `--install` printed "Skipping introspection because dependencies were not installed" and then, four lines later, "Database has been introspected & collections generated!" — the second line branched on the flag, never on the outcome. It now reports what really ran, and when introspection did not, it prints the `schema introspect` and `schema generate` commands that finish the job. In the same pass: the `cd` hint used the project's basename, so `init apps/my-app` said `cd my-app` — a directory that does not exist from where you are standing — and `init .` told you to `cd` into a directory you were already in; both now use the path you typed, and in-place scaffolds print no `cd` at all.

- **`rebase init --help` printed the wrong help** — `init` was missing from the dispatcher's namespaced-command list, so `--help` fell through to the global command index. `--template`, `--flavor`, `--yes`, `--database-url`, `--introspect`, `--project` and `--setup-key` were documented in exactly one place: the error you get for running init on a non-TTY. You had to trigger a failure to discover the flags. `init` now has its own help, and a test fails if a flag the parser accepts goes undocumented.

- **`--git` left the work half-done** — it ran `git init` and stopped, leaving every scaffolded file untracked on whatever `init.defaultBranch` happened to be, so the first `git diff` was noise and the first commit was the user's problem. It now lands an initial commit on `main`, authored by the user's own git identity where one is configured. `.gitignore` is in place before the commit, so `.env` and its generated secrets are never in it while `.env.example` is.

- **`--template` was accepted and discarded for the baas flavor** — baas has no collections, so a preset has nothing to swap; the flag was taken silently and the scaffold came out identical either way. It now says the preset is being ignored, and the help spells out that `--template` does not apply to baas.

- **OAuth token substitution allowed account takeover** — the Google path resolved client-supplied access tokens through the userinfo endpoint, which does not check `aud`, so any valid Google access token — including one an attacker obtained for their own OAuth client — was accepted and resolved to whatever account it belonged to. The audience is now verified against our `clientId` via tokeninfo before the identity is trusted, and ID-token paths read the real `email_verified` claim instead of hardcoding it. On Microsoft, `emailVerified` is derived from a provider-provisioned `mail` mailbox rather than asserted `true`, so a bare userPrincipalName can no longer auto-link an OAuth login onto a pre-existing password account. CORS, rate limiting and vector SQL were hardened in the same pass.

- **`/admin/bootstrap` was a land-grab** — the self-promotion endpoint only refused to run once an admin already existed. In a "users exist but no admin" state — reachable via concurrent first-registrations, or by deleting the first user — any authenticated user could seize the initial admin role. It is now gated to the earliest-registered user, deterministically tie-broken by id, with security-audit logs on both the denial and the success.

- **The API served password hashes** — `/api/data/users` returned every user their own `passwordHash` and `emailVerificationToken`. RLS scoped the row to the caller so this was not a cross-user leak, but a salted hash is offline-crackable and a verification token can be replayed. The users collection only marked them `ui.hideFromCollection`, which stops the admin panel from *rendering* a field and leaves it in the JSON.

- **The data API was rate-limited by API key only** — the limiter returned early for any request that carried no API key, so JWT and anonymous traffic — most of what a BaaS serves — was unbounded, and it was mounted only `if (apiKeyStore)`, making its presence depend on a feature it does not need. Every request now falls in exactly one bucket, resolved most-specific first: API key by id, signed-in user by uid, everyone else by IP.

- **Storage had no effective upload size cap** — the `bodyLimit` was registered *after* the routes, so Hono never ran it. A wrapper router now applies it in front. Storage also accepts API keys under a new `storage` permission namespace (read/write/delete), where `rk_` tokens previously 401'd as malformed JWTs.

- **API keys and admin surfaces** — the builtin auth adapter no longer authenticates `?token=` query params, which could leak full JWTs and the service key into access logs (the non-adapter middleware already refused them). Admin API keys now genuinely reach admin surfaces, with `rk_` pre-auth running in front of `/admin/*`, cron, backups and logs.

- **A purpose-scoped token is not an access token** — every storage token is signed with the same secret, so a signature says the server minted it, not what it is for. A download token travels in URLs and grants one file; it was rejected as a session only because it happens to carry no id, and nothing stopped a future one from carrying one. `verifyAccessToken` now refuses any token with a `purpose` claim outright. No live hole was found — this is defence in depth.

- **Superseded RLS policies survived `db push`** — a generated policy is named after a hash of its own semantics, so editing a `securityRule` writes a policy under a new name, and `policies.sql` only DROPs the names it is about to CREATE. Because Postgres ORs PERMISSIVE policies together, a superseded `USING (auth.uid() IS NOT NULL)` kept granting everything no matter how tight its replacement was — and push reported success throughout, so tightening a rule looked like it had worked and hadn't.

- **A pooled connection could leak its RLS GUCs** — when the client-side `query_timeout` fires inside a drizzle transaction, pg rejects the promise but keeps the connection and splices queued queries, so drizzle's ROLLBACK times out without ever reaching the wire and the `finally` releases the client back to the pool with no error. pg-pool then re-pooled it mid-transaction with the `app.*` GUCs still set, and the next checkout ran inside the zombie transaction under someone else's auth context.

- **Relation batching guessed on composite keys** — batching matched parents on `parentPks[0]`, so two rows of a composite-keyed collection differing only past the first column collapsed together: `tenant_id IN (1, 1)` collected every row of tenant 1 and filed them all under `"1"`, last write winning. Each booking of a tenant was handed its neighbour's relations, and nothing errored. The WHERE is now an OR over whole keys, or it refuses rather than guess.

- **Ephemeral local storage is refused in production** — `STORAGE_TYPE` defaults to `local`, which on a managed platform is the pod's ephemeral filesystem: every uploaded file destroyed on the next restart, with no error at write time, no error at read time, and a warning nobody reads until the data is gone. Boot now fails instead. `FORCE_LOCAL_STORAGE=true` remains the opt-in for a deployment with a real volume mounted. GCS env vars were added alongside, local bucket defaulting made symmetric, and list paging fixed.

- **Subscriptions could hang forever** — a collection view could sit on its loading spinner indefinitely with no error until reload. `subscribe_collection` / `subscribe_one` are in the `expectsResponse = false` set, so unlike ordinary requests they had no timeout, and a subscribe that got no reply left the subscription pending forever; a subscribe whose send rejected — a token refresh losing a cold-load race — failed the same silent way.

- **Channel messages lost their envelope** — channel payloads are now wrapped consistently, and the realtime socket connects lazily rather than in the constructor, so constructing a client no longer opens a connection.

- **Realtime told subscribers the wrong name for their rows**, and a save now names the row it saved rather than deriving an address the caller never asked for.

- **The doctor reported drift on a clean project**, and the schema tooling now says which RLS policies you did not write and how to drop them.

- **`rebase init` failed when installed from npm**, hung on a non-interactive terminal, and defaulted to the wrong package manager; `pnpm start` now filters the backend workspace by path, storage subcommands dispatch correctly, and a stale build warns instead of behaving mysteriously. macOS deploy contexts are handled — AppleDouble tar entries suppressed, dotfiles skipped in directory loaders, and the 100MB upload cap pre-checked.

- **Postgres errors surfaced as opaque 500s** — the underlying error is now reported, and a legacy auth schema is reconciled on boot.

- **Admin: a navigated entity is addressed by the path it was fetched by**, field bindings in `DEFAULT_FIELD_CONFIGS` are read lazily, and the two `WhereFilterOp` definitions now fail loudly when they drift instead of silently disagreeing.

- **Studio: the views that were lying** — an RLS editor crash, dark-mode controls, a revoke confirmation, and the policies those views disowned.

- **BaaS mode served every table to every authenticated user** — it introspects all tables, `ensureAppRole` grants `rebase_user` `SELECT/INSERT/UPDATE/DELETE` across the schema, and nothing enabled RLS, because that only happens via `db push`, which BaaS never runs. Pointing Rebase at an ordinary database therefore exposed every row of every table. A table with RLS disabled has no authorization model, so it is now excluded and logged with the `ALTER TABLE` needed to protect it. Tables with RLS enabled but no policies are served and return nothing — legal, and indistinguishable from an empty table, so that is called out at boot too.

- **Security rules targeting an unusable Postgres role now fail the boot** — `pgRoles` sets a policy's `TO` clause, so naming a role requests never run as means the policy never applies and RLS filters every row. The table reads as empty, which is indistinguishable from having no data, so the mistake shipped. Boot now throws, naming the collection and role, with a specific hint for Supabase's `authenticated`/`anon`/`service_role`.

- **The demo app's collections were empty** — every collection but `users` granted `pgRoles: ["authenticated"]`, a Supabase role name, while requests run as `rebase_user`. RLS filtered every row; `authors` and `posts` granted `TO public`, which is why they were the only two showing data. They now use the documented API (`select: public`, writes `admin`), the same shape `rebase init` scaffolds. The generated `drizzle/policies.sql` carried the same policies and is regenerated — it is what `db push` applies, so the config alone would have changed nothing.

- **The service key did not authenticate websockets** — the HTTP middleware compares it before JWT verification; the websocket path went straight to `extractUserFromToken`, and a static secret can only ever fail that. Any SDK client using a service key (scripts, cron, server-to-server) got `jwt malformed` on every connect and silently received no realtime events.

- **`collection-file → UI package` imports no longer drag React into the backend** — `users.ts` imported `resetPasswordAction` from `@rebasepro/cms`, so the Node backend loaded the entire admin bundle at boot. The action is already injected frontend-side for `auth` collections, making the import redundant. `@rebasepro/cms` is also gone from the config and backend templates, and `@rebasepro/core`/`ui` from `@rebasepro/auth` — none were imported.

### Testing

- **CI had been red for three days on a bug in the test, not the product** — every commit since 2026-07-17 failed the browser e2e with `Local API request failed with status: 401`, and Publish kept shipping canaries past it. The suite writes `REBASE_SERVICE_KEY` into the scaffolded `.env` with a regex, and the regex put `\s*` before the variable name — where `\s` matches newlines. While the CLI shipped that line commented out, the `#` anchored the match and it worked. `259ef0b7a` made the CLI write the key uncommented, so the leftmost match began at the end of the *previous* line and swallowed the newline, welding the assignment onto the comment above it. dotenv then read the whole line as a comment, the server auto-generated its own key, and every service-key request was rejected — a failure three layers away from its cause. The writer is line-based now, and asserts the variable landed on a line of its own instead of trusting the write.

- **The e2e suites refuse to run when their port is taken** — both suites pin a port (3099, 3098) and assert against it, but `rebase dev` falls back to another port when one is busy, so the browser step drove whatever else happened to be listening. A dev server left running in a git worktree held 3099 and silently served the entire local run — including a database that had already been torn down, which is a convincing way to produce failures that have nothing to do with your change. Startup now stops with the squatting pid and command named, and the port is overridable via `E2E_BACKEND_PORT` / `E2E_BAAS_BACKEND_PORT`.

- **Every `init` template is now driven to a persisted row** — the e2e suite scaffolded one project, in one shape, and checked that tables and indexes existed. A template could scaffold, typecheck and migrate cleanly while being unable to store anything, and nothing would say so. `test/e2e/templates.test.ts` takes all six preset × flavor combinations through the path a user actually walks: scaffold, install, bootstrap a real PostgreSQL database, boot the backend, register, log in, write over the HTTP data API, read back, and confirm the row in Postgres — because an API that echoes what it was sent passes every assertion short of the last one. The baas cases additionally assert the security posture the flavor is built on: a table with no row-level security must **not** be served, the boot log must name it and say how to fix it, and once a policy exists, `auth.uid()` must hide one user's rows from another.

- **`rebase init`'s output is under test** — `test/e2e/init-ux.test.ts` pins the reporting defects above so they cannot return: next steps that contradict what happened, a `cd` that points at a directory that does not exist, undocumented flags, an uncommitted `--git` tree, and a silently discarded `--template`. It drives the real binary and installs nothing, so it runs in about three seconds.

- **`test/` is typechecked** — the build config only ever included `src`, so the e2e suites could drift out of sync with the code they drive and fail only at runtime, minutes into a docker-backed run. `tsconfig.test.json` (`pnpm typecheck:test`) covers them; it caught a missing import while this was being written.

- **A stale `dist/` fails loudly** — the e2e suites link the workspace packages and load their build output, so an unbuilt tree silently tests yesterday's code. This surfaced as `Permission denied on "posts"` — a failure with no visible connection to its cause. The suite now checks that every linked package's `dist/` is newer than its sources and, if not, names the packages and the build command instead of running.

## [0.9.0] - 2026-07-13

### Breaking

- **Collection & callback API renames** — several collection-related types took role-based names, the callback parameters flattened to plain rows, and the WebSocket protocol dropped the redundant `ENTITY` from its message names. The `Entity` type itself is unchanged. This is a search-and-replace-level migration for consumers — no behavioral changes.

  **Types (`@rebasepro/types`)**

  | Old Name | New Name |
  |----------|----------|
  | `EntityCollection<M>` | `CollectionConfig<M>` |
  | `EntityCallbacks<M>` | `CollectionCallbacks<M>` |
  | `EntityView` | `EntityCustomView` |
  | `EntityCollectionView` | `DataCollectionView` |

  **Callback API (`CollectionCallbacks`)** — beyond the rename, the parameter shapes changed:

  | Old Param | New Param | Notes |
  |-----------|-----------|-------|
  | `entity` (in `afterRead`) | `row` | Now a flat `Record<string, unknown>`, not an `Entity<M>` wrapper |
  | `entityId` (in save/delete) | `id` | `string \| number` |
  | `previousEntity` | `previousValues` | `Partial<EntityValues<M>>` |
  | `afterCreate` / `afterUpdate` | `afterSave` | Use `status: "new" \| "existing"` to distinguish |

  Migration example:
  ```diff
  -import type { EntityCallbacks } from "@rebasepro/types";
  -const callbacks: EntityCallbacks = {
  -    afterRead: ({ entity }) => {
  -        return { ...entity, values: { ...entity.values, email: "***" } };
  -    },
  -    afterCreate: ({ entity }) => { /* ... */ },
  -    beforeDelete: ({ entityId }) => { /* ... */ },
  +import type { CollectionCallbacks } from "@rebasepro/types";
  +const callbacks: CollectionCallbacks = {
  +    afterRead: ({ row }) => {
  +        return { ...row, email: "***" };
  +    },
  +    afterSave: ({ id, status }) => { if (status === "new") { /* ... */ } },
  +    beforeDelete: ({ id }) => { /* ... */ },
  };
  ```

  **WebSocket wire protocol**

  | Old Message Type | New Message Type |
  |-----------------|-----------------|
  | `FETCH_ENTITY` | `FETCH_ONE` |
  | `SAVE_ENTITY` | `SAVE` |
  | `DELETE_ENTITY` | `DELETE` |
  | `COUNT_ENTITIES` | `COUNT` |
  | `subscribe_entity` | `subscribe_one` |
  | `collection_entity_patch` | `collection_patch` |

- **Unified `<Rebase>` data props** — Removed the `data` and `driver` props. There are now exactly two ways to provide data: `client` (server transport) and `dataSources` (everything else). A `dataSources` entry keyed `"(default)"` with a `driver` replaces `client.data` as the default source — this is how a fully client-side app (e.g. Firestore-only via `RebaseFirebaseApp`) is wired. Migration: `driver={x}` → `dataSources={[{ key: "(default)", engine: "firestore", driver: x }]}`; `data={x}` had no known users (custom backends implement `DataDriver`, now the documented integration SPI).
- **Deterministic default-source resolution** — The default data source resolves as: `"(default)"`-keyed entry with driver → `client.data` → the sole registered source. Several sources without an explicit default now throw instead of silently picking the first object entry (order-dependent).

- **Side-panel / Edit-view / Collection-view component rename** — Renames mechanically-generated "Entity" component names to descriptive, role-based names. Components bound to Rebase core data use the `Binding` suffix. This is a search-and-replace migration — no behavioral changes.

  **Types (`@rebasepro/types`)**

  | Old Name | New Name |
  |----------|----------|
  | `EntitySidePanelProps` | `SidePanelBindingProps` |
  | `sideEntityController` (on `RebaseContext`) | `sidePanelController` |
  | `sideEntityController` (on `EntityActionClickProps`) | `sidePanelController` |
  | `"Entity.FormActions"` (override key) | `"EditView.FormActions"` |
  | `"Entity.DetailView"` (override key) | `"DetailView"` |
  | `"Entity.Preview"` (override key) | `"RecordPreview"` |

  **Components (`@rebasepro/cms`)**

  | Old Name | New Name |
  |----------|----------|
  | `SideEntityProvider` | `SidePanelProvider` |
  | `EntitySidePanel` | `SidePanelBinding` |
  | `EntityEditView` | `EditViewBinding` |
  | `EntityEditViewFormActions` | `EditFormActions` |
  | `EntityDetailView` | `DetailViewBinding` |
  | `EntityView` | `RecordViewBinding` |
  | `EntityPreview` | `RecordPreviewBinding` |
  | `EntityJsonPreview` | `JsonPreviewBinding` |
  | `DataCollectionView` | `CollectionViewBinding` |
  | `EntityCollectionBoardView` | `CollectionBoardViewBinding` |
  | `EntityCollectionCardView` | `CollectionCardViewBinding` |
  | `EntityCollectionListView` | `CollectionListViewBinding` |
  | `DataCollectionViewActions` | `CollectionViewActions` |
  | `DataCollectionViewStartActions` | `CollectionViewStartActions` |
  | `DataCollectionTable` | `CollectionTableBinding` |
  | `EntityCollectionRowActions` | `CollectionRowActions` |
  | `EntitySelectionTable` | `SelectionTableBinding` |
  | `EntityBoardCard` | `BoardCardBinding` |
  | `EntityCard` | `RecordCardBinding` |
  | `useEntityPreviewSlots` | `usePreviewSlots` |
  | `SideEntityControllerContext` | `SidePanelControllerContext` |

  **Bridge key (`@rebasepro/core`)**

  | Old Key | New Key |
  |---------|---------|
  | `"sideEntityController"` | `"sidePanelController"` |
  | `sideEntityController` (on `StudioBridge`) | `sidePanelController` |

- **Client split into server/browser variants** — `RebaseClient` is now split so the RLS-bypassing accessor is explicit: use `rebase.dataAsAdmin` (server-only) for admin-scoped, RLS-bypassing access, and `rebase.data` for user-scoped access. The public API surface was curated to hide internal plumbing.

- **`update`/`delete` throw on not-found** — SDK `update()` and `delete()` now throw when the target row does not exist, instead of silently returning `undefined`.

- **`deleteAll` is now internal** — removed from the public data accessors.

- **Scaffold defaults to cookie auth** — new projects store the refresh token in an httpOnly cookie (`authFlowMode: "cookie"`) by default.

- **`AdminUser.provider` → `providerId`** — renamed to match the canonical `User` type.

### Features & Improvements

- **Membership / relational RLS predicate (`policy.existsIn`)** — a first-class access predicate for scoping reads/writes by membership in a related collection (e.g. "only rows whose team the caller belongs to"). Compiles to a single correlated `EXISTS` subquery — no per-row `afterRead` lookups. Adds `policy.existsIn({ collection, where })` and the `policy.outerField(name)` operand for correlating the subquery to the outer row.

- **Built-in email → user lookup for invites** — opt-in `auth.allowUserLookup` exposes an authenticated `POST /auth/find-user` and a client `rebase.auth.findUserByEmail(email)` that returns a minimal public profile (`uid`, `displayName`, `photoURL` only). Removes the hand-rolled `dataAsAdmin` server function that invite flows previously required. Off by default (enables user enumeration by signed-in users).

- **Mount the admin under a path prefix** — `RebaseCMS` accepts a `basePath` so the admin can live under a sub-path route (e.g. `/admin`) without the collection data-grid hanging on URL↔collection resolution.

- **Filter operators** — LIKE family (`like`, `ilike`, etc.) and null checks, with engine-aware, customizable filter fields.

- **Scoped storage tokens** — storage access is now governed by scoped, time-limited tokens, with a documented public-files + scoped-token URL model.

- **Uniform server error envelope** — server error responses are routed through a central handler for a consistent `{ error: { message, code, details? } }` wire shape.

- **Inferred data-source transport** — `DataSourceDefinition.transport` is now optional: entries with a client-side `driver` default to `"direct"`, entries without to `"server"`. A `"(default)"`-keyed entry without a driver can be used to declare the default source's engine/capabilities while the client keeps serving the data.

- **`installShutdownHandlers`** — New `@rebasepro/server-core` helper that encapsulates graceful shutdown: drains via `backend.shutdown()`, runs `onCleanup` (e.g. closing your database pool), guards against repeated signals, and force-exits if shutdown hangs. Replaces the hand-rolled ~40-line shutdown block in the backend templates — the CLI template previously lacked the re-entry guard and force-exit timer entirely.

- **Honest Realtime Meta** — Added `FindResponse.meta.estimated` flag on realtime first-paint updates. When `listen()` emits its immediate heuristic metadata, the emission now carries `estimated: true`. Redundant second emissions are skipped when the authoritative count matches the heuristic, and count failures no longer silently pretend to be authoritative — the `estimated` flag remains as the signal.

### Fixes

- **Concurrency-safe refresh-token rotation** — token rotation now uses an atomic `INSERT … ON CONFLICT DO UPDATE` instead of a DELETE-then-INSERT. Concurrent `/refresh` calls (which cookie-mode boot can fire at once) previously raced into a `unique_device_session` violation and returned 500, breaking the session. The client also single-flights concurrent refreshes.

- **Cookie session restore** — `/auth/refresh` now returns the user object, and the client restores the user (falling back to `/me`) instead of leaving a blank `uid`. A cold start restored from an httpOnly cookie alone no longer yields an empty user.

- **Resilient auto-refresh** — a transient refresh failure (network blip, backend restart, 5xx) now retries with exponential backoff instead of immediately signing the user out; only a genuine auth failure (401/403/invalid/expired token) or exhausted retries signs out.

- **`server-postgresql` ships `src/`** — the driver package now packs `src` alongside `dist`, fixing `✗ Could not find CLI entry point for @rebasepro/server-postgresql` for `rebase db push` / `schema generate` in published/packed installs (the CLI runs `src/cli.ts` via tsx; no `dist/cli.js` is built).

- **Malformed request bodies** — the API now rejects malformed JSON bodies with `400` and tightens the public-path check.

- **Auth collection callbacks warning** — the server warns at startup when an auth collection defines `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`, since auth-driven user creation bypasses the collection save pipeline (use the `afterUserCreate` auth hook instead).

- **CLI DX** — friendly diagnostics for "SSL is not enabled on the server" (suggests `sslmode=disable`) and for dependency-drop failures that leave a schema half-migrated; a clear warning when `--collections` resolves to a missing path; and `rebase dev` now surfaces when it overrides the project's `.env` PORT / `VITE_API_URL` with its derived per-project port.

- **Scaffold hardening** — the frontend Vite config ships `resolve.dedupe` for React / React Router so a locally `link:`ed Rebase checkout doesn't load duplicate React copies (which broke the admin's data router); `.env.example` documents `sslmode=disable`.

## [0.8.0] - 2026-07-01

### Changed

- **Strict collection accessors** — When a `collections` dictionary is passed to `createRebaseClient`, unknown property accessors on `client.data` now throw immediately with a nearest-match suggestion instead of silently producing a 404 later. Use `data.collection("slug")` for dynamic slugs.

### Cleanup

- **Removed** — Six unused FireCMS-legacy builder identity functions (`buildProperties`, `buildPropertiesOrBuilder`, `buildEnum`, `buildEnumValueConfig`, `buildEntityCallbacks`, `buildAdditionalFieldDelegate`). Migration: remove the wrapper call — they were identity functions, so the object literal is the same value.
- **Deprecated** — `buildCollection` / `buildProperty` in favor of `defineCollection`. Both are marked `@deprecated` and will be removed before 1.0.
- **Removed** — Unused `<Rebase apiKey>` prop (it was never consumed by the component).
- **Fixed** — Duplicated sentences in `propertiesOrder` JSDoc; rewrote `subcollection:` description to cover both Firestore and Postgres.

### Features & Improvements

- **Unified Policy & Filter Engine** — Replaced ad-hoc permission checks with a centralized `evaluatePolicy` system and `Policy` type. This system translates high-level security rules into both frontend conditions (for UI gating) and backend-specific filters (Postgres RLS, Firestore security rules). Includes `policyToPostgres` and `securityRuleToConditions` utilities, ensuring the admin UI matches database enforcement by construction.
- **`defineCron` authoring helper** — Typed identity wrapper for cron job files (parity with `defineFunction`). Demo app now ships a working cron job (`refresh-product-stats`).
- **Multi-Backend Storage Sources** — Introduced a first-class `StorageSource` system allowing a single project to use multiple storage backends (S3, GCS, Local, Firebase) simultaneously. Added `GCSStorageController` for native Google Cloud Storage support with TUS resumable uploads. Managed via `StorageSourcesContext` and `StorageRegistry`, enabling complex multi-cloud storage architectures.
- **Custom Backend Functions** — New `defineFunction()` API for creating type-safe, discoverable backend endpoints. Functions are automatically mounted, type-checked, and can be invoked directly from the client SDK with full type safety. Includes a new `invoke_function` MCP tool for interacting with custom endpoints from AI agents.
- **Property Schema Consolidation** — Refactored the property system to unify how database-level schemas, UI configurations, and validation rules are defined. Removed overlapping property types and introduced a more robust `PropertyConfig` system that handles complex relations and references consistently across all data drivers (Postgres, MongoDB, Firestore).
- **Editable UI Table** — Significantly enhanced `VirtualTable` with native editable cells (`VirtualTableInput`, `VirtualTableSelect`, `VirtualTableNumberInput`, `VirtualTableDateField`). Added a new `SelectionStore` and `SelectionContext` for robust multi-row selection, keyboard navigation, and batch operations within the CMS.
- **Expanded Agent Skills** — Massive overhaul of the Rebase AI coding skills. Added new specialized skills for `rebase-custom-functions`, `rebase-ui-components`, and `rebase-storage`. Expanded existing skills for auth, security, and SDK with deep architectural context, common patterns, and safety rules.
- **Public API Refinement** — Cleaned up the public API surface of `@rebasepro/client` and `@rebasepro/core`, simplifying integration into existing applications. Consolidated data controllers, improved type inference, and refined the `Rebase` component props for better developer experience.
- **NPM Publishing Safeguards** — Added `validate-no-workspace-protocol.sh` and `check-packages.sh` scripts to the release pipeline. These prevent publishing packages with `workspace:` dependencies or inconsistent versions, ensuring library consumers always get stable, resolved dependencies.

### Fixes

- **Dependency Management** — Resolved workspace-wide dependency conflicts and fixed "workspace protocol" leakage in built artifacts that caused installation failures in certain environments.
- **Lifecycle Interception** — Unified lifecycle interception systems across different data drivers. This ensures consistent execution of `beforeSave`, `afterSave`, `beforeDelete`, and `afterDelete` hooks regardless of whether the collection is backed by Postgres, MongoDB, or Firestore.
- **OAuth Configuration** — Refactored and stabilized OAuth provider configuration. Resolved inconsistencies in how environment variables were parsed for Discord, Microsoft, and LinkedIn providers.
- **MongoDB & Firestore Parity** — Improved collection support for MongoDB and Firestore, bringing their relation/reference capabilities and storage integration closer to parity with the PostgreSQL driver.
- **Any Type Audit** — Conducted a comprehensive audit of `any` types across the core packages, replacing them with strict types or narrowing guards (e.g., `isSQLAdmin`) to improve overall codebase robustness and prevent runtime errors.

### Testing

- **Security Policy Tests** — New test suites for `evaluatePolicy`, `policyToPostgres`, and `securityRuleToConditions` covering Kleene logic and complex nested expressions.
- **Storage Tests** — Added comprehensive integration tests for `GCSStorageController`, multi-storage routing, and TUS upload flows.
- **UI Tests** — New unit and integration tests for `VirtualTable` editable fields, selection logic, and keyboard accessibility.
- **Schema Gates** — Added `collection_registry_property_gates` tests to validate property resolution and permission-based visibility gating at the registry level.

---

## [0.7.0] - 2026-06-29

### Features & Improvements

- **Multi-Datasource Architecture** — Introduced a first-class `DataSourceDefinition` / `DataSourceCapabilities` system that lets a single Rebase instance route collections to different database engines (Postgres, Firestore, MongoDB, or custom drivers). Collections declare a `dataSource` key, and the frontend router, backend driver registry, and collection editor all resolve capabilities from the same definition. Includes `resolveDataSource()`, `createDataSourceRegistry()`, `registerDataSourceCapabilities()`, and a new `DataSourcesContext` React provider. The editor automatically shows/hides tabs (Relations, Subcollections, RLS) and property types based on each source's declared feature flags.
- **Headless Collection Views** — Extracted reusable, data-agnostic collection view components (`CollectionView`, `CollectionTableView`, `CollectionCardView`, `CollectionListView`, `CollectionKanbanView`) into `@rebasepro/ui`. These headless components accept a generic `CollectionDataController<T>` — no coupling to entities or the CMS data layer — making them usable in custom pages, standalone apps, and third-party integrations. Includes a `CollectionViewToolbar` with view-mode toggle, search, filters, and pagination.
- **Headless Entity Forms** — Decoupled `EntityForm`, `EntityFormActions`, and `EntityFormBinding` from the admin package internals. Forms now accept pluggable field bindings and layout props, enabling standalone entity editing outside the CMS shell. Added `PopupFormField` for inline editing and extended form layout controls.
- **Auth Hooks Expansion** — Significantly expanded the `AuthHooks` interface with new lifecycle hooks: `beforeLogin`, `afterLogout`, `onPasswordReset`, `beforeUserDelete`, `afterUserDelete`, `onAdminCreateUser`, `onAdminResetPassword`, and `transformAuthResponse`. The `transformAuthResponse` hook lets developers inject external tokens (e.g. Firebase Custom Tokens) or project-specific metadata into every auth response. Added `AuthMethod` type covering all authentication methods.
- **Custom Auth Adapter** — New `createCustomAuthAdapter()` factory for plugging existing auth systems into Rebase with minimal config. Only `verifyRequest` is required — capabilities, user lookup, and registration are all optional overrides.
- **Magic Link Authentication** — Added passwordless magic-link login flow with `mountMagicLinkRoutes()`. Generates secure tokens with 15-minute expiry, sends branded emails via the configured email provider, and integrates with the `transformAuthResponse` hook and rate limiting.
- **API Keys** — Full API key management with collection-level permission scoping (`read` / `write` / `delete`), admin keys, rate limiting, expiration, and revocation. Includes server-side middleware (`api-key-middleware.ts`), a Postgres-backed key store, a Studio management UI (`ApiKeysView`), a CLI command (`rebase api-keys list|create|revoke`), and a client SDK module (`@rebasepro/client` `api-keys.ts`). Keys are stored with hashed secrets; the full key is only returned on creation.
- **Atlas Migrations (replaces Drizzle Kit)** — Replaced `drizzle-kit` with [Atlas](https://atlasgo.io/) for schema migrations. Added `generate-postgres-ddl-logic.ts` that produces raw SQL DDL (with enums, RLS policies, and indexes) from collection definitions. Migrations are now version-controlled SQL files under `drizzle/migrations/` with an `atlas.sum` integrity file. CLI `rebase db` commands updated accordingly.
- **Improved RLS Editor** — Overhauled the Studio RLS editor with better policy visualization, shared `table-classification.ts` module (classifying tables as `rebase-internal`, `junction`, or `user`), and improved default auth policies generation.
- **Headless Collection Editor** — Made the collection schema editor headless and decoupled from the admin shell. Extracted serializable types and utilities, allowing the editor to be embedded in custom Studio views or third-party tools.
- **Security Audit Logging** — Added structured security audit logging across all OAuth providers (Apple, Google, GitHub, GitLab, Facebook, Discord, Microsoft, LinkedIn, Slack, Spotify, Twitter, Bitbucket). Improved `ECONNREFUSED` error handling with actionable diagnostics, and fixed `chalk` CJS compatibility.
- **Landing Page & Demos** — New layered architecture diagram on the developers page, improved CRM dashboard demo (`CrmDashboardDemo`), and fixed NEAT gradient mismatches across all landing pages.
- **CLI Skills Enhancements** — Extended the `rebase skills` command with updated skill definitions for auth, security, collections, realtime, and SDK documentation.

### Fixes

- **Security Hardening** — Parameterized queries in API key store and cron store to prevent SQL injection. Hardened WebSocket connection safeguards, strengthened `EntityPersistService` input validation, and added `.dockerignore` / `.gitignore` rules to prevent secrets leakage. Sanitized environment variable handling in production.
- **Repo Cleanup** — Reorganized internal documentation (`BREAKING_CHANGES_POSTGRES.md`, `PUBLISHING.md`, `REBASE_ARCHITECTURE.md`) into `.github/internal/`. Cleaned up legacy `formex` `.yarn/cache` artifacts, updated `CONTRIBUTING.md`, `README.md`, and `AGENT.md`. Deprecated export documentation moved to `docs/DEPRECATED_EXPORTS.md`.
- **UI & Ergonomics** — Multiple ergonomic fixes across the admin panel: improved Sheet/Dialog focus management, refined `DrawerNavigationGroup` and breadcrumb context, stabilized navigation resolution hooks, and cleaned up `BreadcrumbsContext` and `CollectionRegistryContext`.

### Testing

- **Multi-Datasource Tests** — New test suites for `buildRoutedRebaseData`, `resolveDataSource`, `collection_registry_datasource`, `routing_integration`, `multi-datasource-routing`, and `routed-realtime-service`.
- **Auth Tests** — Added tests for `custom-auth-adapter`, `transform-auth-response`, and extended `auth-routes` tests covering magic links and lifecycle hooks.
- **Postgres Tests** — New `auth-default-policies` tests, extended `cli-helpers-extended` tests, `connection` tests, `databasePoolManager` tests, `doctor-extended` tests, and `generate-postgres-ddl` tests.
- **UI Tests** — Added `views.test.tsx` covering the new headless `CollectionView`, `ListView`, `CardView`, and `TableView` components.
- **E2E Tests** — Updated Playwright E2E tests for collections, studio features, and the new API keys flow.

---

## [0.6.1] - 2026-06-23

### Fixes

- **CLI Init Crash** — Fixed `rebase init` crashing with `UnknownPromptTypeError: Prompt type "list" is not registered` after entering the project name. The `inquirer` v14 dependency renamed the `"list"` prompt type to `"select"`, breaking the interactive flow. The non-interactive (`--yes`) path was unaffected, which is why E2E tests did not catch it.

### Testing

- **Interactive Prompt Validation** — Extracted prompt question building into a testable `buildInitQuestions()` function and added unit tests that validate all prompt `type` values against the installed `inquirer` version's registered types. This prevents prompt-type regressions from shipping silently when `inquirer` is upgraded.

---

## [0.6.0] - 2026-06-18


### Features & Improvements

- **Schema Drift & Previews** — Added a schema drift notification banner to Starlight and Studio home page, and improved previews for collection reference/relation properties.
- **Rebase Client & Types** — Consolidated RebaseClient context hooks, aligned types in `@rebasepro/client` and reconciled data controllers for cleaner imports.
- **Observability** — Integrated structured request-logger middleware and an `X-Request-ID` correlation header to trace client requests across core backend services.
- **Code Quality & Testing** — Added robust unit/integration tests across `@rebasepro/ui` components, StudioHomePage, and data plugins. Cleaned up Vite configuration targets, and strengthened type-safety checks.
- **Multi-Factor Authentication (MFA)** — Full TOTP-based MFA implementation with enroll, verify, challenge, and unenroll flows. Includes recovery codes, `aal1`→`aal2` token upgrade on challenge verification, and an `onMfaVerified` auth hook. Auth routes extracted into dedicated `mfa-routes.ts` and `session-routes.ts` modules.
- **Component Override System** — New `ComponentOverrideContext` and `useComponentOverride` hook allow developers to replace built-in UI components at both the global (`<Rebase components={…}>`) and per-collection level, with resolution priority: collection → global → default.
- **CLI Skills Command** — `rebase skills` auto-detects and installs Rebase AI coding skills for Cursor, Claude Code, Windsurf, and Gemini/Antigravity, writing the correct file format (`.mdc`, `SKILL.md`, `.md`) to each agent's rules directory.
- **MCP Server Expansion** — Added storage tools (`storage_list_objects`, `storage_delete_object`, `storage_get_metadata`), cron tools (`cron_list_jobs`, `cron_get_job`, `cron_trigger_job`, `cron_get_job_logs`, `cron_toggle_job`), and `invoke_function` for calling custom backend functions. Automatic package-manager detection for dev server commands.
- **Server Init Refactor** — Decomposed the monolithic `init.ts` into focused modules: `init/middlewares.ts` (request ID, body limits, CSRF, CORS warnings, logging), `init/health.ts` (health-check endpoint with DB latency), `init/shutdown.ts` (graceful teardown ordering), `init/storage.ts` (multi-backend storage bootstrap), and `init/docs.ts` (OpenAPI serving).
- **Entity Form Improvements** — Enhanced `EntityDetailView` and `EntityEditView` with better field-binding support, added `PopupFormField` inline editing, extended `EntityForm` with additional layout controls, and added `replace` option to `navigateToEntity`.
- **Drizzle Schema Generation** — Improved generated schema logic with richer column-type support and cleaned up `EntityPersistService` by extracting reusable persist utilities.
- **Documentation & Website** — Added `llms.txt`, updated `sitemap.md`, expanded backend auth, realtime, collections, SDK, and component-overrides documentation. Agent skills updated for auth, collections, realtime, SDK, and Studio.


### Fixes

- **Auth Refactoring** — Resolved auth issues and cleaned up redundant user management hooks, admin routes, and legacy decorators.
- **Studio & UI Components** — Corrected icon sizing bugs in navigation cards, restored and stabilized SQLEditor panel logic, improved tab scroll styles, and updated third-party dependencies across all packages.
- **Relation Preview Rendering** — Fixed broken relation previews in list views by correcting `useEntityPreviewSlots` resolution and adding proper hydration logic in `RelationPreview` and `PropertyPreview` components.
- **Security Hardening** — Hardened WebSocket client with connection-level safeguards, added input validation to GraphQL and REST generators, tightened API key store and cron store queries, improved image-transform and SPA-serve path handling, and added branch-service authorization checks.
- **PostgreSQL Error Handling** — New `pg-error-utils.ts` module extracts native PG errors from Drizzle's cause chain, translates 5-character SQLSTATE codes into user-friendly messages, and surfaces constraint, column, and table metadata.
- **Roles Query** — Fixed roles query resolution in user management flows.
- **Package Cleanup** — Cleaned up `package.json` files across the monorepo, fixed dependency declarations, and corrected `plugin-insights` version reference.
- **VirtualTable & UI** — Refactored `VirtualTable` and `VirtualTableHeader` for better resize handling and simplified render logic. Improved `Dialog` focus management and `LoginView`/`ErrorView` layout.

### Testing

- **Admin Package Tests** — Added component-level tests, data export tests, data import tests (including `get_import_inference_type` and transforms), and extended navigation utils test coverage.
- **PostgreSQL Tests** — New `relations.test.ts` for relation service, `pg-error-utils.test.ts` for error extraction, and expanded `drizzle-conditions.test.ts` and `generate-drizzle-schema.test.ts`.
- **MCP Server Tests** — Extended test suite covering new storage, cron, and function tool handlers.


---

## [0.5.0] - 2026-06-15

### Features & Improvements

- **Aesthetic Landing Page** — Added high-performance custom NEAT canvas background gradients, revamped hero illustrations, and introduced localized documentation and responsive demo page structures.
- **Developer Workspaces** — Added curated development skills rules (covering cron jobs, design-language, email, history, and SDK specs) directly into the agent workspace configs.
- **Data Insights & Migrations** — Integrated database migration `0002` schema changes and a seed script, and introduced an automated insights calculator service.
- **CLI Improvements** — Hardened CLI initialization options for PostgreSQL 18.

### Fixes

- **RLS & Security** — Resolved critical security gaps in Postgres Row-Level Security (RLS) policies.
- **Multi-DB Drivers** — Cleaned up type-safety and package path dependencies for `server-mongodb` and `server-postgresql`.

---

## [0.4.0] - 2026-06-11

### Features & Improvements

- **Unified Authentication** — Redesigned default auth routing, eliminated the `defaultUsersCollection` construct, and streamlined default view redirects.
- **Email Config** — Added custom `SMTP_NAME` parameter configuration in SMTP email delivery properties.

### Fixes

- **Layout & Sizing** — Resolved side navigation alignment glitches, added scroll-overflow fixes in entity data grids, and corrected `ReadOnlyFieldBinding` form fields.
- **Missing Build Configurations** — Added missing `tsconfig.prod.json` compiler files and stabilized workspace-level packaging dependencies.

---

## [0.2.5] - 2026-06-09

### Features & Improvements

- **Role Model Simplification** — Removed roles as an independent table/collection, simplifying permissions into a standard DB enum column directly in the `users` table.
- **SDK & Client Methods** — Extended Rebase client drivers with new data persistence methods.

### Fixes

- **Types & Layouts** — Extended schema types to support native UUID format in string fields, adjusted scroll behaviors in tab grids, and solved pnpm lockfile conflicts.

---

## [0.2.4] - 2026-06-08

### Features & Improvements

- **PostgreSQL 18** — Upgraded core infrastructure and Docker configurations to support PostgreSQL v18.
- **Scaffold Configurations** — Added VPC and S3-compatible cloud storage setup inputs directly into the CLI project-creation prompts.
- **Auth Hooks & Orgs** — Added basic multi-tenant organization support and renamed `AuthOverrides` to `AuthHooks`.
- **Advanced Query Operators** — Introduced `array-contains-any` and `not-in` filter clauses for postgres client drivers.
- **Error Boundaries** — Wrapped main application routes in a robust `ErrorBoundary` with specific full-page and authorization error layouts, and attached global listeners for unhandled promise rejections.

### Fixes

- **Stricter Typing & Logging** — Replaced broad `any` usages with type-safe `unknown` keywords, and migrated core controllers from `console.log` to the structured monorepo logger.

---

## [0.2.3] - 2026-05-31

### Features & Improvements

- **OIDC Publish Workflows** — Migrated package publishing workflows to use GitHub Actions OIDC federation with NPM, removing hardcoded auth tokens and adding secure ID-token scopes.
- **Dynamic Versions** — Dynamically resolved workspace versions from `lerna.json` during canary package releases.

### Fixes

- **CLI Scaffold** — Fixed CLI template installation bugs, repaired Docker database image configs, and restored correct properties inside template collection schemas.

---

## [0.2.1] - 2026-05-30

### Fixes

- **Lockfile & Build Issues** — Fixed a missing integrity hash for the `xlsx` dependency in the lockfile, and resolved frontend build failures by adding `@types/node` and `vite/client` type definitions.
- **SQL Editor Component** — Updated the `SQLEditor` component for improved stability and rendering.

### CI & E2E Testing

- **E2E Test Runner Improvements** — Replaced the `execa` dependency with a custom spawn helper in E2E tests, resolved package packing/resolution issues, and fixed split chunk E2E test failures by accumulating logs for dev server URL detection.
- **Vite Template Config** — Tracked `virtual.d.ts` in git and fixed glob inclusions in `tsconfig` files to prevent template compilation errors.

---

## [0.2.0] - 2026-05-29

### Features & Improvements

- **Postgres Vector (pgvector) Support** — Added a `vector` property type for embeddings, including admin UI field bindings, validation, Postgres schema generation, API generators, and data transformations.
- **Pluggable AuthAdapter Architecture** — Replaced direct Firebase Auth logic in key controllers with a pluggable adapter system to support dynamic/external authentication providers (e.g., dynamic Postgres auth schemas).
- **Users & Roles Collections** — Migrated the user/role system to be treated as standard, customizable data collections, with built-in overrides and migration of auth UI components to the core package.
- **A/B Testing & Landing Page Revamp** — Added A/B testing infrastructure, hero CTAs, testimonials, landing page Bento Grid layouts (`ProductContent`), and demo view modes.
- **SDK Drift Detection** — Added SDK drift detection to the CLI doctor command to check for drift between collection definitions and generated SDKs.
- **EntityDetailView & UI Enhancements** — Created `EntityDetailView` for read-only displays, new `FilterChip` components, and support for collection filter presets.
- **CLI and Test Improvements** — Upgraded pnpm to v11, added CLI init E2E tests, localhost validation tests, and AI coding assistant rules to CLI templates.
- **Database Role Switching Config** — Introduced `DISABLE_DB_ROLE_SWITCHING` and `ADMIN_CONNECTION_STRING` options with troubleshooting documentation.
- **License Update** — Relicensed the project under the MIT License.

### Fixes & Refactoring

- **Realtime Service Shutdown Deadlock** — Fixed potential deadlocks during shutdown by cleaning up websocket realtime services before closing the database pool.
- **Environment Validation** — Centralized environment variable validation in `server-core`.
- **UI Styling & Translations** — Refactored UI components to use consistent Typography/Alert variants, and updated i18n translation strings.

---

## [0.1.2] - 2026-05-15

### Improvements

- **Removed `lodash` dependency** — Replaced `lodash/cloneDeep` with a custom `deepClone` utility in `@rebasepro/utils`. This eliminates the external dependency and fixes `npx create-rebase-app` failing due to missing `lodash` at runtime.
- **New `deepClone` utility** — A lightweight deep-clone function that preserves function references and class instances (Date, GeoPoint, etc.), designed specifically for Rebase collection objects.

### CI & Tooling

- **Automated release pipeline** — New GitHub Actions workflow (`Publish Stable Release`) that handles version bumping, npm publishing, and GitHub Release creation in a single click from the Actions tab.
- **Local release script** — `pnpm release:patch`, `pnpm release:minor`, `pnpm release:major` for releasing from the command line with the same pipeline.
- **Canary releases** — Every push to `main` publishes a canary version to npm (`@canary` dist-tag).

### Fixes

- Fixed navigation utility tests to assert the correct call signature with `undefined` options parameter.
- Updated package descriptions to reflect the Postgres-based architecture.

---

## [0.1.0] - 2025-05-14

🎉 **First public release of Rebase** — an open-source headless CMS and admin panel for Postgres.

### Highlights

- **Full Admin Panel** — Spreadsheet, card, list, and table views for managing your data with inline editing, filtering, sorting, and search.
- **PostgreSQL Backend** — First-class Postgres support with Drizzle ORM, schema introspection, and automatic migrations.
- **Authentication** — Built-in auth with email/password, Google OAuth, and anonymous sign-in. Role-based access control with customizable permissions.
- **Storage** — S3-compatible file storage with image resizing, drag-and-drop uploads, and metadata management.
- **Studio** — SQL editor, RLS policy editor, schema visualizer, JS/TS editor, cron jobs, and API explorer.
- **CLI** — `npx create-rebase-app` to scaffold a new project in seconds. Supports both npm and pnpm.
- **SDK Generator** — Auto-generate fully typed TypeScript SDKs from your collection definitions.
- **MCP Server** — Model Context Protocol server for AI-assisted database management.
- **Plugins** — Data enhancement and insights plugins for extending the admin experience.
- **UI Component Library** — A comprehensive set of accessible, themeable React components built on Radix primitives.
- **Firebase Support** — Optional Firebase/Firestore data source and authentication adapters.
- **MongoDB Support** — Optional MongoDB data source adapter.

### Packages

| Package | Description |
|---|---|
| `@rebasepro/types` | Core TypeScript type definitions |
| `@rebasepro/utils` | Shared utility functions |
| `@rebasepro/common` | Common modules shared across packages |
| `@rebasepro/formex` | Lightweight form management library |
| `@rebasepro/ui` | React component library |
| `@rebasepro/core` | Core CMS logic and controllers |
| `@rebasepro/client` | Client-side data access layer |
| `@rebasepro/client-postgresql` | PostgreSQL client adapter |
| `@rebasepro/client-firebase` | Firebase/Firestore client adapter |
| `@rebasepro/server-core` | Server framework and middleware |
| `@rebasepro/server-postgresql` | PostgreSQL server adapter with Drizzle |
| `@rebasepro/server-mongodb` | MongoDB server adapter |
| `@rebasepro/auth` | Authentication controllers and views |
| `@rebasepro/cms` | Full admin panel interface |
| `@rebasepro/studio` | SQL editor, schema tools, and developer utilities |
| `@rebasepro/cli` | CLI for project scaffolding and management |
| `@rebasepro/sdk-generator` | TypeScript SDK code generation |
| `@rebasepro/mcp-server` | MCP server for AI integrations |
| `@rebasepro/schema-inference` | Database schema introspection and inference |
| `@rebasepro/plugin-data-enhancement` | AI-powered data enhancement plugin |
| `@rebasepro/plugin-insights` | Analytics and insights plugin |
