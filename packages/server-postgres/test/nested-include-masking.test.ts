/**
 * `afterRead` masks a row however deep an `include` reached it (SEC-FIX-2 F-1).
 *
 * The chain used to stop one level into an include: `comments?include=post.author`
 * served the authors' masked columns in clear. Every include shape is walked
 * here — to-one, to-many, many-to-many (with `_pivot`), `via`, `hasOne`, a
 * self-reference followed level after level — at depth 1, 2 and 3, through
 * every in-process door the driver serves: the REST/SDK walk (list and one),
 * the driver's SPI (`fetchCollection` / `fetchOne`: socket one-shots, MCP,
 * `requireDriver`), a caller-scoped driver, and realtime frames.
 *
 * Against a real Postgres (PGlite), with the tables created from the plan of
 * the same definitions.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable, rel, type IncludeSpec, type TableHooks } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { afterReadApplies, hookSetOf } from "../src/services/table-hooks";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";
import { testUser } from "./helpers/spg-b-fixtures";

type Row = Record<string, unknown>;

/** People: the masked table. A table hook masks `email`, a column transform `phone`. */
const people = defineTable("people", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name: col.text(),
        email: col.text(),
        phone: col.text().transform({ afterRead: ({ value }) => (value == null ? value : "PHONE-MASKED") })
    },
    relations: {
        // A self-reference: `mentor.mentor.mentor` is three levels of the same table.
        mentor: rel.belongsTo(() => people, { localKey: "mentor_id", constraint: false }),
        profile: rel.hasOne(() => profiles, { foreignKey: "person_id" })
    },
    hooks: {
        afterRead: ({ values }) => ({ ...values, email: values.email == null ? values.email : "MASKED" })
    },
    rls: "admin-only"
});

/** A profile masks its own `ssn` — reached through `hasOne`. */
const profiles = defineTable("profiles", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        bio: col.text(),
        ssn: col.text().transform({ afterRead: ({ value }) => (value == null ? value : "SSN-MASKED") })
    },
    relations: { person: rel.belongsTo(() => people, { localKey: "person_id" }) },
    rls: "admin-only"
});

/** Tags mask `secret`; reached through many-to-many (with a pivot) and through `via`. */
const tags = defineTable("tags", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        label: col.text(),
        secret: col.text()
    },
    relations: { owner: rel.belongsTo(() => people, { localKey: "owner_id" }) },
    hooks: { afterRead: ({ values }) => ({ ...values, secret: values.secret == null ? values.secret : "TAG-MASKED" }) },
    rls: "admin-only"
});

/** Posts have no hooks of their own: the walk must pass through them. */
const posts = defineTable("posts", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        title: col.text()
    },
    relations: {
        author: rel.belongsTo(() => people, { localKey: "author_id" }),
        comments: rel.hasMany(() => comments, { foreignKey: "post_id", orderBy: [["id", "asc"]] }),
        tags: rel.manyToMany(() => tags, {
            through: "post_tags", sourceKey: "post_id", targetKey: "tag_id", pivot: { note: col.text() }
        })
    },
    rls: "admin-only"
});

/** Comments: the root of the deep reads. No hooks either. */
const comments = defineTable("comments", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        body: col.text()
    },
    relations: {
        post: rel.belongsTo(() => posts, { localKey: "post_id" }),
        // Every tag of the comment's post, two joins away.
        postTags: rel.via(() => tags, {
            steps: [
                { table: "posts", on: { from: "post_id", to: "id" } },
                { table: "post_tags", on: { from: "id", to: "post_id" } },
                { table: "tags", on: { from: "tag_id", to: "id" } }
            ]
        })
    },
    rls: "admin-only"
});

const DEFS = [people, profiles, tags, posts, comments];
const ADMIN = testUser({ uid: "u1", roles: ["admin"] });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const queryable = (db: PGlite) => ({
    query: async <T = unknown>(statement: string, values?: unknown[]) => ({ rows: (await db.query<T>(statement, values)).rows })
});

