/**
 * The same tables give a backend the same rules, whichever way they reach it.
 *
 * `backend/schema/index.ts` may export `defaultRls` — the rules every
 * `rls: "inherit"` table takes. Under the collection model the directory
 * loader applied the directory's defaults and nothing else did, so a backend
 * built from the exported array (`createRebaseBackend({ collections })`) saw
 * those collections with no rules, provisioned them locked, and dropped their
 * generated policies from the database for every server sharing it.
 *
 * Now the compiler resolves `"inherit"`, for every door: a backend given the
 * definitions and `defaultRls` as values provisions exactly what one pointed
 * at the directory provisions — and a table that inherits without a
 * `defaultRls` refuses the boot instead of being locked in silence.
 */
import { afterAll, afterEach, describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";
import { createRebaseBackend, loadBackendSchema, type RebaseBackend } from "../src/index";
import { _resetRebaseMock } from "../src/singleton";
import { inertRealtimeProvider } from "./helpers/server-a-g3-realtime";

const DEFAULT_RLS = [
    { operation: "select", access: "authenticated" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
];

const roots: string[] = [];
afterAll(() => {
    while (roots.length) rmSync(roots.pop() ?? "", { recursive: true, force: true });
});

/** A fresh `backend/schema`: two inheriting tables, one with its own rules. */
function schemaDir(): string {
    const root = mkdtempSync(path.join(tmpdir(), "rebase-default-rls-"));
    roots.push(root);
    const dir = path.join(root, "backend", "schema");
    mkdirSync(dir, { recursive: true });
    const table = (name: string, rls: string) => `
import { defineTable, col } from "@rebasepro/types";
export const ${name} = defineTable("${name}", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },
    rls: ${rls}
});
`;
    writeFileSync(path.join(dir, "authors.ts"), table("authors", `"inherit"`));
    writeFileSync(path.join(dir, "tags.ts"), table("tags", `"inherit"`));
    writeFileSync(path.join(dir, "posts.ts"), table("posts", `[{ operation: "select", access: "public", condition: { title: "x" } }]`));
    writeFileSync(path.join(dir, "index.ts"), `
export { authors } from "./authors";
export { tags } from "./tags";
export { posts } from "./posts";
export const defaultRls = ${JSON.stringify(DEFAULT_RLS)};
`);
    return dir;
}

/** Each collection's rules, by slug, as plain data. */
const rulesBySlug = (collections: readonly CollectionConfig[]): Record<string, unknown> =>
    Object.fromEntries(collections.map(c => [c.slug, JSON.parse(JSON.stringify("securityRules" in c ? c.securityRules ?? null : null))]));

/** A driver with no rows, whose RLS scoping hands back another like it. */
interface EmptyDriver extends DataDriver {
    countCollection: () => Promise<number>;
}

function driver(): EmptyDriver & { withAuth: () => Promise<EmptyDriver> } {
    const scoped = (): EmptyDriver => ({
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        checkUniqueField: async () => true,
        countCollection: async () => 0
    });
    return { ...scoped(), withAuth: async () => scoped() };
}

/** A bootstrapper that records the rules of the collections it is asked to provision policies for. */
function recordingBootstrapper(provisioned: CollectionConfig[][]): BackendBootstrapper {
    return {
        type: "postgres",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver: driver(), collections: undefined, internals: {}, realtimeProvider: inertRealtimeProvider() };
        },
        async ensureCollectionSchema() {
            return { applied: 0 };
        },
        async ensureCollectionPolicies(collections: CollectionConfig[]) {
            provisioned.push(collections);
            return { applied: 0 };
        }
    };
}

const built: RebaseBackend[] = [];
afterEach(async () => {
    while (built.length) await built.pop()?.shutdown(0);
    _resetRebaseMock();
});

async function provisionedRules(source: Partial<Parameters<typeof createRebaseBackend>[0]>): Promise<Record<string, unknown>> {
    const provisioned: CollectionConfig[][] = [];
    const backend = await createRebaseBackend({
        ...source,
        bootstrappers: [recordingBootstrapper(provisioned)],
        cronPersistence: false,
        provision: true
    });
    built.push(backend);
    expect(provisioned).toHaveLength(1);
    return rulesBySlug(provisioned[0]);
}

describe("a backend provisioning tables that inherit defaultRls", () => {
    it("provisions the same rules from the definitions as values as from the directory", async () => {
        const dir = schemaDir();
        const loaded = await loadBackendSchema(dir);
        const fromValues = await provisionedRules({ tables: loaded.defs, defaultRls: loaded.defaultRls });
        const fromDirectory = await provisionedRules({ schemaDir: dir });

        expect(fromValues).toEqual(fromDirectory);
        expect(fromValues.authors).toEqual(DEFAULT_RLS);
        expect(fromValues.tags).toEqual(DEFAULT_RLS);
        // Its own rules, untouched.
        expect(fromValues.posts).not.toEqual(DEFAULT_RLS);
    });

    it("refuses the boot when the tables inherit and no defaultRls is given", async () => {
        const loaded = await loadBackendSchema(schemaDir());

        await expect(provisionedRules({ tables: loaded.defs })).rejects.toThrow(/defaultRls/);
    });
});
