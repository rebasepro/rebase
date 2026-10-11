/**
 * check:auth-sql-tests — which auth modules issue SQL, which tests run a real
 * database, and which modules no such test imports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { constructsRealDatabase, importsOf, isAuthSource, issuesSql, uncoveredModules } from "../check-auth-sql-tests.mjs";

test("auth source is a non-test module under some package's src/**/auth/", () => {
    assert.equal(isAuthSource("packages/server/src/auth/sql-rate-limit-store.ts"), true);
    assert.equal(isAuthSource("packages/server-postgres/src/auth/services.ts"), true);
    assert.equal(isAuthSource("packages/server/src/auth/sql-rate-limit-store.test.ts"), false);
    assert.equal(isAuthSource("packages/server/src/api/rest/handlers.ts"), false);
    assert.equal(isAuthSource("packages/server/test/auth/x.ts"), false);
    assert.equal(isAuthSource("packages/types/src/auth/types.d.ts"), false);
});

test("SQL is drizzle, a sql`` template or an execute call — not the word in a comment or c.req.query", () => {
    assert.equal(issuesSql('import { eq } from "drizzle-orm";'), true);
    assert.equal(issuesSql('import { sql } from "drizzle-orm/sql";'), true);
    assert.equal(issuesSql("await db.execute(sql`select 1`);"), true);
    assert.equal(issuesSql("const r = await admin.executeSql(text, params);"), true);
    assert.equal(issuesSql('const token = c.req.query("token");'), false);
    assert.equal(issuesSql("/** shared with `REBASE_RATE_LIMIT_STORE=sql`. */\nexport const x = 1;"), false);
    assert.equal(issuesSql("// db.execute(sql`select 1`)\nexport const x = 1;"), false);
});

test("a real database is PGlite or a pg Pool/Client, constructed", () => {
    assert.equal(constructsRealDatabase('import { PGlite } from "@electric-sql/pglite";\nconst db = new PGlite();'), true);
    assert.equal(constructsRealDatabase("const db = await PGlite.create();"), true);
    assert.equal(constructsRealDatabase('import { Pool } from "pg";\nconst pool = new Pool({ connectionString });'), true);
    assert.equal(constructsRealDatabase('import pg from "pg";\nconst client = new pg.Client(url);'), true);
    // A mocked driver is not a database.
    assert.equal(constructsRealDatabase('jest.mock("drizzle-orm");\nconst db = { execute: jest.fn() };'), false);
    assert.equal(constructsRealDatabase("// new PGlite() would be nicer"), false);
});

test("imports are read from static, dynamic and require forms", () => {
    const specs = importsOf([
        'import { MfaService } from "../src/auth/services";',
        'import type { X } from "../src/auth/interfaces";',
        'const { y } = await import("../../server/src/auth/sql-rate-limit-store.js");',
        'const z = require("./helpers/db");',
        'export { w } from "../src/auth/ensure-tables";'
    ].join("\n"));
    assert.deepEqual(specs, [
        "../src/auth/services",
        "../src/auth/interfaces",
        "../../server/src/auth/sql-rate-limit-store.js",
        "./helpers/db",
        "../src/auth/ensure-tables"
    ]);
});

test("a module is covered only by a real-database test that imports it, directly or through a local helper", () => {
    const files = new Map([
        ["packages/sp/src/auth/services.ts", 'import { eq } from "drizzle-orm";'],
        ["packages/sp/src/auth/store.ts", "await db.execute(sql`select 1`);"],
        ["packages/sp/src/auth/plain.ts", "export const x = 1;"],
        // Imports services and runs PGlite: covers it.
        ["packages/sp/test/services-pglite.test.ts", 'import { PGlite } from "@electric-sql/pglite";\nimport { S } from "../src/auth/services";\nnew PGlite();'],
        // Imports store, but over a mocked driver: does not cover it.
        ["packages/sp/test/store.test.ts", 'jest.mock("drizzle-orm");\nimport { s } from "../src/auth/store";'],
        // The database is built in a helper the test imports.
        ["packages/sp/test/helpers/db.ts", 'import { PGlite } from "@electric-sql/pglite";\nexport const make = () => new PGlite();'],
        ["packages/sp/test/via-helper.test.ts", 'import { make } from "./helpers/db";\nimport { x } from "../src/auth/plain";']
    ]);
    const read = (file) => files.get(file);
    const exists = (file) => files.has(file);
    const sources = [...files.keys()].filter(isAuthSource);
    const tests = [...files.keys()].filter((file) => file.endsWith(".test.ts"));
    assert.deepEqual(uncoveredModules({ sources, tests, read, exists }), ["packages/sp/src/auth/store.ts"]);
});
