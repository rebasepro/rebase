/**
 * Per-field `access.read`, at every exit of the row pipeline.
 *
 * A caller the row's policies let through still does not receive a field their
 * roles cannot read. "Every exit" is the load-bearing word: REST inlines a
 * relation target's columns, the admin and every realtime frame carry a ref with
 * those same columns attached, and only one of the two branches was ever
 * filtered — so a password hash REST correctly withheld rode out on every
 * `.listen()` frame. The same walk now answers for both, and for the role case
 * as well as the empty-list one.
 *
 * The viewer is ambient rather than a parameter (see `field-viewer.ts`): the
 * pipeline is reached through three services that carry no user, and a
 * parameter added to a dozen signatures is a parameter forgotten on the
 * thirteenth. These tests establish it the way the driver does.
 */
import { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { toRestRow, stripUnreadable, canReadRelation } from "../src/services/row-pipeline";
import { withFieldViewer, currentFieldViewer } from "../src/services/field-viewer";
import { FixtureTableRegistry } from "./helpers/tables";
import { belongsTo, manyToMany } from "./helpers/relation-descriptors";

const staff: LegacyCollectionConfig = {
    name: "Staff",
    slug: "staff",
    properties: {
        id: { name: "Id", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        salary: { name: "Salary", type: "number", access: { read: ["hr"] } },
        // Write-only to the API: readable by anyone, settable by nobody.
        rating: { name: "Rating", type: "number", access: { write: [] } },
        passwordHash: {
            name: "Password Hash",
            type: "string",
            columnName: "password_hash",
            excludeFromApi: true
        }
    }
};

const posts: LegacyCollectionConfig = {
    name: "Posts",
    slug: "posts",
    properties: {
        id: { name: "Id", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        author: { name: "Author", type: "relation" }
    },
    relations: [
        { kind: "belongsTo", relationName: "author", target: () => staff, localKey: "author_id" }
    ]
};

function makeRegistry(): FixtureTableRegistry {
    const registry = new FixtureTableRegistry();
    registry.registerMultiple([staff, posts]);
    return registry;
}

const registry = makeRegistry();
/** The table descriptor the strip reads, for a registered fixture. */
const described = (collection: LegacyCollectionConfig) => registry.requireTable(collection.slug).descriptor;
const row = () => ({ id: 1, name: "Ada", salary: 90_000, rating: 5, passwordHash: "salt:hash" });

describe("the REST row", () => {
    it("withholds a field the caller's roles cannot read", () => {
        const served = withFieldViewer({ roles: ["staff"] }, () => toRestRow(row(), registry.requireTable(staff.slug), registry));
        expect(served.name).toBe("Ada");
        expect(served).not.toHaveProperty("salary");
    });

    it("serves it to a caller holding the role", () => {
        const served = withFieldViewer({ roles: ["hr"] }, () => toRestRow(row(), registry.requireTable(staff.slug), registry));
        expect(served.salary).toBe(90_000);
    });

    it("serves it to `admin`, who satisfies any non-empty list", () => {
        const served = withFieldViewer({ roles: ["admin"] }, () => toRestRow(row(), registry.requireTable(staff.slug), registry));
        expect(served.salary).toBe(90_000);
    });

    it("deletes the key rather than nulling it", () => {
        // A withheld value that arrives as `null` is indistinguishable from a
        // stored `null` — which turns a permission boundary into a question a
        // client answers by counting nulls, and makes an echoing update
        // overwrite the real value.
        const served = withFieldViewer({ roles: ["anon"] }, () => toRestRow(row(), registry.requireTable(staff.slug), registry));
        expect("salary" in served).toBe(false);
    });

    it("keeps a field whose rule is only about writing", () => {
        const served = withFieldViewer({ roles: ["anon"] }, () => toRestRow(row(), registry.requireTable(staff.slug), registry));
        expect(served.rating).toBe(5);
    });

    it("still withholds an `excludeFromApi` column from everybody", () => {
        for (const roles of [["hr"], ["admin"], ["anon"]]) {
            const served = withFieldViewer({ roles }, () => toRestRow(row(), registry.requireTable(staff.slug), registry));
            expect(served).not.toHaveProperty("passwordHash");
        }
    });
});

describe("a relation target", () => {
    const post = () => ({ id: 7, title: "Hello", author: row() });

    it("is stripped when inlined into the parent (REST)", () => {
        const served = withFieldViewer({ roles: ["staff"] }, () => toRestRow(post(), registry.requireTable(posts.slug), registry));
        const author = served.author as Record<string, unknown>;
        expect(author.name).toBe("Ada");
        expect(author).not.toHaveProperty("salary");
    });

    it("withholds the target's secret under both its spellings", () => {
        const served = withFieldViewer({ roles: ["staff"] }, () => toRestRow(post(), registry.requireTable(posts.slug), registry));
        const author = served.author as Record<string, unknown>;
        expect(author).not.toHaveProperty("passwordHash");
        expect(author).not.toHaveProperty("password_hash");
    });

    it("carries the field for a caller who may read it", () => {
        const inlined = withFieldViewer({ roles: ["hr"] }, () => toRestRow(post(), registry.requireTable(posts.slug), registry));
        expect((inlined.author as Record<string, unknown>).salary).toBe(90_000);
    });
});

describe("the column-name spelling", () => {
    it("is deleted as well as the property key", () => {
        const raw = { id: 1, password_hash: "salt:hash", name: "Ada" };
        const served = withFieldViewer({ roles: ["admin"] }, () => stripUnreadable(raw, described(staff)));
        expect(served).not.toHaveProperty("password_hash");
    });
});

describe("`_matches`, the list of fields a search hit", () => {
    /**
     * `?searchExplain=true` answers with `[{ field, snippet }]` — the snippet is
     * a `ts_headline` of the matched text, so an entry for a withheld field is
     * the field's *contents*, quoted. The array itself is the caller's to see;
     * the entries are filtered rather than the key deleted.
     *
     * A declared `search` block cannot name a restricted field (boot refuses
     * it), so in practice this is the belt to that brace.
     */
    const matches = () => [
        { field: "name", snippet: "<b>Ada</b>" },
        { field: "salary", snippet: "<b>90000</b>" }
    ];

    it("loses the entries a caller cannot read, and keeps the rest", () => {
        const raw = { id: 1, name: "Ada", salary: 1, _matches: matches() };
        const served = withFieldViewer({ roles: ["staff"] }, () => stripUnreadable(raw, described(staff)));
        expect(served._matches).toEqual([{ field: "name", snippet: "<b>Ada</b>" }]);
    });

    it("is untouched for a caller who can read them all", () => {
        const raw = { id: 1, name: "Ada", salary: 1, _matches: matches() };
        const served = withFieldViewer({ roles: ["hr"] }, () => stripUnreadable(raw, described(staff)));
        expect(served._matches).toEqual(matches());
    });

    it("handles the bare-name shape too", () => {
        const raw = { id: 1, name: "Ada", salary: 1, _matches: ["name", "salary"] };
        const served = withFieldViewer({ roles: ["staff"] }, () => stripUnreadable(raw, described(staff)));
        expect(served._matches).toEqual(["name"]);
    });
});

describe("`_count`, the totals of counted relations", () => {
    /**
     * `include: { reviews: { limit, count: true } }` serves the total beside
     * the rows. A relation property the caller may not read is withheld whole,
     * and its total says as much about it as its rows: it goes with them.
     */
    const reviews: LegacyCollectionConfig = {
        name: "Reviews",
        slug: "reviews",
        properties: { id: { name: "Id", type: "number", isId: "increment" } }
    };
    const team: LegacyCollectionConfig = {
        name: "Teams",
        slug: "teams",
        properties: {
            id: { name: "Id", type: "number", isId: "increment" },
            members: { name: "Members", type: "relation", relation: { kind: "hasMany", target: () => staff, foreignKeyOnTarget: "team_id" } },
            reviews: {
                name: "Reviews", type: "relation", access: { read: ["hr"] },
                relation: { kind: "hasMany", target: () => reviews, foreignKeyOnTarget: "team_id" }
            }
        }
    };
    registry.registerMultiple([reviews, team]);

    it("loses the total of a relation the caller cannot read, and keeps the rest", () => {
        const raw = { id: 1, members: [], reviews: [], _count: { members: 12, reviews: 3 } };
        const served = withFieldViewer({ roles: ["staff"] }, () => stripUnreadable(raw, described(team)));
        expect(served).not.toHaveProperty("reviews");
        expect(served._count).toEqual({ members: 12 });
    });

    it("goes altogether when every counted relation is withheld", () => {
        const raw = { id: 1, reviews: [], _count: { reviews: 3 } };
        const served = withFieldViewer({ roles: ["staff"] }, () => stripUnreadable(raw, described(team)));
        expect(served).not.toHaveProperty("_count");
    });

    it("is untouched for a caller who can read them all", () => {
        const raw = { id: 1, members: [], reviews: [], _count: { members: 12, reviews: 3 } };
        const served = withFieldViewer({ roles: ["hr"] }, () => stripUnreadable(raw, described(team)));
        expect(served._count).toEqual({ members: 12, reviews: 3 });
    });
});

describe("the trusted server plane", () => {
    /**
     * No viewer means no request: an in-process `rebase.data` read, a migration,
     * the auth adapter reading a hash to verify it. `undefined` is not `[]`, and
     * the difference is what makes the flag enforceable — something has to be
     * able to read the column.
     */
    it("receives a role-restricted field", () => {
        expect(toRestRow(row(), registry.requireTable(staff.slug), registry).salary).toBe(90_000);
    });

    it("still does not receive an `excludeFromApi` one", () => {
        expect(toRestRow(row(), registry.requireTable(staff.slug), registry)).not.toHaveProperty("passwordHash");
    });
});

describe("the ambient viewer", () => {
    it("is restored after a nested scope, so a dataAsAdmin read cannot widen the caller's", () => {
        withFieldViewer({ roles: ["staff"] }, () => {
            withFieldViewer({ roles: ["admin"] }, () => {
                expect(currentFieldViewer()).toEqual({ roles: ["admin"] });
            });
            expect(currentFieldViewer()).toEqual({ roles: ["staff"] });
            expect(toRestRow(row(), registry.requireTable(staff.slug), registry)).not.toHaveProperty("salary");
        });
    });

    it("survives an await, which is what every read does", async () => {
        await withFieldViewer({ roles: ["staff"] }, async () => {
            await Promise.resolve();
            expect(toRestRow(row(), registry.requireTable(staff.slug), registry)).not.toHaveProperty("salary");
        });
    });
});

describe("a withheld to-one relation", () => {
    /**
     * The foreign key is the same fact as the relation it holds: `bandId: 7`
     * names the salary band exactly as `band: { id: 7 }` does. Withholding the
     * relation and serving the column beside it withheld nothing.
     */
    const bands: LegacyCollectionConfig = {
        name: "Bands",
        slug: "bands",
        properties: {
            id: { name: "Id", type: "number", isId: "increment" },
            label: { name: "Label", type: "string" }
        }
    };

    const people: LegacyCollectionConfig = {
        name: "People",
        slug: "people",
        properties: {
            id: { name: "Id", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            band: {
                name: "Salary band",
                type: "relation",
                access: { read: ["hr"] },
                relation: { kind: "belongsTo", target: () => bands, localKey: "band_id" }
            }
        }
    };

    const person = () => ({ id: 1, name: "Ann", bandId: 7 });
    registry.registerMultiple([bands, people]);

    it("takes its foreign key with it, under the wire name and the column name", () => {
        const rest = withFieldViewer({ roles: ["staff"] }, () => toRestRow(person(), registry.requireTable(people.slug), registry));
        expect(rest).toEqual({ id: 1, name: "Ann" });
        const raw = withFieldViewer({ roles: ["staff"] }, () => stripUnreadable({ id: 1, band_id: 7 }, described(people)));
        expect(raw).toEqual({ id: 1 });
    });

    it("keeps it for a caller who may read the relation", () => {
        const rest = withFieldViewer({ roles: ["hr"] }, () => toRestRow(person(), registry.requireTable(people.slug), registry));
        expect(rest.bandId).toBe(7);
    });
});

describe("a relation an include may load (`canReadRelation`)", () => {
    /**
     * The include loader asks this before it loads a relation, because the
     * REST rows are stripped before it runs: a withheld relation it loaded
     * anyway was written back onto the stripped row, `_count` beside it
     * (pinned end to end in `test/e2e/include-field-access-e2e.test.ts`).
     *
     * The rule is the relation's own (`rel.*(…, { access })`, `{ private:
     * true }`). The legacy model had three ways for a *property* to name the
     * relation it withheld; a table declares the rule on the relation.
     */
    const withheld = { ...manyToMany("labels", "tags", { table: "projects_tags", sourceKey: "project_id", targetKey: "tag_id" }), access: { read: ["hr"] } };
    const manager = { ...belongsTo("manager", "staff", "manager_id", "managerId"), access: { read: ["hr"] } };
    const sponsor = belongsTo("sponsor", "staff", "sponsor_id", "sponsorId");
    const hidden = { ...belongsTo("auditor", "staff", "auditor_id", "auditorId"), private: true as const };

    const readable = (relation: Parameters<typeof canReadRelation>[0], roles: string[]) =>
        withFieldViewer({ roles }, () => canReadRelation(relation));

    it.each([withheld, manager])("withholds '$name' from a caller without the role", (relation) => {
        expect(readable(relation, ["staff"])).toBe(false);
    });

    it.each([withheld, manager, sponsor])("serves '$name' to a caller holding it", (relation) => {
        expect(readable(relation, ["hr"])).toBe(true);
    });

    it("serves a relation with no rule", () => {
        expect(readable(sponsor, ["staff"])).toBe(true);
    });

    it("never serves a private relation, the admin included", () => {
        expect(readable(hidden, ["admin"])).toBe(false);
    });
});
