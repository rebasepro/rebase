import { describe, expect, it, jest } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import { computeSchemaVersion } from "@rebasepro/types";

import {
    decideSchemaStamp,
    describeMismatch,
    enforceSchemaStamp,
    resolveSchemaMismatchPolicy,
    SchemaVersionMismatchError
} from "./schema-stamp";

/**
 * The schema stamp.
 *
 * Two things are worth defending here and they are different. The first is the
 * decision table — every branch of "what does this pair of versions mean",
 * because a wrong answer there is invisible by construction. The second is that
 * the versions being compared are *computed on both sides*: a check that
 * compares a declared number to itself passes on a bundle whose declared number
 * is nonsense, which has happened in this repository before and is the reason
 * this file asserts against a real `computeSchemaVersion` rather than a literal.
 */

function collection(slug: string, extraProperty?: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            ...(extraProperty ? { [extraProperty]: { name: extraProperty, type: "string" } } : {})
        }
    } as unknown as CollectionConfig;
}

describe("decideSchemaStamp — the decision table", () => {
    it("agrees when the versions match", () => {
        expect(decideSchemaStamp({ processVersion: "v1:aaaa", databaseVersion: "v1:aaaa" }))
            .toEqual({ status: "match", version: "v1:aaaa" });
    });

    it("reports a mismatch with both sides named", () => {
        // Both, because the operator's next move depends on which is which, and
        // a message that says only "mismatch" sends them to read two manifests.
        expect(decideSchemaStamp({ processVersion: "v1:bbbb", databaseVersion: "v1:aaaa" }))
            .toEqual({ status: "mismatch", database: "v1:aaaa", process: "v1:bbbb" });
    });

    it("treats an unstamped database as unstamped, never as a mismatch", () => {
        // Every database provisioned before this check existed reads this way,
        // and so does every fresh one. Turning that into a mismatch would fire
        // the warning on every existing deployment on the first upgrade, which
        // is how a real signal gets filtered out by everyone who sees it.
        expect(decideSchemaStamp({ processVersion: "v1:aaaa", databaseVersion: null }))
            .toEqual({ status: "unstamped" });
    });

    it("declines to judge when the collections came from the database", () => {
        // In introspection mode the collections ARE the database, so the two
        // cannot meaningfully disagree — a difference would only mean two
        // processes read the schema at different moments.
        expect(decideSchemaStamp({ processVersion: "v1:bbbb", databaseVersion: "v1:aaaa", introspecting: true }))
            .toMatchObject({ status: "skipped" });
    });

    it("declines to judge when the driver cannot record a version", () => {
        expect(decideSchemaStamp({ processVersion: "v1:bbbb", databaseVersion: "v1:aaaa", supported: false }))
            .toMatchObject({ status: "skipped" });
    });

    it("puts introspection ahead of a mismatch, and support ahead of both", () => {
        // Ordering matters: each of these is a reason the comparison is
        // meaningless, so any of them must win over the comparison's result.
        expect(decideSchemaStamp({
            processVersion: "v1:bbbb", databaseVersion: "v1:aaaa", introspecting: true, supported: false
        })).toMatchObject({ status: "skipped" });
    });
});

describe("resolveSchemaMismatchPolicy", () => {
    it("warns by default", () => {
        // Refusing would fail a rollout mid-flight: between the schema owner
        // rolling and the last unit following, the units that have not rolled
        // yet legitimately disagree.
        expect(resolveSchemaMismatchPolicy({})).toBe("warn");
    });

    it("refuses when asked", () => {
        expect(resolveSchemaMismatchPolicy({ REBASE_REQUIRE_SCHEMA_MATCH: "true" })).toBe("refuse");
        expect(resolveSchemaMismatchPolicy({ REBASE_REQUIRE_SCHEMA_MATCH: "1" })).toBe("refuse");
    });

    it("reads a blank value as unset", () => {
        // `REBASE_REQUIRE_SCHEMA_MATCH=${SOMETHING}` with SOMETHING undefined is
        // the ordinary way to write a compose file, and it is how the platform
        // neutralises a tenant's own variable.
        expect(resolveSchemaMismatchPolicy({ REBASE_REQUIRE_SCHEMA_MATCH: "" })).toBe("warn");
        expect(resolveSchemaMismatchPolicy({ REBASE_REQUIRE_SCHEMA_MATCH: "   " })).toBe("warn");
    });

    it("does not treat an unrecognised value as consent", () => {
        expect(resolveSchemaMismatchPolicy({ REBASE_REQUIRE_SCHEMA_MATCH: "yes-please" })).toBe("warn");
    });
});

