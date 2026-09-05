/**
 * The first run `rebase init` prints — and nothing else.
 *
 * ## Why this file exists next to `templates.test.ts`
 *
 * Every other e2e here scaffolds with `--database-url` pointed at a throwaway
 * Postgres container and runs `rebase db push` before booting. That is a real
 * path, but it is not the one a new project takes: `rebase init` leaves
 * `DATABASE_URL` commented out on purpose, so `rebase dev` starts the managed
 * PGlite database, and the next steps it prints are `install` then `run dev` —
 * no container, no push.
 *
 * The gap between the tested path and the documented one hid a total failure of
 * the quickstart, in the worst shape a first run can have: **the database was
 * fine**. Boot created every table through the additive ensure, registration
 * worked, the admin panel loaded — and every `GET /api/data/*` answered 500,
 * because the driver looks a table up in `backend/src/schema.generated.ts`,
 * which the scaffold ships as `export const tables = {}`. On the container path
 * `db push` rewrote that file as step one of three. On this path nothing did.
 * Nothing in the suite noticed, because nothing in the suite took this path.
 *
 * So: no container, no push, no flags. This is the quickstart, executed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execa } from "execa";
import {
    cliBin,
    getCleanEnv,
    assertPackagesBuilt,
    linkLocalPackages,
    startBackend,
    stopBackend,
    loginSeededAdmin,
    writeRow,
    readRows,
    type RunningBackend
} from "./helpers.js";

const env = getCleanEnv();

let tempDir: string;
let projectDir: string;
let backend: RunningBackend | undefined;
let admin: { uid: string; roles: string[]; accessToken: string };
/** `backend/src/schema.generated.ts` as the scaffold shipped it, before `dev` ran. */
let shippedSchema = "";

beforeAll(async () => {
    // The scaffold consumes these as built output; an unbuilt tree tests old code.
    assertPackagesBuilt();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-first-run-e2e-"));

    // No --database-url. That single omission is what puts this on the managed
    // path, and it is the whole point of the file — a `--database-url` added
    // here for any reason silently turns this back into a duplicate of
    // templates.test.ts.
    await execa("node", [cliBin, "init", "myapp", "--yes", "--template", "blog"], {
        cwd: tempDir,
        env
    });

    projectDir = path.join(tempDir, "myapp");
    shippedSchema = fs.readFileSync(path.join(projectDir, "backend", "src", "schema.generated.ts"), "utf8");

    linkLocalPackages(projectDir);
    await execa("pnpm", ["install"], { cwd: projectDir, env });

    // `rebase dev --backend-only`, exactly as the printed next steps say — and
    // nothing between it and the install.
    backend = await startBackend(projectDir, env);
    // Signed in, not registered. `rebase init` names the first admin in `.env`
    // and the runtime creates it while the user table is empty, so the account
    // this suite used to register itself is already there — and registering it
    // answered `409 EMAIL_EXISTS`, which is what a reader following the
    // quickstart would hit too if they typed the default address.
    admin = await loginSeededAdmin(projectDir, backend.baseUrl);
}, 900_000);

afterAll(async () => {
    await stopBackend(backend);

    // The managed database is spawned detached and unref'd on purpose, so that
    // the next `rebase dev` reuses it — which means killing the dev server does
    // NOT reap it. Without this the suite leaves a PGlite daemon holding a port
    // and a data directory that the rm below then deletes underneath it.
    if (projectDir) {
        await execa("node", [cliBin, "db", "stop"], { cwd: projectDir, env, reject: false });
    }
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}, 120_000);

describe("the documented first run", () => {
    it("takes the managed database, with no Docker and no push", () => {
        // Pins the path under test. If the default ever becomes a container
        // again, this says so here rather than letting the rest of the file
        // quietly re-test what templates.test.ts already covers.
        expect(fs.existsSync(path.join(projectDir, ".rebase", "pgdata"))).toBe(true);
        expect(backend?.output()).toContain("managed development database");
    });

    it("regenerates the schema the scaffold ships as a stub", () => {
        // The precondition, asserted rather than assumed: a template that starts
        // shipping a real schema changes what this file is guarding.
        expect(shippedSchema).toContain("export const tables = {}");

        const generated = fs.readFileSync(
            path.join(projectDir, "backend", "src", "schema.generated.ts"),
            "utf8"
        );
        expect(generated).not.toContain("export const tables = {}");
        expect(generated).toContain("posts");
    });

    it("reads a collection", async () => {
        // The assertion the whole file is for. This was a 500 on a project that
        // had done nothing wrong, with a valid admin token and a healthy database.
        const read = await readRows(backend!.baseUrl, admin.accessToken, "posts");
        expect(read.status).toBe(200);
        expect(read.rows).toEqual([]);
    });

    it("writes a row and reads it back", async () => {
        // A 200 on an empty collection can be produced by a driver that knows
        // nothing about the table, so round-trip an actual row.
        const write = await writeRow(backend!.baseUrl, admin.accessToken, "posts", {
            title: "Hello from the first run",
            content: "Written by the e2e suite.",
            status: "published"
        });
        expect(write.status).toBe(201);

        const read = await readRows(backend!.baseUrl, admin.accessToken, "posts");
        expect(read.status).toBe(200);
        expect(read.rows.map((r: { title: string }) => r.title)).toContain("Hello from the first run");
    });

    it("seeds the admin named in .env, with the admin role", () => {
        // The scaffold's own account, on the managed-database path: `init`
        // writes the address and a generated password, and boot creates it
        // before anyone can register. That the role comes with it is the whole
        // reason the account exists — a seeded user without it would leave a
        // first run with no way into the admin panel at all.
        expect(admin.roles).toContain("admin");
    });
});

describe("rebase db push on the managed database", () => {
    it("refuses up front, and names what to do instead", async () => {
        // Atlas plans a diff by replaying into a second empty database; PGlite
        // serves exactly one, so `CREATE DATABASE` succeeds without creating
        // anything and Atlas ends up comparing the database with itself. There
        // is nothing to fix by trying harder, so the command has to say so —
        // and it used to fail two errors deep instead, first with
        // `pq: SSL is not enabled on the server` and then with advice to edit a
        // DATABASE_URL that is unset precisely because this path is in use.
        const result = await execa(
            "node",
            [cliBin, "db", "push", "--collections", "../config/collections"],
            { cwd: projectDir, env, reject: false }
        );

        expect(result.exitCode).toBe(1);
        const output = `${result.stdout}\n${result.stderr}`;
        expect(output).toContain("does not work on the managed development database");
        // The way out, both halves: what already covers it, and what to switch to.
        expect(output).toContain("rebase dev");
        expect(output).toContain("DATABASE_URL");
        // The two errors it used to produce first.
        expect(output).not.toContain("SSL is not enabled");
        expect(output).not.toContain("not clean");
    });
});
