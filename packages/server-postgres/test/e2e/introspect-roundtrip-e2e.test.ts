/**
 * Adopting a database is a round trip, and the round trip must be a no-op.
 *
 * The documented path for an existing database is `rebase schema introspect`,
 * then `rebase db push`. Nothing ever ran the two together, and they read a
 * column two different ways: introspection wrote `type: "number"` for an
 * `integer` and the planner reads that as `NUMERIC`; `validation.max` for a
 * `varchar(40)` and the planner makes it `TEXT`; a `time` as a timestamp
 * Postgres refuses to cast; every `serial` key as an identity, every NOT NULL
 * column with a default as nullable, every `ON DELETE CASCADE` as `SET NULL`,
 * the search column as a plain text property. The first push after adopting a
 * database planned a type change on most columns, and some it could not even
 * dry-run.
 *
 * So this runs the real doors in order against a real Postgres:
 *
 *   1. a database Rebase built (`db push` of a column × relation matrix),
 *      introspected into a fresh `backend/schema`, planned again — no changes;
 *   2. a hand-written legacy database, introspected and planned — no schema
 *      change. A table keyed on several columns is one composite key; one
 *      keyed on an instant is left out with its reason. Its tables have
 *      row-level security off, which no table keeps: the push switches it on,
 *      and both the introspection and the dry run say so.
 *
 * Requires Docker. Spins up a throwaway Postgres container and tears it down.
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

/** The matrix: every column kind and every relation kind `db push` builds, as `backend/schema`. */
const MATRIX: Record<string, string> = {
    "people.ts": `
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { categories } from "./categories";
import { addresses } from "./addresses";
import { profiles } from "./profiles";
export const people = defineTable("people", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull(),
        email: col.text().unique(),
        bio: col.text(),
        nickname: col.varchar({ length: 40 }),
        age: col.integer(),
        rating: col.numeric({ precision: 5, scale: 2 }),
        score: col.numeric(),
        big: col.bigint({ mode: "number" }),
        active: col.boolean().default(true),
        born: col.date(),
        wakeAt: col.time(),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow(),
        status: col.enum(["new", "old"]).default("new"),
        aliases: col.text().array(),
        lucky: col.integer().array(),
        meta: col.jsonb(),
        prefs: col.json()
    },
    relations: {
        categories: rel.manyToMany(() => categories),
        addresses: rel.hasMany(() => addresses),
        profile: rel.hasOne(() => profiles)
    },
    search: { fields: [{ path: "name", weight: "A" }, { path: "bio", weight: "B" }] },
    rls: "admin-only"
});`,
    "categories.ts": `
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { people } from "./people";
export const categories = defineTable("categories", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), title: col.text() },
    relations: { people: rel.manyToMany(() => people) },
    // The scaffold's default rules: reads for everyone, writes for admins.
    rls: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], roles: ["admin"] }
    ]
});`,
    "addresses.ts": `
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { people } from "./people";
export const addresses = defineTable("addresses", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), line: col.text() },
    relations: { person: rel.belongsTo(() => people, { notNull: true, onDelete: "cascade" }) },
    rls: "admin-only"
});`,
    "profiles.ts": `
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { people } from "./people";
export const profiles = defineTable("profiles", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), handle: col.text() },
    relations: { person: rel.belongsTo(() => people) },
    rls: "admin-only"
});`,
    "orders.ts": `
import { defineTable, col, rel } from "@rebasepro/server/schema";
export const orders = defineTable("orders", {
    table: "order",
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), select: col.text(), group: col.enum(["a", "b"]) },
    relations: { friends: rel.manyToMany(() => orders) },
    rls: "admin-only"
});`,
    "series.ts": `
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { news } from "./news";
export const series = defineTable("series", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },
    relations: { news: rel.manyToMany(() => news) },
    rls: "admin-only"
});`,
    "news.ts": `
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { series } from "./series";
export const news = defineTable("news", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), headline: col.text() },
    relations: { series: rel.belongsTo(() => series) },
    rls: "admin-only"
});`,
    "long_things.ts": `
import { defineTable, col } from "@rebasepro/server/schema";
export const longThings = defineTable("long_things", {
    table: "long_things_tbl",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        aStatusColumnWithQuiteALongNameThatKeepsGoingOn: col.enum("a_status_column_with_quite_a_long_name_that_keeps_going_on", ["x"])
    },
    rls: "admin-only"
});`
};

