import { DataService } from "../src/services/dataService";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { integer, PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { is, Param, SQL } from "drizzle-orm";

const collectionRegistry = new FixtureTableRegistry();

// ---------------------------------------------------------------------------
// Mock Drizzle table definitions
// ---------------------------------------------------------------------------

/**
 * Table with two primary keys – used to expose the composite-key delete bug.
 * The `primary: true` flag makes getPrimaryKeys() discover both columns as PKs.
 */
// Both key columns marked primary on themselves, as the code reads them.
const mockProjectUsersTable = pgTable("project_users", {
    project_id: text("project_id").primaryKey(),
    user_id: text("user_id").primaryKey(),
    role: text("role")
});

/** Single-PK table for count / pagination tests */
// `getSQLType` is the only thing the search builder asks a column about
// itself — see `supportsILike` — and a text column answers "text".
const mockItemsTable = pgTable("items", { id: integer("id"), name: text("name"), description: text("description") });

// ---------------------------------------------------------------------------
// Collection definitions
// ---------------------------------------------------------------------------

const projectUsersCollection: LegacyCollectionConfig = {
    slug: "project_users",
    name: "Project Users",
    table: "project_users",
    properties: {
        // The key: both columns, in this order.
        project_id: { type: "string", isId: true },
        user_id: { type: "string", isId: true },
        role: { type: "string" }
    }
};

const itemsCollection: LegacyCollectionConfig = {
    slug: "items",
    name: "Items",
    table: "items",
    properties: {
        id: { type: "number" },
        name: { type: "string" },
        description: { type: "string" }
    }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compile a condition handed to `.where()` into readable SQL plus its values.
 *
 * `PgDialect` is no use against these mock tables: its column check is an
 * `instanceof`, so every plain-object column above renders as a bind parameter
 * and the column names — the half of the WHERE clause that says *which* row is
 * being written — disappear from the output. Walking the chunks keeps them.
 *
 * The mock chains also swallow the condition entirely, so `toHaveBeenCalled()`
 * on `.where()` is satisfied by any condition at all, including one that
 * constrains a single key of a composite primary key.
 */
function renderCondition(condition: unknown): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const walk = (node: unknown): string => {
        if (is(node, SQL)) return (node as SQL).queryChunks.map(walk).join("");
        if (is(node, Param)) {
            params.push((node as Param).value);
            return `$${params.length}`;
        }
        if (node && typeof node === "object") {
            const chunk = node as { value?: unknown; name?: unknown };
            // StringChunk carries the literal SQL fragments; a mock column is
            // any other object with a `name`.
            if (Array.isArray(chunk.value)) return chunk.value.join("");
            if (typeof chunk.name === "string") return `"${chunk.name}"`;
        }
        params.push(node);
        return `$${params.length}`;
    };
    return { sql: walk(condition),
        params };
}

/** The condition of the last `.where()` call — cursor conditions re-issue it. */
function lastWhereCondition(db: ChainDb): { sql: string; params: unknown[] } {
    const calls = db.where.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return renderCondition(calls[calls.length - 1][0]);
}

/** Build the standard chainable mock db used throughout the existing test suite. */
function createMockDb() {
    // What every awaited chain resolves to; `answerWith` replaces it.
    let answer: unknown[] = Object.assign([], { rowCount: 1 });
    const chain = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        $dynamic: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        // UPDATE and DELETE report how many rows they matched; the driver rejects a
        // write that matched none, so the chainable mock has to carry a row count.
        rowCount: 1,
        transaction: jest.fn(),
        // Terminal operations are thenable, so they resolve when awaited.
        then: (resolve: (v: unknown[]) => void) => resolve(answer),
        answerWith(rows: unknown[]) { answer = rows; }
    };
    chain.transaction.mockImplementation((callback: (tx: NodePgDatabase) => unknown) => callback(asDrizzle(chain)));
    return chain;
}

type ChainDb = ReturnType<typeof createMockDb>;

/**
 * The chain as the service's database. It is a stand-in for drizzle's query
 * builder whose calls the tests inspect one by one; drizzle's builders have no
 * seam for that, so this is the one place it is asserted to be a database.
 */
function asDrizzle(chain: ChainDb): NodePgDatabase {
    return chain as unknown as NodePgDatabase;
}

function setupRegistryMocks() {
    jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation(path => {
        if (path.startsWith("project_users")) return projectUsersCollection;
        if (path.startsWith("items")) return itemsCollection;
        return undefined;
    });

    jest.spyOn(collectionRegistry, "getPgTable").mockImplementation(tableName => {
        if (tableName === "project_users") return mockProjectUsersTable;
        if (tableName === "items") return mockItemsTable;
        return undefined;
    });

    jest.spyOn(collectionRegistry, "getCollections").mockReturnValue([
        projectUsersCollection,
        itemsCollection
    ]);
}

