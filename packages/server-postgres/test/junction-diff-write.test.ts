import { jest } from "@jest/globals";
import type { LegacyCollectionConfig, LegacyManyToManyRelation } from "@rebasepro/common/migrate";
import { pgTable, text } from "drizzle-orm/pg-core";
import { RelationWriteService } from "../src/services/RelationWriteService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { recordingDb } from "./helpers/spg-b-recording-db";

/**
 * A save of the parent used to be a full replacement of its membership set.
 *
 * `updateRelationsUsingJoins` deleted every junction row for the parent and
 * re-inserted the ids the browser had sent — a list the browser assembled out
 * of a read it did earlier. Three things follow, and all three are data loss
 * rather than a display problem:
 *
 *  - **Lost update.** Two editors with post 7 open: A adds tag X and saves, B
 *    saves any field from a form that predates it, and X is gone with nothing
 *    reported to either of them.
 *  - **A partially-read set is a partially-deleted set.** The read that fills
 *    the form runs under RLS, so a user who may edit the parent but cannot see
 *    some linked rows gets a shorter list — and writing it back deleted the
 *    links they were never shown.
 *  - **Junction payload columns.** A junction with its own columns lost them
 *    on every save, because every surviving link was deleted and re-inserted
 *    with only the two keys.
 *
 * The writer diffs now: delete only the ids that left, insert only the ids
 * that arrived, leave the rest alone.
 */
