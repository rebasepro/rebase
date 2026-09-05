import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { resourceKind, resourceKinds } from "@rebasepro/types";
import { ACCOUNT_SCOPED_STORAGE_BASES } from "../src/boot/sources";
import { resourceResolver, unbindableKinds } from "../src/boot/resource-resolvers";

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

    it("account-scoped bases are exactly the ones read through the account reader", () => {
        // `ACCOUNT_SCOPED_STORAGE_BASES` is what `rebase status` uses to tell a
        // developer that an unset `S3_ACCESS_KEY_ID__MEDIA` is not the whole
        // story, because the bucket names an account. It is a second statement
        // of a fact the resolver already encodes in WHICH reader it passes each
        // base to, so it is checked against exactly that.
        const scoped = new Set<string>();
        const plain = new Set<string>();
        const body = SOURCES.slice(SOURCES.indexOf("// Storage sources"));
        for (const m of body.matchAll(/(read(?:Account)?(?:Var|Bool))\(\s*env,\s*"([A-Z0-9_]+)"/g)) {
            (m[1].startsWith("readAccount") ? scoped : plain).add(m[2]);
        }

        expect([...scoped].sort()).toEqual([...ACCOUNT_SCOPED_STORAGE_BASES].sort());
        // And the bucket name must never be in it: two buckets sharing an
        // account share credentials, never a bucket.
        for (const name of ["S3_BUCKET", "GCS_BUCKET", "STORAGE_TYPE", "STORAGE_PATH"]) {
            expect({ name, scoped: scoped.has(name), plain: plain.has(name) })
                .toEqual({ name, scoped: false, plain: true });
        }
    });

    it("every registered kind has a resolver, and it reads exactly the kind's bases", () => {
        // The generic half of the gate. The two source-text checks above see
        // inside the resolvers for database and bucket; this one holds EVERY
        // kind — topic, queue, cron, function and whatever comes next — to the
        // same rule from the outside: the runtime must know how to bind it,
        // and the bases it says it reads must be the bases the kind declares.
        // The topic kind escaped the old per-kind tests with `REBASE_TOPIC_URL`,
        // a name nothing read, which is why this iterates the registry rather
        // than naming kinds.
        expect(unbindableKinds()).toEqual([]);
        expect(resourceKinds().length).toBeGreaterThanOrEqual(6);
        for (const spec of resourceKinds()) {
            const resolver = resourceResolver(spec.kind);
            expect({ kind: spec.kind, resolver: Boolean(resolver) }).toEqual({ kind: spec.kind, resolver: true });
            expect({ kind: spec.kind, reads: [...resolver!.reads].sort() })
                .toEqual({ kind: spec.kind, reads: [...spec.envBases].sort() });
            if (resolver!.accountScoped) {
                for (const base of resolver!.accountScoped) {
                    expect({ kind: spec.kind, base, declared: spec.envBases.includes(base) })
                        .toEqual({ kind: spec.kind, base, declared: true });
                }
            }
        }
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
