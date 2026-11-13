/**
 * The shims a legacy `config/` is loaded with are code the migration then
 * evaluates, so they are written into a directory of the run's own and never
 * read from anywhere else (SEC-FIX-3 D-5).
 *
 * Before: each shim lived at a fixed, content-named path under the system's
 * temporary directory and was used if it already existed — on a shared `/tmp`
 * another user could plant `_rebasepro_types.ts` there first, and the next
 * `rebase migrate collections-to-tables` (`--dry-run` included) ran it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createShimDir, legacyLoadAliases, removeShimDir } from "./legacy-shims";
import { migrateCollectionsToTables } from "./migrate";

const TYPES_SOURCE = path.resolve(__dirname, "../../../../types/src/index.ts");
const HOSTILE = "export const planted = 'attacker code';\n";

const scratch: string[] = [];
afterAll(() => {
    for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

let previousTmp: string | undefined;
let tmp: string;
beforeEach(() => {
    // The shared temporary directory, played by a scratch one.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codemod-shared-tmp-"));
    scratch.push(tmp);
    previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = tmp;
});
afterEach(() => {
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
});

function configDir(): string {
    const dir = fs.mkdtempSync(path.join(tmp, "project-"));
    fs.mkdirSync(path.join(dir, "config"));
    return path.join(dir, "config");
}

/** Every file a hostile user could have planted ahead of the run, at the paths the old code used and beside them. */
function plantEverywhere(): string[] {
    const planted: string[] = [];
    const legacyRoot = path.join(tmp, "rebase-legacy-shims");
    for (const hash of ["0000000000000000", "ffffffffffffffff"]) {
        const dir = path.join(legacyRoot, hash);
        fs.mkdirSync(dir, { recursive: true });
        for (const name of ["_rebasepro_types.ts", "_rebasepro_common.ts", "_rebasepro_cms-types.ts"]) {
            const file = path.join(dir, name);
            fs.writeFileSync(file, HOSTILE);
            planted.push(file);
        }
    }
    return planted;
}

describe("the codemod's shims", () => {
    it("are written into a fresh private directory, never at a path planted ahead of the run", () => {
        const planted = plantEverywhere();
        const dir = createShimDir();
        try {
            expect(path.dirname(dir.path)).toBe(path.resolve(os.tmpdir()));
            expect(path.basename(dir.path)).toMatch(/^rebase-legacy-shims-/);
            expect(fs.statSync(dir.path).mode & 0o777).toBe(0o700);
            const aliases = legacyLoadAliases(configDir(), dir, { "@rebasepro/types": TYPES_SOURCE });
            const shim = aliases["@rebasepro/types"];
            expect(path.dirname(shim)).toBe(dir.path);
            expect(planted).not.toContain(shim);
            expect(fs.readFileSync(shim, "utf8")).not.toContain("planted");
            expect(fs.readFileSync(shim, "utf8")).toContain("export * from");
            expect(fs.statSync(shim).mode & 0o777).toBe(0o600);
        } finally {
            removeShimDir(dir);
        }
        expect(fs.existsSync(dir.path)).toBe(false);
    });

    it("refuses a file in the run's directory that the run did not write, rather than using it", () => {
        const dir = createShimDir();
        try {
            fs.writeFileSync(path.join(dir.path, "_rebasepro_types.ts"), HOSTILE);
            expect(() => legacyLoadAliases(configDir(), dir, { "@rebasepro/types": TYPES_SOURCE })).toThrow(/EEXIST/);
        } finally {
            removeShimDir(dir);
        }
    });

    it("answers a shim it wrote itself again within the run", () => {
        const dir = createShimDir();
        try {
            const config = configDir();
            const first = legacyLoadAliases(config, dir, { "@rebasepro/types": TYPES_SOURCE })["@rebasepro/types"];
            const second = legacyLoadAliases(config, dir, { "@rebasepro/types": TYPES_SOURCE })["@rebasepro/types"];
            expect(second).toBe(first);
        } finally {
            removeShimDir(dir);
        }
    });

    it("leave nothing behind when a run is over, refused or thrown", async () => {
        const leftovers = () => fs.readdirSync(tmp).filter(name => name.startsWith("rebase-legacy-shims-"));
        const refused = fs.mkdtempSync(path.join(tmp, "broken-project-"));
        const report = await migrateCollectionsToTables({ projectRoot: refused, dryRun: true });
        expect(report.status).toBe("blocked");
        expect(leftovers()).toEqual([]);
        // A project root that is a file: the run throws before it loads anything.
        const notADirectory = path.join(tmp, "not-a-project");
        fs.writeFileSync(notADirectory, "");
        await migrateCollectionsToTables({ projectRoot: notADirectory, dryRun: true }).catch(() => undefined);
        expect(leftovers()).toEqual([]);
    });
});