describe("enforceSchemaStamp — the provisioning process writes", () => {
    it("stamps the version computed from its own collections", async () => {
        const stamp = jest.fn(async () => {});
        const collections = [collection("posts"), collection("authors")];

        await enforceSchemaStamp({ collections, provisioned: true, stamp, read: async () => null });

        // The value written must be derived, not declared. This is the whole
        // point: comparing a manifest's own number to itself is a check that
        // passes on a bundle corrupted to `v1:deadbeefdeadbeef`.
        expect(stamp).toHaveBeenCalledWith(computeSchemaVersion(collections));
    });

    it("does not read when it is the authority", async () => {
        const read = jest.fn(async () => "v1:something-else");
        const stamp = jest.fn(async () => {});

        await enforceSchemaStamp({ collections: [collection("posts")], provisioned: true, stamp, read });

        expect(read).not.toHaveBeenCalled();
    });

    it("survives a database that refuses the write", async () => {
        // This check exists to make a silent problem visible. Letting it take
        // down a boot it was only supposed to describe is a worse trade.
        const stamp = jest.fn(async () => { throw new Error("permission denied"); });

        await expect(enforceSchemaStamp({
            collections: [collection("posts")], provisioned: true, stamp
        })).resolves.toMatchObject({ status: "match" });
    });
});

describe("enforceSchemaStamp — every other process compares", () => {
    const collections = [collection("posts")];

    it("is quiet when the database agrees", async () => {
        const read = async () => computeSchemaVersion(collections);

        await expect(enforceSchemaStamp({ collections, provisioned: false, read }))
            .resolves.toMatchObject({ status: "match" });
    });

    it("notices a database provisioned from different collections", async () => {
        const other = [collection("posts", "subtitle")];
        const read = async () => computeSchemaVersion(other);

        await expect(enforceSchemaStamp({ collections, provisioned: false, read }))
            .resolves.toMatchObject({ status: "mismatch" });
    });

    it("refuses the boot under the strict policy, naming both versions", async () => {
        const other = [collection("posts", "subtitle")];
        const read = async () => computeSchemaVersion(other);

        const failure = enforceSchemaStamp({ collections, provisioned: false, read, policy: "refuse" });

        await expect(failure).rejects.toBeInstanceOf(SchemaVersionMismatchError);
        await expect(failure).rejects.toThrow(computeSchemaVersion(other));
    });

    it("warns rather than refusing by default", async () => {
        const other = [collection("posts", "subtitle")];

        await expect(enforceSchemaStamp({
            collections, provisioned: false, read: async () => computeSchemaVersion(other)
        })).resolves.toMatchObject({ status: "mismatch" });
    });

    it("survives a database it cannot read the stamp from", async () => {
        await expect(enforceSchemaStamp({
            collections, provisioned: false, read: async () => { throw new Error("no such table"); }
        })).resolves.toMatchObject({ status: "skipped" });
    });

    it("does nothing at all on a driver with neither hook", async () => {
        await expect(enforceSchemaStamp({ collections, provisioned: false }))
            .resolves.toMatchObject({ status: "skipped" });
    });

    it("skips introspected collections before reading anything", async () => {
        const read = jest.fn(async () => "v1:whatever");

        await enforceSchemaStamp({ collections, provisioned: false, read, introspecting: true });

        expect(read).not.toHaveBeenCalled();
    });
});

describe("the message", () => {
    it("names both versions, the direction that is safe, and the way to escalate", async () => {
        const message = describeMismatch("v1:database", "v1:process");

        expect(message).toContain("v1:database");
        expect(message).toContain("v1:process");
        // An operator reading one pod's log needs to know what to do, and the
        // rollout order IS the fix. Without it the message is an observation.
        expect(message).toMatch(/roll the process that owns the schema first/i);
        expect(message).toContain("REBASE_REQUIRE_SCHEMA_MATCH");
    });

    it("says the same thing whether it warns or throws", async () => {
        // An operator raising the policy from warn to refuse should not have to
        // learn a second description of one fact.
        const collections = [collection("posts")];
        const other = [collection("posts", "subtitle")];

        try {
            await enforceSchemaStamp({
                collections, provisioned: false, policy: "refuse",
                read: async () => computeSchemaVersion(other)
            });
            throw new Error("expected a refusal");
        } catch (error) {
            expect((error as Error).message)
                .toBe(describeMismatch(computeSchemaVersion(other), computeSchemaVersion(collections)));
        }
    });
});
