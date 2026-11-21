import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

import { isSchemaDefinitionError } from "@rebasepro/common";
import { loadBackendSchema } from "../src/schema/load-schema";
import { resolveDeclaredTables } from "../src/schema/declared-tables";

/**
 * `defineRpc` declarations ride in `backend/schema` beside the tables: the
 * index exports them, every door that loads the schema sees the same ones, and
 * one defined elsewhere without being exported is refused like a table.
 */

let root: string;
let dir: string;

const write = (file: string, source: string): void => {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
};

const posts = `
import { defineTable, col } from "@rebasepro/types";
export const posts = defineTable("posts", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },
    rls: "admin-only"
});
`;

const rpc = `
import { defineRpc, json } from "@rebasepro/types";
export const getPublicProposal = defineRpc("get_public_proposal", { access: "public", args: { token: json.string().required() } });
export const myTrips = defineRpc("my_trips", { access: "authenticated" });
`;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-rpc-schema-"));
    dir = path.join(root, "backend", "schema");
    fs.mkdirSync(dir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("RPC declarations in backend/schema", () => {
    it("loads the RPCs the index exports, once each, beside the tables", async () => {
        write("posts.ts", posts);
        write("rpc.ts", rpc);
        write("index.ts", `
export { posts } from "./posts";
export * from "./rpc";
export { myTrips as alsoMyTrips } from "./rpc";
`);
        const loaded = await loadBackendSchema(dir);
        expect(loaded.defs.map(def => def.name)).toEqual(["posts"]);
        expect(loaded.rpc?.map(def => def.name).sort()).toEqual(["get_public_proposal", "my_trips"]);

        const declared = await resolveDeclaredTables({ schemaDir: dir });
        expect(declared.rpc?.map(def => def.name).sort()).toEqual(["get_public_proposal", "my_trips"]);
    });

    it("has no rpc when the index exports none", async () => {
        write("posts.ts", posts);
        write("index.ts", `export { posts } from "./posts";`);
        expect((await loadBackendSchema(dir)).rpc).toBeUndefined();
    });

    it("refuses an RPC defined in the schema directory that the index does not export", async () => {
        write("posts.ts", posts);
        write("rpc.ts", rpc);
        write("index.ts", `
export { posts } from "./posts";
export { myTrips } from "./rpc";
`);
        const error = await loadBackendSchema(dir).then(() => undefined, (e: unknown) => e);
        if (!isSchemaDefinitionError(error)) throw new Error(`expected a SchemaDefinitionError, got ${String(error)}`);
        expect(error.problems).toEqual([expect.objectContaining({
            table: "rpc get_public_proposal",
            message: expect.stringContaining("is an RPC defined in rpc.ts (export `getPublicProposal`)")
        })]);
    });

    it("refuses two RPCs under one name", async () => {
        write("posts.ts", posts);
        write("index.ts", `
import { defineRpc } from "@rebasepro/types";
export { posts } from "./posts";
export const a = defineRpc("same_name", { access: "public" });
export const b = defineRpc("same_name", { access: "authenticated" });
`);
        const error = await loadBackendSchema(dir).then(() => undefined, (e: unknown) => e);
        if (!isSchemaDefinitionError(error)) throw new Error(`expected a SchemaDefinitionError, got ${String(error)}`);
        expect(error.message).toContain("rpc same_name: is declared more than once");
    });
});
