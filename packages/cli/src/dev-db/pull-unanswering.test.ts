/**
 * The pull's own connections to the local database, when it stops answering.
 *
 * A wedged managed database refuses nothing: its daemon accepts the socket
 * and then never answers. A connection with no bound waits on it for good.
 * The re-grant's did, after a pull from a LATIN1 database. These are the
 * connections `dumpSource` and `restoreCopy` open, against a server that
 * answers nothing (see `__fixtures__/unanswering-postgres.ts`), with the bounds
 * shortened so a hang shows up as a test that runs out of time.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unansweringPostgres, type UnansweringPostgres } from "./__fixtures__/unanswering-postgres";
import { dumpSource, restoreCopy, type PullPlan } from "./pull";

vi.mock("./local-timeouts", () => ({ LOCAL_CONNECT_TIMEOUT_MS: 300, LOCAL_QUERY_TIMEOUT_MS: 300 }));

describe("the pull's connections to a local database that does not answer", () => {
    let server: UnansweringPostgres | null = null;
    let dir = "";

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-pull-unanswering-"));
    });

    afterEach(async () => {
        await server?.close();
        server = null;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function plan(target: string): PullPlan {
        return { source: "postgresql://u:pw@prod.example.com/app", target, anonymize: false, schemas: [] };
    }

    it("restoreCopy gives up on a connection that is never answered, and says the database is as it was", async () => {
        server = await unansweringPostgres("silent");
        const dumpFile = path.join(dir, "pull.dump");
        fs.writeFileSync(dumpFile, "not a pg_dump archive");

        const outcome = await restoreCopy(plan(server.url), dumpFile);

        expect(server.connections()).toBeGreaterThan(0);
        expect(outcome).toMatchObject({ cleared: false, started: false });
        expect(outcome.failure).toMatch(/timeout/i);
    }, 5_000);

    it("restoreCopy gives up on a query that is never answered, and says the database is as it was", async () => {
        server = await unansweringPostgres("after-handshake");
        const dumpFile = path.join(dir, "pull.dump");
        fs.writeFileSync(dumpFile, "not a pg_dump archive");

        const outcome = await restoreCopy(plan(server.url), dumpFile);

        expect(outcome).toMatchObject({ cleared: false, started: false });
        expect(outcome.failure).toMatch(/timeout/i);
    }, 5_000);

    it("dumpSource gives up on a local database that connects and never answers, before reading the source", async () => {
        server = await unansweringPostgres("after-handshake");
        const dumpFile = path.join(dir, "pull.dump");

        const outcome = await dumpSource(plan(server.url), dumpFile);

        expect(outcome.ok).toBe(false);
        const text = outcome.ok ? "" : outcome.lines.join("\n");
        expect(text).toContain(`Cannot connect to PostgreSQL at 127.0.0.1:${new URL(server.url).port}`);
        expect(text).toMatch(/timeout/i);
        expect(fs.existsSync(dumpFile)).toBe(false);
    }, 5_000);
});
