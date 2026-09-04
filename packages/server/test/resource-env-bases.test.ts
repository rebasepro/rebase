import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { resourceKind } from "@rebasepro/types";

/**
 * A kind's `envBases` list against the resolver that actually reads them.
 *
 * `envBases` is what a generator or a control plane binds from — it is how a
 * kind registered by a plugin gets bound by code that has never heard of it. It
 * is therefore a second statement of what the runtime reads, and it was wrong:
 * the bucket kind advertised `STORAGE_BUCKET`, `STORAGE_ENDPOINT`,
 * `STORAGE_REGION` and `STORAGE_PUBLIC_URL`, none of which
 * `resolveStorageBackend` has ever read, while omitting `S3_ACCESS_KEY_ID` and
 * `S3_SECRET_ACCESS_KEY`, without which a bucket cannot be reached at all. The
 * database kind advertised `REBASE_DB_POOL_MAX` for a resolver that reads
 * `DB_POOL_MAX` — a real variable, but a process-global pool ceiling rather than
 * a per-source binding, so the `__<KEY>` form a binder would write reads
 * nothing.
 *
 * Nothing caught it because nothing compared the two. This does, by reading the
 * resolver's source for the literal base names it passes to its readers. A
 * source-text check is coarse, and it is the only thing that can see a variable
 * name that exists in one file and not the other.
 */
const SOURCES = fs.readFileSync(path.join(__dirname, "../src/boot/sources.ts"), "utf8");

const RULE = "// ───";

/**
 * Every `<BASE>` passed to one of the env readers under one banner comment.
 *
 * `boot/sources.ts` is divided by full-width rules into a data-source half and
 * a storage half, so the two kinds can be checked separately — a base declared
 * on the wrong kind is exactly as wrong as one declared nowhere.
 */
function basesReadBy(section: string): Set<string> {
    const start = SOURCES.indexOf(`// ${section}\n`);
    if (start === -1) throw new Error(`No "${section}" banner in boot/sources.ts`);
    // Past the rule that closes this section's own banner.
    const bodyStart = SOURCES.indexOf("\n", SOURCES.indexOf(RULE, start)) + 1;
    const end = SOURCES.indexOf(RULE, bodyStart);
    const scoped = SOURCES.slice(bodyStart, end === -1 ? undefined : end);
    const found = new Set<string>();
    for (const m of scoped.matchAll(/read(?:Account)?(?:Var|Bool)\(\s*env,\s*"([A-Z0-9_]+)"/g)) {
        found.add(m[1]);
    }
    return found;
}

describe("envBases matches the resolver", () => {
    it("declares every variable the storage resolver reads, and nothing else", () => {
        const read = basesReadBy("Storage sources");
        const declared = new Set(resourceKind("bucket")!.envBases);

        // Sanity: the extraction found something. A regex that silently matches
        // nothing would make this test pass by reading no source at all.
        expect(read.size).toBeGreaterThan(5);
        expect([...read].sort()).toEqual([...declared].sort());
    });

    it("declares every variable the data-source resolver reads, and nothing else", () => {
        const read = basesReadBy("Data sources");
        const declared = new Set(resourceKind("database")!.envBases);

        expect(read.size).toBeGreaterThan(3);
        expect([...read].sort()).toEqual([...declared].sort());
    });

    it("narrows per engine without inventing a base the kind does not have", () => {
        const spec = resourceKind("bucket")!;
        const all = new Set(spec.envBases);
        for (const [engine, bases] of Object.entries(spec.envBasesByEngine ?? {})) {
            for (const base of bases) {
                expect({ engine, base, known: all.has(base) })
                    .toEqual({ engine, base, known: true });
            }
        }
    });
});
