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
 *   1. a database Rebase built (`db push` of a property × relation matrix),
 *      introspected into fresh collection files, planned again — no changes;
 *   2. a hand-written legacy database of shapes a property can state,
 *      introspected and planned — no changes, and the table keyed on two
 *      columns is left out with its reason.
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

/** The matrix: every property kind and every relation kind `db push` builds. */
const MATRIX: Record<string, string> = {
    "people.js": `
import categories from "./categories.js";
import addresses from "./addresses.js";
import profiles from "./profiles.js";
export default {
    name: "People", slug: "people", table: "people",
    search: { fields: [{ path: "name", weight: "A" }, { path: "bio", weight: "B" }] },
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { name: "Name", type: "string", validation: { required: true } },
        email: { name: "Email", type: "string", validation: { unique: true } },
        bio: { name: "Bio", type: "string", columnType: "text" },
        nickname: { name: "Nickname", type: "string", columnType: "varchar", validation: { max: 40 } },
        age: { name: "Age", type: "number", validation: { integer: true } },
        rating: { name: "Rating", type: "number", precision: 5, scale: 2 },
        score: { name: "Score", type: "number" },
        big: { name: "Big", type: "number", columnType: "bigint" },
        active: { name: "Active", type: "boolean", defaultValue: true },
        born: { name: "Born", type: "date", columnType: "date" },
        wakeAt: { name: "Wake", type: "date", columnType: "time" },
        createdAt: { name: "Created", type: "date", autoValue: "on_create" },
        status: { name: "Status", type: "string", defaultValue: "new", enum: [{ id: "new", label: "New" }, { id: "old", label: "Old" }] },
        aliases: { name: "Aliases", type: "array", of: { type: "string" } },
        lucky: { name: "Lucky", type: "array", columnType: "integer[]", of: { type: "number" } },
        meta: { name: "Meta", type: "map", keyValue: true },
        prefs: { name: "Prefs", type: "map", columnType: "json", keyValue: true },
        categories: { name: "Categories", type: "relation", relation: { kind: "manyToMany", target: () => categories } },
        addresses: { name: "Addresses", type: "relation", relation: { kind: "hasMany", target: () => addresses } },
        profile: { name: "Profile", type: "relation", relation: { kind: "hasOne", target: () => profiles } }
    }
};`,
    "categories.js": `
import people from "./people.js";
export default {
    name: "Categories", slug: "categories", table: "categories",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        people: { name: "People", type: "relation", relation: { kind: "manyToMany", target: () => people } }
    }
};`,
    "addresses.js": `
import people from "./people.js";
export default {
    name: "Addresses", slug: "addresses", table: "addresses",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        line: { name: "Line", type: "string" },
        person: { name: "Person", type: "relation", validation: { required: true },
            relation: { kind: "belongsTo", target: () => people, onDelete: "cascade" } }
    }
};`,
    "profiles.js": `
import people from "./people.js";
export default {
    name: "Profiles", slug: "profiles", table: "profiles",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        handle: { name: "Handle", type: "string" },
        person: { name: "Person", type: "relation", relation: { kind: "belongsTo", target: () => people } }
    }
};`,
    "orders.js": `
import orders from "./orders.js";
export default {
    name: "Orders", slug: "orders", table: "order",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        select: { name: "Select", type: "string" },
        group: { name: "Group", type: "string", enum: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
        friends: { name: "Friends", type: "relation", relation: { kind: "manyToMany", target: () => orders } }
    }
};`,
    "series.js": `
import news from "./news.js";
export default {
    name: "Series", slug: "series", table: "series",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        news: { name: "News", type: "relation", relation: { kind: "manyToMany", target: () => news } }
    }
};`,
    "news.js": `
import series from "./series.js";
export default {
    name: "News", slug: "news", table: "news",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        headline: { name: "Headline", type: "string" },
        series: { name: "Series", type: "relation", relation: { kind: "belongsTo", target: () => series } }
    }
};`,
    "long_things.js": `
export default {
    name: "Long", slug: "long_things", table: "long_things_tbl",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        a_status_column_with_quite_a_long_name_that_keeps_going_on: { name: "S", type: "string", enum: [{ id: "x", label: "X" }] }
    }
};`
};

/** A hand-written schema, made only of shapes a property can state. */
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
    return env;
}

/** A backend dir and an empty collections dir beside it, as a project lays them out. */
function scratchProject(name: string): { backend: string; collections: string } {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `rebase-${name}-`));
    const backend = path.join(base, "backend");
    const collections = path.join(base, "config", "collections");
    fs.mkdirSync(backend, { recursive: true });
    fs.mkdirSync(collections, { recursive: true });
    fs.writeFileSync(path.join(backend, "package.json"), JSON.stringify({ name: `${name}-backend`, type: "module" }));
    fs.writeFileSync(path.join(collections, "package.json"), JSON.stringify({ type: "module" }));
    return { backend, collections };
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
            ["schema", "introspect", "--output", adopted.collections, "--force"]);
        expect(introspected.exitCode, introspected.all).toBe(0);
        const planned = await cli(adopted.backend, database,
            ["db", "push", "--dry-run", "--collections", adopted.collections]);
        return { introspected, planned };
    }

    it("a database Rebase built plans no changes after a round trip", async () => {
        await admin.query("CREATE DATABASE built");
        const made = scratchProject("built");
        for (const [file, source] of Object.entries(MATRIX)) fs.writeFileSync(path.join(made.collections, file), source);
        fs.writeFileSync(path.join(made.collections, "index.js"),
            Object.keys(MATRIX).map((file, i) => `import c${i} from "./${file}";`).join("\n")
            + `\nexport default [${Object.keys(MATRIX).map((_, i) => `c${i}`).join(", ")}];\n`);
        const pushed = await cli(made.backend, "built", ["db", "push", "--collections", made.collections]);
        expect(pushed.exitCode, pushed.all).toBe(0);

        const { introspected, planned } = await introspectAndPlan("built");
        expect(introspected.all).not.toMatch(/will not round-trip/);
        expect(planned.exitCode, planned.all).toBe(0);
        expect(planned.all).toMatch(/No changes: the database already matches these collections/);
    }, 300_000);

    it("a hand-written database of shapes a property can state plans no changes", async () => {
        await admin.query("CREATE DATABASE legacy");
        const legacy = new pg.Client({ connectionString: urlFor("legacy") });
        await legacy.connect();
        try {
            await legacy.query(LEGACY_SQL);
        } finally {
            await legacy.end();
        }

        const { introspected, planned } = await introspectAndPlan("legacy");
        expect(introspected.all).toMatch(/Skipping table "order_lines": it is keyed on \(order_id, line_no\)/);
        expect(introspected.all).not.toMatch(/will not round-trip/);
        expect(planned.exitCode, planned.all).toBe(0);
        expect(planned.all).toMatch(/No changes: the database already matches these collections/);
    }, 300_000);
});
