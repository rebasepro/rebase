# Audit — Unit 64: the small CLI commands

Read-only audit of `packages/cli/src/commands/{auth,api-keys,apps,telemetry,skills,start}.ts`,
`packages/cli/src/telemetry/**`, `packages/cli/src/utils/project.ts` and the shared
dispatch in `packages/cli/src/cli.ts`. 2026-08-08.

## Verdict

The telemetry subsystem is the best-built thing in this unit and needs almost no
defending: consent is genuinely opt-in, every branch of `suppressionReason`
refuses, the payload is closed by construction (`sanitize` drops free text), both
ids are random rather than derived, the config file is written `0600`, and
`rebase telemetry show` prints the real builder's output rather than a prose
promise. The problems are all in the other five commands, and they share one
root: **every command in this group resolves its positional arguments by fixed
index into `process.argv`** (`rawArgs.slice(3)` / `.slice(4)`) with a flag spec
that does not declare the flags the CLI itself tells people to type. `cli.ts:59-70`
documents this exact hazard and points at `positionals()` in `commands/cloud/index.ts`
as the fix; none of these six commands use it. The sharpest consequence is not a
usability wart: `rebase auth reset-password bob@example.com --debug` sets Bob's
password to the literal string `--debug`, and `--debug` is what `bin/rebase.js`
prints on every failure as the thing to re-run with. The documented `-p` alias
has the same effect because it was never implemented. Separately, `writeManifest`
emits only three keys, so `rebase eject` and `rebase apps init --force` silently
delete a repository's `"telemetry": false` opt-out and its whole `storage` block —
the one privacy control this subsystem asks organisations to trust is destroyed by
two unrelated commands. Below that: `--help` is a no-op for three subcommands (it
*runs* them), `auth` and `api-keys` read their credential and their target URL from
disjoint sources so the two commands can address two different backends, the
direct-DB reset path exits `0` on failure, and the `.env` holding the service key,
the JWT secret and the database password is created `0644` while two lesser files
next to it are deliberately `0600`.

---

## Critical

None.

---

## High

### H1. An unrecognised flag becomes the new password

**`packages/cli/src/commands/auth.ts:97-111`**, help text at **`:352-354`**.

```ts
const args = arg({ "--email": String, "--password": String, "-e": "--email" },
                 { argv: rawArgs.slice(4), permissive: true });
const email = args["--email"] || args._[0];
const newPassword = args["--password"] || args._[1];
```

`arg` in `permissive` mode pushes every undeclared flag into `_` as a bare token
(`node_modules/.pnpm/arg@5.0.2/node_modules/arg/index.js:127-130`). `_[1]` is
therefore whatever came second on the line, flag or not. Verified against the real
`arg` build:

| typed | email | password |
|---|---|---|
| `auth reset-password bob@x.com --debug` | `bob@x.com` | `--debug` |
| `auth reset-password bob@x.com -p 'S3cret!'` | `bob@x.com` | `-p` |
| `auth reset-password --email bob@x.com -p 'S3cret!'` | `bob@x.com` | `S3cret!` |

Two ways in, and both are things the product tells the user to type:

