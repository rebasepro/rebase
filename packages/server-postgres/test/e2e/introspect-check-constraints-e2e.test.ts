/**
 * Adopting a database keeps the rules it enforces that a collection cannot
 * declare: `rebase schema introspect`, then `rebase db push`, leaves every
 * CHECK and EXCLUDE constraint, trigger and function as it was.
 *
 * The collection model has no way to declare a CHECK or an EXCLUDE
 * constraint, so the desired state Atlas diffs against had none, and the first
 * push after an introspection applied
 * `ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_total_check"` with no
 * prompt. Introspection reads `CHECK (total >= 0)` as `validation.min: 0`, so
 * the form still refused a negative total while the database, from then on,
 * accepted one from every other writer.
 *
 * Triggers and functions are here too, as a pin rather than a fix: Atlas's
 * free tier does not inspect them, so it never plans their drop. An Atlas that
 * starts to fails this file.
 *
 * Requires Docker. Runs the driver CLI from source against a throwaway Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { execa } from "execa";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "../..");
const monorepoRoot = path.resolve(pkgRoot, "../..");
const cliScript = path.join(pkgRoot, "src", "cli.ts");
const tsxBin = path.join(monorepoRoot, "node_modules", ".bin", "tsx");

/** A hand-built shop whose rules live in the database. */
const SHOP_SQL = `
CREATE TABLE public.orders (
  id serial PRIMARY KEY,
  total numeric(10,2) NOT NULL,
  starts_at integer,
  ends_at integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ADD CONSTRAINT orders_total_check CHECK (total >= 0);
-- Two columns: a relationship, which introspection does not carry at all.
ALTER TABLE public.orders ADD CONSTRAINT orders_window_check CHECK (ends_at IS NULL OR ends_at > starts_at);
ALTER TABLE public.orders ADD CONSTRAINT orders_no_overlap EXCLUDE USING gist (int4range(starts_at, ends_at) WITH &&);
-- A name that is not a glob as it stands: a raw dot refuses the whole push.
ALTER TABLE public.orders ADD CONSTRAINT "orders.cap [v1]*" CHECK (total < 1000000);
CREATE FUNCTION public.orders_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.orders_touch();
CREATE FUNCTION public.order_tax(amount numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS 'SELECT amount * 0.2';
INSERT INTO public.orders (total, starts_at, ends_at) VALUES (10, 1, 5), (20, 10, 15);
`;

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    return env;
}

type LiveConstraint = { conname: string; contype: string; definition: string };

describe("introspect, then push: CHECK and EXCLUDE constraints, triggers and functions survive", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let backend: string;
    let collections: string;
    let before: LiveConstraint[];

    const cli = (args: string[]) =>
        execa(tsxBin, [cliScript, ...args], { cwd: backend, env: cleanEnv(container.connectionString), reject: false, stdin: "ignore", all: true });

    /** The table's CHECK and EXCLUDE constraints, as Postgres renders them. */
    const constraints = async (): Promise<LiveConstraint[]> => (await admin.query<LiveConstraint>(
        `SELECT conname, contype::text AS contype, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'public.orders'::regclass AND contype IN ('c', 'x')
          ORDER BY conname`
    )).rows;

    /** The SQLSTATE an insert fails with, or `undefined` when it succeeds. */
    const insertFails = async (values: string): Promise<string | undefined> => {
        try {
            await admin.query(`INSERT INTO public.orders (total, starts_at, ends_at) VALUES ${values}`);
            return undefined;
        } catch (error) {
            return error instanceof pg.DatabaseError ? error.code : String(error);
        }
    };

    beforeAll(async () => {
        container = await startPgContainer();
        for (let attempt = 1; ; attempt++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (error) {
                if (attempt >= 10) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        await admin.query(SHOP_SQL);
        before = await constraints();
        expect(before.map(c => c.conname)).toEqual(["orders.cap [v1]*", "orders_no_overlap", "orders_total_check", "orders_window_check"]);

        const base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-introspect-checks-"));
        backend = path.join(base, "backend");
        collections = path.join(base, "config", "collections");
        fs.mkdirSync(backend, { recursive: true });
        fs.mkdirSync(collections, { recursive: true });
        fs.writeFileSync(path.join(backend, "package.json"), JSON.stringify({ name: "introspect-checks-backend", type: "module" }));
        fs.writeFileSync(path.join(collections, "package.json"), JSON.stringify({ type: "module" }));
    }, 120_000);

    afterAll(async () => {
        if (admin) try { await admin.end(); } catch { /* ignore */ }
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("introspects the table", async () => {
        const introspected = await cli(["schema", "introspect", "--output", collections, "--force"]);
        expect(introspected.exitCode, introspected.all).toBe(0);
        expect(fs.existsSync(path.join(collections, "orders.ts"))).toBe(true);
    }, 180_000);

    it("pushes without dropping a constraint, and the database still refuses what they refuse", async () => {
        // A push with real work on the table, so the constraints are not
        // simply left out of a plan that is empty: Atlas folds every change to
        // a table into one `ALTER TABLE`, and a drop would ride in it.
        await admin.query("ALTER TABLE public.orders DROP COLUMN note");

        const pushed = await cli(["db", "push", "--collections", collections]);
        expect(pushed.exitCode, pushed.all).toBe(0);
        expect(pushed.all).not.toMatch(/DROP CONSTRAINT/);
        expect((await admin.query(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'note'"
        )).rowCount).toBe(1);

        expect(await constraints()).toEqual(before);
        expect(await insertFails("(-1, NULL, NULL)")).toBe("23514");   // check_violation
        expect(await insertFails("(5, 9, 3)")).toBe("23514");          // the two-column CHECK
        expect(await insertFails("(5, 2, 4)")).toBe("23P01");          // exclusion_violation
        expect(await insertFails("(2000000, NULL, NULL)")).toBe("23514");
        expect(await insertFails("(5, 100, 110)")).toBeUndefined();
    }, 300_000);

    it("leaves the triggers and functions it cannot see alone", async () => {
        const trigger = await admin.query(
            "SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND tgname = 'orders_touch' AND NOT tgisinternal"
        );
        expect(trigger.rowCount).toBe(1);
        const functions = await admin.query<{ proname: string }>(
            "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('orders_touch', 'order_tax') ORDER BY proname"
        );
        expect(functions.rows.map(r => r.proname)).toEqual(["order_tax", "orders_touch"]);
    });

    it("plans nothing on a second push", async () => {
        const dryRun = await cli(["db", "push", "--dry-run", "--collections", collections]);
        expect(dryRun.exitCode, dryRun.all).toBe(0);
        expect(dryRun.all).not.toMatch(/DROP CONSTRAINT/);
        expect(dryRun.all).not.toMatch(/destroy/i);
        expect(await constraints()).toEqual(before);
    }, 300_000);
});
