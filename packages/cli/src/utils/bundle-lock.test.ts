/**
 * One build of a project's bundle at a time.
 *
 * Two runs sharing `dist-bundle/` do not fail: the second one's clean-up deletes
 * files the first has already emitted, and the first carries on and ships what
 * is left.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBundle } from "../bundle";
import { lockBundleBuild } from "./bundle-lock";

let scratch: string;
const lockFile = (): string => path.join(scratch, ".rebase", "bundle-build.lock");

/** A process that is certainly alive, and is not this one. */
const anotherProcess = process.ppid;
/** Past every platform's `pid_max`, so certainly no process at all. */
const noProcess = 2 ** 30;

function holdLock(pid: number): void {
    fs.mkdirSync(path.dirname(lockFile()), { recursive: true });
    fs.writeFileSync(lockFile(), String(pid));
}

beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-lock-")));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe("lockBundleBuild", () => {
    it("holds the lock until it is released", () => {
        const release = lockBundleBuild(scratch);
        expect(fs.readFileSync(lockFile(), "utf8")).toBe(String(process.pid));

        release();

        expect(fs.existsSync(lockFile())).toBe(false);
    });

    it("refuses while another live process holds it, and says which", () => {
        holdLock(anotherProcess);

        expect(() => lockBundleBuild(scratch)).toThrow(new RegExp(`process ${anotherProcess}`));
        expect(fs.readFileSync(lockFile(), "utf8")).toBe(String(anotherProcess));
    });

    it("takes over from a process that is gone", () => {
        holdLock(noProcess);

        const release = lockBundleBuild(scratch);

        expect(fs.readFileSync(lockFile(), "utf8")).toBe(String(process.pid));
        release();
    });

    it("does not lock a process out of its own earlier build", () => {
        lockBundleBuild(scratch);

        const release = lockBundleBuild(scratch);

        release();
        expect(fs.existsSync(lockFile())).toBe(false);
    });

    it("does not touch a lock it lost", () => {
        const release = lockBundleBuild(scratch);
        holdLock(anotherProcess);

        release();

        expect(fs.readFileSync(lockFile(), "utf8")).toBe(String(anotherProcess));
    });
});

describe("buildBundle while another build runs", () => {
    it("refuses before it touches the other build's output", async () => {
        const emitted = path.join(scratch, "dist-bundle", "backend", "functions", "lines.json");
        fs.mkdirSync(path.dirname(emitted), { recursive: true });
        fs.writeFileSync(emitted, "{}");
        fs.mkdirSync(path.join(scratch, "backend", "functions"), { recursive: true });
        holdLock(anotherProcess);

        await expect(buildBundle({
            projectRoot: scratch,
            appName: "backend",
            app: { type: "backend", runtime: "managed" },
            runtimeRange: "^1"
        })).rejects.toThrow(/Another build/);

        expect(fs.existsSync(emitted)).toBe(true);
    });
});
