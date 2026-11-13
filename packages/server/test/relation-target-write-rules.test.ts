import { describe, expect, it } from "@jest/globals";
import { col, defineTable, rel, type TableDescriptor } from "@rebasepro/types";
import { compileSchemaDefs } from "../src/schema/load-schema";
import { assertColumnWriteRules, assertKnownWriteFields, assertWriteRequestValid } from "../src/api/rest/write-validation";

/**
 * A `hasMany` / `hasOne` write from the parent is a write of the child's
 * foreign key, held to that column's rules (SEC-FIX-2 F-4).
 *
 * `PATCH /threads/1 { replies: [1, 2] }` moved reply 2 into thread 1 although
 * `replies.threadId` is `.readOnly()` — `PATCH /replies/2 { threadId: 1 }` is
 * refused — because the write check judged only the parent's relation key.
 * The same holds for a role-restricted key (`access.write`), a private one, and
 * the `hasOne` mirror. The check is the one REST (`assertKnownWriteFields`),
 * the socket's SAVE and MCP (`assertWriteRequestValid`) run.
 */

const readOnlyKeyThreads = defineTable("threads", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    relations: { replies: rel.hasMany(() => replies, { foreignKey: "threadId" }) },
    rls: [{ operation: "all", access: "authenticated" }]
});
const replies = defineTable("replies", {
    columns: { id: col.serial().primaryKey(), body: col.text(), threadId: col.integer().readOnly() },
    rls: [{ operation: "all", access: "authenticated" }]
});

const boards = defineTable("boards", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    relations: {
        cards: rel.hasMany(() => cards, { foreignKey: "boardId" }),
        cover: rel.hasOne(() => covers, { foreignKey: "boardId" }),
        notes: rel.hasMany(() => notes, { foreignKey: "boardId" }),
        tags: rel.manyToMany(() => tags)
    },
    rls: [{ operation: "all", access: "authenticated" }]
});
const cards = defineTable("cards", {
    columns: { id: col.serial().primaryKey(), title: col.text(), boardId: col.integer().access({ write: ["moderator"] }) },
    rls: [{ operation: "all", access: "authenticated" }]
});
const covers = defineTable("covers", {
    columns: { id: col.serial().primaryKey(), url: col.text(), boardId: col.integer().access({ write: ["moderator"] }) },
    rls: [{ operation: "all", access: "authenticated" }]
});
const notes = defineTable("notes", {
    columns: { id: col.serial().primaryKey(), text: col.text(), boardId: col.integer() },
    rls: [{ operation: "all", access: "authenticated" }]
});
const tags = defineTable("tags", {
    columns: { id: col.serial().primaryKey(), label: col.text() },
    rls: [{ operation: "all", access: "authenticated" }]
});

// SEC-FIX-3: the spellings of one column — its key, the link bound to it, a
// to-one `via` that sets it on the target, a `_pivot` field — and the rules.
const people = defineTable("people", {
    columns: { id: col.text().primaryKey(), name: col.text() },
    rls: [{ operation: "all", access: "authenticated" }]
});
const docs = defineTable("docs", {
    columns: {
        id: col.serial().primaryKey(),
        title: col.text(),
        createdBy: col.text().onCreateUser(),
        reviewerId: col.text().readOnly(),
        approverId: col.text().access({ write: ["admin"] }),
        informantId: col.text().private()
    },
    relations: {
        creator: rel.belongsTo(() => people, { localKey: "created_by" }),
        reviewer: rel.belongsTo(() => people, { localKey: "reviewer_id" }),
        approver: rel.belongsTo(() => people, { localKey: "approver_id" }),
        informant: rel.belongsTo(() => people, { localKey: "informant_id" })
    },
    rls: [{ operation: "all", access: "authenticated" }]
});
const badges = defineTable("badges", {
    columns: { id: col.serial().primaryKey(), label: col.text(), ownerId: col.integer().readOnly() },
    rls: [{ operation: "all", access: "authenticated" }]
});
const owners = defineTable("owners", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    relations: {
        badge: rel.via(() => badges, { steps: [{ table: "badges", on: { from: "id", to: "owner_id" } }], cardinality: "one" })
    },
    rls: [{ operation: "all", access: "authenticated" }]
});
const labels = defineTable("labels", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    rls: [{ operation: "all", access: "authenticated" }]
});
const loose = defineTable("loose", {
    columns: { id: col.serial().primaryKey(), name: col.text(), sealed: col.text().readOnly() },
    relations: {
        labels: rel.manyToMany(() => labels, {
            pivot: { grade: col.text().access({ write: ["admin"] }), locked: col.text().readOnly() }
        })
    },
    strictWrites: false,
    rls: [{ operation: "all", access: "authenticated" }]
});

