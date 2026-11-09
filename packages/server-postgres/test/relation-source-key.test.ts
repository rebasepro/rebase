import type { CollectionConfig, ResolvedHasMany } from "@rebasepro/types";
import { resolveCollectionRelations } from "@rebasepro/common";
import { RelationService } from "../src/services/RelationService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { recordingDb, shapedRows } from "./helpers/spg-c-db";
import { textTable } from "./helpers/spg-c-tables";

/**
 * `sourceKey` links two collections on a natural key rather than on the row id.
 *
 * The reason it has to exist: an app with an external auth provider joins
 * `talents` to `talent_applications` on `auth_user_id ↔ auth_user_id`. Neither
 * side's row id is involved. Without a `sourceKey` that is not a `hasMany` at
 * all — it has to drop to `via`, which is read-only by construction — so the
 * whole write path disappears for a link that is otherwise perfectly ordinary.
 *
 * The reason it needs its own suite: every failure mode here is silent. A read
 * that compares the target's foreign key against the parent's *id* does not
 * error, it returns nothing; a batch loader that attributes rows by the wrong
 * value does not error either, it hands one parent's children to another.
 */
describe("hasMany/hasOne — sourceKey", () => {
    const registry = new PostgresCollectionRegistry();

    const applications: CollectionConfig = {
        slug: "talent_applications",
        name: "Applications",
        table: "talent_applications",
        properties: {
            id: { type: "number", isId: "increment" },
            auth_user_id: { type: "string" },
            role: { type: "string" }
        }
    };

    const talents: CollectionConfig = {
        slug: "talents",
        name: "Talents",
        table: "talents",
        properties: {
            id: { type: "number", isId: "increment" },
            auth_user_id: { type: "string" },
            applications: {
                type: "relation",
                relation: {
                    kind: "hasMany",
                    relationName: "applications",
                    target: () => applications,
                    sourceKey: "auth_user_id",
                    foreignKeyOnTarget: "auth_user_id"
                }
            }
        }
    };

    /** The `applications` link as the services see it: resolved, with its defaults filled in. */
    const applicationsLink = (): ResolvedHasMany => {
        const link = resolveCollectionRelations(talents).applications;
        if (link?.kind !== "hasMany") throw new Error("talents.applications is not a hasMany");
        return link;
    };

    /**
     * A db that answers each `select()` with the next queued result set and
     * records the WHERE it was given.
     *
     * One queue rather than one canned answer, because the whole point of a
     * `sourceKey` read is that it is two statements: look the key up on the
     * parent, then match the children against it. A mock that replied the same
     * way to both would pass whether or not the second statement used the first
     * statement's answer.
     */
    const queuedDb = (resultSets: Record<string, unknown>[][]) => {
        let call = 0;
        const { db, statements } = recordingDb((statement) => {
            if (!/^select /i.test(statement.text)) return [];
            const rows = resultSets[call] ?? [];
            call += 1;
            return shapedRows(statement, rows);
        });
        const selects = () => statements.filter((statement) => /^select /i.test(statement.text));
        // The values each read was bound with, in order.
        return { db, params: () => selects().map((statement) => statement.values), selectCount: () => call };
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("talents") ? talents : applications);
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "talents") return textTable("talents", ["id", "auth_user_id"]);
            if (name === "talent_applications") return textTable("talent_applications", ["id", "auth_user_id", "role"]);
            return undefined;
        });
    });

    it("matches children against the parent's source key, not its id", async () => {
        const { db, params, selectCount } = queuedDb([
            // 1. the parent row, read to learn what its `auth_user_id` is
            [{ id: 7, auth_user_id: "auth0|abc" }],
            // 2. the children
            [{ id: 1, auth_user_id: "auth0|abc", role: "chef" }]
        ]);
        const relationService = new RelationService(db, registry);

        const rows = await relationService.fetchRelatedEntities("talents", 7, "applications");

        expect(selectCount()).toBe(2);
        expect(rows.map(r => r.id)).toEqual(["1"]);
        // The decisive assertion: the children were matched on "auth0|abc". The
        // bug this guards against compares against 7 and quietly returns none.
        expect(params()[1]).toContain("auth0|abc");
        expect(params()[1]).not.toContain(7);
    });

    it("returns nothing when the parent's source key is null", async () => {
        // NULL is never equal to a foreign key, so an `= NULL` would return
        // nothing anyway — but only by accident. Say it deliberately, and skip
        // the second statement entirely.
        const { db, selectCount } = queuedDb([[{ id: 7, auth_user_id: null }]]);
        const relationService = new RelationService(db, registry);

        expect(await relationService.fetchRelatedEntities("talents", 7, "applications")).toEqual([]);
        expect(selectCount()).toBe(1);
    });

    it("attributes batched children to the right parent by source key", async () => {
        const { db } = queuedDb([
            [
                { id: 7, auth_user_id: "auth0|abc" },
                { id: 9, auth_user_id: "auth0|xyz" }
            ],
            [
                { id: 1, auth_user_id: "auth0|abc", role: "chef" },
                { id: 2, auth_user_id: "auth0|xyz", role: "waiter" },
                { id: 3, auth_user_id: "auth0|abc", role: "host" }
            ]
        ]);
        const relationService = new RelationService(db, registry);

        const byParent = await relationService.batchFetchRelatedEntitiesMany(
            "talents",
            [7, 9],
            "applications",
            applicationsLink()
        );

        // Keyed by parent *id*, though the rows arrived keyed by auth id: the
        // caller addresses parents by id and cannot use anything else.
        expect([...byParent.keys()].sort()).toEqual(["7", "9"]);
        expect(byParent.get("7")!.map(r => r.values.role)).toEqual(["chef", "host"]);
        expect(byParent.get("9")!.map(r => r.values.role)).toEqual(["waiter"]);
    });

    it("refuses a source key that names more than one parent row", async () => {
        // Two parents holding the same key makes "whose child is this" have no
        // answer. Picking one is the failure this guards against.
        const { db } = queuedDb([
            [
                { id: 7, auth_user_id: "auth0|dup" },
                { id: 9, auth_user_id: "auth0|dup" }
            ]
        ]);
        const relationService = new RelationService(db, registry);

        await expect(
            relationService.batchFetchRelatedEntitiesMany(
                "talents",
                [7, 9],
                "applications",
                applicationsLink()
            )
        ).rejects.toThrow(/is not unique on 'talents'/);
    });

    it("resolves the parent's key on the caller's transaction, not the pool", async () => {
        // A write that read the key from the pool would translate the id
        // against whatever was committed, not against the change the
        // transaction is in the middle of making.
        const pool = queuedDb([[{ id: 7, auth_user_id: "stale" }]]);
        const tx = queuedDb([[{ id: 7, auth_user_id: "fresh" }]]);
        const relationService = new RelationService(pool.db, registry);

        const value = await relationService.parentKeyValue(
            talents,
            applicationsLink(),
            7,
            tx.db
        );

        expect(value).toBe("fresh");
        expect(pool.selectCount()).toBe(0);
    });

    it("costs no extra statement when the link joins on the row id", async () => {
        const plain: CollectionConfig = {
            ...talents,
            properties: {
                ...talents.properties,
                applications: {
                    type: "relation",
                    relation: { kind: "hasMany", relationName: "applications", target: () => applications, foreignKeyOnTarget: "talent_id" }
                }
            }
        };
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("talents") ? plain : applications);
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "talents") return textTable("talents", ["id", "auth_user_id"]);
            if (name === "talent_applications") return textTable("talent_applications", ["id", "talentId", "role"]);
            return undefined;
        });

        const { db, selectCount } = queuedDb([[{ id: 1, talentId: 7, role: "chef" }]]);
        const relationService = new RelationService(db, registry);

        await relationService.fetchRelatedEntities("talents", 7, "applications");

        // The common case stays one statement. A lookup that ran unconditionally
        // would double every relation read in the codebase.
        expect(selectCount()).toBe(1);
    });

    it("still parses the id when the link joins on the row id", async () => {
        // The regression this whole indirection could introduce. An id arrives
        // as the string out of a URL; the column is an integer. Routing the
        // common case through the source-key resolver and forgetting to parse
        // compares "7" against 7 and returns nothing — no error, no rows, and
        // nothing in the query to suggest why.
        const plain: CollectionConfig = {
            ...talents,
            properties: {
                ...talents.properties,
                applications: {
                    type: "relation",
                    relation: { kind: "hasMany", relationName: "applications", target: () => applications, foreignKeyOnTarget: "talent_id" }
                }
            }
        };
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("talents") ? plain : applications);
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "talents") return textTable("talents", ["id", "auth_user_id"]);
            if (name === "talent_applications") return textTable("talent_applications", ["id", "talentId", "role"]);
            return undefined;
        });

        const { db, params } = queuedDb([[{ id: 1, talentId: 7, role: "chef" }]]);
        const relationService = new RelationService(db, registry);

        await relationService.fetchRelatedEntities("talents", "7", "applications");

        expect(params()[0]).toContain(7);
        expect(params()[0]).not.toContain("7");
    });
});
