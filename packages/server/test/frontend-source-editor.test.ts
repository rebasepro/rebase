import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    FrontendSourceEditError,
    FrontendSourceEditor,
    parseFrontendSourceEdit,
    versionOf,
    type FrontendSourceOperation
} from "../src/schema-edit/frontend-source-editor";
import { createSchemaEditorRoutes } from "../src/api/schema-editor-routes";
import { TableSourceEditor } from "../src/api/table-source-editor";

/**
 * The frontend source editor over real `defineFirestoreCollection` files —
 * the hybrid example's own, and one written with everything an edit must
 * leave alone: comments, a custom field component, a function-valued option,
 * a cross-source reference, and a `customizeTable` with `referenceTo` beside it.
 */

const HYBRID_EVENTS = fs.readFileSync(path.join(__dirname, "../../../examples/hybrid/frontend/src/cms/events.ts"), "utf8");

const RICH = [
    "import React from \"react\";",
    "import { defineFirestoreCollection } from \"@rebasepro/firebase\";",
    "import { customizeTable } from \"@rebasepro/cms\";",
    "import { PriorityField } from \"../fields/PriorityField\";",
    "",
    "/** Support tickets, in Firestore. */",
    "export const tickets = defineFirestoreCollection({",
    "    slug: \"tickets\", // the URL",
    "    name: \"Tickets\",",
    "    dataSource: \"firestore\",",
    "    fields: {",
    "        // What the customer wrote.",
    "        title: { name: \"Title\", type: \"string\", required: true },",
    "        priority: {",
    "            name: \"Priority\",",
    "            type: \"number\",",
    "            admin: { Field: PriorityField, Preview: ({ value }) => <b>{String(value)}</b> }",
    "        },",
    "        /* Points at the Postgres customers table. */",
    "        customerId: { name: \"Customer\", type: \"reference\", target: \"customers\" },",
    "        notes: sharedNotesField",
    "    },",
    "    callbacks: {",
    "        beforeSave: ({ values }) => ({ ...values, touched: Date.now() })",
    "    },",
    "    subcollections: () => [ticketReplies]",
    "});",
    "",
    "export const ordersCms = customizeTable(\"orders\", {",
    "    fields: { sourceTicket: { referenceTo: \"tickets\" } }",
    "});",
    ""
].join("\n");

let dir: string;
let editor: FrontendSourceEditor;

const file = (name: string) => path.join(dir, "frontend", "src", "cms", name);
const read = (name: string) => fs.readFileSync(file(name), "utf8");

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-frontend-edit-"));
    fs.writeFileSync(path.join(dir, "rebase.json"), "{}\n");
    fs.mkdirSync(path.join(dir, "backend", "schema"), { recursive: true });
    fs.mkdirSync(path.join(dir, "frontend", "src", "cms"), { recursive: true });
    fs.writeFileSync(file("events.ts"), HYBRID_EVENTS);
    fs.writeFileSync(file("tickets.tsx"), RICH);
    editor = new FrontendSourceEditor(path.join(dir, "frontend", "src"), { root: dir });
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const events = { callee: "defineFirestoreCollection", key: "slug", value: "fs_events" };
const tickets = { callee: "defineFirestoreCollection", key: "slug", value: "tickets" };

/** The text with `from` replaced by `to`, once — the only change an edit may make. */
function replaced(text: string, from: string, to: string): string {
    expect(text.split(from).length).toBe(2);
    return text.replace(from, to);
}

describe("reading the calls", () => {
    it("finds each collection by slug, with its file, version and what is edited in code", () => {
        const calls = editor.describe("defineFirestoreCollection", "slug", [["fields"]]);
        expect(calls.map(call => [call.value, call.file])).toEqual([
            ["fs_events", "frontend/src/cms/events.ts"],
            ["tickets", "frontend/src/cms/tickets.tsx"]
        ]);
        const rich = calls[1];
        expect(rich.version).toBe(versionOf(RICH));
        expect(Object.keys(rich.members)).toEqual(["fields.notes"]);
        expect(rich.members["fields.notes"]).toMatch(/sharedNotesField/);
    });
});

