import { computeSchemaVersion, type CollectionConfig } from "@rebasepro/types";
import { missingExtensionIssues, schemaStampIssues } from "../src/schema/doctor";

/**
 * Two things `rebase doctor` could not see, both of which stop a first run.
 *
 * A `{ type: "vector" }` property plans a column of a type that does not exist
 * until pgvector is installed — and installing it is a deployment decision
 * Rebase deliberately does not make, so the absence is often correct
 * configuration and a wrong image. Without this check the first symptom is
 * `type "vector" does not exist` on a write to a table the report has just
 * called healthy.
 *
 * And the stamp: the runtime records which collections it provisioned from, and
 * nothing outside boot ever compared it. A database provisioned from a
 * different set — a colleague's branch, an older deploy — makes every other
 * line of this report a description of somebody else's schema.
 */
const withVector: CollectionConfig[] = [{
    slug: "docs",
    name: "Docs",
    table: "docs",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        embedding: { name: "Embedding", type: "vector", dimensions: 1536 }
    }
} as unknown as CollectionConfig];

const withoutVector: CollectionConfig[] = [{
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
} as unknown as CollectionConfig];

describe("missing extensions", () => {
    it("reports pgvector when a collection needs it and the database has not got it", () => {
        const [issue] = missingExtensionIssues(withVector, new Set(["plpgsql"]));
        expect(issue.severity).toBe("error");
        expect(issue.message).toContain("pgvector");
        // Both halves of the fix: the declaration Rebase needs, and the image
        // that ships the library. Either alone leaves the reader stuck.
        expect(issue.fix).toContain('extensions: ["vector"]');
        expect(issue.fix).toContain("pgvector/pgvector");
    });

    it("says nothing when the extension is installed", () => {
        expect(missingExtensionIssues(withVector, new Set(["vector"]))).toEqual([]);
    });

    it("says nothing when no collection asks for it", () => {
        expect(missingExtensionIssues(withoutVector, new Set())).toEqual([]);
    });
});

/**
 * A pool that answers from a script, so the check can be driven without a
 * database. Anything it is not asked about comes back empty, which is what a
 * database that has never been stamped looks like.
 */
function scriptedPool(answers: Array<[RegExp, unknown[]]>) {
    return {
        query: async <T>(text: string): Promise<{ rows: T[] }> => {
            const answer = answers.find(([match]) => match.test(text));
            return { rows: (answer?.[1] ?? []) as T[] };
        }
    };
}

const stampTablePresent: [RegExp, unknown[]] = [/to_regclass/, [{ present: true }]];

describe("the schema stamp", () => {
    it("reports a database provisioned from different collections", async () => {
        const issues = await schemaStampIssues(
            scriptedPool([stampTablePresent, [/collections_schema_version/, [{ value: "0000deadbeef1111" }]]]),
            withoutVector
        );

        expect(issues).toHaveLength(1);
        expect(issues[0].severity).toBe("warning");
        expect(issues[0].message).toContain("0000deadbeef");
        // A hash has no direction, and saying which is ahead would be a guess
        // presented as a diagnosis.
        expect(issues[0].fix).toContain("never which is ahead");
    });

    it("says nothing when the stamp agrees with the collections on disk", async () => {
        const issues = await schemaStampIssues(
            scriptedPool([
                stampTablePresent,
                [/collections_schema_version/, [{ value: computeSchemaVersion(withoutVector) }]]
            ]),
            withoutVector
        );
        expect(issues).toEqual([]);
    });

    it("treats a never-stamped database as no finding", async () => {
        // Every database provisioned before the stamp existed reads this way,
        // and so does every fresh one until its first provisioning boot.
        expect(await schemaStampIssues(scriptedPool([]), withoutVector)).toEqual([]);
        expect(await schemaStampIssues(scriptedPool([stampTablePresent]), withoutVector)).toEqual([]);
    });

    it("stays quiet when the database will not answer the question", async () => {
        // The stamp is a diagnostic, not a gate. A database that cannot answer
        // has bigger problems, and the checks around this one report them.
        const throwing = { query: async () => { throw new Error("permission denied for schema rebase"); } };
        expect(await schemaStampIssues(throwing as never, withoutVector)).toEqual([]);
    });

    it("changes when the collections change", () => {
        expect(computeSchemaVersion(withVector)).not.toBe(computeSchemaVersion(withoutVector));
    });
});
