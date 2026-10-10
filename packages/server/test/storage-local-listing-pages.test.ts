import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
/**
 * Paging a local folder reads the directory once, not once per page.
 *
 * A page token is an index into the folder's entries, and every continuation
 * page read the whole directory again to find its place: a folder of n entries
 * listed in pages of p cost n/p full reads, so walking it was O(n²/p). The
 * first page's read is kept and continuation pages index into it while the
 * directory is unchanged (its mtime), for at most a short while.
 */
import * as path from "path";
import * as os from "os";

const readdirCalls = { count: 0 };

// Counted at the module boundary, so every spelling the controller could use —
// `fs.readdir`, a promisified copy of it, `fs.promises.readdir` — is seen.
jest.mock("fs", () => {
    const actual = jest.requireActual<typeof import("fs")>("fs");
    const callbackReaddir = (...args: unknown[]) => {
        readdirCalls.count++;
        return (actual.readdir as (...a: unknown[]) => void)(...args);
    };
    const promiseReaddir = (...args: unknown[]) => {
        readdirCalls.count++;
        return (actual.promises.readdir as (...a: unknown[]) => Promise<unknown>)(...args);
    };
    return {
        ...actual,
        readdir: callbackReaddir,
        promises: { ...actual.promises, readdir: promiseReaddir }
    };
});

import * as fs from "fs";
import { LocalStorageController } from "../src/storage/LocalStorageController";

describe("LocalStorageController listing pages", () => {
    let basePath: string;
    let controller: LocalStorageController;
    const folder = path.join("default", "photos");

    /** Files written straight to disk: no sidecars, and an mtime in the past. */
    function seed(count: number) {
        const dir = path.join(basePath, folder);
        fs.mkdirSync(dir, { recursive: true });
        for (let i = 0; i < count; i++) fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, "0")}.txt`), "x");
        // A directory changed within the last instant is not kept: a second
        // change in the same mtime tick would not show. Age it, as a folder
        // nobody is writing to is.
        const past = new Date(Date.now() - 60_000);
        fs.utimesSync(dir, past, past);
    }

    async function walk(maxResults: number): Promise<string[]> {
        const names: string[] = [];
        let pageToken: string | undefined;
        do {
            const page = await controller.listObjects("photos", { maxResults, pageToken });
            names.push(...page.items.map(i => i.name));
            pageToken = page.nextPageToken;
        } while (pageToken);
        return names;
    }

    beforeEach(() => {
        basePath = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-local-pages-"));
        controller = new LocalStorageController({ type: "local", basePath });
        readdirCalls.count = 0;
    });

    afterEach(() => {
        jest.useRealTimers();
        fs.rmSync(basePath, { recursive: true, force: true });
    });

    it("reads the directory once for ten pages", async () => {
        seed(100);

        const names = await walk(10);

        expect(names).toHaveLength(100);
        expect(new Set(names).size).toBe(100);
        expect(readdirCalls.count).toBe(1);
    });

    it("reads it again on a new first page, and when the folder changes between pages", async () => {
        seed(30);
        const first = await controller.listObjects("photos", { maxResults: 10 });
        expect(readdirCalls.count).toBe(1);

        // Another first page is a fresh look.
        await controller.listObjects("photos", { maxResults: 10 });
        expect(readdirCalls.count).toBe(2);

        // A file added after the first page changes the folder's mtime, so the
        // next page reads the folder as it now is.
        fs.writeFileSync(path.join(basePath, folder, "new.txt"), "x");
        const rest: string[] = [];
        let pageToken = first.nextPageToken;
        while (pageToken) {
            const page = await controller.listObjects("photos", { maxResults: 10, pageToken });
            rest.push(...page.items.map(i => i.name));
            pageToken = page.nextPageToken;
        }
        expect(readdirCalls.count).toBeGreaterThan(2);
        expect([...first.items.map(i => i.name), ...rest]).toContain("new.txt");
    });

    it("does not keep the read past its time limit", async () => {
        seed(30);
        const now = Date.now();
        const clock = jest.spyOn(Date, "now").mockReturnValue(now);
        const first = await controller.listObjects("photos", { maxResults: 10 });

        clock.mockReturnValue(now + 31_000);
        await controller.listObjects("photos", { maxResults: 10, pageToken: first.nextPageToken });

        expect(readdirCalls.count).toBe(2);
        clock.mockRestore();
    });

    it("does not keep the read of a folder changed a moment ago", async () => {
        // A change in the same mtime tick as the read would leave the mtime
        // as it was, and a page served from the read would miss it.
        seed(30);
        const now = new Date();
        fs.utimesSync(path.join(basePath, folder), now, now);

        const first = await controller.listObjects("photos", { maxResults: 10 });
        await controller.listObjects("photos", { maxResults: 10, pageToken: first.nextPageToken });

        expect(readdirCalls.count).toBe(2);
    });
});
