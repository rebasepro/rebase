/**
 * Planning a collection change for MongoDB.
 *
 * Shorter than the Postgres one by the whole of its difficulty. A document
 * database has no table to alter: adding a property adds nothing, removing one
 * removes nothing, and a document written yesterday is still valid tomorrow. So
 * the plan is the commit, and there is no DDL to run, refuse or get wrong.
 *
 * ## Why this exists at all, rather than leaving Mongo unsupported
 *
 * Because "unsupported" was the wrong answer, and it was the answer only
 * because nothing had been written here. `isSchemaEditingAdmin` is a structural
 * check — a driver either offers `planSchemaChange` or it does not — so a Mongo
 * project got `SCHEMA_EDITING_UNSUPPORTED` and fell back to the source-only
 * editor, which is off in production. A schemaless database is the one place
 * where changing a collection against a *running* backend is completely safe,
 * and it was the one place it did not work.
 *
 * ## What a verdict means here
 *
 * Every change is `safe`, because none of them can fail. That is not the
 * classifier being lax: on Postgres a verdict answers "will the database end up
 * matching this configuration", and here it always does — there is nothing in
 * the database that describes the shape.
 *
 * What the changes still say is what happens to the **data**, because that is
 * the part a reader can be surprised by. Removing a property does not delete
 * the field from documents that have it; those documents keep it and the API
 * stops serving it. Saying so is the difference between a reader who knows the
 * data is still there and one who assumes it is gone.
 */
import type {
    CollectionConfig,
    SchemaChange,
    SchemaChangePlan
} from "@rebasepro/types";

const bySlug = (collections: CollectionConfig[]): Map<string, CollectionConfig> => {
    const map = new Map<string, CollectionConfig>();
    for (const collection of collections) {
        if (collection.slug) map.set(collection.slug, collection);
    }
    return map;
};

const propertiesOf = (collection: CollectionConfig): Record<string, unknown> =>
    (collection.properties ?? {}) as Record<string, unknown>;

/**
 * What changed, in the terms a document database makes true.
 *
 * Exported because it is the interesting half and worth testing without a
 * driver: the shape of the answer is the product, and the rest is plumbing.
 */
export function classifyMongoChanges(
    before: CollectionConfig[],
    after: CollectionConfig[]
): SchemaChange[] {
    const previous = bySlug(before);
    const next = bySlug(after);
    const changes: SchemaChange[] = [];

    for (const [slug, collection] of next) {
        if (!previous.has(slug)) {
            changes.push({
                kind: "add-collection",
                verdict: "safe",
                collection: slug,
                detail: `New collection "${slug}". MongoDB creates it on the first write; nothing ` +
                    "is created now."
            });
            continue;
        }

        const oldProps = propertiesOf(previous.get(slug)!);
        const newProps = propertiesOf(collection);

        for (const name of Object.keys(newProps)) {
            if (name in oldProps) continue;
            changes.push({
                kind: "add-property",
                verdict: "safe",
                collection: slug,
                property: name,
                detail: `New property "${name}". Existing documents do not have it and are not ` +
                    "rewritten; reads return it as absent until something writes it."
            });
        }

        for (const name of Object.keys(oldProps)) {
            if (name in newProps) continue;
            changes.push({
                kind: "remove-property",
                verdict: "safe",
                collection: slug,
                property: name,
                // The one thing worth being explicit about. On Postgres this is
                // refused because it would drop a column; here nothing is
                // dropped, and a reader who assumes otherwise has it backwards.
                detail: `"${name}" is no longer served. Documents that have it keep it — MongoDB ` +
                    "stores no schema, so nothing is removed from the data."
            });
        }
    }

    for (const [slug] of previous) {
        if (next.has(slug)) continue;
        changes.push({
            kind: "remove-collection",
            verdict: "safe",
            collection: slug,
            detail: `Collection "${slug}" is no longer served. The MongoDB collection and every ` +
                "document in it are left exactly as they are."
        });
    }

    return changes;
}

/** A commit message that says what changed rather than that something did. */
function commitMessage(changes: SchemaChange[]): string {
    if (changes.length === 0) return "chore(schema): no change";

    const collections = [...new Set(changes.map(c => c.collection))].sort();
    const added = changes.filter(c => c.kind === "add-collection");
    const properties = changes.filter(c => c.kind === "add-property");

    const subject = added.length === 1 && changes.length === 1
        ? `add the ${added[0].collection} collection`
        : properties.length === 1 && changes.length === 1
            ? `add ${properties[0].property} to ${properties[0].collection}`
            : collections.length === 1
                ? `${changes.length} change(s) to ${collections[0]}`
                : `${changes.length} change(s) across ${collections.length} collections`;

    return `feat(schema): ${subject}\n\n${changes.map(c => `- ${c.detail}`).join("\n")}\n`;
}

/**
 * The plan: a commit, and nothing to run.
 *
 * `files` is empty here and filled by the caller with the rewritten collection
 * source. Postgres adds generated artifacts — a Drizzle schema, declarative
 * DDL — because a stale one breaks the next deploy. MongoDB generates none, so
 * the collection file is the whole of the change.
 */
export async function planMongoSchemaChange(
    before: CollectionConfig[],
    after: CollectionConfig[]
): Promise<SchemaChangePlan> {
    const changes = classifyMongoChanges(before, after);
    return {
        files: [],
        statements: [],
        classified: { changes, verdict: "safe", applicable: true },
        message: commitMessage(changes),
        withheldConstraints: []
    };
}
