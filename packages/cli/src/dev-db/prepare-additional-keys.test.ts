/**
 * The declared databases reach a command's environment on the managed
 * database, and cost nothing anywhere else.
 *
 * `rebase dev` bound `DATABASE_URL__<KEY>` for every `database("<key>")` the
 * project declares; every other command started the same managed database and
 * bound none of them, so `rebase db push --database analytics` found no
 * connection string. The keys may be handed over as a function, read only on
 * the managed path — a project on its own Postgres does not evaluate its
 * resources to learn them.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ensureManagedDatabase } = vi.hoisted(() => ({
    ensureManagedDatabase: vi.fn(async (_root: string, options: { additionalKeys?: readonly string[] }) => ({
        url: "postgres://rebase@127.0.0.1:55001/rebase",
        dataDir: "/tmp/pgdata",
        port: 55001,
        pid: 1,
        started: false,
        additional: Object.fromEntries((options.additionalKeys ?? []).map((key, i) => [key, `postgres://rebase@127.0.0.1:${55100 + i}/rebase`]))
    }))
}));

vi.mock("./daemon", async importOriginal => ({
    ...(await importOriginal<typeof import("./daemon")>()),
    ensureManagedDatabase
}));

import { prepareDatabaseEnv } from "./prepare";

let root: string;
const originalEnv = { ...process.env };

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-prepare-keys-")));
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL__ANALYTICS;
    delete process.env.DATABASE_URL__WAREHOUSE;
    ensureManagedDatabase.mockClear();
});

afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(root, { recursive: true, force: true });
});

describe("the declared databases, handed over as a function", () => {
    it("are read on the managed path and bound as DATABASE_URL__<KEY>", async () => {
        const keys = vi.fn(async () => ["analytics", "warehouse"]);

        const prepared = await prepareDatabaseEnv(root, { followLastDev: false, additionalKeys: keys });

        expect(keys).toHaveBeenCalledTimes(1);
        expect(prepared.database.kind).toBe("managed");
        expect(prepared.env.DATABASE_URL__ANALYTICS).toBe("postgres://rebase@127.0.0.1:55100/rebase");
        expect(prepared.env.DATABASE_URL__WAREHOUSE).toBe("postgres://rebase@127.0.0.1:55101/rebase");
    });

    it("leave a variable the developer set alone", async () => {
        process.env.DATABASE_URL__ANALYTICS = "postgres://warehouse.example/analytics";

        const prepared = await prepareDatabaseEnv(root, { followLastDev: false, additionalKeys: async () => ["analytics"] });

        expect(ensureManagedDatabase.mock.calls[0][1].additionalKeys).toEqual([]);
        expect(prepared.env.DATABASE_URL__ANALYTICS).toBeUndefined();
    });

    it("are never read for a database the developer named", async () => {
        process.env.DATABASE_URL = "postgres://u:p@db.example:5432/app";
        const keys = vi.fn(async () => ["analytics"]);

        const prepared = await prepareDatabaseEnv(root, { followLastDev: false, additionalKeys: keys });

        expect(prepared.database.kind).toBe("external");
        expect(keys).not.toHaveBeenCalled();
        expect(ensureManagedDatabase).not.toHaveBeenCalled();
    });

    it("still work as a plain list", async () => {
        const prepared = await prepareDatabaseEnv(root, { followLastDev: false, additionalKeys: ["analytics"] });

        expect(prepared.env.DATABASE_URL__ANALYTICS).toBe("postgres://rebase@127.0.0.1:55100/rebase");
    });
});
