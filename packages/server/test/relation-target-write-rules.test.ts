import { describe, expect, it } from "@jest/globals";
import { col, defineTable, rel, type TableDescriptor } from "@rebasepro/types";
import { compileSchemaDefs } from "../src/schema/load-schema";
import { assertKnownWriteFields, assertWriteRequestValid } from "../src/api/rest/write-validation";

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

const DESCRIPTORS = compileSchemaDefs([readOnlyKeyThreads, replies, boards, cards, covers, notes, tags]).descriptors;
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