const DESCRIPTORS = compileSchemaDefs([readOnlyKeyThreads, replies, boards, cards, covers, notes, tags, people, docs, badges, owners, labels, loose]).descriptors;
const tableOf = (slug: string): TableDescriptor => {
    const table = DESCRIPTORS.find(candidate => candidate.slug === slug);
    if (!table) throw new Error(slug);
    return table;
};
const relatedTables = (slug: string) => DESCRIPTORS.find(table => table.slug === slug);
const editor = { roles: ["editor"] };
const moderator = { roles: ["moderator"] };

function refusal(write: () => void): { code?: string; message: string } | undefined {
    try {
        write();
        return undefined;
    } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
        return { code, message: error instanceof Error ? error.message : String(error) };
    }
}

describe("a hasMany / hasOne write is held to the child's foreign-key rules", () => {
    it("refuses moving rows whose key is `.readOnly()` — as the same write on the child is refused", () => {
        const direct = refusal(() => assertKnownWriteFields({ threadId: 1 }, tableOf("replies"), { viewer: editor, relatedTables }));
        const fromParent = refusal(() => assertKnownWriteFields({ replies: [1, 2] }, tableOf("threads"), { viewer: editor, relatedTables }));
        expect(direct?.code).toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(fromParent?.code).toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(fromParent?.message).toContain("Writing 'replies' on 'threads' sets 'threadId' on the rows of 'replies'");
        // Unlinking every reply clears the same key.
        expect(refusal(() => assertKnownWriteFields({ replies: [] }, tableOf("threads"), { viewer: editor, relatedTables }))?.code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
    });

    it("refuses a role-restricted key to a caller without the role, and admits one with it — hasMany and hasOne", () => {
        for (const body of [{ cards: [1] }, { cover: 1 }]) {
            expect(refusal(() => assertKnownWriteFields(body, tableOf("boards"), { viewer: editor, relatedTables }))?.code)
                .toBe("FIELD_NOT_WRITABLE");
            expect(refusal(() => assertKnownWriteFields(body, tableOf("boards"), { viewer: moderator, relatedTables }))).toBeUndefined();
        }
    });

    it("runs on the socket's and MCP's check too", () => {
        expect(refusal(() => assertWriteRequestValid({ cards: [1] }, tableOf("boards"), { status: "existing", viewer: editor, relatedTables }))?.code)
            .toBe("FIELD_NOT_WRITABLE");
    });

    it("leaves an open key, a many-to-many and the parent's own columns alone", () => {
        expect(refusal(() => assertKnownWriteFields({ notes: [1, 2], tags: [1], name: "x" }, tableOf("boards"), { viewer: editor, relatedTables })))
            .toBeUndefined();
    });

    it("fails closed when the target's rules cannot be read", () => {
        const answer = refusal(() => assertKnownWriteFields({ notes: [1] }, tableOf("boards"), { viewer: editor }));
        expect(answer?.code).toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(answer?.message).toContain("whose rules this write cannot read");
    });
});

/**
 * One rule: a restriction on a column is a restriction on every spelling that
 * writes it (SEC-FIX-3). Each cell answers exactly as the column's own name
 * does — the same code, or the same acceptance.
 */
describe("every spelling of a column is held to the column's write rules", () => {
    const docsT = () => tableOf("docs");
    const check = (body: Record<string, unknown>, viewer = editor) =>
        refusal(() => assertKnownWriteFields(body, docsT(), { viewer, relatedTables }))?.code;

    it.each([
        ["reviewerId", "reviewer", "VALIDATION_EXCLUDED_FIELDS"],
        ["informantId", "informant", "VALIDATION_EXCLUDED_FIELDS"],
        ["approverId", "approver", "FIELD_NOT_WRITABLE"]
    ])("a link written by name answers as its key column %s does (D-1)", (column, link, code) => {
        expect(check({ [column]: "v" })).toBe(code);
        expect(check({ [link]: "v" })).toBe(code);
    });

    it("admits a link whose key column admits the caller", () => {
        expect(check({ approver: "v" }, { roles: ["admin"] })).toBeUndefined();
        expect(check({ approverId: "v" }, { roles: ["admin"] })).toBeUndefined();
    });

    it("leaves a stamped key to the driver, by either spelling (it drops both on an update)", () => {
        expect(check({ createdBy: "v" })).toBeUndefined();
        expect(check({ creator: "v" })).toBeUndefined();
    });

    it("runs on the socket's, MCP's and the in-process SDK's check too", () => {
        expect(refusal(() => assertWriteRequestValid({ reviewer: "v" }, docsT(), { status: "existing", viewer: editor, relatedTables }))?.code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(refusal(() => assertColumnWriteRules({ approver: "v" }, docsT(), { viewer: editor, relatedTables }))?.code)
            .toBe("FIELD_NOT_WRITABLE");
    });

    it("refuses a to-one `via` that moves target rows whose key is `.readOnly()`, as the direct write is (D-3)", () => {
        expect(refusal(() => assertKnownWriteFields({ ownerId: 1 }, tableOf("badges"), { viewer: editor, relatedTables }))?.code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
        const viaWrite = refusal(() => assertKnownWriteFields({ badge: 3 }, tableOf("owners"), { viewer: editor, relatedTables }));
        expect(viaWrite?.code).toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(viaWrite?.message).toContain("Writing 'badge' on 'owners' sets 'ownerId' on the rows of 'badges'");
        expect(refusal(() => assertKnownWriteFields({ badge: null }, tableOf("owners"), { viewer: editor, relatedTables }))?.code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
        // Fails closed without the target's rules.
        expect(refusal(() => assertKnownWriteFields({ badge: 3 }, tableOf("owners"), { viewer: editor }))?.code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
    });

    it("judges `_pivot` fields under `strictWrites: false` exactly as under the default (D-4)", () => {
        const looseT = tableOf("loose");
        const pivot = (fields: Record<string, unknown>) => ({ labels: [{ id: 1, _pivot: fields }] });
        expect(refusal(() => assertKnownWriteFields(pivot({ grade: "A+" }), looseT, { viewer: editor, relatedTables }))?.code)
            .toBe("FIELD_NOT_WRITABLE");
        expect(refusal(() => assertKnownWriteFields(pivot({ locked: "no" }), looseT, { viewer: editor, relatedTables }))?.code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(refusal(() => assertKnownWriteFields(pivot({ grade: "A+" }), looseT, { viewer: { roles: ["admin"] }, relatedTables })))
            .toBeUndefined();
    });

    it("`strictWrites: false` decides only an unknown key: a closed column stays closed, an undeclared key passes to the driver", () => {
        const looseT = tableOf("loose");
        expect(refusal(() => assertKnownWriteFields({ sealed: "x" }, looseT, { viewer: editor, relatedTables }))?.code)
            .toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(refusal(() => assertKnownWriteFields({ undeclared: "x" }, looseT, { viewer: editor, relatedTables }))).toBeUndefined();
    });
});
