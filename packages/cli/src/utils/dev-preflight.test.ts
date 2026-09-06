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
    composeDatabaseUrl,
    composeDeclaresDbService,
    composeHostPort,
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

describe("composeDatabaseUrl", () => {
    /** The `db` service `rebase init` writes, in the shape the scan reads. */
    const SCAFFOLD = [
        "name: myapp",
        "",
        "services:",
        "  db:",
        "    image: pgvector/pgvector:pg18",
        "    restart: unless-stopped",
        "    environment:",
        "      POSTGRES_USER: rebase_app",
        "      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}",
        "      POSTGRES_DB: rebase",
        "    # Published so `rebase db push` can reach it from the host.",
        "    ports:",
        '      - "5435:5432"',
        "    volumes:",
        "      - postgres_data:/var/lib/postgresql",
        "",
        "  api:",
        "    image: rebasepro/server",
        "    ports:",
        '      - "3001:3001"',
        "",
        "volumes:",
        "  postgres_data:"
    ].join("\n");

    it("derives the URL `rebase init` writes as the commented-out DATABASE_URL", () => {
        // The two must agree, or uncommenting that line and passing --docker
        // reach two different databases.
        expect(composeDatabaseUrl(SCAFFOLD, { DATABASE_PASSWORD: "s3cret" })).toBe(
            "postgresql://rebase_app:s3cret@127.0.0.1:5435/rebase?options=-c%20search_path%3Dpublic&sslmode=disable"
        );
    });

    it("uses compose's own ${VAR:-default} when .env sets no password", () => {
        expect(composeDatabaseUrl(SCAFFOLD, {})).toContain("rebase_app:changeme@127.0.0.1:5435");
    });

    it("takes the db service's published port, not another service's", () => {
        // `api` publishes 3001 in the same file. Reading the wrong `ports:`
        // block would point the backend at itself.
        expect(composeDatabaseUrl(SCAFFOLD, {})).toContain(":5435/rebase");
    });

    it("percent-encodes a password with URL metacharacters in it", () => {
        expect(composeDatabaseUrl(SCAFFOLD, { DATABASE_PASSWORD: "p@ss/word" }))
            .toContain("rebase_app:p%40ss%2Fword@");
    });

    it("is null when the file declares no db service", () => {
        expect(composeDatabaseUrl([
            "services:",
            "  api:",
            "    image: rebasepro/server"
        ].join("\n"), {})).toBeNull();
    });

    it("is null when the db service publishes no host port", () => {
        // Unreachable from the host, so there is no URL to hand anyone —
        // and guessing 5432 would name somebody else's Postgres.
        expect(composeDatabaseUrl([
            "services:",
            "  db:",
            "    environment:",
            "      POSTGRES_USER: rebase_app",
            "      POSTGRES_PASSWORD: pw",
            "      POSTGRES_DB: rebase"
        ].join("\n"), {})).toBeNull();
    });
});