let db: PGlite;
let registry: PostgresTableRegistry;
let driver: PostgresBackendDriver;
let realtime: RealtimeService;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    const compiled = compileSchema(DEFS);
    await db.exec(renderPostgresDdl(planSchema(compiled, { databaseExtensions: [] }), {
        includePolicies: false, includeSearch: false, includeVector: false
    }));
    const catalogue = await readCatalogueSchema({ client: queryable(db), tables: compiled.map(t => t.descriptor), defaultSchema: "public" });
    registry = new PostgresTableRegistry();
    registry.registerTables(compiled);
    for (const [name, table] of Object.entries(catalogue.tables)) registry.registerPgTable(table, name);
    const orm = pgliteNodePg(db, { schema: catalogue.tables });
    realtime = new RealtimeService(orm, registry);
    driver = new PostgresBackendDriver(orm, realtime, registry);
    realtime.setDataDriver(driver);

    await db.exec(`
        INSERT INTO people (name, email, phone, mentor_id) VALUES
            ('Ada', 'ada@real.example', '555-0001', 2),
            ('Bo', 'bo@real.example', '555-0002', 3),
            ('Cy', 'cy@real.example', '555-0003', 1);
        INSERT INTO profiles (bio, ssn, person_id) VALUES ('Ada writes', '111-11-1111', 1), ('Bo reads', '222-22-2222', 2);
        INSERT INTO tags (label, secret, owner_id) VALUES ('red', 'tag-secret-red', 2), ('blue', 'tag-secret-blue', 3);
        INSERT INTO posts (title, author_id) VALUES ('hello', 1), ('again', 2);
        INSERT INTO post_tags (post_id, tag_id, note) VALUES (1, 1, 'first link'), (1, 2, 'second link');
        INSERT INTO comments (body, post_id) VALUES ('nice', 1), ('also nice', 1), ('meh', 2);
    `);
});

afterAll(async () => {
    await realtime.destroy();
    await db.close();
});

const RAW = ["ada@real.example", "bo@real.example", "cy@real.example", "555-0001", "555-0002", "555-0003",
    "111-11-1111", "222-22-2222", "tag-secret-red", "tag-secret-blue"];

/** Every raw value a mask hides that appears anywhere in `value`. */
function leaks(value: unknown): string[] {
    const text = JSON.stringify(value);
    return RAW.filter(raw => text.includes(raw));
}

/** A read door: how a caller gets rows of `path` with `include`. */
type Door = (path: string, include: IncludeSpec) => Promise<Row[]>;

const DOORS: Record<string, Door> = {
    "REST/SDK list": (path, include) => driver.restFetchService.fetchCollectionForRest(path, {}, include),
    "REST/SDK one": async (path, include) => {
        const row = await driver.restFetchService.fetchOneForRest(path, "1", include);
        return row ? [row] : [];
    },
    "caller-scoped REST/SDK list": async (path, include) => {
        const scoped = await driver.withAuth(ADMIN);
        if (!scoped.restFetchService) throw new Error("no scoped fetch service");
        return scoped.restFetchService.fetchCollectionForRest(path, {}, include);
    },
    "driver fetchCollection (socket one-shot, MCP)": (path, include) =>
        driver.fetchCollection({ path, include }),
    "driver fetchOne": async (path, include) => {
        const row = await driver.fetchOne({ path, id: "1", include });
        return row ? [row] : [];
    },
    "realtime collection frame": async (path, include) => {
        const scoped = await driver.withAuth(ADMIN);
        const frames: Row[][] = [];
        if (!scoped.listenCollection) throw new Error("no listenCollection");
        const unsubscribe = scoped.listenCollection({ path, include, onUpdate: rows => frames.push(rows) });
        await wait(200);
        unsubscribe();
        const last = frames.at(-1);
        if (!last) throw new Error(`no frame for ${path}`);
        return last;
    },
    "realtime one frame (first and refetch)": async (path, include) => {
        const scoped = await driver.withAuth(ADMIN);
        const frames: (Row | null)[] = [];
        if (!scoped.listenOne) throw new Error("no listenOne");
        const unsubscribe = scoped.listenOne({ path, id: "1", include, onUpdate: row => frames.push(row) });
        await wait(150);
        // A refetch is sent when the row changed: touch a column no mask reads.
        const column = ({ people: "name", comments: "body", posts: "title" } as Record<string, string>)[path];
        await db.query(`UPDATE ${path} SET ${column} = ${column} || '!' WHERE id = 1`);
        await realtime.notifyUpdate(path, "1", { _rebase_invalidated: true });
        // The refetch is debounced.
        await wait(600);
        unsubscribe();
        await db.query(`UPDATE ${path} SET ${column} = rtrim(${column}, '!') WHERE id = 1`);
        if (frames.length < 2) throw new Error(`expected a first frame and a refetch for ${path}, got ${JSON.stringify(frames)}`);
        return frames.filter((row): row is Row => row !== null);
    }
};

