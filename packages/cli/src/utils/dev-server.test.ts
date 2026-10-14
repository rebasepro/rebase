/**
 * Where `rebase dev` serves a project, for the commands that have to say so.
 *
 * With the backend stopped, `rebase api-keys list` and `rebase storage orphans`
 * said `Is the Rebase server running at http://localhost:3001?` — the PORT in
 * `.env`, which `rebase dev` overrides with a port of its own. The tester's dev
 * had used 3732, and `.rebase/state.json` still said so.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { devServerUrl, getProjectPort, runningBackendUrl, serverUnreachableHint } from "./dev-server";

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-dev-server-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function writeState(contents: unknown): void {
    fs.mkdirSync(path.join(root, ".rebase"), { recursive: true });
    fs.writeFileSync(path.join(root, ".rebase", "state.json"), JSON.stringify(contents));
}

describe("devServerUrl", () => {
    it("is the URL a running `rebase dev` wrote", () => {
        fs.writeFileSync(path.join(root, ".rebase-dev-url"), "http://localhost:3555\n");
        writeState({ port: 3732 });
        expect(devServerUrl(root)).toEqual({ url: "http://localhost:3555", source: "running" });
    });

    it("is the port the last run recorded, once it has stopped", () => {
        writeState({ port: 3732, baseUrl: "http://localhost:3732" });
        expect(devServerUrl(root)).toEqual({ url: "http://localhost:3732", source: "recorded" });
    });

    it("reads the port file when there is no state file", () => {
        fs.writeFileSync(path.join(root, ".rebase-dev-port"), "3733 3733");
        expect(devServerUrl(root)).toEqual({ url: "http://localhost:3733", source: "recorded" });
    });

    it("is the port dev derives for this project when nothing is recorded", () => {
        expect(devServerUrl(root)).toEqual({ url: `http://localhost:${getProjectPort(root)}`, source: "derived" });
    });

    it("ignores a state file that names no usable port", () => {
        writeState({ port: "nope" });
        expect(devServerUrl(root).source).toBe("derived");
    });
});

describe("serverUnreachableHint", () => {
    it("names the port `rebase dev` used, when the request went somewhere else", () => {
        writeState({ port: 3732 });

        const text = serverUnreachableHint("http://localhost:3001", root).join("\n");

        expect(text).toContain("Is the Rebase server running at http://localhost:3001?");
        expect(text).toContain("`rebase dev` serves this project at http://localhost:3732");
        expect(text).toContain("the port it last used");
    });

    it("says the port is derived when dev has never run", () => {
        const text = serverUnreachableHint("http://localhost:3001", root).join("\n");
        expect(text).toContain(`http://localhost:${getProjectPort(root)}`);
        expect(text).toContain("the port it picks for this project");
    });

    it("adds nothing when the request already went to dev's port", () => {
        writeState({ port: 3732 });
        expect(serverUnreachableHint("http://localhost:3732", root)).toHaveLength(1);
    });

    it("keeps to the one line outside a project", () => {
        expect(serverUnreachableHint("http://rebase.test", null)).toEqual([
            "  Is the Rebase server running at http://rebase.test? Start it with `rebase dev`, or set REBASE_BASE_URL in .env."
        ]);
    });
});

describe("runningBackendUrl", () => {
    it("is the address of this project's backend while its process is alive", () => {
        writeState({ port: 3755, baseUrl: "http://localhost:3755", pid: process.pid });
        expect(runningBackendUrl(root)).toBe("http://localhost:3755");
    });

    it("is null once that process is gone, whatever the file still says", () => {
        // Far above any real pid_max: a backend that was killed leaves the file behind.
        writeState({ port: 3755, baseUrl: "http://localhost:3755", pid: 2 ** 30 });
        expect(runningBackendUrl(root)).toBeNull();
    });

    it("is null with no state file, or one with no pid", () => {
        expect(runningBackendUrl(root)).toBeNull();
        writeState({ port: 3755, baseUrl: "http://localhost:3755" });
        expect(runningBackendUrl(root)).toBeNull();
    });
});