describe("junction writes diff rather than replace", () => {
    const postsTable = pgTable("posts", { id: text("id").primaryKey(), title: text("title") });
    const tagsTable = pgTable("tags", { id: text("id").primaryKey(), name: text("name") });
    const postsTagsTable = pgTable("posts_tags", { post_id: text("post_id"), tag_id: text("tag_id") });

    const registry = new FixtureTableRegistry();
    registry.registerPgTable(postsTable, "posts");
    registry.registerPgTable(tagsTable, "tags");
    registry.registerPgTable(postsTagsTable, "posts_tags");

    const tagsCollection: LegacyCollectionConfig = {
        slug: "tags",
        name: "Tags",
        table: "tags",
        properties: {
            id: { type: "string", isId: true },
            name: { type: "string" }
        }
    };

    const tagsRelation: LegacyManyToManyRelation = {
        kind: "manyToMany",
        relationName: "tags",
        target: () => tagsCollection,
        through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
    };

    const postsCollection: LegacyCollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "string", isId: true },
            title: { type: "string" }
        },
        relations: [tagsRelation]
    };
    registry.registerMultiple([postsCollection, tagsCollection]);

    /**
     * A registry serving `postsCollection` with `relation` in place of its one
     * relation, over the same tables.
     */
    const registryWith = (relation: LegacyManyToManyRelation): PostgresTableRegistry => {
        const other = new FixtureTableRegistry([{ ...postsCollection, relations: [relation] }, tagsCollection]);
        other.registerPgTable(postsTable, "posts");
        other.registerPgTable(tagsTable, "tags");
        other.registerPgTable(postsTagsTable, "posts_tags");
        return other;
    };

    /**
     * A database that answers the "what is linked now?" select with `existing`,
     * and records the deletes and inserts that follow.
     */
    const recordingTx = (existing: (string | number)[], deletedRowCount?: number) => {
        // `rowCount` is not decoration: the writer compares it against the
        // number of links it asked to remove, so a database that reports none
        // refused every delete. Default to "removed everything it was asked
        // to" — `removed` is always a subset of `existing`.
        const rowCount = deletedRowCount ?? existing.length;
        const recording = recordingDb(({ text: sqlText }) => {
            // The survivor re-read after a short delete asks for one row.
            if (/^select 1 from "posts_tags"/i.test(sqlText)) return existing.slice(0, 1).map(() => [1]);
            if (/^select .* from "posts_tags"/i.test(sqlText)) return existing.map(id => [id]);
            if (/^delete from "posts_tags"/i.test(sqlText)) return { rows: [], rowCount };
            return [];
        });
        const inserts = () => recording.statements().filter(q => /^insert into "posts_tags"/i.test(q.text));
        const deletes = () => recording.statements().filter(q => /^delete from "posts_tags"/i.test(q.text));
        /** Each insert's rows, as `{ post_id, tag_id }`. */
        const inserted = () => inserts().map(q => {
            const rows: Record<string, unknown>[] = [];
            for (let i = 0; i < q.values.length; i += 2) rows.push({ post_id: q.values[i], tag_id: q.values[i + 1] });
            return rows;
        });
        const conflictHandled = () => inserts().map(q => /on conflict do nothing/i.test(q.text));
        return { db: recording.db, inserted, deletes, conflictHandled };
    };

    const writeTags = async (existing: (string | number)[], value: unknown, deletedRowCount?: number) => {
        const recording = recordingTx(existing, deletedRowCount);
        const service = new RelationWriteService(recording.db, registry);
        await service.updateRelationsUsingJoins(recording.db, registry.requireTable(postsCollection.slug), "p1", { tags: value });
        return recording;
    };

    it("inserts only the link that arrived", async () => {
        const { inserted } = await writeTags(["t-1", "t-2"], ["t-1", "t-2", "t-3"]);
        expect(inserted()).toEqual([[{ post_id: "p1", tag_id: "t-3" }]]);
    });

    it("touches nothing at all when the membership is unchanged", async () => {
        // This is the lost-update case and the payload-column case at once: a
        // save of some other field on the parent must not rewrite the junction.
        const { inserted, deletes } = await writeTags(["t-1", "t-2"], ["t-1", "t-2"]);
        expect(inserted()).toEqual([]);
        expect(deletes()).toEqual([]);
    });

    it("never names a link that the reading transaction cannot see", async () => {
        // The RLS case. The select that drives the diff runs in the same
        // transaction, under the same policies, as the read that filled the
        // form: a link the user cannot see is in neither list, so it is in
        // neither the delete nor the insert and survives the save. The old
        // writer deleted every row for the parent, sight unseen, first.
        const { inserted, deletes } = await writeTags(["t-1"], ["t-1", "t-2"]);
        expect(inserted()).toEqual([[{ post_id: "p1", tag_id: "t-2" }]]);
        expect(deletes()).toEqual([]);
    });

    it("deletes the links that were actually removed", async () => {
        const { inserted, deletes } = await writeTags(["t-1", "t-2"], ["t-1"]);
        expect(deletes()).toHaveLength(1);
        expect(deletes()[0].values).toEqual(["p1", "t-2"]);
        expect(inserted()).toEqual([]);
    });

    it("clears every link when the relation is emptied", async () => {
        const { inserted, deletes } = await writeTags(["t-1", "t-2"], []);
        expect(deletes()).toHaveLength(1);
        expect(inserted()).toEqual([]);
    });

    it("inserts with ON CONFLICT DO NOTHING, so two sessions adding the same link do not collide", async () => {
        const { conflictHandled } = await writeTags([], ["t-1"]);
        expect(conflictHandled()).toEqual([true]);
    });

    it("matches a stored key against a parsed one by value, not by type", async () => {
        // The driver can hand a numeric key back as a string. A diff that
        // missed that would delete and re-insert every link on every save —
        // exactly the behaviour being removed.
        const { inserted, deletes } = await writeTags(["t-1"], [{ id: "t-1" }]);
        expect(inserted()).toEqual([]);
        expect(deletes()).toEqual([]);
    });

    it("refuses to report success when the delete removed fewer links than it named", async () => {
        // A junction policy that permits SELECT and not DELETE returns zero
        // rows removed and no error — indistinguishable from a save that had
        // nothing to do. The links are still readable afterwards, which is
        // what separates "refused" from "someone else got there first".
        await expect(writeTags(["t-1", "t-2"], ["t-1"], 0)).rejects.toMatchObject({
            statusCode: 403,
            code: "WRITE_DENIED"
        });
    });

    it("lets that refusal out of the inverse-relation path, which warns about everything else", async () => {
        // `updateInverseRelations` catches per relation so that one relation
        // with unresolvable columns does not abort the others — and it used to
        // catch the refusal too, which put the silent success back one layer up
        // from where it was just fixed.
        const recording = recordingTx(["t-1", "t-2"], 0);
        const service = new RelationWriteService(recording.db, registry);
        const inverse = [{ relationKey: "tags", newValue: [] }];

        await expect(service.updateInverseRelations(
            recording.db, registry.requireTable(postsCollection.slug), "p1", inverse
        )).rejects.toMatchObject({ statusCode: 403, code: "WRITE_DENIED" });
    });

    it("refuses a junction it cannot resolve rather than skipping the relation", async () => {
        // This used to warn and carry on, so the save reported success having
        // written no links at all. `assertRelationsResolve` fails boot on the
        // same defect, so a running server cannot reach this — it is the second
        // line, for a registry assembled by hand.
        const recording = recordingTx([]);
        const misconfigured = registryWith({
            ...tagsRelation,
            through: { table: "does_not_exist", sourceColumn: "post_id", targetColumn: "tag_id" }
        });
        const service = new RelationWriteService(recording.db, misconfigured);
        const inverse = [{ relationKey: "tags", newValue: [] }];

        await expect(service.updateInverseRelations(
            recording.db, misconfigured.requireTable(postsCollection.slug), "p1", inverse
        )).rejects.toMatchObject({ code: "RELATION_MISCONFIGURED" });
    });

    it("still carries on past a relation that fails for a reason of its own", async () => {
        // The catch in `updateInverseRelations` earns its place for everything
        // that is not a decision about the caller: one relation blowing up on a
        // driver error should not abort the ones after it.
        const recording = recordingTx([]);
        const exploding = registryWith(tagsRelation);
        const requireTable = exploding.requireTable.bind(exploding);
        jest.spyOn(exploding, "requireTable").mockImplementation(slug => {
            if (slug === "tags") throw new Error("target lookup exploded");
            return requireTable(slug);
        });
        const service = new RelationWriteService(recording.db, exploding);
        const inverse = [{ relationKey: "tags", newValue: [] }];

        await expect(service.updateInverseRelations(
            recording.db, exploding.requireTable(postsCollection.slug), "p1", inverse
        )).resolves.toBeUndefined();
    });

    it("writes a duplicated id once", async () => {
        const { inserted } = await writeTags([], ["t-1", "t-1"]);
        expect(inserted()).toEqual([[{ post_id: "p1", tag_id: "t-1" }]]);
    });
});
