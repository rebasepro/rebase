/**
 * Port selection in dev.
 *
 * The interesting case is the interaction between an explicitly requested port and
 * the affinity file a previous run left behind. Affinity exists so a `tsx watch`
 * restart keeps the address the frontend was configured with; it must not become a
 * way for a stale file to override configuration.
 *
 * That is not hypothetical. Affinity used to win outright, and two things followed:
 * changing `PORT` in `.env` had no effect (the server re-bound the old port and
 * printed the old number), and the templates e2e — which assigns every backend a
 * fresh free port — had its second boot silently re-bind the first boot's port. The
 * suite then talked to a server it had not started and failed on unrelated
 * assertions.
 */
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import { createServer, type Server } from "http";
import { spawnSync } from "child_process";
import { cleanupDevPortFile, listenWithPortRetry, DEV_PORT_FILENAME } from "../src/utils/dev-port";
import { logger } from "../src/utils/logger";

/** A port nothing is listening on. */
async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            if (address === null || typeof address === "string") {
                probe.close(() => reject(new Error("no port")));
                return;
            }
            probe.close(() => resolve(address.port));
        });
    });
}

describe("listenWithPortRetry", () => {
    let dir: string;
    const servers: Server[] = [];

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-dev-port-"));
    });

    afterEach(async () => {
        await Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r()))));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function track(server: Server): Server {
        servers.push(server);
        return server;
    }

    const portFile = () => path.join(dir, DEV_PORT_FILENAME);

    it("binds the requested port and records what was asked for", async () => {
        const requested = await freePort();
        const bound = await listenWithPortRetry(track(createServer()), requested, { portFileDir: dir });

        expect(bound).toBe(requested);
        // "<bound> <requested>" — the bound port stays first so that `parseInt`,
        // which is how the CLI reads this file, still returns it.
        expect(fs.readFileSync(portFile(), "utf-8")).toBe(`${requested} ${requested}`);
        expect(parseInt(fs.readFileSync(portFile(), "utf-8").trim(), 10)).toBe(requested);
    });

    it("honours affinity when the same port is requested again", async () => {
        const requested = await freePort();
        const previouslyBound = await freePort();
        fs.writeFileSync(portFile(), `${previouslyBound} ${requested}`, "utf-8");

        const bound = await listenWithPortRetry(track(createServer()), requested, { portFileDir: dir });

        // The frontend was configured with `previouslyBound`, and the request has not
        // changed, so that is the address to keep — even though `requested` is free.
        expect(bound).toBe(previouslyBound);
    });

    it("ignores affinity when a different port is requested", async () => {
        const nowRequested = await freePort();
        const previouslyBound = await freePort();
        const previouslyRequested = await freePort();
        fs.writeFileSync(portFile(), `${previouslyBound} ${previouslyRequested}`, "utf-8");

        const bound = await listenWithPortRetry(track(createServer()), nowRequested, { portFileDir: dir });

        // The whole bug: this used to return `previouslyBound`.
        expect(bound).toBe(nowRequested);
    });

    it("reports the port it actually bound after retrying past one in use", async () => {
        const occupied = await freePort();
        await new Promise<void>(r => track(createServer()).listen(occupied, "0.0.0.0", r));

        const server = track(createServer());
        const reported = await listenWithPortRetry(server, occupied, { portFileDir: dir });

        const actual = server.address();
        if (actual === null || typeof actual === "string") throw new Error("not listening on a TCP port");

        expect(reported).toBeGreaterThan(occupied);
        // The defect: `reported` came back as `occupied` — the port it had just
        // failed to bind — while the socket was on `occupied + 1`. Anything trusting
        // the return value, or the banner printed from it, reached the squatter.
        expect(reported).toBe(actual.port);
        expect(parseInt(fs.readFileSync(portFile(), "utf-8").trim(), 10)).toBe(actual.port);
    });

    it("says which port was in use and which one it moved to", async () => {
        // Silence here is how a developer ends up staring at a server on 3002
        // while the frontend, the bookmark and the curl all point at 3001, with
        // nothing anywhere saying a port was skipped.
        const occupied = await freePort();
        await new Promise<void>(r => track(createServer()).listen(occupied, "0.0.0.0", r));

        const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
        try {
            const server = track(createServer());
            const bound = await listenWithPortRetry(server, occupied, { portFileDir: dir });

            const said = warn.mock.calls.map(call => String(call[0])).join("\n");
            expect(said).toContain(`Port ${occupied} is in use`);
            expect(said).toContain(String(bound));
        } finally {
            warn.mockRestore();
        }
    });

    it("reports the ephemeral port the OS chose when asked for 0", async () => {
        // `PORT=0` is the ordinary way to say "any free port", and it is the one
        // request that is never granted literally. Resolving with the request
        // announced `http://localhost:0`, wrote `0` into the port file and into
        // `.rebase/state.json`, and pointed the CLI banner, MCP discovery and any
        // health check at a port nothing listens on.
        const server = track(createServer());

        const reported = await listenWithPortRetry(server, 0, { portFileDir: dir });

        const actual = server.address();
        if (actual === null || typeof actual === "string") throw new Error("not listening on a TCP port");

        expect(reported).toBe(actual.port);
        expect(reported).toBeGreaterThan(0);
        expect(parseInt(fs.readFileSync(portFile(), "utf-8").trim(), 10)).toBe(actual.port);
    });

    it("treats a legacy single-number port file as affinity", async () => {
        // Files written before the format carried the requested port. There is no
        // way to know what was asked for then, so the old behaviour is kept.
        const requested = await freePort();
        const previouslyBound = await freePort();
        fs.writeFileSync(portFile(), String(previouslyBound), "utf-8");

        const bound = await listenWithPortRetry(track(createServer()), requested, { portFileDir: dir });

        expect(bound).toBe(previouslyBound);
    });

    describe("a squatter on loopback only", () => {
        /**
         * The collision `listen` cannot see. Binding `0.0.0.0` over a listener
         * that holds `127.0.0.1:<port>` **succeeds** on Linux and macOS — the
         * two sockets coexist and the kernel routes loopback traffic to the
         * more specific bind — so `EADDRINUSE` never fires and the retry above
         * has nothing to retry on.
         *
         * Measured: with `node -e "…listen(3013,'127.0.0.1')"` running,
         * `rebase dev --port 3013` announced `Server running at
         * http://localhost:3013` and `curl localhost:3013` answered
         * `squatter`. Vite's default bind is exactly this shape, which makes
         * it the ordinary way for a developer to meet it.
         */
        it("is treated as in use, and the server moves to the next port", async () => {
            const occupied = await freePort();
            await new Promise<void>(r => track(createServer()).listen(occupied, "127.0.0.1", r));

            const server = track(createServer());
            const bound = await listenWithPortRetry(server, occupied, { portFileDir: dir });

            const actual = server.address();
            if (actual === null || typeof actual === "string") throw new Error("not listening on a TCP port");

            expect(bound).toBeGreaterThan(occupied);
            expect(bound).toBe(actual.port);
        });

        it("says so, in the same words as any other port collision", async () => {
            const occupied = await freePort();
            await new Promise<void>(r => track(createServer()).listen(occupied, "127.0.0.1", r));

            const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
            try {
                const bound = await listenWithPortRetry(track(createServer()), occupied, { portFileDir: dir });

                const said = warn.mock.calls.map(call => String(call[0])).join("\n");
                expect(said).toContain(`Port ${occupied} is in use`);
                expect(said).toContain(String(bound));
            } finally {
                warn.mockRestore();
            }
        });

        it("leaves a genuinely free port alone", async () => {
            // The probe must not cost anything on the ordinary path, and above
            // all must not report a free port as taken.
            const free = await freePort();

            const bound = await listenWithPortRetry(track(createServer()), free, { portFileDir: dir });

            expect(bound).toBe(free);
        });
    });

    /**
     * A port that was typed binds or fails; only a derived one walks.
     *
     * Dev ports are derived per project, so the number a developer types into
     * `--port` is very often another Rebase backend. Walking past it announced
     * one port, served on another, and left the typed address answering 200
     * from the wrong project — which reads exactly like the right one.
     */
    describe("an explicitly requested port", () => {
        it("fails rather than moving, and names the port", async () => {
            const occupied = await freePort();
            await new Promise<void>(r => track(createServer()).listen(occupied, "0.0.0.0", r));

            await expect(
                listenWithPortRetry(track(createServer()), occupied, { portFileDir: dir, explicit: true })
            ).rejects.toThrow(new RegExp(`Port ${occupied} is in use`));
        });

        it("ignores the affinity file, which records where the last run landed", async () => {
            const requested = await freePort();
            const elsewhere = await freePort();
            fs.writeFileSync(portFile(), `${elsewhere} ${requested}`, "utf-8");

            const bound = await listenWithPortRetry(track(createServer()), requested, { portFileDir: dir, explicit: true });

            expect(bound).toBe(requested);
        });

        it("is off by default, so a derived port still walks", async () => {
            const occupied = await freePort();
            await new Promise<void>(r => track(createServer()).listen(occupied, "0.0.0.0", r));

            const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
            try {
                const bound = await listenWithPortRetry(track(createServer()), occupied, { portFileDir: dir });
                expect(bound).toBeGreaterThan(occupied);
            } finally {
                warn.mockRestore();
            }
        });

        it("reads REBASE_DEV_PORT_EXPLICIT, which is how the CLI says so", async () => {
            // The CLI knows about `--port`; the server is the one that binds.
            // The child's environment is the only channel between them.
            const occupied = await freePort();
            await new Promise<void>(r => track(createServer()).listen(occupied, "0.0.0.0", r));

            process.env.REBASE_DEV_PORT_EXPLICIT = "true";
            try {
                await expect(
                    listenWithPortRetry(track(createServer()), occupied, { portFileDir: dir })
                ).rejects.toThrow(new RegExp(`Port ${occupied} is in use`));
            } finally {
                delete process.env.REBASE_DEV_PORT_EXPLICIT;
            }
        });
    });

    /**
     * `rebase start` beside `rebase dev`, which is the documented local check.
     *
     * Both run this function, and both used to write `.rebase-dev-port` and
     * `.rebase/state.json` on every bind and delete them on every stop. So
     * `start` took the files over while it ran — `rebase api-keys`,
     * `generate-sdk` and the `db stop` message all pointed at it — and when it
     * stopped it deleted them, while dev was still serving: `api-keys list`
     * then said "This project's server is not running".
     */
    describe("two servers in one project", () => {
        const stateFile = () => path.join(dir, ".rebase", "state.json");
        const readState = () => JSON.parse(fs.readFileSync(stateFile(), "utf-8")) as { port: number; pid: number };

        /** Dev's files, as its backend wrote them: another live process, on a port that answers. */
        async function devIsRunning(): Promise<{ port: number; portFile: string; state: string }> {
            const port = await freePort();
            await new Promise<void>(r => track(createServer()).listen(port, "127.0.0.1", r));
            fs.mkdirSync(path.join(dir, ".rebase"), { recursive: true });
            // The parent is alive for as long as this test runs, and is not us.
            const state = JSON.stringify({ port, baseUrl: `http://localhost:${port}`, pid: process.ppid, startedAt: new Date().toISOString() });
            fs.writeFileSync(stateFile(), state);
            fs.writeFileSync(portFile(), `${port} ${port}`);
            return { port, portFile: `${port} ${port}`, state };
        }

        it("leaves a running dev's files alone, and they survive the other server stopping", async () => {
            const dev = await devIsRunning();

            const startPort = await freePort();
            const bound = await listenWithPortRetry(track(createServer()), startPort, { portFileDir: dir });
            expect(bound).toBe(startPort);

            expect(fs.readFileSync(stateFile(), "utf-8")).toBe(dev.state);
            expect(fs.readFileSync(portFile(), "utf-8")).toBe(dev.portFile);

            cleanupDevPortFile(dir);

            expect(fs.readFileSync(stateFile(), "utf-8")).toBe(dev.state);
            expect(fs.readFileSync(portFile(), "utf-8")).toBe(dev.portFile);
        });

        it("takes the files over from a server that is gone", async () => {
            // A dev that crashed leaves its files behind, naming a pid that has
            // exited — and its port may be somebody else's by now.
            const gone = spawnSync(process.execPath, ["-e", ""]).pid;
            const stalePort = await freePort();
            await new Promise<void>(r => track(createServer()).listen(stalePort, "127.0.0.1", r));
            fs.mkdirSync(path.join(dir, ".rebase"), { recursive: true });
            fs.writeFileSync(stateFile(), JSON.stringify({ port: stalePort, pid: gone }));
            fs.writeFileSync(portFile(), `${stalePort} ${stalePort}`);

            const startPort = await freePort();
            const bound = await listenWithPortRetry(track(createServer()), startPort, { portFileDir: dir });

            expect(readState()).toMatchObject({ port: bound, pid: process.pid });
            expect(fs.readFileSync(portFile(), "utf-8")).toBe(`${bound} ${startPort}`);
        });

        it("takes them over on the port they name, which is a restart rather than another server", async () => {
            // `tsx watch` restarts dev's backend; the old process can outlive
            // its socket, and the probe of that port reaches this server itself.
            const port = await freePort();
            fs.mkdirSync(path.join(dir, ".rebase"), { recursive: true });
            fs.writeFileSync(stateFile(), JSON.stringify({ port, pid: process.ppid }));
            fs.writeFileSync(portFile(), `${port} ${port}`);

            const bound = await listenWithPortRetry(track(createServer()), port, { portFileDir: dir });

            expect(bound).toBe(port);
            expect(readState()).toMatchObject({ port, pid: process.pid });
        });

        it("takes them over from a live server when rebase dev started this one", async () => {
            // `rebase dev` states REBASE_DEV_PORT_EXPLICIT on every backend it
            // spawns, and the files are its own: a dev started after a
            // `rebase start` must not leave every command pointed at start.
            await devIsRunning();

            process.env.REBASE_DEV_PORT_EXPLICIT = "false";
            try {
                const devPort = await freePort();
                const bound = await listenWithPortRetry(track(createServer()), devPort, { portFileDir: dir });

                expect(readState()).toMatchObject({ port: bound, pid: process.pid });
                expect(fs.readFileSync(portFile(), "utf-8")).toBe(`${bound} ${devPort}`);
            } finally {
                delete process.env.REBASE_DEV_PORT_EXPLICIT;
            }
        });

        it("removes only what it wrote, once another server has taken the files over", async () => {
            const startPort = await freePort();
            await listenWithPortRetry(track(createServer()), startPort, { portFileDir: dir });

            // Then `rebase dev` starts, and its backend takes them over.
            const devPort = await freePort();
            const devState = JSON.stringify({ port: devPort, pid: process.ppid });
            fs.writeFileSync(stateFile(), devState);
            fs.writeFileSync(portFile(), `${devPort} ${devPort}`);

            cleanupDevPortFile(dir);

            expect(fs.readFileSync(stateFile(), "utf-8")).toBe(devState);
            expect(fs.readFileSync(portFile(), "utf-8")).toBe(`${devPort} ${devPort}`);
        });

        it("keeps the port file a restart on the same port wrote, though it reads the same", async () => {
            // The old process of a `tsx watch` restart can stop after the new
            // one has bound: same port, same `.rebase-dev-port`, and
            // `state.json` already names the new pid.
            const port = await freePort();
            const server = track(createServer());
            await listenWithPortRetry(server, port, { portFileDir: dir });
            const written = fs.readFileSync(portFile(), "utf-8");
            fs.writeFileSync(stateFile(), JSON.stringify({ port, pid: process.ppid }));

            cleanupDevPortFile(dir);

            expect(fs.readFileSync(portFile(), "utf-8")).toBe(written);
            expect(readState().pid).toBe(process.ppid);
        });

        it("still removes its own files when it stops", async () => {
            const port = await freePort();
            await listenWithPortRetry(track(createServer()), port, { portFileDir: dir });
            expect(readState().pid).toBe(process.pid);

            cleanupDevPortFile(dir);

            expect(fs.existsSync(stateFile())).toBe(false);
            expect(fs.existsSync(portFile())).toBe(false);
        });
    });
});
