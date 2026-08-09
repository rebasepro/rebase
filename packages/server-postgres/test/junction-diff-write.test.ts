import { CollectionConfig } from "@rebasepro/types";
import { RelationService } from "../src/services/RelationService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

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
    const registry = new PostgresCollectionRegistry();

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { _def: { tableName: name } };
        for (const c of columns) t[c] = { name: c };
        return t;
    };

    const tagsCollection: CollectionConfig = {
        slug: "tags",
        name: "Tags",
        table: "tags",
        properties: {
            id: { type: "string", isId: true },
            name: { type: "string" }
        }
    } as unknown as CollectionConfig;

    const postsCollection: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "string", isId: true },
            title: { type: "string" },
            tags: { type: "relation", relationName: "tags" }
        },
        relations: [
            {
                kind: "manyToMany",
                relationName: "tags",
                target: () => tagsCollection,
                cardinality: "many",
                through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
            }
        ]
    } as unknown as CollectionConfig;

    /**
     * A tx that answers the "what is linked now?" select with `existing`, and
     * records the deletes and inserts that follow.
     */
    const recordingTx = (existing: (string | number)[], deletedRowCount?: number) => {
        const inserted: Record<string, unknown>[][] = [];
        const deleteWheres: unknown[] = [];
        const conflictHandled: boolean[] = [];
        // `rowCount` is not decoration: the writer compares it against the
        // number of links it asked to remove, so a mock that omits it models a
        // database that refused every delete. Default to "removed everything it
        // was asked to" — `removed` is always a subset of `existing`.
        const rowCount = deletedRowCount ?? existing.length;
        const tx = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    // Awaitable, and `.limit()`-able: the diff select awaits it
                    // directly, while the survivor re-read after a short delete
                    // asks for one row.
                    where: jest.fn(() => {
                        const rows = existing.map(id => ({ targetId: id }));
                        return Object.assign(Promise.resolve(rows), {
                            limit: jest.fn(async () => rows.slice(0, 1))
                        });
                    })
                }))
            })),
            delete: jest.fn(() => ({
                where: jest.fn(async (condition: unknown) => {
                    deleteWheres.push(condition);
                    return { rowCount };
                })
            })),
            insert: jest.fn(() => ({
                values: jest.fn((rows: Record<string, unknown>[]) => {
                    inserted.push(rows);
                    return {
                        onConflictDoNothing: jest.fn(async () => {
                            conflictHandled.push(true);
                        })
                    };
                })
            }))
        };
        return { tx,
inserted,
deleteWheres,
conflictHandled };
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "posts") return table("posts", ["id", "title"]) as never;
            if (name === "tags") return table("tags", ["id", "name"]) as never;
            if (name === "posts_tags") return table("posts_tags", ["post_id", "tag_id"]) as never;
            return undefined;
        });
    });

    const writeTags = async (existing: (string | number)[], value: unknown, deletedRowCount?: number) => {
        const recording = recordingTx(existing, deletedRowCount);
        const service = new RelationService({} as never, registry);
        await service.updateRelationsUsingJoins(recording.tx as never, postsCollection, "p1", { tags: value } as never);
        return recording;
    };

    it("inserts only the link that arrived", async () => {
        const { inserted } = await writeTags(["t-1", "t-2"], ["t-1", "t-2", "t-3"]);
        expect(inserted).toEqual([[{ post_id: "p1", tag_id: "t-3" }]]);
    });

    it("touches nothing at all when the membership is unchanged", async () => {
        // This is the lost-update case and the payload-column case at once: a
        // save of some other field on the parent must not rewrite the junction.
        const { tx, inserted, deleteWheres } = await writeTags(["t-1", "t-2"], ["t-1", "t-2"]);
        expect(inserted).toEqual([]);
        expect(deleteWheres).toEqual([]);
        expect(tx.delete).not.toHaveBeenCalled();
        expect(tx.insert).not.toHaveBeenCalled();
    });

    it("never names a link that the reading transaction cannot see", async () => {
        // The RLS case. The select that drives the diff runs in the same
        // transaction, under the same policies, as the read that filled the
        // form: a link the user cannot see is in neither list, so it is in
        // neither the delete nor the insert and survives the save. The old
        // writer deleted every row for the parent, sight unseen, first.
        const { tx, inserted } = await writeTags(["t-1"], ["t-1", "t-2"]);
        expect(inserted).toEqual([[{ post_id: "p1", tag_id: "t-2" }]]);
        expect(tx.delete).not.toHaveBeenCalled();
    });

    it("deletes the links that were actually removed", async () => {
        const { tx, inserted } = await writeTags(["t-1", "t-2"], ["t-1"]);
        expect(tx.delete).toHaveBeenCalledTimes(1);
        expect(inserted).toEqual([]);
    });

    it("clears every link when the relation is emptied", async () => {
        const { tx, inserted } = await writeTags(["t-1", "t-2"], []);
        expect(tx.delete).toHaveBeenCalledTimes(1);
        expect(inserted).toEqual([]);
    });

    it("inserts with ON CONFLICT DO NOTHING, so two sessions adding the same link do not collide", async () => {
        const { conflictHandled } = await writeTags([], ["t-1"]);
        expect(conflictHandled).toEqual([true]);
    });

    it("matches a stored key against a parsed one by value, not by type", async () => {
        // The driver can hand a numeric key back as a string. A diff that
        // missed that would delete and re-insert every link on every save —
        // exactly the behaviour being removed.
        const { tx, inserted } = await writeTags(["t-1"], [{ id: "t-1" }]);
        expect(inserted).toEqual([]);
        expect(tx.delete).not.toHaveBeenCalled();
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
        const service = new RelationService({} as never, registry);
        const inverse = [{
            relationKey: "tags",
            relation: (postsCollection.relations as never as Array<Record<string, unknown>>)[0],
            newValue: []
        }];

        await expect(service.updateInverseRelations(
            recording.tx as never, postsCollection, "p1", inverse as never
        )).rejects.toMatchObject({ statusCode: 403, code: "WRITE_DENIED" });
    });

    it("refuses a junction it cannot resolve rather than skipping the relation", async () => {
        // This used to warn and carry on, so the save reported success having
        // written no links at all. `assertRelationsResolve` fails boot on the
        // same defect, so a running server cannot reach this — it is the second
        // line, for a registry assembled by hand.
        const recording = recordingTx([]);
        const service = new RelationService({} as never, registry);
        const inverse = [{
            relationKey: "tags",
            relation: {
                kind: "manyToMany",
                relationName: "tags",
                target: () => tagsCollection,
                cardinality: "many",
                through: { table: "does_not_exist", sourceColumn: "post_id", targetColumn: "tag_id" }
            },
            newValue: []
        }];

        await expect(service.updateInverseRelations(
            recording.tx as never, postsCollection, "p1", inverse as never
        )).rejects.toMatchObject({ code: "RELATION_MISCONFIGURED" });
    });

    it("still carries on past a relation that fails for a reason of its own", async () => {
        // The catch in `updateInverseRelations` earns its place for everything
        // that is not a decision about the caller: one relation blowing up on a
        // driver error should not abort the ones after it.
        const recording = recordingTx([]);
        const service = new RelationService({} as never, registry);
        const inverse = [{
            relationKey: "tags",
            relation: {
                kind: "manyToMany",
                relationName: "tags",
                target: () => { throw new Error("target thunk exploded"); },
                cardinality: "many",
                through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
            },
            newValue: []
        }];

        await expect(service.updateInverseRelations(
            recording.tx as never, postsCollection, "p1", inverse as never
        )).resolves.toBeUndefined();
    });

    it("writes a duplicated id once", async () => {
        const { inserted } = await writeTags([], ["t-1", "t-1"]);
        expect(inserted).toEqual([[{ post_id: "p1", tag_id: "t-1" }]]);
    });
});
