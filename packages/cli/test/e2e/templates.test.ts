/**
 * Every `rebase init` template, taken all the way to a persisted row.
 *
 * For each preset x flavor this scaffolds, installs, bootstraps a real
 * PostgreSQL database, boots the backend, registers and logs in a user, writes
 * through the HTTP data API, reads it back, and finally confirms the row in
 * Postgres — so a template that scaffolds and typechecks but cannot actually
 * store anything still fails.
 *
 * The two flavors are shaped differently on purpose:
 *   cms  — collections are declared in files, so `db push` creates the tables.
 *   baas — there are no collection files; a table is served only once it has
 *          row-level security and a policy. The baas cases therefore assert
 *          the security posture too: an unprotected table must NOT be served,
 *          and `rebase.uid()` must isolate one user's rows from another's.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execa } from "execa";
import pg from "pg";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import {
    cliBin,
    getCleanEnv,
    assertPackagesBuilt,
    linkLocalPackages,
    startBackend,
    stopBackend,
    registerAndLogin,
    claimFirstAdmin,
    FIRST_ADMIN,
    login,
    writeRow,
    readRows,
    type RunningBackend
} from "./helpers.js";

const env = getCleanEnv();

interface CmsCase {
    preset: "blog" | "ecommerce" | "blank";
    /** Collection to write into over /api/data. */
    collection: string;
    row: Record<string, unknown>;
    /**
     * A second, non-colliding row used to probe unknown-field rejection.
     * It must not reuse `row`'s identity: on the blank preset the collection is
     * the users table, and a duplicate email trips the unique constraint first,
     * masking the validation error under test.
     */
    probeRow: Record<string, unknown>;
    /**
     * Whether an undeclared field is a 400 on this collection.
     *
     * Auth collections are exempt by design: a signup body carries `password`
     * and provider fields the users collection never declares as columns, so
     * api-generator.ts skips the check and lets `prepareUserCreation` map the
     * body onto real columns. The consequence is that an undeclared field on an
     * auth collection is silently dropped rather than reported.
     */
    rejectsUnknownFields: boolean;
    /** Schema-qualified table to confirm the row in. */
    table: string;
    /** Column to read back. */
    column: string;
    expected: string;
    /**
     * Rows the API should report afterwards. The blank preset's only
     * collection is the auth users table, which already holds the admin
     * `rebase init` named in `.env` and boot created.
     */
    expectedTotal: number;
}

const CMS_CASES: CmsCase[] = [
    {
        preset: "blog",
        collection: "posts",
        row: { title: "Hello from e2e", content: "Written by the e2e suite.", status: "published" },
        probeRow: { title: "Probe", content: "Probe.", status: "published" },
        rejectsUnknownFields: true,
        table: "public.posts",
        column: "title",
        expected: "Hello from e2e",
        expectedTotal: 1
    },
    {
        preset: "ecommerce",
        collection: "products",
        row: { name: "E2E Widget", description: "Written by the e2e suite.", price: 19.99 },
        probeRow: { name: "Probe Widget", description: "Probe.", price: 1.0 },
        rejectsUnknownFields: true,
        table: "public.products",
        column: "name",
        expected: "E2E Widget",
        expectedTotal: 1
    },
    {
        preset: "blank",
        collection: "users",
        row: { email: "second@example.com", password: "StrongPass2!", displayName: "Second User" },
        probeRow: { email: "probe@example.com", password: "StrongPass3!", displayName: "Probe User" },
        // `users` is an auth collection. Its signup body legitimately carries
        // `password`, which the table does not declare — but that is the *only*
        // exemption (the adapter's create contract), so any other undeclared
        // field is still a 400, same as a normal collection. This used to be
        // `false`, because the check was skipped for auth collections wholesale
        // and an undeclared field was silently dropped with a 201.
        rejectsUnknownFields: true,
        table: "rebase.users",
        column: "email",
        expected: "second@example.com",
        expectedTotal: 2
    }
];

const BAAS_PRESETS = ["blog", "ecommerce", "blank"] as const;