const MATRIX_INDEX = Object.keys(MATRIX).map(file => {
    const name = file.replace(/\.ts$/, "");
    const identifier = name === "long_things" ? "longThings" : name;
    return `export { ${identifier} } from "./${name}";`;
}).join("\n") + "\n";

/** A hand-written schema of the shapes a column builder states. */
const LEGACY_SQL = `
CREATE TABLE customers (
  id serial PRIMARY KEY,
  code char(2) NOT NULL,
  full_name varchar(120) NOT NULL,
  email varchar(255) UNIQUE,
  balance numeric(10,2) NOT NULL DEFAULT 0,
  big_counter bigint,
  ratio real,
  precise double precision,
  is_vip boolean NOT NULL DEFAULT false,
  signup_date date,
  open_at time,
  avatar bytea,
  prefs json,
  tags text[],
  note text DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "order" (
  id bigserial PRIMARY KEY,
  "select" text,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  total numeric(12,2)
);
CREATE TABLE order_lines (
  order_id bigint NOT NULL REFERENCES "order"(id),
  line_no integer NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  PRIMARY KEY (order_id, line_no)
);
CREATE TABLE readings (
  sensor_id integer NOT NULL,
  taken_at timestamptz NOT NULL,
  value numeric(8,2),
  PRIMARY KEY (sensor_id, taken_at)
);
CREATE TABLE "UserAccounts" (
  "UserId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "DisplayName" text
);
CREATE TABLE codes (
  code text PRIMARY KEY,
  label text
);
`;

function cleanEnv(connectionString: string): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
        if (/^(npm_|PNPM_|pnpm_|NPM_)/i.test(key)) delete env[key];
    }
    env.DATABASE_URL = connectionString;
    // The schema modules import `@rebasepro/server/schema` from a directory
    // outside the workspace; the typecheck config maps every `@rebasepro/*`
    // onto source, so the driver and the modules share one copy of the builders.
    env.TSX_TSCONFIG_PATH = path.join(monorepoRoot, "tsconfig.typecheck.json");
    return env;
}

/** A backend dir and its schema dir, as a project lays them out. */
function scratchProject(name: string): { backend: string; schema: string } {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `rebase-${name}-`));
    fs.writeFileSync(path.join(base, "rebase.json"), JSON.stringify({ rebase: "^1" }));
    const backend = path.join(base, "backend");
    const schema = path.join(backend, "schema");
    fs.mkdirSync(schema, { recursive: true });
    fs.writeFileSync(path.join(backend, "package.json"), JSON.stringify({ name: `${name}-backend`, type: "module" }));
    return { backend, schema };
}

