# Explainers — voice-over scripts

Short lessons for developers about Postgres and the things around it. They
are **not about Rebase**: Rebase is named once, in the last line, as who
made the film, and the end card carries the mark and rebase.pro (no
command). Each film runs 90–120 seconds and comes in **two shapes from the
same take**: 16:9 (`Explainer-<id>`) and 9:16 (`Explainer-<id>-Tall`).

**The voice.** One engineer showing another something real. Friendly,
present tense, every sentence has a subject and a verb. No slogans, no jabs
at any product or vendor, no "this one", no accidentally repeated phrases.
The hook is said to camera and states the surprise in one sentence.

**Every claim is proved against a real Postgres** before it goes in the
script, and every SQL statement and result on screen is the real statement
and its real output. The *Proof* table under each script says which part of
the proof script shows each claim. Never mentioned: rls-check, Studio,
Rebase Cloud.

**Each film has its own visual device.** No template: the series kit
(`src/series/kit.tsx`) supplies the voice-following timeline, the
presenter's places, the ground, captions and the end card; the picture is
designed for the subject.

## The gates

```bash
pnpm lint:film <id>      # script: banned phrases, repetition, 200-280 words,
                         # Rebase only in the last line, on-screen SQL = proof
pnpm audit:film <id>     # both shapes at a simulated read: bare ground at cuts,
                         # headline sizes (≤3), headline wrapping (≤2 lines);
                         # writes out/audit/<id>/{wide,tall}/{sheet,cuts}.png
pnpm typecheck
```

Then **look at the sheets** in both shapes. The audit cannot see overlap,
clipping, legibility or motion. See the header of `scripts/audit-film.ts`
for what it does not catch.

## Recording

```bash
pnpm live
```

Open http://localhost:3500/?film=view-side-door (or pick it from the
**Film** menu). Everything else is the series' routine (`VOICEOVER-SERIES.md`
→ *Recording*): Space to start, read at your pace, the film follows your
voice. Try it without a camera first with `&simulate`.

**Pace.** 236 words. At a natural 140–155 words a minute that is about
**95–105 seconds** with the end card (the audit's simulated read at 155 wpm
runs 106 s). The film waits for you; don't rush.

**Where to look.** Large in the centre for the hook, to camera. Then the
corner (16:9) or the lower card (9:16) while the floor plan and psql play.
Back large for the last line, to camera.

---

## 01 · Your view is a side door around row-level security — `view-side-door`

**Device: a floor plan.** The table is a room with its three rows inside;
the policy is a checkpoint at the front door; alice is a token that walks
in. The view is a corridor built through the wall *behind* the checkpoint,
and she walks it to every row. The fix puts a checkpoint at the corridor's
end; the materialized view is a copy room outside the walls, with no door
at all. The plan is one drawing for the whole film (the kit's `layer`), so
it never cuts; beside it, a psql panel shows the real statements and
results.

| Line | Script |
|------|--------|
| hook | A view over a table with row-level security can show every row to anyone allowed to query it. |
| table | Here's a table of orders, with a policy that lets each customer see only their own. When Alice selects from it, she gets one row. |
| view | The same migration then creates a view of that table and grants Alice access. She queries the view, and all three orders come back. |
| why | By default, a view reads its tables with its owner's rights, not those of the person asking. That owner is usually the migration role that created the table, and row-level security skips a table's owner unless you force it. |
| door | So the policy still guards the table, and the view walks right around it. |
| fix | On Postgres 15 or later, the fix is a single option. Alter the view and set security invoker to true. |
| after | Now the view checks the policy as whoever runs the query, and Alice is back to her one order. For new views, write the option into the create statement. |
| matview | Materialized views have the same problem, and no such option. They store whatever their owner could read at refresh time, so keep them away from the roles your users connect as. |
| check | To find these in your own database, run one query against the catalog. It lists every view and materialized view that reads a protected table without security invoker. |
| close | We build Rebase, an open-source backend for Postgres. |

**Proof.** `scripts/proof/view-side-door.sql`, run by
`pnpm proof:view-side-door` (`scripts/proof-view-side-door.sh`) on a
throwaway cluster — initdb in a temp dir, localhost on a spare port, torn
down after — and compared with `scripts/proof/view-side-door.expected`.
Verified 2026-11-16 on **PostgreSQL 18.4** (Homebrew, aarch64); the same
script on **PostgreSQL 14.12** fails at the first `security_invoker`
(`ERROR: unrecognized parameter "security_invoker"`), which is the "15 or
later" claim.

| Claim | Where the proof shows it |
|-------|--------------------------|
| The policy limits alice to her own row | §1: `SELECT * FROM orders` as alice → 1 row |
| A view over it returns all rows to alice | §2: `SELECT * FROM order_list` as alice → 3 rows |
| The view and the table share the migration role as owner | §3: `relowner::regrole` → `app` for both; `via_table 1 / via_view 3` |
| "unless you force it" | §3b: with `FORCE ROW LEVEL SECURITY`, the same view gives alice 1 row |
| `ALTER VIEW … SET (security_invoker = true)` fixes it | §4: alice → 1 row; §4b: bob → his 1 row |
| The option works in `CREATE VIEW … WITH (…)` | §4b: `my_orders` → alice's 1 row |
| Materialized views leak the same way | §5: `SELECT * FROM order_totals` as alice → all 3 customers |
| …and have no such option | §5: `ALTER MATERIALIZED VIEW … SET (security_invoker = true)` → `ERROR: unrecognized parameter "security_invoker"`; RLS cannot be enabled on one either |
| Not every definer-rights view leaks: only when its owner skips RLS — hence "usually" | §6: a view owned by `reporter` (not the table owner) gives alice only her row |
| The catalog query finds them | §7: lists `order_totals \| orders` after the fix; §7b: lists `order_list` again once `security_invoker` is reset |

`pnpm lint:film view-side-door` fails if any statement or result the film
shows (`SHOWN` in `src/explainers/01-view-side-door.tsx`) stops appearing in
the expected file. Statements are re-wrapped to the panel; whitespace aside
they are the proof's own.

**What the check query does not catch** (worth knowing before quoting it as
complete): a definer-rights view over *another view* that is itself over an
RLS table (it only follows direct dependencies); it also lists every
definer-rights view over an RLS table, including harmless ones whose owner
is subject to the policy (§6). That is deliberate: it is a list to review, not a
verdict.

**Recording notes.**
- "security invoker" is said as two words; the screen shows
  `security_invoker`.
- "Postgres 15" — say "fifteen", not "one five".
- The psql role labels (`alice ›`, `app ›`, `postgres ›`) are annotations
  of which role ran the statement; the proof sets it with `SET ROLE`.
- The episode mark reads `01 / VIEWS AND ROW-LEVEL SECURITY`.
