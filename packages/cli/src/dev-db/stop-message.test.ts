/**
 * What `rebase db stop` says once the managed database is down.
 *
 * It said "Data is kept — `rebase dev` will start it again" under a running
 * `rebase dev`, which does not: the backend answered 503 until something else
 * started the database. The next command that needs it does, on the port it
 * had, and the backend reconnects — so that is what it says while a backend
 * runs, and the plain sentence otherwise.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stoppedManagedDatabaseLines } from "./daemon";

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-stop-message-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function backendState(pid: number): void {
    fs.mkdirSync(path.join(root, ".rebase"), { recursive: true });
    fs.writeFileSync(path.join(root, ".rebase", "state.json"), JSON.stringify({ port: 3755, baseUrl: "http://localhost:3755", pid }));
}

describe("stoppedManagedDatabaseLines", () => {
    it("with no backend running, says the data is kept and what starts it again", () => {
        const [headline, ...rest] = stoppedManagedDatabaseLines(root);
        expect(headline).toContain("Development database stopped. Data is kept");
        expect(headline).toContain("rebase dev");
        expect(rest).toEqual([]);
    });

    it("with this project's backend running, says it cannot reach the database, and how it gets it back", () => {
        backendState(process.pid);
        const text = stoppedManagedDatabaseLines(root).join("\n");

        expect(text).toContain("Data is kept");
        expect(text).toContain("http://localhost:3755");
        expect(text).toContain("same port");
        expect(text).toContain("rebase db url");
        // The sentence that was not true.
        expect(text).not.toContain("`rebase dev` will start it again");
    });

    it("ignores a backend that is no longer running", () => {
        backendState(2 ** 30);
        expect(stoppedManagedDatabaseLines(root).join("\n")).not.toContain("http://localhost:3755");
    });
});
