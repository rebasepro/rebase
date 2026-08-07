/**
 * Tests for the dev command's deterministic port logic.
 *
 * These verify that `getProjectPort` produces stable, non-colliding ports
 * and that the port resolution strategy (flag → env → file → hash) works
 * correctly.
 *
 * They used to reproduce `getProjectPort` locally, on the grounds that it was
 * not exported — so every assertion exercised the copy in this file and dev.ts
 * could have been deleted without a failure. `resolveStartPort`, which the
 * docblock claimed to cover, was never called at all. Both are exported now and
 * imported here.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { DEV_PORT_FILENAME, getProjectPort, resolveStartPort } from "./dev";

describe("getProjectPort", () => {
    it("returns a port in the range 3001–3999", () => {
        const paths = [
            "/Users/dev/project-a",
            "/Users/dev/project-b",
            "/home/user/apps/my-rebase-app",
            "/tmp/test",
            "C:\\Users\\dev\\my-app"
        ];

        for (const p of paths) {
            const port = getProjectPort(p);
            expect(port).toBeGreaterThanOrEqual(3001);
            expect(port).toBeLessThanOrEqual(3999);
        }
    });

    it("is deterministic — same path always returns same port", () => {
        const p = "/Users/francesco/rebase/app";
        expect(getProjectPort(p)).toBe(getProjectPort(p));
    });

    it("produces different ports for different directories", () => {
        const portA = getProjectPort("/Users/dev/project-alpha");
        const portB = getProjectPort("/Users/dev/project-beta");
        // Not guaranteed by a hash, but extremely likely for distinct strings
        expect(portA).not.toBe(portB);
    });

    it("handles deeply nested paths", () => {
        const port = getProjectPort("/a/very/deeply/nested/path/to/project");
        expect(port).toBeGreaterThanOrEqual(3001);
        expect(port).toBeLessThanOrEqual(3999);
    });

    it("handles single-character paths", () => {
        const port = getProjectPort("/");
        expect(port).toBeGreaterThanOrEqual(3001);
        expect(port).toBeLessThanOrEqual(3999);
    });
});

describe("port collision resistance", () => {
    it("produces at least 50 unique ports from 100 random-looking paths", () => {
        const ports = new Set<number>();
        for (let i = 0; i < 100; i++) {
            ports.add(getProjectPort(`/Users/dev/project-${i}`));
        }
        // With 999 possible values and 100 inputs, collisions are possible
        // but having fewer than 50 unique values would indicate a broken hash
        expect(ports.size).toBeGreaterThan(50);
    });
});

describe("resolveStartPort", () => {

    let projectRoot: string;
    let savedPortEnv: string | undefined;

    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-dev-port-"));
        savedPortEnv = process.env.PORT;
        delete process.env.PORT;
    });

    afterEach(() => {
        if (savedPortEnv === undefined) delete process.env.PORT;
        else process.env.PORT = savedPortEnv;
        fs.rmSync(projectRoot, { recursive: true,
force: true });
    });

    const writePortFile = (port: string) =>
        fs.writeFileSync(path.join(projectRoot, DEV_PORT_FILENAME), port, "utf-8");

    it("falls back to the project hash when nothing else says otherwise", () => {
        expect(resolveStartPort(projectRoot)).toBe(getProjectPort(projectRoot));
    });

    it("prefers the saved port file over the hash", () => {
        writePortFile("4321");
        expect(resolveStartPort(projectRoot)).toBe(4321);
    });

    it("prefers PORT over the saved port file", () => {
        writePortFile("4321");
        process.env.PORT = "5555";
        expect(resolveStartPort(projectRoot)).toBe(5555);
    });

    it("prefers the explicit flag over everything", () => {
        writePortFile("4321");
        process.env.PORT = "5555";
        expect(resolveStartPort(projectRoot, 6006)).toBe(6006);
    });

    it("ignores a port file holding an out-of-range or unparseable value", () => {
        const hashed = getProjectPort(projectRoot);
        for (const bad of ["0", "-1", "65536", "999999", "not-a-port", ""]) {
            writePortFile(bad);
            expect(resolveStartPort(projectRoot)).toBe(hashed);
        }
    });

    it("tolerates trailing whitespace in the port file", () => {
        writePortFile("4321\n");
        expect(resolveStartPort(projectRoot)).toBe(4321);
    });

    // The twin of the port-file case above. It was the branch without the
    // check: `PORT=oops` reached `parseInt` and came back `NaN`, which was
    // returned as the port to start from.
    it("ignores a PORT holding an out-of-range or unparseable value", () => {
        const hashed = getProjectPort(projectRoot);
        for (const bad of ["0", "-1", "65536", "999999", "not-a-port", "80.5", "  "]) {
            process.env.PORT = bad;
            const resolved = resolveStartPort(projectRoot);
            expect(Number.isInteger(resolved)).toBe(true);
            expect(resolved).toBe(hashed);
        }
    });

    it("falls back to the port file, not the hash, when PORT is unusable", () => {
        writePortFile("4321");
        process.env.PORT = "not-a-port";
        expect(resolveStartPort(projectRoot)).toBe(4321);
    });

    it("tolerates surrounding whitespace in PORT", () => {
        process.env.PORT = " 5555 ";
        expect(resolveStartPort(projectRoot)).toBe(5555);
    });

    it("falls back to the hash when the project directory does not exist", () => {
        const missing = path.join(projectRoot, "gone");
        expect(resolveStartPort(missing)).toBe(getProjectPort(missing));
    });
});
