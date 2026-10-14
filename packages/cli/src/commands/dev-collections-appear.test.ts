/**
 * `rebase schema introspect` while a headless `rebase dev` runs.
 *
 * A headless project has no `config/collections` until introspect writes one,
 * and dev only watched that directory when it existed at start — so the
 * backend kept serving the API it derived from the database, and edits to the
 * new files did nothing either, until dev was restarted by hand.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { whenDirectoryAppears } from "./dev";

let root: string;
const stops: Array<() => void> = [];

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-appears-")));
});

afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * macOS delivers a watch's events from a moment after it starts; a change in
 * the same tick can be missed. Introspect runs long after dev starts, so the
 * tests wait that moment too.
 */
const settle = () => new Promise(resolve => setTimeout(resolve, 150));

/** Resolves once `onAppear` has been called. */
function watchFor(target: string): { appeared: Promise<void>; calls: () => number } {
    let calls = 0;
    let resolve!: () => void;
    const appeared = new Promise<void>(r => { resolve = r; });
    stops.push(whenDirectoryAppears(target, root, () => {
        calls++;
        resolve();
    }));
    return { appeared, calls: () => calls };
}

const within = <T>(promise: Promise<T>, ms = 10_000): Promise<T> =>
    Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`not within ${ms}ms`)), ms))]);

describe("whenDirectoryAppears", () => {
    it("answers when the directory is created inside one that exists", async () => {
        fs.mkdirSync(path.join(root, "config"));
        const target = path.join(root, "config", "collections");
        const watch = watchFor(target);
        await settle();

        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, "posts.ts"), "export default {};\n");

        await within(watch.appeared);
        expect(watch.calls()).toBe(1);
    });

    it("follows the path down when a parent appears first", async () => {
        const target = path.join(root, "config", "collections");
        const watch = watchFor(target);
        await settle();

        fs.mkdirSync(path.join(root, "config"));
        await settle();
        fs.mkdirSync(target);

        await within(watch.appeared);
        expect(watch.calls()).toBe(1);
    });

    it("answers at once for a directory that is already there", async () => {
        const target = path.join(root, "config", "collections");
        fs.mkdirSync(target, { recursive: true });
        await within(watchFor(target).appeared, 100);
    });

    it("never answers once stopped", async () => {
        fs.mkdirSync(path.join(root, "config"));
        const target = path.join(root, "config", "collections");
        let called = false;
        const stop = whenDirectoryAppears(target, root, () => { called = true; });
        stop();

        fs.mkdirSync(target);
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(called).toBe(false);
    });
});
