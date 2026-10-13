/**
 * Adopting a database keeps its row-level security: `rebase schema introspect`
 * carries each policy into the collection's `securityRules`, and the
 * `rebase db push` after it leaves every policy as it was.
 *
 * Introspection read the tables and none of their policies. The generated
 * collections then described no rules, so the database's own policies became
 * "orphans" the collections did not describe:
 *
 * - `rebase doctor --policies` failed on them as "left behind by an earlier
 *   push", which a hand-written `customers_owner` never was;
 * - every `db push` warned "Drop them by hand if they are stale" about the
 *   policies that were the table's whole access model;
 * - and a policy whose name has the shape an unnamed rule compiles to —
 *   `<table>_<op>_<hash>`, which is every rule on a database Rebase built —
 *   was DROPPED by that push as superseded, taking its grant with it.
 *
 * It also read a referenced three-row table whose rows each belong to one
 * user as "a 3-row code list". Rows a policy hands out per caller are the
 * app's data, not a list of labels.
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

/** A shop someone built by hand: owners see their own customers and orders. */
const SHOP_SQL = `
CREATE TABLE public.customers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text,
  owner_id text NOT NULL DEFAULT current_setting('app.uid', true),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.orders (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES public.customers(id),
  total numeric(10,2) NOT NULL,
  owner_id text NOT NULL DEFAULT current_setting('app.uid', true),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_owner ON public.customers FOR ALL
  USING (owner_id = current_setting('app.uid', true))
  WITH CHECK (owner_id = current_setting('app.uid', true));
CREATE POLICY orders_owner ON public.orders FOR ALL
  USING (owner_id = current_setting('app.uid', true))
  WITH CHECK (owner_id = current_setting('app.uid', true));
-- The shape an unnamed rule compiles to, as on a database Rebase built.
CREATE POLICY orders_select_1a2b3c4 ON public.orders FOR SELECT
  USING (total < 1000);
INSERT INTO public.customers (name, email, owner_id) VALUES
  ('Ada', 'ada@shop.test', 'u1'), ('Bob', 'bob@shop.test', 'u2'), ('Cy', 'cy@shop.test', 'u1');
INSERT INTO public.orders (customer_id, total, owner_id) VALUES (1, 10, 'u1'), (2, 20, 'u2');
`;

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    return env;
}

type LivePolicy = { tablename: string; policyname: string; cmd: string; permissive: string; roles: string[] | string; qual: string | null; with_check: string | null };

describe("introspect, then push: a database's own policies survive", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let backend: string;
    let collections: string;
    let before: LivePolicy[];

    const cli = (args: string[]) =>
        execa(tsxBin, [cliScript, ...args], { cwd: backend, env: cleanEnv(container.connectionString), reject: false, stdin: "ignore", all: true });

    const handWritten = async (): Promise<LivePolicy[]> => (await admin.query<LivePolicy>(
        `SELECT tablename, policyname, cmd, permissive, roles, qual, with_check FROM pg_policies
          WHERE schemaname = 'public' AND policyname NOT LIKE '%\\_default\\_%' ORDER BY tablename, policyname`
    )).rows;

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
        before = await handWritten();

        const base = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-introspect-policies-"));
        backend = path.join(base, "backend");
        collections = path.join(base, "config", "collections");
        fs.mkdirSync(backend, { recursive: true });
        fs.mkdirSync(collections, { recursive: true });
        fs.writeFileSync(path.join(backend, "package.json"), JSON.stringify({ name: "introspect-policies-backend", type: "module" }));
        fs.writeFileSync(path.join(collections, "package.json"), JSON.stringify({ type: "module" }));
    }, 120_000);

    afterAll(async () => {
        if (admin) try { await admin.end(); } catch { /* ignore */ }
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("writes each table's policies into its collection, and reads per-user rows as the app's data", async () => {
        const introspected = await cli(["schema", "introspect", "--output", collections, "--force"]);
        expect(introspected.exitCode, introspected.all).toBe(0);

        const customers = fs.readFileSync(path.join(collections, "customers.ts"), "utf8");
        const orders = fs.readFileSync(path.join(collections, "orders.ts"), "utf8");
        expect(customers).toMatch(/securityRules: \[/);
        expect(customers).toContain(`name: "customers_owner"`);
        expect(orders).toContain(`name: "orders_owner"`);
        expect(orders).toContain(`name: "orders_select_1a2b3c4"`);
        // A policy hands each user their own customers: not a code list.
        expect(customers).not.toMatch(/Introspected as a lookup/);
        expect(customers).not.toMatch(/group: "Reference"/);
        // Nor are a user's orders something only reached through a customer.
        expect(orders).not.toMatch(/hideFromNavigation: true/);
    }, 180_000);

    it("pushes without dropping, rewriting or disowning a single policy", async () => {
        const pushed = await cli(["db", "push", "--collections", collections]);
        expect(pushed.exitCode, pushed.all).toBe(0);
        expect(pushed.all).not.toMatch(/Dropped superseded policy/);
        expect(pushed.all).not.toMatch(/no collection describes/);

        // Recreated from the rules, each policy reads as it did.
        expect(await handWritten()).toEqual(before);

        const doctor = await cli(["doctor", "--policies", "--collections", collections]);
        expect(doctor.all).not.toMatch(/Orphaned/);
    }, 300_000);
});
