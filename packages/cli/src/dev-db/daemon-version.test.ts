/**
 * A daemon started by another CLI, and what a newer one does about it.
 *
 * The managed database outlives the command that started it, and the database
 * proxy — the code that fixed the double ReadyForQuery and the `[pg-pool]`
 * errors — runs inside it. After `rebase upgrade` the next `rebase dev` found
 * the old daemon, adopted it without a word, and kept the old proxy's bugs
 * until `rebase db stop` or thirty idle minutes; under a running dev it never
 * idles. So the state file now says which CLI started the daemon, and a newer
 * CLI restarts an older one when nothing is connected, or says to.
 */
import { execFileSync } from "child_process";
import net from "net";
import { afterEach, describe, expect, it } from "vitest";

import { acceptedConnections, connectedClients, daemonOutdated, outdatedDaemonNotice } from "./daemon";
import type { DaemonState } from "./state";

describe("daemonOutdated", () => {
    it("is false for a daemon this very CLI started", () => {
        expect(daemonOutdated("0.26.0", "0.26.0")).toBe(false);
    });

    it("is true for one from before daemons were stamped", () => {
        expect(daemonOutdated(undefined, "0.26.0")).toBe(true);
    });

    it("is true for an older release", () => {
        expect(daemonOutdated("0.25.0", "0.26.0")).toBe(true);
        expect(daemonOutdated("0.25.9", "0.26.0")).toBe(true);
        expect(daemonOutdated("0.9.0", "0.10.0")).toBe(true);
    });

    it("is false for a newer one: an older CLI leaves a newer proxy alone", () => {
        expect(daemonOutdated("0.27.0", "0.26.0")).toBe(false);
        expect(daemonOutdated("1.0.0", "0.26.0")).toBe(false);
    });

    it("is true for another build of the same release, which cannot be ordered", () => {
        // Canary hashes do not sort by date: g70dad01 < ge06257e as text, and
        // ge06257e was the older of the two.
        expect(daemonOutdated("0.25.0-canary.ge06257e", "0.25.0-canary.g70dad01")).toBe(true);
        expect(daemonOutdated("0.26.0-canary.gabc", "0.26.0")).toBe(true);
    });

    it("is false when this CLI cannot say what it is", () => {
        expect(daemonOutdated(undefined, "unknown")).toBe(false);
    });
});

describe("outdatedDaemonNotice", () => {
    it("names both versions and the command, once clients are connected", () => {
        const text = outdatedDaemonNotice({ cliVersion: "0.25.0" }, "0.26.0", 2).join("\n");
        expect(text).toContain("0.25.0");
        expect(text).toContain("0.26.0");
        expect(text).toContain("rebase db stop");
        expect(text).toContain("2 clients");
    });

    it("says when it cannot tell whether anything is connected", () => {
        const text = outdatedDaemonNotice({}, "0.26.0", null).join("\n");
        expect(text).toContain("an earlier Rebase CLI");
        expect(text).toContain("cannot tell");
        expect(text).toContain("rebase db stop");
    });
});

describe("acceptedConnections", () => {
    it("counts the connections accepted on the daemon's ports, not the ones it opened", () => {
        // `lsof -Fn` lists each socket as `n<local>-><remote>`. The daemon's
        // own upstream connections to its private socket server are on other
        // ports; a client's socket would be another process's.
        const output = [
            "p4242",
            "f14",
            "n127.0.0.1:25432->127.0.0.1:61001",
            "f15",
            "n127.0.0.1:61002->127.0.0.1:49999",
            "f16",
            "n[::1]:25433->[::1]:61003",
            "f17",
            "n127.0.0.1:61004->127.0.0.1:25432"
        ].join("\n");
        expect(acceptedConnections(output, [25432, 25433])).toBe(2);
        expect(acceptedConnections("", [25432])).toBe(0);
    });
});

describe("connectedClients", () => {
    const servers: net.Server[] = [];
    const sockets: net.Socket[] = [];

    afterEach(async () => {
        for (const socket of sockets.splice(0)) socket.destroy();
        await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    });

    async function listen(onConnection: (socket: net.Socket) => void = () => undefined): Promise<number> {
        const server = net.createServer((socket) => {
            sockets.push(socket);
            onConnection(socket);
        });
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        return (server.address() as net.AddressInfo).port;
    }

    /** An identity socket that answers `clients` as the daemon does, or as one from before the command. */
    function identity(token: string, reply: string): Promise<number> {
        return listen((socket) => {
            socket.write(`rebase-dev-db ${token}\n`);
            socket.once("data", () => socket.end(`${reply}\n`));
        });
    }

    function stateFor(port: number, identityPort: number): DaemonState {
        return { port, pid: process.pid, dataDir: "/nowhere", startedAt: "", token: "t0k", identityPort };
    }

    it("asks the daemon, which counts the clients of every database it serves", async () => {
        const port = await listen();
        expect(await connectedClients(stateFor(port, await identity("t0k", "ok 3")))).toBe(3);
        expect(await connectedClients(stateFor(port, await identity("t0k", "ok 0")))).toBe(0);
    });

    let hasLsof = true;
    try {
        execFileSync("lsof", ["-v"], { stdio: "ignore" });
    } catch (error) {
        hasLsof = (error as NodeJS.ErrnoException).code !== "ENOENT";
    }

    it.skipIf(!hasLsof)("asks the operating system about a daemon from before the command", async () => {
        // A 0.25 daemon answers `error unknown command "clients"`. Its pid is
        // this process here, and so is the one client connected to its port.
        const port = await listen();
        const older = await identity("t0k", 'error unknown command "clients"');
        expect(await connectedClients(stateFor(port, older))).toBe(0);

        const client = net.connect(port, "127.0.0.1");
        sockets.push(client);
        await new Promise<void>(resolve => client.once("connect", () => resolve()));
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(await connectedClients(stateFor(port, older))).toBe(1);
    });

    it("does not answer for a process that is not the daemon", async () => {
        const port = await listen();
        const stranger = await identity("someone-else", "ok 0");
        // Not 0: a stranger's "nobody is connected" is no reason to stop anything.
        expect(await connectedClients(stateFor(port, stranger))).not.toBe(0);
    });
});