let pgContainer: PgContainer;
let tempDir: string;
let adminClient: pg.Client;

/** A connection string for a dedicated database on the shared container. */
function urlFor(database: string): string {
    return `postgresql://rebase:rebase@localhost:${pgContainer.port}/${database}` +
        "?options=-c%20search_path=public&sslmode=disable";
}

async function createDatabase(name: string): Promise<string> {
    await adminClient.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE ${name}`);
    return urlFor(name);
}

/** Scaffold, point the deps at the working tree, and install. */
async function scaffold(name: string, preset: string, flavor: string, databaseUrl: string): Promise<string> {
    // No --install here: the dependencies must be redirected to the local
    // packages before anything is fetched.
    //
    // `--headless` is what makes the baas cases baas. It used to be implied by a
    // `flavor` concept the CLI has since dropped, and when that went the argument
    // stopped reaching `init` — so every "baas template" case scaffolded an
    // ordinary project and then asserted it had no `config/` directory. The
    // parameter survived as a label on a distinction that was no longer being
    // made.
    await execa("node", [
        cliBin, "init", name,
        "--yes",
        ...(flavor === "baas" ? ["--headless"] : []),
        "--template", preset,
        "--database-url", databaseUrl
    ], { cwd: tempDir, env });

    const projectDir = path.join(tempDir, name);
    linkLocalPackages(projectDir);
    await execa("pnpm", ["install"], { cwd: projectDir, env });
    return projectDir;
}

beforeAll(async () => {
    // Before spending minutes on containers and installs: the scaffold links
    // these packages and loads their dist/, so an unbuilt tree tests old code.
    assertPackagesBuilt();

    pgContainer = await startPgContainer();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-templates-e2e-"));
    adminClient = new pg.Client({ connectionString: pgContainer.connectionString });
    await adminClient.connect();
}, 240_000);

afterAll(async () => {
    try { await adminClient?.end(); } catch { /* ignore */ }
    if (pgContainer) await stopPgContainer(pgContainer.containerName);
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}, 120_000);

describe.each(CMS_CASES)("cms template: $preset", (testCase) => {
    const name = `${testCase.preset}-cms`;
    const database = `db_${testCase.preset}_cms`;
    let projectDir: string;
    let client: pg.Client;
    let backend: RunningBackend | undefined;
    /** The first user registered against this project — see the admin test. */
    let admin: { uid: string; roles: string[]; accessToken: string };

    beforeAll(async () => {
        const databaseUrl = await createDatabase(database);
        projectDir = await scaffold(name, testCase.preset, "cms", databaseUrl);

        // cms declares its schema in files, so this is what creates the tables.
        // No `--force`: `db push` has never had one. It was accepted because
        // every driver parser ran `arg(..., { permissive: true })`, which turns
        // an undeclared flag into a positional — so this line asked for
        // something and silently got nothing for as long as it existed. The
        // fresh database it pushes into has nothing to destroy, so the
        // destructive gate it was presumably reaching for never fires.
        await execa("node", [cliBin, "db", "push", "--collections", "../config/collections"], {
            cwd: projectDir,
            env
        });

        client = new pg.Client({ connectionString: databaseUrl });
        await client.connect();
        backend = await startBackend(projectDir, env);

        // The first registered account, which is the admin — the documented
        // path, and the one `rebase dev` still takes: `REBASE_ADMIN_*` in the
        // scaffold's `.env` belongs to the production boot and is ignored here.
        //
        // Once, in `beforeAll`: registering inside each test would add rows to
        // the blank preset, whose only collection is `users`.
        admin = await claimFirstAdmin(backend.baseUrl);
    }, 600_000);

    afterAll(async () => {
        await stopBackend(backend);
        try { await client?.end(); } catch { /* ignore */ }
    }, 60_000);

    it("scaffolds the collections the preset promises", () => {
        const collections = fs.readdirSync(path.join(projectDir, "config", "collections"));
        expect(collections).toContain("users.ts");
        if (testCase.preset === "blog") {
            expect(collections).toEqual(expect.arrayContaining(["posts.ts", "authors.ts", "tags.ts"]));
        } else if (testCase.preset === "ecommerce") {
            expect(collections).toEqual(expect.arrayContaining(["products.ts", "categories.ts", "orders.ts"]));
        } else {
            // blank ships auth and nothing else.
            expect(collections.sort()).toEqual(["index.ts", "users.ts"]);
        }
    });

    it("seeds the admin named in .env, with the admin role", () => {
        expect(admin.roles).toContain("admin");
    });

    it("writes through the API and persists the row in Postgres", async () => {
        const written = await writeRow(backend!.baseUrl, admin.accessToken, testCase.collection, testCase.row);
        expect(written.status, JSON.stringify(written.body)).toBeLessThan(300);
        expect(written.body.id).toBeDefined();

        const read = await readRows(backend!.baseUrl, admin.accessToken, testCase.collection);
        expect(read.status).toBe(200);
        expect(read.total).toBe(testCase.expectedTotal);

        // Postgres is the source of truth: an API that echoes back what it was
        // sent without storing it would pass every assertion above.
        const { rows } = await client.query(
            `SELECT ${testCase.column} AS value FROM ${testCase.table} WHERE ${testCase.column} = $1`,
            [testCase.expected]
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].value).toBe(testCase.expected);
    }, 120_000);

    // The scaffolded example function is the shape every custom route in the
    // project gets copied from, so its guards have to be real. The functions
    // router is deliberately mounted with `requireAuth: false` — a webhook
    // receiver has no token — which means a `requireAuth` that composed but did
    // not enforce would look exactly like this template working.
    it("enforces the three auth tiers the example function demonstrates", async () => {
        const fn = `${backend!.baseUrl}/api/functions/hello`;
        const auth = { Authorization: `Bearer ${admin.accessToken}` };

        // Public by design.
        expect((await fetch(fn)).status).toBe(200);

        // requireAuth.
        const anonPost = await fetch(fn, { method: "POST" });
        expect(anonPost.status).toBe(401);
        const authedPost = await fetch(fn, {
            method: "POST",
            headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify({ name: "e2e" })
        });
        expect(authedPost.status).toBe(200);
        // …and the identity actually reaches the handler. The previous example
        // read a `userId` claim the tokens do not carry, so it reported
        // "anonymous" for every caller, signed in or not.
        expect((await authedPost.json() as any).user).toBe(admin.uid);

        // requireAdmin. The first registered user is the admin, so the same
        // token that is merely "signed in" above is also the admin here.
        expect((await fetch(`${fn}/stats`)).status).toBe(401);
        const adminGet = await fetch(`${fn}/stats`, { headers: auth });
        expect(adminGet.status, await adminGet.text()).toBe(200);
    }, 60_000);

    it.runIf(testCase.rejectsUnknownFields)("rejects a field the collection does not declare", async () => {
        const bad = await writeRow(backend!.baseUrl, admin.accessToken, testCase.collection, {
            ...testCase.probeRow,
            definitely_not_a_field: "x"
        });
        expect(bad.status).toBeGreaterThanOrEqual(400);
        // The message must name the offending field, not just say "invalid".
        expect(JSON.stringify(bad.body)).toContain("definitely_not_a_field");
    }, 60_000);
});

describe.each(BAAS_PRESETS)("baas template: %s", (preset) => {
    const name = `${preset}-baas`;
    const database = `db_${preset}_baas`;
    let projectDir: string;
    let client: pg.Client;
    let backend: RunningBackend | undefined;

    beforeAll(async () => {
        const databaseUrl = await createDatabase(database);
        projectDir = await scaffold(name, preset, "baas", databaseUrl);
        client = new pg.Client({ connectionString: databaseUrl });
        await client.connect();
        // baas has no db:push; the auth schema is created by the server at boot.
        backend = await startBackend(projectDir, env);
        // The first registered account, which is the admin — and the one the
        // RLS test below signs in as after a restart. Nothing else creates it:
        // `REBASE_ADMIN_*` in the scaffold's `.env` belongs to the production
        // boot and is ignored here, which is the whole point of that change.
        await claimFirstAdmin(backend.baseUrl);
    }, 600_000);

    afterAll(async () => {
        await stopBackend(backend);
        try { await client?.end(); } catch { /* ignore */ }
    }, 60_000);

    it("scaffolds no collections and no admin UI", () => {
        // "No collections" means no `config/collections` — not no `config`. The
        // headless scaffold still ships a config package, and has since
        // d71452ffa: storage does not run under row-level security and its keys
        // share one flat namespace, so without an access model a deployment with
        // file storage serves every user's files to every signed-in user. The
        // server refuses to boot without it, and `config/index.ts` is the export
        // it looks for. Asserting the whole directory away asserted that guard
        // away with it.
        expect(fs.existsSync(path.join(projectDir, "config", "collections"))).toBe(false);
        expect(fs.existsSync(path.join(projectDir, "frontend"))).toBe(false);
        // The config package is present, and carries the storage access model.
        expect(fs.existsSync(path.join(projectDir, "config", "index.ts"))).toBe(true);
        expect(fs.readFileSync(path.join(projectDir, "config", "index.ts"), "utf-8"))
            .toContain("storageAuthorize");
    });

    it("bootstraps the auth schema without a db push", async () => {
        // A round trip through register and login is what proves the tables are
        // there. The address is deliberately NOT the seeded admin's: `init`
        // writes that one into `.env` and boot creates it, so registering it
        // proves nothing and answers 409.
        const user = await registerAndLogin(backend!.baseUrl, "second@example.com", "StrongPass2!");
        expect(user.uid).toBeTruthy();
    }, 60_000);

    it("refuses to serve a table that has no row-level security", async () => {
        // Schema-qualified on purpose. The scaffold's role is `rebase_app`
        // now, so `"$user"` no longer resolves to the `rebase` schema for a new
        // project — but this suite may run against a database whose role does
        // collide, and naming the schema costs nothing and depends on neither.
        await client.query(`
            CREATE TABLE public.notes (
                id serial PRIMARY KEY,
                body text NOT NULL,
                user_id text NOT NULL DEFAULT rebase.uid()
            )
        `);

        await stopBackend(backend);
        backend = await startBackend(projectDir, env);

        const res = await fetch(`${backend.baseUrl}/api/data/notes`);
        expect(res.status).toBe(404);

        // Silently skipping would be indistinguishable from a broken server,
        // so the boot output has to name the table and say what to do.
        expect(backend.output()).toContain("notes");
        expect(backend.output()).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    }, 240_000);

    it("serves the table once RLS and a policy exist, and isolates rows by rebase.uid()", async () => {
        await client.query("ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY");
        await client.query(`
            CREATE POLICY notes_owner ON public.notes
                FOR ALL USING (user_id = rebase.uid())
                WITH CHECK (user_id = rebase.uid())
        `);

        await stopBackend(backend);
        backend = await startBackend(projectDir, env);

        // The first registered account owns the row. Signed in rather than
        // registered: the backend was restarted above, so it already exists.
        const owner = await login(backend.baseUrl, FIRST_ADMIN.email, FIRST_ADMIN.password);
        const other = await registerAndLogin(backend.baseUrl, "other@example.com", "StrongPass3!");

        const written = await writeRow(backend.baseUrl, owner.accessToken, "notes", { body: "owner's private note" });
        expect(written.status, JSON.stringify(written.body)).toBeLessThan(300);

        const ownerView = await readRows(backend.baseUrl, owner.accessToken, "notes");
        expect(ownerView.rows).toHaveLength(1);

        // The whole point of the RLS gate: another authenticated user must not
        // see it. rebase.uid() is what makes that true.
        const otherView = await readRows(backend.baseUrl, other.accessToken, "notes");
        expect(otherView.rows).toHaveLength(0);

        const { rows } = await client.query("SELECT body, user_id FROM public.notes");
        expect(rows).toHaveLength(1);
        expect(rows[0].body).toBe("owner's private note");
        expect(rows[0].user_id).toBe(owner.uid);
    }, 240_000);
});