/** Include shapes × depth, each with the path to a masked value it must reach. */
const SHAPES: { name: string; path: string; include: string; reach: (row: Row) => unknown }[] = [
    { name: "to-one, depth 1", path: "posts", include: "author", reach: row => (row.author as Row).email },
    { name: "to-one, depth 2", path: "comments", include: "post.author", reach: row => ((row.post as Row).author as Row).email },
    {
        name: "to-one, depth 3 (self-reference)", path: "comments", include: "post.author.mentor",
        reach: row => (((row.post as Row).author as Row).mentor as Row).phone
    },
    {
        name: "self-reference, depth 3 of one table", path: "people", include: "mentor.mentor.mentor",
        reach: row => (((row.mentor as Row).mentor as Row).mentor as Row).email
    },
    {
        name: "hasOne at depth 3", path: "comments", include: "post.author.profile",
        reach: row => ((((row.post as Row).author as Row).profile as Row).ssn)
    },
    {
        name: "to-many then to-one, depth 2", path: "posts", include: "comments.post",
        reach: row => ((row.comments as Row[])[0]?.post as Row).title
    },
    {
        name: "many-to-many at depth 2, with _pivot", path: "comments", include: "post.tags",
        reach: row => ((row.post as Row).tags as Row[]).map(tag => [tag.secret, (tag._pivot as Row | undefined)?.note])
    },
    {
        name: "many-to-many then to-one, depth 3", path: "comments", include: "post.tags.owner",
        reach: row => ((row.post as Row).tags as Row[]).map(tag => (tag.owner as Row).email)
    },
    {
        name: "via then to-one, depth 2", path: "comments", include: "postTags.owner",
        reach: row => (row.postTags as Row[]).map(tag => [tag.secret, (tag.owner as Row).phone])
    }
];

describe("afterRead at every include depth, on every in-process door", () => {
    for (const [doorName, door] of Object.entries(DOORS)) {
        describe(doorName, () => {
            for (const shape of SHAPES) {
                it(`masks ${shape.name} (${shape.path}?include=${shape.include})`, async () => {
                    const rows = await door(shape.path, [shape.include]);
                    expect(rows.length).toBeGreaterThan(0);
                    // The include was followed: the value is there…
                    for (const row of rows) {
                        if (shape.path === "comments" && (row.id === 3)) continue;
                        expect(shape.reach(row)).toBeDefined();
                    }
                    // …and nothing a mask hides is anywhere in the answer.
                    expect(leaks(rows)).toEqual([]);
                });
            }
        });
    }

    it("serves the pivot's own data beside the masked target row", async () => {
        const [row] = await DOORS["REST/SDK one"]("comments", ["post.tags"]);
        const tagsOfPost = (row.post as Row).tags as Row[];
        expect(tagsOfPost.map(tag => [tag.label, tag.secret, (tag._pivot as Row).note])).toEqual([
            ["red", "TAG-MASKED", "first link"],
            ["blue", "TAG-MASKED", "second link"]
        ]);
    });
});

describe("the walk", () => {
    it("knows a table with no hooks of its own reaches masked tables through its relations", () => {
        const comments = registry.requireTable("comments");
        expect(afterReadApplies(registry, hookSetOf(registry, comments))).toBe(true);
    });

    it("runs the global hook on every row at every level, each once", async () => {
        const seen: string[] = [];
        const global: TableHooks = {
            afterRead: ({ table, values }) => {
                seen.push(`${table.slug}:${String(values.id)}`);
                return { ...values, globallySeen: true };
            }
        };
        registry.setGlobalHooks(global);
        try {
            const rows = await driver.restFetchService.fetchCollectionForRest(
                "comments", { filter: { id: ["==", 1] } }, ["post.author.mentor"]
            );
            const post = rows[0].post as Row;
            const author = post.author as Row;
            const mentor = author.mentor as Row;
            for (const level of [rows[0], post, author, mentor]) expect(level.globallySeen).toBe(true);
            expect(seen.sort()).toEqual(["comments:1", "people:1", "people:2", "posts:1"]);
        } finally {
            registry.setGlobalHooks(undefined);
        }
    });

    it("does not let a hook's in-place edit of a shared related row reach another parent", async () => {
        // Two comments share one post; a hook that edits its argument edits a copy.
        registry.setTableHooks("people", {
            afterRead: ({ values }) => {
                values.email = `${String(values.email).length > 0 ? "MASKED" : ""}`;
                values.timesMasked = (typeof values.timesMasked === "number" ? values.timesMasked : 0) + 1;
                return values;
            }
        });
        try {
            const rows = await driver.restFetchService.fetchCollectionForRest(
                "comments", { filter: { id: ["in", [1, 2]] } }, ["post.author"]
            );
            expect(rows).toHaveLength(2);
            for (const row of rows) expect(((row.post as Row).author as Row).timesMasked).toBe(1);
        } finally {
            registry.setTableHooks("people", people.config.hooks ?? {});
        }
    });
});