// ===========================================================================
// 1. COMPOSITE KEY DELETION BUG
// ===========================================================================

describe("PersistService – composite key delete bug", () => {
    let dataService: DataService;
    let db: ChainDb;

    beforeEach(() => {
        db = createMockDb();
        setupRegistryMocks();
        dataService = new DataService(asDrizzle(db), collectionRegistry);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should call db.delete for a composite-key entity", async () => {
        await dataService.delete("project_users", "proj1:::user1");
        expect(db.delete).toHaveBeenCalledWith(mockProjectUsersTable);
        expect(db.where).toHaveBeenCalled();
    });

    it("REGRESSION: delete must use ALL primary keys in the WHERE clause", async () => {
        /**
         * There was a bug where `delete` only used `idInfoArray[0]`
         * for the WHERE clause, meaning only `project_id` was constrained.
         * This would delete ALL rows matching the first key instead of the
         * specific composite-key row.
         *
         * The fix loops over all primary keys and combines them with `and()`,
         * matching what `save` already does (lines 230-236).
         *
         * This test serves as a regression guard.
         */

        const whereSpy = db.where;
        whereSpy.mockClear();

        await dataService.delete("project_users", "proj1:::user1");

        expect(whereSpy).toHaveBeenCalledTimes(1);

        // Inspect the SQL condition passed to .where(), rendered with its values.
        const whereArg = whereSpy.mock.calls[0][0];
        const rendered = new PgDialect().sqlToQuery(whereArg);
        const serialisedCondition = `${rendered.sql} ${JSON.stringify(rendered.params)}`;

        // Both primary key columns MUST appear in the WHERE clause
        expect(serialisedCondition).toContain("project_id");
        expect(serialisedCondition).toContain("user_id");

        // The condition must also contain both parsed ID values
        expect(serialisedCondition).toContain("proj1");
        expect(serialisedCondition).toContain("user1");

        // The condition should be an AND (compound) condition, not a
        // simple eq() — verified by the presence of " and " in the
        // serialised SQL fragments.
        expect(serialisedCondition).toContain(" and ");
    });

    it("save correctly uses ALL primary keys in the WHERE clause (control test)", async () => {
        /**
         * This control test proves that `save` (update path) does
         * build the WHERE clause with ALL composite keys – confirming the
         * asymmetry with `delete`.
         */
        // UPDATE … RETURNING: the statement hands the row back itself.
        const mockWhere = jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{
            project_id: "proj1",
            user_id: "user1",
            role: "admin"
        }]) });
        const mockSet = jest.fn().mockReturnValue({ where: mockWhere });
        db.update.mockReturnValue({
            set: mockSet
        });

        // Mock the fetch-back after save
        db.limit.mockResolvedValue([{
            project_id: "proj1",
            user_id: "user1",
            role: "admin"
        }]);

        await dataService.save("project_users", { role: "admin" }, "proj1:::user1");

        expect(mockWhere).toHaveBeenCalledTimes(1);

        const saveWhereArg = mockWhere.mock.calls[0][0];
        const serialisedSaveCondition = new PgDialect().sqlToQuery(saveWhereArg).sql;

        // save correctly includes BOTH keys
        const saveHasProjectId = serialisedSaveCondition.includes("project_id");
        const saveHasUserId = serialisedSaveCondition.includes("user_id");

        expect(saveHasProjectId).toBe(true);
        expect(saveHasUserId).toBe(true);
    });

    it("delete should parse composite ID correctly before deletion", async () => {
        // The ID is split on ":::" and the parts are assigned *positionally*,
        // in `primaryKeys` order. Not throwing says nothing about that order:
        // swap the two and the statement is still valid SQL that deletes some
        // other row, or none.
        await expect(
            dataService.delete("project_users", "projA:::userB")
        ).resolves.toBeUndefined();

        const { sql, params } = lastWhereCondition(db);
        expect(sql).toBe('("project_id" = $1 and "user_id" = $2)');
        expect(params).toEqual(["projA", "userB"]);
    });

    it("delete should throw for malformed composite IDs", async () => {
        // Only one part instead of two → parseIdValues should reject it
        await expect(
            dataService.delete("project_users", "only-one-part")
        ).rejects.toThrow("Composite ID parts mismatch");
    });
});

// ===========================================================================
// 2. CURSOR PAGINATION WITH FILTERS
// ===========================================================================