describe("an edit is exactly the edit", () => {
    it("changes a field's label in the hybrid example and nothing else", async () => {
        await editor.apply({ target: events, operations: [{ op: "set", path: ["fields", "payload", "name"], value: "Body" }] });
        expect(read("events.ts")).toBe(replaced(HYBRID_EVENTS, "payload: { name: \"Payload\"", "payload: { name: \"Body\""));
    });

    it("adds a field at the end, in the file's own layout", async () => {
        await editor.apply({ target: events, operations: [{ op: "set", path: ["fields", "channel"], value: { name: "Channel", type: "string" } }] });
        expect(read("events.ts")).toBe(replaced(HYBRID_EVENTS,
            "receivedAt: { name: \"Received at\", type: \"date\", autoValue: \"on_create\" }\n",
            "receivedAt: { name: \"Received at\", type: \"date\", autoValue: \"on_create\" },\n        channel: { name: \"Channel\", type: \"string\" }\n"));
    });

    it("removes a field, its line and nothing else", async () => {
        await editor.apply({ target: events, operations: [{ op: "remove", path: ["fields", "payload"] }] });
        expect(read("events.ts")).toBe(replaced(HYBRID_EVENTS, "        payload: { name: \"Payload\", type: \"map\" },\n", ""));
    });

    it("sets validation on a field, creating the object on the way", async () => {
        await editor.apply({ target: events, operations: [{ op: "set", path: ["fields", "payload", "validation", "required"], value: true }] });
        expect(read("events.ts")).toBe(replaced(HYBRID_EVENTS,
            "payload: { name: \"Payload\", type: \"map\" }",
            "payload: { name: \"Payload\", type: \"map\", validation: { required: true } }"));
    });

    it("changes a type, renames and moves a field", async () => {
        await editor.apply({
            target: events,
            operations: [
                { op: "set", path: ["fields", "payload", "type"], value: "string" },
                { op: "rename", path: ["fields", "payload"], to: "body" },
                { op: "move", path: ["fields", "body"], before: "type" }
            ]
        });
        const text = read("events.ts");
        expect(text).toContain("    fields: {\n        body: { name: \"Payload\", type: \"string\" },\n        type: {\n");
        expect(text.replace("        body: { name: \"Payload\", type: \"string\" },\n", "")).toBe(
            replaced(HYBRID_EVENTS, "        payload: { name: \"Payload\", type: \"map\" },\n", ""));
    });

    it("removes `required` and the empty `validation` it leaves, when asked to prune", async () => {
        fs.writeFileSync(file("events.ts"), HYBRID_EVENTS.replace("required: true,", "validation: { required: true },"));
        await editor.apply({
            target: events,
            operations: [
                { op: "remove", path: ["fields", "type", "required"] },
                { op: "remove", path: ["fields", "type", "validation", "required"], prune: true }
            ]
        });
        expect(read("events.ts")).toBe(replaced(HYBRID_EVENTS, "            required: true,\n", ""));
    });

    it("leaves comments, JSX, functions, imports and the cross-source references byte for byte", async () => {
        await editor.apply({
            target: tickets,
            operations: [
                { op: "set", path: ["fields", "priority", "name"], value: "Urgency" },
                { op: "set", path: ["fields", "title", "validation"], value: { max: 120 } },
                { op: "set", path: ["name"], value: "Support tickets" }
            ]
        });
        const expected = replaced(replaced(replaced(RICH,
            "            name: \"Priority\",", "            name: \"Urgency\","),
            "title: { name: \"Title\", type: \"string\", required: true }", "title: { name: \"Title\", type: \"string\", required: true, validation: { max: 120 } }"),
            "    name: \"Tickets\",", "    name: \"Support tickets\",");
        expect(read("tickets.tsx")).toBe(expected);
        expect(read("tickets.tsx")).toContain("customerId: { name: \"Customer\", type: \"reference\", target: \"customers\" }");
        expect(read("tickets.tsx")).toContain("fields: { sourceTicket: { referenceTo: \"tickets\" } }");
    });
});

describe("what is edited in code is refused, never overwritten", () => {
    const refusedWith = async (operations: FrontendSourceOperation[], pattern: RegExp) => {
        await expect(editor.apply({ target: tickets, operations })).rejects.toThrow(pattern);
        expect(read("tickets.tsx")).toBe(RICH);
    };

    it("a field written as a variable", () => refusedWith([{ op: "set", path: ["fields", "notes", "name"], value: "Notes" }], /edited in code.*sharedNotesField/));
    it("a custom component", () => refusedWith([{ op: "set", path: ["fields", "priority", "admin", "Field"], value: "x" }], /edited in code.*PriorityField/));
    it("a function-valued option", () => refusedWith([{ op: "set", path: ["callbacks"], value: {} }], /edited in code/));
    it("the subcollections thunk", () => refusedWith([{ op: "remove", path: ["subcollections"] }], /edited in code/));
    it("the slug the call is found by", () => refusedWith([{ op: "set", path: ["slug"], value: "renamed" }], /change it in code/));
});

