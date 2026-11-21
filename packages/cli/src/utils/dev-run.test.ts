/**
 * The record a running `rebase dev` keeps of itself (`.rebase/dev.json`), and
 * the two questions it answers for the commands beside it: where its backend
 * is, and whether it is on the database a `db push` just planned against.
 *
 * From a migration report: a `rebase db push --dry-run` run beside `rebase
 * dev` said "No changes" for columns that were not there a minute earlier —
 * correct, because dev had applied them on save, and read as a planner bug
 * until the dev server was found.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    databaseAddress,
    devRunPath,
    devServerAppliesSchemaNote,
    forgetDevRun,
    preparedDatabaseUrl,
    readRunningDev,
    recordDevBackendUrl,
    recordDevRun,
    runningDevOnDatabase
} from "./dev-run";

/** Far above any real pid_max: a `rebase dev` that was killed leaves its file behind. */
const GONE = 2 ** 30;

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-dev-run-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function writeRun(contents: unknown): void {
    fs.mkdirSync(path.dirname(devRunPath(root)), { recursive: true });
    fs.writeFileSync(devRunPath(root), JSON.stringify(contents));
}

describe("databaseAddress", () => {
    it("is host, port and name, and never the credentials", () => {
        expect(databaseAddress("postgresql://app:s3cret@db.example.com:6543/shop?sslmode=require")).toBe("db.example.com:6543/shop");
    });

    it("reads every loopback spelling and the default port as one address", () => {
        const one = databaseAddress("postgres://u:p@127.0.0.1/rebase");
        expect(one).toBe("localhost:5432/rebase");
        expect(databaseAddress("postgresql://u:p@localhost:5432/rebase")).toBe(one);
        expect(databaseAddress("postgresql://u:p@[::1]:5432/rebase")).toBe(one);
    });

    it("is null for anything that is not a Postgres connection string", () => {
        expect(databaseAddress(undefined)).toBeNull();
        expect(databaseAddress("not a url")).toBeNull();
        expect(databaseAddress("http://localhost:3001")).toBeNull();
    });
});

describe("preparedDatabaseUrl", () => {
    it("is the managed daemon's connection string, which only the environment carries", () => {
        expect(preparedDatabaseUrl({ database: { kind: "managed", source: "managed" }, env: { DATABASE_URL: "postgresql://localhost:54329/postgres" } }))
            .toBe("postgresql://localhost:54329/postgres");
    });

    it("is the resolver's choice for a database of the developer's own", () => {
        expect(preparedDatabaseUrl({ database: { kind: "external", url: "postgresql://localhost/app", source: "env-file" }, env: {} }))
            .toBe("postgresql://localhost/app");
        expect(preparedDatabaseUrl(null)).toBeNull();
    });
});

describe("the record of a running `rebase dev`", () => {
    it("names this process, its database without credentials, and its backend once it has bound", () => {
        recordDevRun(root, "postgresql://rebase:pw@127.0.0.1:54329/postgres");
        expect(readRunningDev(root)).toMatchObject({ pid: process.pid, database: "localhost:54329/postgres", backendUrl: null });
        expect(fs.readFileSync(devRunPath(root), "utf-8")).not.toContain("pw");

        recordDevBackendUrl(root, "http://localhost:3082");
        expect(readRunningDev(root)?.backendUrl).toBe("http://localhost:3082");
    });

    it("is nobody's once its process is gone, whatever the file still says", () => {
        writeRun({ pid: GONE, database: "localhost:5432/app", backendUrl: "http://localhost:3083" });
        expect(readRunningDev(root)).toBeNull();
    });

    it("is removed by the run that wrote it, and left alone by any other", () => {
        writeRun({ pid: GONE, database: null, backendUrl: "http://localhost:3083" });
        forgetDevRun(root);
        expect(fs.existsSync(devRunPath(root))).toBe(true);
        recordDevBackendUrl(root, "http://localhost:3082");
        expect(JSON.parse(fs.readFileSync(devRunPath(root), "utf-8")).backendUrl).toBe("http://localhost:3083");

        recordDevRun(root, null);
        forgetDevRun(root);
        expect(fs.existsSync(devRunPath(root))).toBe(false);
    });
});

describe("runningDevOnDatabase", () => {
    it("finds the `rebase dev` on the database a push planned against, however it was spelled", () => {
        recordDevRun(root, "postgresql://rebase:pw@127.0.0.1:54329/postgres");
        recordDevBackendUrl(root, "http://localhost:3082");

        const dev = runningDevOnDatabase(root, "postgresql://other:creds@localhost:54329/postgres");

        if (!dev) throw new Error("the running `rebase dev` was not found");
        expect(dev.pid).toBe(process.pid);
        const note = devServerAppliesSchemaNote(dev);
        expect(note).toContain("`rebase dev` is running on this database at http://localhost:3082");
        expect(note).toContain("applies new tables and columns as you save");
        expect(note).toContain("not listed here");
    });

    it("says nothing about a `rebase dev` on another database, or one that has stopped", () => {
        recordDevRun(root, "postgresql://localhost:54329/postgres");
        expect(runningDevOnDatabase(root, "postgresql://localhost:5432/staging")).toBeNull();
        expect(runningDevOnDatabase(root, null)).toBeNull();

        writeRun({ pid: GONE, database: "localhost:54329/postgres", backendUrl: null });
        expect(runningDevOnDatabase(root, "postgresql://localhost:54329/postgres")).toBeNull();
    });
});
