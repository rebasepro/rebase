/**
 * The preflight's whole value is in what it *declines* to do, so that is what
 * these assert. A test that only proved it can start a container would pass
 * just as happily on a version that also started one against production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import {
    composeDeclaresDbService,
    ensureDevDatabase,
    parseLoopbackDsn,
    probeTcp,
    waitForPort
} from "./dev-preflight";

describe("parseLoopbackDsn", () => {
    it.each([
        ["postgres://u:p@localhost:5432/db", "localhost", 5432],
        ["postgresql://u:p@127.0.0.1:5544/db", "127.0.0.1", 5544],
        ["postgres://u:p@[::1]:5432/db", "::1", 5432],
        ["postgres://u@localhost/db", "localhost", 5432]
    ])("accepts the local DSN %s", (dsn, host, port) => {
        expect(parseLoopbackDsn(dsn)).toEqual({ host, port });
    });

    it.each([
        ["a remote host", "postgres://u:p@db.example.com:5432/app"],
        ["a cloud provider", "postgres://u:p@ep-cool-1.eu-central-1.aws.neon.tech/main"],
        ["a private network address", "postgres://u:p@10.0.0.5:5432/app"],
        ["a non-postgres scheme", "mysql://u:p@localhost:3306/app"],
        ["an unparseable string", "not a url at all"],
        ["nothing", undefined]
    ])("refuses %s", (_label, dsn) => {
        expect(parseLoopbackDsn(dsn as string | undefined)).toBeNull();
    });

    it("refuses a host that merely starts with a loopback name", () => {
        // `localhost.attacker.com` resolves wherever its owner wants it to.
        expect(parseLoopbackDsn("postgres://u@localhost.example.com:5432/db")).toBeNull();
    });

    it("refuses a port outside the valid range", () => {
        expect(parseLoopbackDsn("postgres://u@localhost:99999/db")).toBeNull();
    });
});

describe("composeDeclaresDbService", () => {
    it("finds a db service", () => {
        expect(composeDeclaresDbService([
            "name: myapp",
            "services:",
            "  db:",
            "    image: postgres:18-alpine"
        ].join("\n"))).toBe(true);
    });

    it("does not mistake a commented-out service for a real one", () => {
        expect(composeDeclaresDbService([
            "services:",
            "  # db:",
            "  api:",
            "    image: rebasepro/server"
        ].join("\n"))).toBe(false);
    });

    it("does not match a `db:` key outside the services block", () => {
        expect(composeDeclaresDbService([
            "volumes:",
            "  db:",
            "services:",
            "  api:",
            "    image: rebasepro/server"
        ].join("\n"))).toBe(false);
    });

    it("is false for a compose file with no services at all", () => {
        expect(composeDeclaresDbService("name: myapp\n")).toBe(false);
    });
});

describe("probeTcp", () => {
    it("is true for a port that is listening, false once it closes", async () => {
        const server = net.createServer();
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as net.AddressInfo).port;

        expect(await probeTcp("127.0.0.1", port)).toBe(true);

        await new Promise<void>(resolve => server.close(() => resolve()));
        expect(await probeTcp("127.0.0.1", port)).toBe(false);
    });

    it("gives up rather than hanging on an unroutable address", async () => {
        // 203.0.113.0/24 is TEST-NET-3 and is guaranteed not to be routed.
        expect(await probeTcp("203.0.113.1", 5432, 300)).toBe(false);
    });
});

describe("waitForPort", () => {
    it("returns false once the timeout elapses", async () => {
        const started = Date.now();
        expect(await waitForPort("127.0.0.1", 1, 900, 200)).toBe(false);
        expect(Date.now() - started).toBeGreaterThanOrEqual(800);
    });
});

describe("ensureDevDatabase", () => {
    let projectRoot: string;
    const silent = (): void => { /* the outcome is what is asserted */ };

    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-preflight-"));
    });

    afterEach(() => {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    const base = {
        disabled: false,
        hasCollections: true,
        log: silent
    };

    it("does nothing when disabled", async () => {
        const pushSchema = vi.fn();
        const outcome = await ensureDevDatabase({
            ...base,
            projectRoot,
            databaseUrl: "postgres://u@localhost:5432/db",
            disabled: true,
            pushSchema
        });
        expect(outcome).toEqual({ action: "disabled" });
        expect(pushSchema).not.toHaveBeenCalled();
    });

    it("does nothing when there is no DATABASE_URL", async () => {
        const pushSchema = vi.fn();
        const outcome = await ensureDevDatabase({ ...base, projectRoot, databaseUrl: undefined, pushSchema });
        expect(outcome).toEqual({ action: "no-dsn" });
        expect(pushSchema).not.toHaveBeenCalled();
    });

    it("REFUSES to touch a remote database, even with a compose file present", async () => {
        // The failure this prevents: `rebase dev` against a staging DSN starting
        // a local container and pushing a schema into whatever answers.
        fs.writeFileSync(
            path.join(projectRoot, "docker-compose.yml"),
            "services:\n  db:\n    image: postgres:18-alpine\n"
        );
        const pushSchema = vi.fn();
        const outcome = await ensureDevDatabase({
            ...base,
            projectRoot,
            databaseUrl: "postgres://u:p@db.production.example.com:5432/app",
            pushSchema
        });
        expect(outcome).toEqual({ action: "remote-dsn", host: "db.production.example.com" });
        expect(pushSchema).not.toHaveBeenCalled();
    });

    it("leaves a database that is already running completely alone", async () => {
        const server = net.createServer();
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as net.AddressInfo).port;
        try {
            fs.writeFileSync(
                path.join(projectRoot, "docker-compose.yml"),
                "services:\n  db:\n    image: postgres:18-alpine\n"
            );
            const pushSchema = vi.fn();
            const outcome = await ensureDevDatabase({
                ...base,
                projectRoot,
                databaseUrl: `postgres://u@127.0.0.1:${port}/db`,
                pushSchema
            });
            expect(outcome).toEqual({ action: "already-running", host: "127.0.0.1", port });
            // The point of the assertion: no schema push against a database
            // that was already there, whatever state it is in.
            expect(pushSchema).not.toHaveBeenCalled();
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    it("declines when the project has no compose file to start", async () => {
        const pushSchema = vi.fn();
        const outcome = await ensureDevDatabase({
            ...base,
            projectRoot,
            // Port 1 is privileged and nothing will be listening on it.
            databaseUrl: "postgres://u@127.0.0.1:1/db",
            pushSchema
        });
        expect(outcome).toEqual({ action: "no-compose" });
        expect(pushSchema).not.toHaveBeenCalled();
    });

    it("declines when the compose file has no db service", async () => {
        fs.writeFileSync(
            path.join(projectRoot, "docker-compose.yml"),
            "services:\n  api:\n    image: rebasepro/server\n"
        );
        const outcome = await ensureDevDatabase({
            ...base,
            projectRoot,
            databaseUrl: "postgres://u@127.0.0.1:1/db",
            pushSchema: vi.fn()
        });
        expect(outcome).toEqual({ action: "no-compose" });
    });
});