describe("what a request cannot smuggle into the source", () => {
    const hostile = [
        "\"); process.exit(1); (\"",
        "`${process.exit(1)}`",
        "${globalThis.pwned = 1}",
        "*/ process.exit(1); /*",
        "line one\nline two\r\n end",
        "</script><img src=x onerror=alert(1)>"
    ];

    it.each(hostile)("prints %j as an inert string literal that reads back as itself", async (value) => {
        const edit = await editor.preview({ target: events, operations: [{ op: "set", path: ["fields", "payload", "name"], value }] });
        const text = edit.files[0].contents;
        expect(text).toContain(`payload: { name: ${JSON.stringify(value)}`);
        expect(Reflect.get(globalThis, "pwned")).toBeUndefined();
    });

    it("quotes a hostile key, so it closes nothing", async () => {
        const key = "x: 1 }); process.exit(1); ({ y";
        const edit = await editor.preview({ target: events, operations: [{ op: "set", path: ["fields", key], value: { type: "string" } }] });
        expect(edit.files[0].contents).toContain(`${JSON.stringify(key)}: { type: "string" }`);
    });

    it("refuses a callee that is not an identifier, and values that are not JSON", () => {
        expect(() => parseFrontendSourceEdit({ target: { callee: "x(); y", key: "slug", value: "a" }, operations: [{ op: "remove", path: ["a"] }] }))
            .toThrow(/identifier/);
        expect(() => parseFrontendSourceEdit({ target: events, operations: [{ op: "set", path: ["a"], value: Number.NaN }] })).toThrow(/JSON/);
        expect(() => parseFrontendSourceEdit({ target: events, operations: [{ op: "eval", path: ["a"] }] })).toThrow(/one of set/);
    });
});

describe("stale files, failed checks", () => {
    it("refuses an edit made against a version the file no longer has", async () => {
        const version = versionOf(HYBRID_EVENTS);
        fs.writeFileSync(file("events.ts"), `// saved in the IDE\n${HYBRID_EVENTS}`);
        await expect(editor.apply({ target: events, version, operations: [{ op: "set", path: ["name"], value: "X" }] }))
            .rejects.toThrow(/changed since the edit was prepared/);
        expect(read("events.ts")).toBe(`// saved in the IDE\n${HYBRID_EVENTS}`);
    });

    it("refuses to write when the file changed between preview and write", async () => {
        const edit = await editor.preview({ target: events, operations: [{ op: "set", path: ["name"], value: "X" }] });
        fs.writeFileSync(file("events.ts"), `${HYBRID_EVENTS}// later\n`);
        await expect(editor.write(edit)).rejects.toThrow(/changed since the edit was prepared/);
        expect(read("events.ts")).toBe(`${HYBRID_EVENTS}// later\n`);
    });

    it("rolls the file back when the compile check fails", async () => {
        const checking = new FrontendSourceEditor(path.join(dir, "frontend", "src"), {
            root: dir,
            check: async files => {
                // The edit is on disk while the check runs.
                expect(fs.readFileSync(files[0].path, "utf8")).toContain("\"Renamed\"");
                return [{ table: "fs_events", message: "Type 'string' is not assignable to type 'never'." }];
            }
        });
        const error = await checking.apply({ target: events, operations: [{ op: "set", path: ["name"], value: "Renamed" }] }).catch(e => e);
        expect(error).toBeInstanceOf(FrontendSourceEditError);
        expect(error).toMatchObject({ code: "SCHEMA_EDIT_DOES_NOT_COMPILE" });
        expect(read("events.ts")).toBe(HYBRID_EVENTS);
    });

    it("refuses to splice into a file that would not parse", async () => {
        fs.writeFileSync(file("events.ts"), `${HYBRID_EVENTS}\nconst broken = {;\n`);
        await expect(editor.apply({ target: events, operations: [{ op: "set", path: ["name"], value: "X" }] })).rejects.toThrow(/would not parse/);
    });
});

describe("the routes", () => {
    it("are served under the schema editor at /frontend", async () => {
        const routes = createSchemaEditorRoutes(new TableSourceEditor(path.join(dir, "backend", "schema")));
        const listed = await routes.request("/frontend/calls?callee=defineFirestoreCollection&key=slug&list=fields");
        expect(listed.status).toBe(200);
        const body: unknown = await listed.json();
        expect(JSON.stringify(body)).toContain("frontend/src/cms/events.ts");

        const applied = await routes.request("/frontend/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: events, operations: [{ op: "set", path: ["fields", "payload", "name"], value: "Body" }] })
        });
        expect(applied.status).toBe(200);
        expect(read("events.ts")).toContain("payload: { name: \"Body\"");

        const refused = await routes.request("/frontend/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: tickets, operations: [{ op: "set", path: ["callbacks"], value: 1 }] })
        });
        expect(refused.status).toBe(400);
        expect(JSON.stringify(await refused.json())).toContain("SCHEMA_EDIT_REFUSED");
    });
});
