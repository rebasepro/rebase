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
import { CollectionConfig } from "@rebasepro/types";
import { toFlatRow, toRestRow, stripUnreadable } from "../src/services/row-pipeline";
import { withFieldViewer, currentFieldViewer } from "../src/services/field-viewer";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const staff = {
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
} as unknown as CollectionConfig;

const posts = {
    name: "Posts",
    slug: "posts",
    properties: {
        id: { name: "Id", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        author: { name: "Author", type: "relation", relationName: "author" }
    },
    relations: [
        { kind: "belongsTo", relationName: "author", target: () => staff, localKey: "author_id" }
    ]
} as unknown as CollectionConfig;

function makeRegistry(): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    registry.registerCollection?.(staff);
    registry.registerCollection?.(posts);
    return registry;
}

const registry = makeRegistry();
const row = () => ({ id: 1, name: "Ada", salary: 90_000, rating: 5, passwordHash: "salt:hash" });

describe("the REST row", () => {
    it("withholds a field the caller's roles cannot read", () => {
        const served = withFieldViewer({ roles: ["staff"] }, () => toRestRow(row(), staff, registry));
        expect(served.name).toBe("Ada");
        expect(served).not.toHaveProperty("salary");
    });

    it("serves it to a caller holding the role", () => {
        const served = withFieldViewer({ roles: ["hr"] }, () => toRestRow(row(), staff, registry));
        expect(served.salary).toBe(90_000);
    });

    it("serves it to `admin`, who satisfies any non-empty list", () => {
        const served = withFieldViewer({ roles: ["admin"] }, () => toRestRow(row(), staff, registry));
        expect(served.salary).toBe(90_000);
    });

    it("deletes the key rather than nulling it", () => {
        // A withheld value that arrives as `null` is indistinguishable from a
        // stored `null` — which turns a permission boundary into a question a
        // client answers by counting nulls, and makes an echoing update
        // overwrite the real value.
        const served = withFieldViewer({ roles: ["anon"] }, () => toRestRow(row(), staff, registry));
        expect("salary" in served).toBe(false);
    });

    it("keeps a field whose rule is only about writing", () => {
        const served = withFieldViewer({ roles: ["anon"] }, () => toRestRow(row(), staff, registry));
        expect(served.rating).toBe(5);
    });

    it("still withholds an `excludeFromApi` column from everybody", () => {
        for (const roles of [["hr"], ["admin"], ["anon"]]) {
            const served = withFieldViewer({ roles }, () => toRestRow(row(), staff, registry));
            expect(served).not.toHaveProperty("passwordHash");
        }
    });
});

describe("the admin row", () => {
    it("applies the same rule as REST", () => {
        const served = withFieldViewer({ roles: ["staff"] }, () => toFlatRow(row(), staff, registry));
        expect(served).not.toHaveProperty("salary");
        expect(served.name).toBe("Ada");
    });
});

describe("a relation target", () => {
    const post = () => ({ id: 7, title: "Hello", author: row() });

    it("is stripped when inlined into the parent (REST)", () => {
        const served = withFieldViewer({ roles: ["staff"] }, () => toRestRow(post(), posts, registry));
        const author = served.author as Record<string, unknown>;
        expect(author.name).toBe("Ada");
        expect(author).not.toHaveProperty("salary");
    });

    type Ref = { data?: { values?: Record<string, unknown> } };

    it("is stripped inside the ref the admin and every realtime frame carry", () => {
        const served = withFieldViewer({ roles: ["staff"] }, () => toFlatRow(post(), posts, registry));
        const ref = served.author as Ref;
        expect(ref.data?.values?.name).toBe("Ada");
        expect(ref.data?.values).not.toHaveProperty("salary");
        expect(ref.data?.values).not.toHaveProperty("passwordHash");
        expect(ref.data?.values).not.toHaveProperty("password_hash");
    });

    it("carries the field for a caller who may read it, in both renderings", () => {
        const inlined = withFieldViewer({ roles: ["hr"] }, () => toRestRow(post(), posts, registry));
        expect((inlined.author as Record<string, unknown>).salary).toBe(90_000);
        const ref = withFieldViewer({ roles: ["hr"] }, () => toFlatRow(post(), posts, registry));
        expect((ref.author as Ref).data?.values?.salary).toBe(90_000);
    });
});

describe("the column-name spelling", () => {
    it("is deleted as well as the property key", () => {
        const raw = { id: 1, password_hash: "salt:hash", name: "Ada" };
        const served = withFieldViewer({ roles: ["admin"] }, () => stripUnreadable(raw, staff));
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
        const served = withFieldViewer({ roles: ["staff"] }, () => stripUnreadable(raw, staff));
        expect(served._matches).toEqual([{ field: "name", snippet: "<b>Ada</b>" }]);
    });

    it("is untouched for a caller who can read them all", () => {
        const raw = { id: 1, name: "Ada", salary: 1, _matches: matches() };
        const served = withFieldViewer({ roles: ["hr"] }, () => stripUnreadable(raw, staff));
        expect(served._matches).toEqual(matches());
    });

    it("handles the bare-name shape too", () => {
        const raw = { id: 1, name: "Ada", salary: 1, _matches: ["name", "salary"] };
        const served = withFieldViewer({ roles: ["staff"] }, () => stripUnreadable(raw, staff));
        expect(served._matches).toEqual(["name"]);
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
        expect(toRestRow(row(), staff, registry).salary).toBe(90_000);
    });

    it("still does not receive an `excludeFromApi` one", () => {
        expect(toRestRow(row(), staff, registry)).not.toHaveProperty("passwordHash");
    });
});

describe("the ambient viewer", () => {
    it("is restored after a nested scope, so a dataAsAdmin read cannot widen the caller's", () => {
        withFieldViewer({ roles: ["staff"] }, () => {
            withFieldViewer({ roles: ["admin"] }, () => {
                expect(currentFieldViewer()).toEqual({ roles: ["admin"] });
            });
            expect(currentFieldViewer()).toEqual({ roles: ["staff"] });
            expect(toRestRow(row(), staff, registry)).not.toHaveProperty("salary");
        });
    });

    it("survives an await, which is what every read does", async () => {
        await withFieldViewer({ roles: ["staff"] }, async () => {
            await Promise.resolve();
            expect(toRestRow(row(), staff, registry)).not.toHaveProperty("salary");
        });
    });
});
