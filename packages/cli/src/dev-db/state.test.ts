/**
 * The state file, and the reasons not to trust one.
 *
 * The record on disk says where the managed database is. Believing a stale one
 * is the failure that matters: the pid it names may belong to something else
 * after a reboot, and the port may have been taken by a stranger, so a command
 * that trusts the file could send a migration somewhere it was never meant to
 * go. {@link readState} is therefore strict about shape — every field it needs
 * to make that judgement must be present and sane, or the record is no record
 * at all.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    type DaemonState,
    clearState,
    dataDir,
    devDbDir,
    findFreePort,
    pidRunning,
    portAccepting,
    readState,
    stateFile,
    writeState
} from "./state";

let root: string;

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-state-")));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function state(overrides: Partial<DaemonState> = {}): DaemonState {
    return {
        port: 55432,
        pid: 4242,
        dataDir: path.join(root, ".rebase", "pgdata"),
        startedAt: "2026-08-23T00:00:00.000Z",
        token: "0123456789abcdef",
        identityPort: 55433,
        ...overrides
    };
}

describe("paths", () => {
    it("keeps everything under a single generated directory", () => {
        expect(devDbDir(root)).toBe(path.join(root, ".rebase"));
        expect(dataDir(root)).toBe(path.join(root, ".rebase", "pgdata"));
        expect(stateFile(root)).toBe(path.join(root, ".rebase", "pglite.json"));
    });
});

describe("writeState / readState", () => {
    it("round-trips a record", () => {
        const written = state();
        writeState(root, written);

        expect(readState(root)).toEqual(written);
    });

    it("creates the directory it needs", () => {
        writeState(root, state());

        expect(fs.existsSync(devDbDir(root))).toBe(true);
    });

    it("never leaves a partial record where a reader could see it", () => {
        // Commands poll this file while the daemon is starting, so it is
        // written to a temporary name and renamed into place.
        writeState(root, state());
        const leftovers = fs.readdirSync(devDbDir(root)).filter((name) => name.endsWith(".tmp"));

        expect(leftovers).toEqual([]);
    });

    it("reads back as absent when nothing was written", () => {
        expect(readState(root)).toBeNull();
    });
});

describe("readState rejects anything it cannot act on", () => {
    const write = (contents: string) => {
        fs.mkdirSync(devDbDir(root), { recursive: true });
        fs.writeFileSync(stateFile(root), contents, "utf8");
    };

    it("rejects unparseable JSON", () => {
        write("{ not json");

        expect(readState(root)).toBeNull();
    });

    it("rejects a record missing the identity token", () => {
        // Without the token, liveness degrades to "is something listening on
        // that port", which answers yes about strangers.
        const { token: _token, ...rest } = state();
        write(JSON.stringify(rest));

        expect(readState(root)).toBeNull();
    });

    it("rejects an empty token", () => {
        write(JSON.stringify(state({ token: "" })));

        expect(readState(root)).toBeNull();
    });

    it("rejects a record missing the identity port", () => {
        const { identityPort: _identityPort, ...rest } = state();
        write(JSON.stringify(rest));

        expect(readState(root)).toBeNull();
    });

    it.each([0, -1, 70000, 1.5])("rejects an impossible port: %s", (port) => {
        write(JSON.stringify(state({ port })));

        expect(readState(root)).toBeNull();
    });

    it.each([0, -1, 70000])("rejects an impossible identity port: %s", (identityPort) => {
        write(JSON.stringify(state({ identityPort })));

        expect(readState(root)).toBeNull();
    });

    it("tolerates a missing startedAt, which is only ever diagnostic", () => {
        const { startedAt: _startedAt, ...rest } = state();
        write(JSON.stringify(rest));

        expect(readState(root)?.startedAt).toBe("");
    });
});

describe("clearState", () => {
    it("removes the record", () => {
        writeState(root, state());
        clearState(root);

        expect(readState(root)).toBeNull();
    });

    it("is silent when there was nothing to remove", () => {
        expect(() => clearState(root)).not.toThrow();
    });
});

describe("pidRunning", () => {
    it("is true for this process", () => {
        expect(pidRunning(process.pid)).toBe(true);
    });

    it("is false for a pid that cannot exist", () => {
        // Above the platform maximum, so it is never recycled onto something.
        expect(pidRunning(0x7fffffff)).toBe(false);
    });
});

describe("ports", () => {
    it("finds a port that is actually free to bind", async () => {
        const port = await findFreePort();

        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThanOrEqual(65535);
        // The probe binds loopback, which is where the daemon listens — a port
        // that binds here binds there. `rebase init`'s probe has a documented
        // failure where a port is free to probe and unusable to publish.
        expect(await portAccepting(port, 300)).toBe(false);
    });

    it("reports a port nobody is listening on as closed", async () => {
        const port = await findFreePort();

        expect(await portAccepting(port, 300)).toBe(false);
    });
});
