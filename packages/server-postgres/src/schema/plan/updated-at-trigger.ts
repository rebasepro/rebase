/**
 * `autoValue: "on_update"`, as a database trigger.
 *
 * ## Why a trigger and not only the driver
 *
 * The driver stamps `updated_at` on every write it makes, and it has to keep
 * doing so: a `beforeSave` hook reads the row it is about to persist, and a
 * value that only appears once Postgres has written it is a value the hook
 * cannot see.
 *
 * But the driver is not the only writer. A seed script, a migration backfill, a
 * `psql` session, an admin fixing one row by hand — every one of those leaves
 * `updated_at` at whatever it was, and the column then says the row has not
 * changed since a date that is simply wrong. Anything reading it to decide what
 * to re-index, re-sync or re-send skips the row. The declaration says "this
 * column tracks the last write"; only the database can make that true.
 *
 * So both: the app stamps so hooks see the value, and a `BEFORE UPDATE` trigger
 * stamps so every other writer does too. They agree because they both mean
 * "now" — the trigger's `now()` is the transaction's start time, which is the
 * same instant the driver's own timestamp is written under.
 *
 * ## Why it is carved out of Atlas
 *
 * Atlas's free tier refuses to *parse* a desired-state file containing a
 * function ("functions and procedures are available to logged-in users only"),
 * and a trigger is a function plus a binding. This is the same arrangement the
 * search helpers already have: excluded from Atlas's view by pattern, written
 * to a file Rebase applies itself, applied at boot by the schema ensure, and
 * appended to migrations by the CLI so a replay is complete.
 *
 * ## Why one function for every column
 *
 * The column name arrives as a trigger argument (`TG_ARGV[0]`), so a project
 * with forty `updated_at` columns installs one function and forty bindings
 * rather than forty near-identical functions. `jsonb_populate_record(NEW, …)`
 * is the documented way to set a field of a row whose type is not known until
 * run time; it takes `NEW` as the row template, so the value is cast back to
 * whatever the column actually is — a `timestamptz`, or a `date` if that is
 * what the property declared.
 */
import { REBASE_SCHEMA } from "@rebasepro/types";
import type { TriggerPlan } from "./types";

/** The one trigger function, qualified. A frozen derived name. */
export const SET_UPDATED_AT_FN = `${REBASE_SCHEMA}.set_updated_at`;

/**
 * `CREATE OR REPLACE FUNCTION`, so replaying it against a database that already
 * has it is a no-op — this is emitted into a file that runs on every push and
 * is appended to migrations that run against databases at any stage of life.
 */
export const setUpdatedAtFunction = (): string =>
    `CREATE OR REPLACE FUNCTION ${SET_UPDATED_AT_FN}() RETURNS trigger\n` +
    "LANGUAGE plpgsql AS $$\n" +
    "BEGIN\n" +
    "    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));\n" +
    "    RETURN NEW;\n" +
    "END;\n" +
    "$$;";

/**
 * `DROP TRIGGER IF EXISTS` before the `CREATE`.
 *
 * `CREATE OR REPLACE TRIGGER` exists only on Postgres 14+, and this runs
 * against whatever a self-hosted project points at. Two statements rather than
 * one is also what the boot-time applier needs: it issues DDL one statement at
 * a time over the extended query protocol, which forbids multiple commands in
 * one execute.
 */
export const dropTriggerStatement = (plan: TriggerPlan): string =>
    `DROP TRIGGER IF EXISTS "${plan.name}" ON "${plan.schema}"."${plan.table}";`;

export const createTriggerStatement = (plan: TriggerPlan): string =>
    `CREATE TRIGGER "${plan.name}" BEFORE UPDATE ON "${plan.schema}"."${plan.table}" ` +
    `FOR EACH ROW EXECUTE FUNCTION ${SET_UPDATED_AT_FN}('${plan.column.replace(/'/g, "''")}');`;

/** Both statements, in the order they must run. */
export const triggerStatements = (plan: TriggerPlan): string[] =>
    [dropTriggerStatement(plan), createTriggerStatement(plan)];
