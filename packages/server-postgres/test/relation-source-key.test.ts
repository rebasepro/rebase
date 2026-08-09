import { CollectionConfig } from "@rebasepro/types";
import { RelationService } from "../src/services/RelationService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

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

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { _def: { tableName: name } };
        for (const c of columns) t[c] = { name: c };
        return t;
    };

    const applications: CollectionConfig = {
        slug: "talent_applications",
        name: "Applications",
        table: "talent_applications",
        properties: {
            id: { type: "number", isId: "increment" },
            auth_user_id: { type: "string" },
            role: { type: "string" }
        }
    } as unknown as CollectionConfig;

    const talents: CollectionConfig = {
        slug: "talents",
        name: "Talents",
        table: "talents",
        properties: {
            id: { type: "number", isId: "increment" },
            auth_user_id: { type: "string" },
            applications: { type: "relation", relationName: "applications" }
        },
        relations: [
            {
                kind: "hasMany",
                relationName: "applications",
                target: () => applications,
                sourceKey: "auth_user_id",
                foreignKeyOnTarget: "auth_user_id"
            }
        ]
    } as unknown as CollectionConfig;

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
        const wheres: unknown[] = [];
        let call = 0;
        const select = jest.fn(() => {
            const rows = resultSets[call] ?? [];
            call += 1;
            const chain: Record<string, unknown> = {};
            for (const method of ["from", "$dynamic", "limit", "offset", "orderBy", "innerJoin", "leftJoin"]) {
                chain[method] = jest.fn(() => chain);
            }
            chain.where = jest.fn((condition: unknown) => {
                wheres.push(condition);
                return chain;
            });
            chain.then = (resolve: (r: unknown) => void) => resolve(rows);
            return chain;
        });
        return { db: { select } as never, wheres, selectCount: () => call };
    };

    /**
     * Every bound value a Drizzle SQL condition carries, however deeply nested.
     *
     * `queryChunks` interleave `StringChunk`s (whose `value` is an array of SQL
     * fragments), columns, and the bound parameters — and a condition passed
     * through `and(...)` nests another `SQL` in the first slot, so this has to
     * recurse or it reads an empty list off a perfectly good condition.
     */
    const paramsOf = (condition: unknown): unknown[] => {
        const chunks = (condition as { queryChunks?: unknown[] })?.queryChunks;
        if (!Array.isArray(chunks)) return [];

        const params: unknown[] = [];
        for (const chunk of chunks) {
            if (chunk === null || typeof chunk !== "object") {
                params.push(chunk);
                continue;
            }
            if (Array.isArray((chunk as { queryChunks?: unknown }).queryChunks)) {
                params.push(...paramsOf(chunk));
                continue;
            }
            const value = (chunk as { value?: unknown }).value;
            // A StringChunk's `value` is the SQL text, not a parameter.
            if (value !== undefined && !Array.isArray(value)) params.push(value);
        }
        return params;
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("talents") ? talents : applications);
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "talents") return table("talents", ["id", "auth_user_id"]) as never;
            if (name === "talent_applications") return table("talent_applications", ["id", "auth_user_id", "role"]) as never;
            return undefined;
        });
    });

    it("matches children against the parent's source key, not its id", async () => {
        const { db, wheres, selectCount } = queuedDb([
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
        expect(paramsOf(wheres[1])).toContain("auth0|abc");
        expect(paramsOf(wheres[1])).not.toContain(7);
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
            (talents.relations as never as { kind: string }[])[0] as never
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
                (talents.relations as never as { kind: string }[])[0] as never
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
            (talents.relations as never as { kind: string }[])[0] as never,
            7,
            tx.db
        );

        expect(value).toBe("fresh");
        expect(pool.selectCount()).toBe(0);
    });

    it("costs no extra statement when the link joins on the row id", async () => {
        const plain: CollectionConfig = {
            ...talents,
            relations: [
                {
                    kind: "hasMany",
                    relationName: "applications",
                    target: () => applications,
                    foreignKeyOnTarget: "talent_id"
                }
            ]
        } as unknown as CollectionConfig;
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("talents") ? plain : applications);
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "talents") return table("talents", ["id", "auth_user_id"]) as never;
            if (name === "talent_applications") return table("talent_applications", ["id", "talentId", "role"]) as never;
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
            relations: [
                {
                    kind: "hasMany",
                    relationName: "applications",
                    target: () => applications,
                    foreignKeyOnTarget: "talent_id"
                }
            ]
        } as unknown as CollectionConfig;
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("talents") ? plain : applications);
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "talents") return table("talents", ["id", "auth_user_id"]) as never;
            if (name === "talent_applications") return table("talent_applications", ["id", "talentId", "role"]) as never;
            return undefined;
        });

        const { db, wheres } = queuedDb([[{ id: 1, talentId: 7, role: "chef" }]]);
        const relationService = new RelationService(db, registry);

        await relationService.fetchRelatedEntities("talents", "7", "applications");

        expect(paramsOf(wheres[0])).toContain(7);
        expect(paramsOf(wheres[0])).not.toContain("7");
    });
});
