# Auditing a system

How one system of [`systems.json`](systems.json) is audited, by a person or by the
nightly routine. `pnpm audit:queue` says which system is due; this says what to ask
of it and what "done" means.

A system is audited end to end, as a product — not as the files in one package.
Two whole-repo bug hunts sliced by package (2026-09-23, 2026-09-27) fixed about four
hundred things and still walked past what the next topical audit found, because those
problems live *between* files: two doors that disagree, a claim the docs make and the
code does not keep, a feature built to 80%, an error nobody can act on, a starting
state no test creates.

## Before reading code

1. `AGENTS.md`, and the `.agent/workflows/*.md` guide matching the system.
2. The class headings of [`bug-classes.md`](../bug-classes.md) — cite them by number.
3. The system's `focus` in `systems.json`, and its units in [`audit-map.md`](audit-map.md).
4. `git log <last audit commit>..HEAD -- <its paths>`: what changed since anyone looked.

## The questions

Ask every one of them of the system.

1. **Doors.** Every entry point — REST route, SDK method, websocket frame, MCP tool,
   CLI command, CMS or Studio screen, callback, boot step — and the decision functions
   behind each. Does each door give the same outcome for the same operation:
   validation, defaults, hooks, history, error shape, status? The highest-yield
   question in this repository is *"does this agree with the thing next to it?"*
2. **Starting states.** Empty database, fresh install, a database aged by an older
   version, an upgrade mid-life, two instances, a restart mid-operation, a slow or
   failing network.
3. **Failure truthfulness.** What the user sees when it fails: swallowed errors, a 200
   for work not done, a success toast for a failed write, a status describing the old
   state, an error naming the wrong cause or no remedy.
4. **Claims against behaviour.** The English docs, package READMEs, JSDoc on exported
   types, CLI `--help`, error text, the changelog. Options declared and never read.
5. **Completeness.** What someone arriving from Supabase, Firebase, Directus or Payload
   expects this system to do in their first weeks, that it does not or does halfway.
6. **Guards.** For each finding, the test, lint or boot-time check that would have
   caught it, and why none existed. A guard that stops a class beats a fix of one case.
7. **Coherence.** Names, shapes and errors consistent within the system and with the
   rest of the platform. Screens built from `@rebasepro/ui`, consistent with
   `UIReferenceView`.
8. **Scale.** Work growing faster than input, unbounded reads, N+1, a 100k-row table,
   memory held per connection.
9. **Security.** Injection (SQL, header, template, CSV), SSRF, traversal, XSS, secrets
   in logs or error bodies, unbounded input — and, for any system with a door, whether
   that door asks the permissions system the same question every other door asks.

A finding needs a concrete scenario — state and input, what happens, what should — and
is reproduced whenever that costs under ten minutes: a failing test, a request against
a throwaway server, a `tsc` probe. A suspicion that was not reproduced is listed apart
as unconfirmed and never fixed blind.

## Fixing what it finds

- **Test first, seen red.** Write the regression test, watch it fail against the
  current code, then fix. Break the fix on purpose and watch the test fail again
  ([mutation check](../bug-classes.md)); a test that survives its fix being reverted
  pins nothing.
- **Fix the class, gate the class.** Sweep for siblings of each finding before calling
  it fixed, and when a class has no guard, build the guard — a boot-time refusal in
  `validate-config.ts`, a `check:` script, a property test over every door. Then a
  dated row in `bug-classes.md`, including what came back clean.
- **One finding, one commit,** with explicit pathspecs. CHANGELOG `[Unreleased]` entry
  for anything a user can observe; docs updated in the same change when a claim moved.
- **A behaviour change, a removed option or a security trade-off is a decision,** not
  a fix: write it up with the options and a recommendation and leave the code alone.
- `./tooling/scripts/verify-quality.sh` — or at least `typecheck`, `check:lint`, the
  touched packages' suites and `ci:static` — before the audit is called done.

## Done

`pnpm audit:queue --record <system> --by <who>` stamps the audit into `systems.json`
at the current commit, and the system drops to the bottom of the queue until its code
changes again.