* **`-p`** is advertised in this command's own help — `--password, -p  New
  password` (`:354`) — and is not in the spec. It is class 21: a declared option
  nothing reads. Anyone following the help sets the account's password to the
  two-character string `-p`.
* **`--debug`** is what `bin/rebase.js:104-112` prints after *every* failure
  ("Re-run with --debug for the stack trace"). Appending it to a command that
  already failed once — the single most likely thing a user does next — resets the
  account to `--debug`.

**Failure scenario.** A password reset is run against a staging backend, it fails
on a 500, the CLI says to re-run with `--debug`, the user does, and the reset now
succeeds with the password `--debug` on an account whose email was correct. The
API path then prints `Password: --debug` (`:209`) so a careful reader could
notice; the direct-DB path prints `Password: **` (`:302`) so nobody can.

**Fix direction.** Declare `-p`, and stop reading positionals by index — resolve
them against the command's own spec the way `positionals()` does
(`commands/cloud/index.ts:57-63`), then reject a positional that begins with `-`
rather than accepting it as a password. A password that is two characters long,
or that starts with `-`, is worth refusing outright.

---

### H2. `writeManifest` deletes the telemetry opt-out and the storage topology

**`packages/cli/src/manifest.ts:577-586`**; callers **`commands/eject.ts:227`**
and **`commands/apps.ts:155`**; parse side **`manifest.ts:386-392`**.

```ts
const ordered = {
    $schema: manifest.$schema ?? "https://rebase.pro/schemas/rebase.json",
    rebase: manifest.rebase,
    apps: manifest.apps
};
fs.writeFileSync(filePath, `${JSON.stringify(ordered, null, 4)}\n`, "utf8");
```

`RebaseProjectManifest` (`packages/types/src/types/project_manifest.ts:159-218`)
declares four data keys: `rebase`, `apps`, `storage` and `telemetry`.
`parseManifest` carries `storage` but drops `telemetry` (`:386-392`);
`writeManifest` then drops `storage` too. So a round-trip through either writer
loses both.

`"telemetry": false` is the *only* repository-wide privacy control the CLI
honours, and its docblock is explicit that it "suppresses sharing for everyone who
clones this repository, overriding each developer's own opt-in". `telemetry/project.ts:48-51`
even notes that `parseManifest` "drops keys it does not model" as the reason the
*read* path uses a raw regex — the read side was defended and the write side was
not.

**Failure scenario.** An organisation commits `"telemetry": false`. Six months
later someone runs `rebase eject` to take ownership of the server process — a
command with no visible relationship to privacy, whose output lists `rebase.json
… runtime: custom` as an intended change. The opt-out is gone from the committed
file, and every developer on the team who had ever answered "yes" to the `init`
prompt silently resumes sending events. Same file, same commit: a multi-bucket
project's `storage` block vanishes, so the console can no longer tell that the
project wants a `media` bucket and the per-source `S3_BUCKET__MEDIA` topology has
to be reconstructed by hand.

**Fix direction.** Write every modelled key — spread the loaded manifest and
override only what changed — and carry `telemetry` through `parseManifest` so it
survives the round trip. Gate it with a test that writes a manifest containing
every key of `RebaseProjectManifest`, reads it back and asserts equality; a
hand-listed key set is class 17 and will lose the fifth key too.

---

## Medium

### M1. `--help` runs the command instead of describing it

**`packages/cli/src/cli.ts:92`** sets `effectiveSubcommand` to the real subcommand
whenever one was named, on the stated assumption that "a handler that parses its
own flags sees the request whichever branch this takes". Three handlers do not
parse it:

* **`commands/skills.ts:130-145`** — `rebase skills install --help` reaches
  `skillsInstall`, which never looks at `--help` and **writes files**: it
  detects agents and overwrites `.claude/skills/*/SKILL.md`, `.cursor/rules/*.mdc`
  etc. (`:117-124`). A flag whose entire job is to print text mutates the repo.
* **`commands/auth.ts:96-111`** — `rebase auth reset-password --help` takes
  `--help` as `_[0]`, i.e. the email, and proceeds: it contacts the backend, then
  writes `.tmp-reset-password.ts` into `backend/` and runs a database UPDATE for
  a user named `--help`, ending in `✗ User not found: --help`.
* **`commands/api-keys.ts:83-145,282-333`** — `rebase api-keys list --help` lists
  the keys; `rebase api-keys revoke --help` sends `DELETE /api/admin/api-keys/--help`.

`apps.ts:58`, `start.ts:48`, `telemetry.ts:21` and the whole `cloud` family get
this right, which is the tell that the three above are slips rather than a design.

The same fixed-index parsing breaks the other way for a flag placed *before* the
command: `rebase --debug auth reset-password bob@x.com NewPass1!` resolves
`email = "reset-password"` and `password = "bob@x.com"` (verified), because
`cli.ts` filters flags out of `_` when naming the command but hands each handler
the unfiltered `process.argv` to index into.

**Fix direction.** One shared `positionals(rawArgs, spec)` helper, used by every
command, plus a `--help` check at the top of each subcommand — or, better,
answered centrally before dispatch the way `cloudCommand` does
(`commands/cloud/index.ts:121-134`, whose comment describes this exact incident
class in the cloud group).

---

### M2. `auth` and `api-keys` disagree about where the service key and the backend are

`auth` (`commands/auth.ts:128-157`) resolves:

* key — `process.env.REBASE_SERVICE_KEY`, then `.env`, then `.rebase/state.json`;
* URL — `process.env.REBASE_BASE_URL`, then `state.json.baseUrl`, then `.rebase-dev-url`.

`api-keys` (`commands/api-keys.ts:30-49,87`) resolves:

* key — `.env` only (`env.SERVICE_KEY || env.REBASE_SERVICE_KEY`), never the
  process environment;
* URL — `.env`'s `REBASE_BASE_URL`, then `.rebase-dev-url`, then `.env`'s `PORT`,
  then `http://localhost:3001`. It never reads `state.json`.

Neither reads both sources, and the two sets are disjoint in both directions.
This is class 2 — one predicate, several implementations — on the two values that
decide *which server receives a service key* and *which database gets written*.

**Failure scenarios.** (a) CI injects `REBASE_SERVICE_KEY` as a secret env var:
`rebase auth reset-password` works, `rebase api-keys list` fails with
`✗ SERVICE_KEY not found in .env — required for admin operations.` — a message
that names the wrong cause and sends the operator to write the secret into a file.
(b) `.env` carries `REBASE_BASE_URL=https://staging.example.com`: `api-keys create`
mints a key on staging while `auth reset-password` talks to whatever
`.rebase-dev-url` says, i.e. the local dev server. Neither command prints the URL
it chose; the failure text is `Is the Rebase server running?` (`:142,:273,:330`)
with no target named.

**Fix direction.** One resolver, in `utils/project.ts`, that reads the process
environment, the `.env` and `.rebase/state.json` in a stated order and returns the
resolved URL so every command can echo it. Print the target on both success and
failure.

---

### M3. The direct-DB reset reports success when it failed

**`packages/cli/src/commands/auth.ts:291`** — the generated script ends
`resetPassword().catch(console.error);`. A rejection is logged and the promise
resolves, so Node exits `0`. The parent treats that as success
(`:327-333`: `if (code !== 0) process.exit(code ?? 1)`), returns, and the CLI
exits `0`.

The comment at `:285-288` shows the author already reasoned about exactly this
("Exiting 0 here reported success for a no-op, which is what a script would have
believed") and fixed the *not-found* branch while leaving the *threw* branch.

**Failure scenario.** A provisioning script runs `rebase auth reset-password
"$ADMIN_EMAIL" "$PASS" && echo ok`. `DATABASE_URL` points at a database that is
not up yet. The connection throws, the error scrolls past in the middle of the
build log, the exit status is `0`, and the pipeline proceeds to hand out an
admin password that was never set.

**Fix direction.** `.catch(e => { console.error(e); process.exit(1); })` in the
generated script. Then assert the *outcome* (class 4): a test that runs the
command against an unreachable database and asserts a non-zero status.

---

### M4. A rejected service key silently escalates to writing the database directly

**`packages/cli/src/commands/auth.ts:212-217`.** Any failure of the API path — a
revoked key, an expired key, a 403, a typo'd URL, a network error — is caught,
printed as a yellow `API reset failed, falling back to direct database update…`,
and followed by a direct `UPDATE users SET password_hash` through `DATABASE_URL`.

Two things are wrong with that shape. First, the answer to "your credential was
refused" is not a stack trace but it is also not "try the other door": the user
never learns their key is invalid, only that something was slow. Second — and this
is the part that bites — **the two paths can address different systems**. The API
path targets `REBASE_BASE_URL` (possibly a remote staging or production backend);
the fallback targets whatever `DATABASE_URL` in the local `.env` names. So an
operator who believes they reset the production admin's password has reset it in
their local dev database, or the reverse, with a single yellow line between the
two.

**Fix direction.** Distinguish *reached the server and was refused* (401/403 —
stop, say the key is invalid or expired, exit non-zero) from *never reached it*
(ECONNREFUSED — the fallback is legitimate). This is the same `reachedDatabase()`
question as bug class 16, one layer up. When the fallback does run, name the
database it is about to write to.

---

### M5. The `.env` holding every project secret is created world-readable

**`packages/cli/src/commands/init.ts:1107`** (`fs.copyFileSync(envExamplePath,
envPath)`) and **`:1266`** (`fs.writeFileSync(envPath, envContent, "utf-8")`).
Neither passes a mode and there is no `chmod` anywhere in `init.ts`;
`copyFileSync` copies the source's permissions, and the packaged
`templates/template/.env.example` is `-rw-r--r--`. The resulting `.env` — carrying
the generated `JWT_SECRET`, the database password and `REBASE_SERVICE_KEY`
(`:1110-1141`) — is therefore `0644`.

It is in scope here because it *is* the credential store these commands read:
`api-keys` reads nothing else, and `auth` prefers it over `state.json`. The
contrast is the argument: `telemetry.json` is written `0600` with a comment
explaining why (`telemetry/identity.ts:77-83`), and `.rebase/state.json` is
written `0600` *and* `chmod`ed because "the file can carry the dev service key"
(`packages/server/src/utils/dev-port.ts:244-247`). The same service key, three
files, two of them hardened.

**Failure scenario.** A shared build box or a multi-user dev machine: any local
account can read another project's `.env` and obtain a service key that
`api-key-routes.ts` treats as a full admin credential. The file is gitignored
(`templates/template/gitignore:9`), so the repository is safe; the machine is not.

**Fix direction.** Write `.env` with `mode: 0o600` and `chmod` it after the
rewrite (mode only applies on create), matching `writeStateFile`. Worth a sweep:
every CLI writer of a file that can hold a secret.

---

### M6. The API reset path prints the password; the DB path masks it

**`packages/cli/src/commands/auth.ts:209`** prints
`Password: ${finalPass}` in clear; **`:302`** prints `"*".repeat(n)` for the same
value on the other path. One command, two policies, decided by whether the backend
happened to be reachable.

Related, same lines: the default when no password is given is the hardcoded
`NewPassword123!` (`:162`, `:234`), documented in the help (`:354`). It is a public
constant in an MIT-licensed CLI. `rebase auth reset-password admin@company.com`
against a backend that `REBASE_BASE_URL` can point anywhere leaves the admin
account on a password that is in the source tree.

**Fix direction.** Mask on both paths, or print on neither and require the caller
to supply one. Replace the fixed default with a generated random password printed
once, the way `api-keys create` already does it (`api-keys.ts:267-269`, which does
warn "Copy your key now — it won't be shown again").

---

## Low

### L1. `rebase telemetry show` contradicts `rebase telemetry status`

**`packages/cli/src/commands/telemetry.ts:80-90`** gates on `config.enabled !== true`
only, while `printStatus` (`:61-78`) and everything that actually sends go through
`suppressionReason`. With `DO_NOT_TRACK=1`, `CI=1`, or a project `"telemetry":
false`, `status` correctly reports disabled and `show` prints a payload under the
heading `Sent to https://app.rebase.pro/… , for example:` — describing traffic that
cannot happen. In the command whose whole purpose is to be the inspectable,
trustworthy answer.

Same function: `previewEvent` returns `TelemetryEvent | null` (`telemetry/index.ts:104-115`)
and the result is passed straight to `JSON.stringify` (`:98`), so a config with
`enabled: true` and no `machineId` prints the word `null`. That state is reachable:
`setConsent(true)` writes `enabled: true` first and calls `ensureMachineId()`
afterwards (`telemetry/index.ts:78-94`), so a write that fails on the second call
leaves the first on disk while the command reports "sharing was not enabled".

**Fix direction.** Gate `printPayload` on `suppressionReason()` and print the same
`describeState()` sentence; handle the `null` return explicitly.

### L2. Enabled telemetry holds the process open after the command is done

**`packages/cli/src/telemetry/index.ts:130-163`.** `recordEvent` is `void`ed at the
call sites precisely so it does not block (`db.ts:24-27`, `schema.ts:27`,
`dev.ts:219`), but the `fetch` and its 2-second `setTimeout` (`:147`) are live
handles. Node will not exit while they are pending, so a successful `rebase db push`
returns from `execa` and then waits up to 2 s for the collector before the shell
gets its prompt back. The docblock's second promise — "It never blocks meaningfully"
— is true of the command's work and false of its exit. Only affects users who opted
in, and `REBASE_TELEMETRY_ENDPOINT` can point at anything.

**Fix direction.** `timer.unref()`, and let the process exit with the request in
flight; or await it explicitly where the event matters more than the 2 s.

### L3. `--expires` reads `Object.prototype` and crashes past its own error message

**`packages/cli/src/commands/api-keys.ts:207-221.`**
`const days: Record<string, number> = {"7d":7,…}; if (days[expiresFlag]) {…}`.
`days["constructor"]`, `["toString"]`, `["valueOf"]`, `["hasOwnProperty"]` and
`["__proto__"]` are all truthy, so the guard passes, the arithmetic yields `NaN`,
and `new Date(NaN).toISOString()` throws `RangeError: Invalid time value` —
verified for all five. The written remediation ("Use 7d, 30d, 90d, 1y, or an ISO
date", `:217`) is unreachable for exactly those inputs. It is the read half of bug
class 22, in a lookup table.

**Fix direction.** `Object.hasOwn(days, expiresFlag)`, or a `Map`, or a
`switch`. No user impact beyond a confusing error, but it is a two-character fix
and the class is documented.

### L4. `.tmp-reset-password.ts` survives Ctrl-C

**`packages/cli/src/commands/auth.ts:294-334`.** The docblock says "every exit has
to remove it", and `error` and `close` do. `SIGINT` does not: with `stdio:
"inherit"` both processes take the signal, the parent dies without running
`cleanup`, and a generated `.ts` file is left in the user's `backend/` to be
committed. Same for `SIGTERM`.

**Fix direction.** Write the script to `os.tmpdir()` instead — the only reason it
sits in `backendDir` is module resolution, which `tsx --cwd` or an absolute import
specifier can supply — or add `process.once("SIGINT", cleanup)`.

### L5. Two declared telemetry events are never sent

**`packages/cli/src/telemetry/payload.ts:41-52`** declares six event names.
`cli.init`, `cli.dev`, `cli.schema` and `cli.db` have call sites; `cli.deploy` and
`cli.error` have none anywhere in `packages/cli/src` (only a test uses `cli.error`
as a string). Class 21, in miniature: `cli.deploy` is presumably the funnel's most
interesting event and nothing emits it, so the data set silently answers "nobody
deploys". Not user-visible; it makes the collected data wrong rather than unsafe.

### L6. No machine-readable output anywhere in this group, unlike `rebase cloud`

`rebase cloud` latches JSON mode whenever stdout is not a TTY
(`commands/cloud/context.ts:541-549`), so any piped or agent-run cloud command
returns JSON. In this unit only `apps` has `--json` at all (`apps.ts:49`), it is
opt-in, and its own error paths ignore it — `apps config nosuchapp --json` writes
human prose to stderr and exits 1, so a script gets neither a parseable success
nor a parseable failure. `api-keys list`, the one command in the group whose output
a script most obviously wants, has no structured form: the only way to get a key id
is to scrape `ID:` out of coloured text.

**Fix direction.** Reuse `initOutputMode`/`emit`/`fail` from the cloud context for
this group; they already exist and already strip ANSI.

### L7. `rebase telemetry show` mints and persists a project id from a subdirectory-dependent root

**`commands/telemetry.ts:94`** passes `process.cwd()` to `previewEvent`, which calls
`ensureProjectId` (`telemetry/identity.ts:116-149`) — a function that creates
`.rebase/` and writes a fresh random UUID into `state.json`. Two consequences, both
small: an inspection command has a persistent write side effect, and because the
guard is `rebase.json` in the *cwd* rather than the project root, the same command
run from `backend/` previews `projectId: undefined` while the root previews a real
one. The preview is meant to be exactly what would be sent, and `recordEvent`'s
caller passes a real `projectRoot`.

**Fix direction.** `findProjectRoot()` instead of `process.cwd()`, and a read-only
variant of `ensureProjectId` for the preview.

### L8. `rebase skills install` overwrites without saying what it replaced

**`commands/skills.ts:117-124`** writes every skill unconditionally and reports a
count. A developer who edited `.claude/skills/rebase-auth/SKILL.md` loses the edit
with no diff, no backup and no prompt; the closing line ("Re-run this command
anytime to update to the latest skills", `:259`) is the only warning and it is
printed *after* the write. Naming the files that changed, or skipping ones whose
content differs from the last install without `--force`, would cost little.

---

## Checked and clean

* **`rawArgs` index discipline, where it is used.** Each command's `slice(N)` is
  internally consistent with how it indexes `_`: `auth`/`api-keys` slice 4 and read
  `_[0]`/`_[1]` as the arguments after the subcommand; `apps` slices 3 and reads
  `_[1]`; `start`/`telemetry` slice 3 for a non-namespaced command. The bug is the
  fixed index itself (M1), not an off-by-one.
* **`api-keys create` warns that the secret is shown once** (`api-keys.ts:267`),
  and `list` prints only `key_prefix•••` (`:131`) — no hash, no key. The secret
  reaches stdout, but it is output rather than an argument, so it never enters
  shell history; CI logs remain the only exposure and the warning is present.
* **No secret is ever logged by these commands.** No `Authorization` header, no
  `serviceKey`, no `DATABASE_URL` reaches any `console.*` on any path read.
* **Empty/absent permissions fail closed.** `api-keys create` refuses to default to
  full access and says how to ask for it explicitly (`api-keys.ts:191-203`) — the
  class-1 "empty list means all" trap, correctly avoided.
* **`--rate-limit`'s documented default of 1000 is real** — `rate-limiter.ts:210,265`
  applies it when a key's own `rate_limit` is null. The CLI's `null` is the right
  wire value, and every body field it sends (`admin`, `rate_limit`, `expires_at`)
  matches what `api-key-routes.ts:94-137` destructures.
* **Behaviour outside a project.** `auth`, `api-keys`, `apps`, `start` all call
  `requireProjectRoot`, which exits 1 naming the three markers it looked for in the
  order it looked (`utils/project.ts:293-309`). `skills` deliberately falls back to
  the cwd; `telemetry` needs no project.
* **Malformed config.** `loadManifestOrExit` (`apps.ts:248-261`) prints each
  validation issue with its dotted path and exits 1. `readEnvFile` and
  `readConfig` both treat unreadable as absent rather than throwing. A `rebase.json`
  too malformed to parse still switches telemetry off, by design
  (`telemetry/project.ts:48-55`).
* **Unhandled exceptions are not stack traces.** `bin/rebase.js:106-118` awaits
  `entry()` and prints the error's own message, with the stack behind `--debug`. An
  `arg` parse error (`--password` with no value) surfaces as
  `✗ option requires argument: --password`, exit 1.
* **The whole telemetry consent model.** Opt-in; six independent suppression
  reasons all defaulting to refusal (`telemetry/index.ts:50-63`); `DO_NOT_TRACK`
  and `CI` honoured; no id minted on decline (`:87`); config `0600`; project
  `"telemetry": true` refused *and said out loud* (`telemetry.ts:64-72`); the
  prompt requires a TTY and a failed prompt is a non-persisted decline; the payload
  is a closed set of enumerated values with strings capped at 64 chars and anything
  containing `/ \ @ : whitespace` dropped (`payload.ts:139-152`); errors reduced to
  a code or a constructor name (`:110-118`); counts bucketed. `sanitize` also
  refuses prototype-shadowing keys. `recordEvent` cannot send without consent
  because the check is inside it rather than at the call sites.
* **`start.ts`** — `--help` honoured, bundle path resolved against the project
  root, symlink farm confined to `dist-bundle/node_modules` and only created when
  absent, failure to boot exits 1.
* **`selectUserForEmail`** (`auth.ts:51-76`) matches exactly, case- and
  whitespace-insensitively, accepts `id` or `uid`, and returns `undefined` rather
  than guessing — with eight tests. The class-2 defect it documents is genuinely
  fixed.

---

## Open questions

1. **Should `rebase auth reset-password` exist in this shape at all?** It is a
   command that takes a plaintext password as a positional argument (shell history,
   `ps`), falls back from an authenticated API to a raw database write, and defaults
   to a published constant. An `--email`-only form that prints a generated password
   once would remove H1, M4 and M6 together.
2. **Is `rebase eject` expected to be idempotent over a hand-edited `rebase.json`?**
   H2 assumes not. If the manifest is meant to be machine-owned, the fix is to say
   so in the file's own header; if authored, `writeManifest` needs to round-trip
   every key.
3. **Does anything downstream still read a project's `storage` block after an
   eject?** The console reads `rebase.json` topology; a custom-runtime project emits
   no bundle manifest. If the console is the only reader, H2's storage half is a
   console-display bug; if the platform provisions buckets from it, it is a
   provisioning bug. Not resolved from the CLI side.
4. **`REBASE_TELEMETRY_ENDPOINT` is honoured with no allowlist** and no notice in
   `telemetry status` beyond printing the value. A committed `.env` or a shell
   profile could redirect an opted-in developer's events to a third party without
   any prompt. Deliberate (the docblock says "so a fork can point at its own
   collector") — but worth deciding whether `status` should flag a non-default
   endpoint in yellow rather than grey.
5. **`packages/cli/src/commands/{auth,api-keys,apps,skills,start}.ts` have no arg-parsing
   tests at all** — `auth.test.ts` covers only `selectUserForEmail`. Every finding in
   H1 and M1 would have been caught by one table-driven test per command asserting
   what each flag resolves to. Is that worth a shared fixture before the next
   command is added?