describe("FetchService – cursor pagination combined with filters", () => {
    let dataService: DataService;
    let db: ChainDb;

    beforeEach(() => {
        db = createMockDb();
        setupRegistryMocks();
        dataService = new DataService(asDrizzle(db), collectionRegistry);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should call where() when both startAfter cursor and filter are provided", async () => {
        const mockResults = [
            { id: 3, name: "Item C", description: "Third" }
        ];
        db.answerWith(mockResults);

        await dataService.fetchCollection("items", {
            filter: { name: ["==", "Item C"] },
            startAfter: { id: 5, values: { name: "Item E" } },
            orderBy: "name",
            order: "asc",
            limit: 10
        });

        // Filter + cursor both generate WHERE conditions that must be combined
        expect(db.where).toHaveBeenCalled();

        // …and "combined" is the whole point: the cursor re-issues `.where()`
        // with the filter carried along, so losing the filter here would serve
        // the next page of the *unfiltered* table. Ascending order compares
        // with `>`, and the id tie-breaker is what keeps rows with an equal
        // `name` from being skipped or repeated across pages.
        //
        // Two things this used to get wrong, both of them silent:
        //
        // - The tie-breaker read `"id" > $4` while the ORDER BY has always
        //   appended `id DESC`. A comparison that runs opposite to the sort it
        //   breaks ties for walks the ties backwards, so rows sharing a `name`
        //   were skipped and repeated across pages.
        // - `>` answers *unknown* against NULL, so with NULLS LAST every row
        //   whose `name` is NULL vanished from page two onward. They sort after
        //   the cursor row, so `"name" is null` belongs in the disjunction.
        const { sql, params } = lastWhereCondition(db);
        expect(sql).toBe('("name" = $1 and ("name" > $2 or "name" is null or ("name" = $3 and "id" < $4)))');
        expect(params).toEqual(["Item C", "Item E", "Item E", 5]);
    });

    it("should apply cursor without orderBy (simple id < cursorId)", async () => {
        db.answerWith(Object.assign([], { rowCount: 1 }));

        await dataService.fetchCollection("items", {
            startAfter: { id: 10 },
            limit: 5
        });

        expect(db.where).toHaveBeenCalled();

        // With no orderBy the rows come back `id DESC`, so "after" means a
        // *smaller* id. The bound value must also be the parsed number: `id`
        // is numeric here, and a string cursor would compare as text.
        const { sql, params } = lastWhereCondition(db);
        expect(sql).toBe('"id" < $1');
        expect(params).toEqual([10]);
    });

    it("should apply cursor with desc ordering", async () => {
        db.answerWith(Object.assign([], { rowCount: 1 }));

        await dataService.fetchCollection("items", {
            startAfter: { id: 20, values: { name: "Alpha" } },
            orderBy: "name",
            order: "desc",
            limit: 10
        });

        // The fallback path applies where() + orderBy()
        expect(db.where).toHaveBeenCalled();
        expect(db.orderBy).toHaveBeenCalled();

        // `order: "desc"` has to invert both halves of the keyset comparison.
        // Leave either as `>` and the "next" page walks back over rows the
        // caller has already seen.
        const { sql, params } = lastWhereCondition(db);
        expect(sql).toBe('("name" < $1 or ("name" = $2 and "id" < $3))');
        expect(params).toEqual(["Alpha", "Alpha", 20]);

        // The ORDER BY must agree with the comparison, and always end on the
        // id — an ordering that is not total makes the cursor ambiguous.
        //
        // The NULL placement is spelled out rather than left to Postgres's
        // default. It is the same query — `DESC` already means `NULLS FIRST` —
        // but `buildKeysetComparison` encodes that placement too, and the two
        // have to agree for paging over a nullable key to be exact.
        const orderExpressions = db.orderBy.mock.calls[0];
        expect(orderExpressions.map((e: unknown) => renderCondition(e).sql)).toEqual([
            '"name" DESC NULLS FIRST',
            '"id" desc'
        ]);
    });

    it("should return empty array when no results match cursor + filter", async () => {
        db.answerWith(Object.assign([], { rowCount: 1 }));

        const entities = await dataService.fetchCollection("items", {
            filter: { name: ["==", "nonexistent"] },
            startAfter: { id: 1 },
            limit: 10
        });

        // `[]` on its own is the mock's own answer echoed back. What the
        // service decides is the query behind it: both narrowings AND-ed, and
        // no row invented for an empty driver result.
        const { sql, params } = lastWhereCondition(db);
        expect(sql).toBe('("name" = $1 and "id" < $2)');
        expect(params).toEqual(["nonexistent", 1]);
        expect(entities).toEqual([]);
    });
});