describe("introspect, then push: adopting a database changes nothing", () => {
    let container: PgContainer;
    let admin: pg.Client;
    const urlFor = (database: string) => container.connectionString.replace(/\/rebase(\?|$)/, `/${database}$1`);

    beforeAll(async () => {
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
    }, 120_000);

    afterAll(async () => {
        if (admin) try { await admin.end(); } catch { /* ignore */ }
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    const cli = (cwd: string, database: string, args: string[]) =>
        execa(tsxBin, [cliScript, ...args], { cwd, env: cleanEnv(urlFor(database)), reject: false, stdin: "ignore", all: true });

    async function introspectAndPlan(database: string) {
        const adopted = scratchProject(`${database}-adopted`);
        const introspected = await cli(adopted.backend, database,
            ["schema", "introspect", "--schema-dir", adopted.schema, "--force"]);
        expect(introspected.exitCode, introspected.all).toBe(0);
        const planned = await cli(adopted.backend, database,
            ["db", "push", "--dry-run", "--schema-dir", adopted.schema]);
        return { introspected, planned, adopted };
    }

    it("a database Rebase built plans no changes after a round trip", async () => {
        await admin.query("CREATE DATABASE built");
        const made = scratchProject("built");
        for (const [file, source] of Object.entries(MATRIX)) fs.writeFileSync(path.join(made.schema, file), source);
        fs.writeFileSync(path.join(made.schema, "index.ts"), MATRIX_INDEX);
        const pushed = await cli(made.backend, "built", ["db", "push", "--schema-dir", made.schema]);
        expect(pushed.exitCode, pushed.all).toBe(0);

        const { introspected, planned, adopted } = await introspectAndPlan("built");
        expect(introspected.all).not.toMatch(/would not reproduce exactly/);
        expect(planned.exitCode, planned.all).toBe(0);
        expect(planned.all).toMatch(/No changes: the database already matches these tables/);
        // A role rule reads back deparsed — `( SELECT (string_to_array(
        // rebase.roles(), ','::text) && ARRAY['admin'::text]))` — and the stamp
        // over the statement it renders then differed from the push's, so each
        // was planned as a replacement of itself.
        expect(planned.all).not.toMatch(/Planned row-level security changes/);
        expect(planned.all).not.toMatch(/replace policy/);
        expect(planned.all).not.toMatch(/carry no stamp of Rebase's/);
        // The junction's `categories_people_default_edge_write_*` policies are
        // derived from categories' update rule. Read back as SQL that did not
        // parse as a role check, the rule could not be carried into the
        // junction, so its three policies were left in force as ones no
        // table describes — and would never follow the rule again.
        expect(planned.all).not.toMatch(/no table describes/);
        const doctor = await cli(adopted.backend, "built", ["doctor", "--policies", "--schema-dir", adopted.schema]);
        expect(doctor.all).not.toMatch(/Orphaned/);
        expect(doctor.all).not.toMatch(/categories_people_default_edge_write/);
    }, 300_000);

    it("a hand-written database of shapes a property can state plans no schema change", async () => {
        await admin.query("CREATE DATABASE legacy");
        const legacy = new pg.Client({ connectionString: urlFor("legacy") });
        await legacy.connect();
        try {
            await legacy.query(LEGACY_SQL);
        } finally {
            await legacy.end();
        }

        const { introspected, planned } = await introspectAndPlan("legacy");
        // A composite key is declared on every one of its columns.
        expect(introspected.all).not.toMatch(/Skipping table "order_lines"/);
        expect(introspected.all).toMatch(/✓ .*order_lines\.ts/);
        // An instant is no key a row can be addressed by: left out, with why.
        expect(introspected.all).toMatch(/Skipping table "readings": its key includes "taken_at" \(timestamptz\)/);
        expect(introspected.all).not.toMatch(/would not reproduce exactly/);
        expect(planned.exitCode, planned.all).toBe(0);
        // Nothing for Atlas: no column, key or constraint moves.
        expect(planned.all).not.toMatch(/Planned changes:/);
        // What does change, said in both places: RLS goes on, and with it
        // the admin baseline every table keeps.
        expect(introspected.all).toMatch(/5 table\(s\) have row-level security off, so every request reaches every row: UserAccounts, codes, customers, order, order_lines\./);
        expect(planned.all).toMatch(/Planned row-level security changes:/);
        for (const table of ["UserAccounts", "codes", "customers", "order", "order_lines"]) {
            expect(planned.all).toContain(`switch RLS on   public.${table}`);
            expect(planned.all).toContain(`create policy   public.${table} → "${table}_default_admin_read"`);
        }
    }, 300_000);
});