describe("composeHostPort", () => {
    it("reads the db service's published port", () => {
        expect(composeHostPort([
            "services:",
            "  db:",
            "    ports:",
            '      - "5435:5432"',
            "  api:",
            "    ports:",
            '      - "3001:3001"'
        ].join("\n"))).toBe(5435);
    });

    it("answers even when the file names no user or password", () => {
        // The whole reason it is not `composeDatabaseUrl`: the question "would
        // starting this container answer that DSN?" needs only the port.
        expect(composeHostPort("services:\n  db:\n    ports:\n      - \"5436:5432\"\n")).toBe(5436);
    });

    it("is null when nothing is published", () => {
        expect(composeHostPort("services:\n  db:\n    image: postgres:18-alpine\n")).toBeNull();
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

    it("starts nothing when .env names a port the compose file does not publish", async () => {
        /**
         * The failure this is the guard for: `DATABASE_URL=…@127.0.0.1:3139`
         * in `.env`, a compose file publishing 5436. `rebase dev` said
         * `Database not running — starting it…`, started `app1-db-1` on 5436,
         * waited on 3139, and then reported `⚠ The database container did not
         * begin listening on port 3139. Run docker compose up -d db then rebase
         * db push to see why.` The container was up and healthy; the port in
         * `.env` was what was wrong, and the remedy said the opposite. A
         * container nobody had asked for was left running.
         */
        fs.writeFileSync(
            path.join(projectRoot, "docker-compose.yml"),
            [
                "services:",
                "  db:",
                "    image: postgres:18-alpine",
                "    ports:",
                '      - "5436:5432"'
            ].join("\n")
        );
        const started = vi.fn();

        const outcome = await ensureDevDatabase({
            ...base,
            projectRoot,
            databaseUrl: "postgres://u@127.0.0.1:3139/db",
            startDatabase: started,
            pushSchema: vi.fn()
        });

        expect(started).not.toHaveBeenCalled();
        expect(outcome.action).toBe("wrong-port");
        expect(outcome).toMatchObject({ port: 3139, composePort: 5436 });
        if (outcome.action !== "wrong-port") throw new Error("narrowing");
        expect(outcome.hint).toContain("127.0.0.1:3139");
        expect(outcome.hint).toContain("publishes 5436");
        expect(outcome.hint).toContain("nothing was started");
    });

    it("starts it when the ports do agree", async () => {
        // The counter-check: the guard must not stop the case it was written
        // around, which is a `.env` that matches the compose file.
        const free = net.createServer();
        await new Promise<void>(resolve => free.listen(0, "127.0.0.1", resolve));
        const port = (free.address() as net.AddressInfo).port;
        await new Promise<void>(resolve => free.close(() => resolve()));

        const server = net.createServer();
        fs.writeFileSync(
            path.join(projectRoot, "docker-compose.yml"),
            ["services:", "  db:", "    image: postgres:18-alpine", "    ports:", `      - "${port}:5432"`].join("\n")
        );

        try {
            const outcome = await ensureDevDatabase({
                ...base,
                hasCollections: false,
                projectRoot,
                databaseUrl: `postgres://u@127.0.0.1:${port}/db`,
                startDatabase: async () => {
                    await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
                },
                pushSchema: vi.fn()
            });

            expect(outcome).toEqual({ action: "started", port, pushed: false });
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    it("survives a schema push that fails, and says the database is up anyway", async () => {
        /**
         * The failure this is the guard for: the push runs *in this process*,
         * and `refuseAtlasOnManagedDatabase` used to answer it with
         * `process.exit(1)`. So the first `rebase dev --docker` of a fresh
         * scaffold started the container, hit the refusal inside the push, and
         * exited — past the `catch` written expressly to prevent that, because
         * an exit is not catchable. The container was left running with no
         * server in front of it.
         *
         * `pushSchema` throwing is the whole test: the outcome must still be
         * `started`, and the process must still be here to report it.
         */
        const exit = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("the preflight must not exit the process");
        }) as never);

        // A port that is closed when the preflight probes it and open by the
        // time it waits for it — which is what starting a container looks like.
        const server = net.createServer();
        const free = net.createServer();
        await new Promise<void>(resolve => free.listen(0, "127.0.0.1", resolve));
        const port = (free.address() as net.AddressInfo).port;
        await new Promise<void>(resolve => free.close(() => resolve()));

        const started = vi.fn(async () => {
            await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
        });

        fs.writeFileSync(
            path.join(projectRoot, "docker-compose.yml"),
            "services:\n  db:\n    image: postgres:18-alpine\n"
        );

        try {
            const outcome = await ensureDevDatabase({
                ...base,
                projectRoot,
                databaseUrl: `postgres://u@127.0.0.1:${port}/db`,
                startDatabase: started,
                pushSchema: async () => {
                    throw new Error("rebase db push does not work on the managed development database.");
                }
            });

            expect(started).toHaveBeenCalledOnce();
            expect(outcome).toEqual({ action: "started", port, pushed: false });
            expect(exit).not.toHaveBeenCalled();
        } finally {
            exit.mockRestore();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