// ===========================================================================
// 3. COUNT SNAPSHOTS
// ===========================================================================

describe("FetchService – count", () => {
    let dataService: DataService;
    let db: ChainDb;

    beforeEach(() => {
        db = createMockDb();
        setupRegistryMocks();
        dataService = new DataService(asDrizzle(db), collectionRegistry);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should count entities with no filters", async () => {
        // The count query resolves to [{ count: 42 }]
        db.answerWith([{ count: 42 }]);

        const result = await dataService.count("items");

        expect(result).toBe(42);
        expect(db.select).toHaveBeenCalled();
        expect(db.from).toHaveBeenCalled();
    });

    it("should count entities with a filter", async () => {
        db.answerWith([{ count: 7 }]);

        const result = await dataService.count("items", {
            filter: { name: ["==", "Widget"] }
        });

        expect(result).toBe(7);
        expect(db.where).toHaveBeenCalled();
    });

    it("should return 0 when count result is empty", async () => {
        db.answerWith([]);

        const result = await dataService.count("items");

        expect(result).toBe(0);
    });

    it("should pass searchString through to the query pipeline", async () => {
        // The mock columns report a text `getSQLType()`, so buildSearchConditions
        // generates ILIKE conditions and the search path proceeds normally
        // rather than short-circuiting to 0.
        db.answerWith([{ count: 3 }]);

        const result = await dataService.count("items", {
            searchString: "hello"
        });

        // The mock columns pass the ILIKE eligibility check, so the query
        // proceeds and returns the mocked count.
        expect(result).toBe(3);
        expect(db.where).toHaveBeenCalled();
    });

    it("should handle search strings with ILIKE metacharacters (%, _)", async () => {
        db.answerWith([{ count: 1 }]);

        const searchString = "100%_done\\!";
        await expect(
            dataService.count("items", { searchString })
        ).resolves.toBeDefined();

        // Two guarantees. The user's text is *bound*, never spliced into the
        // statement, so it can never terminate the literal and become SQL —
        // which is what "should not crash" was quietly standing in for. And it
        // is escaped, so `%` and `_` are searched for rather than obeyed: this
        // is a substring search for the characters the user typed, and a
        // caller who wants wildcards has the `like` operator for that.
        const { sql, params } = lastWhereCondition(db);
        expect(sql).toBe('("name" ilike $1 or "description" ilike $2)');
        expect(params).toEqual(["%100\\%\\_done\\\\!%", "%100\\%\\_done\\\\!%"]);
        // The only unescaped wildcards are the two the substring wrapper adds.
        expect(params.every(p => String(p).match(/(?<!\\)%/g)?.length === 2)).toBe(true);

        // Every searchable string property is OR-ed in; drop one and the
        // search silently stops looking in that column.
        expect(sql).not.toContain('"id"');
    });
});

// ===========================================================================
// 4. DELETE ALL – no before/afterDelete callbacks
// ===========================================================================

describe("PersistService – deleteAll", () => {
    let dataService: DataService;
    let db: ChainDb;

    beforeEach(() => {
        db = createMockDb();
        setupRegistryMocks();
        dataService = new DataService(asDrizzle(db), collectionRegistry);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should issue a bulk DELETE without WHERE clause", async () => {
        await dataService.deleteAll("items");

        expect(db.delete).toHaveBeenCalledWith(mockItemsTable);
        // deleteAll must NOT call where() — it deletes everything
        expect(db.where).not.toHaveBeenCalled();
    });

    it("should issue a bulk DELETE on composite-key tables", async () => {
        await dataService.deleteAll("project_users");

        expect(db.delete).toHaveBeenCalledWith(mockProjectUsersTable);
        expect(db.where).not.toHaveBeenCalled();
    });

    it("should not invoke any per-entity callbacks (beforeDelete/afterDelete)", async () => {
        // deleteAll directly calls db.delete(table) — it does NOT iterate
        // over individual entities and therefore MUST NOT trigger any
        // beforeDelete / afterDelete lifecycle hooks.
        //
        // We verify this by ensuring only a single db.delete call is made
        // and no select/fetchOne calls precede it.
        const selectSpy = db.select;
        selectSpy.mockClear();

        await dataService.deleteAll("items");

        // Only one delete call, no selects to fetch individual entities
        expect(db.delete).toHaveBeenCalledTimes(1);
        expect(selectSpy).not.toHaveBeenCalled();
    });

    it("should throw for unknown collection", async () => {
        jest.spyOn(collectionRegistry, "getCollectionByPath").mockReturnValue(undefined);

        await expect(
            dataService.deleteAll("nonexistent")
        ).rejects.toThrow("Table not found: nonexistent");
    });
});
