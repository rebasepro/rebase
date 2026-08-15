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
import { listenWithPortRetry, DEV_PORT_FILENAME } from "../src/utils/dev-port";

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
});
