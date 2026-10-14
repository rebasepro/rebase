/**
 * The same collections give a backend the same rules, whichever way they reach it.
 *
 * The scaffold's `config/collections/index.ts` declares `defaultSecurityRules`
 * — every signed-in user reads, only admins write — for the collections that
 * declare none. The directory loader applied them; nothing else did. So a
 * backend built from the array the same file exports,
 * `createRebaseBackend({ collections, provision: true })` as custom-server.md
 * has it, saw `posts`, `authors` and `tags` with no rules, provisioned them
 * locked, and dropped their twelve generated policies from the database —
 * for every server sharing it, `rebase dev` included — with nothing but
 * "Applied 12 RLS policy statement(s)" in the log.
 *
 * The array now carries the defaults on the collection objects themselves,
 * exactly as the loader leaves them.
 */
import { afterAll, afterEach, describe, expect, it } from "@jest/globals";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver, SecurityRule } from "@rebasepro/types";
import { createRebaseBackend, loadCollectionsFromDirectory, type RebaseBackend } from "../src/index";
import { _resetRebaseMock } from "../src/singleton";

const templateRoot = path.resolve(__dirname, "../../cli/templates/template/config/collections");

/**
 * A fresh copy of the scaffold's collections directory.
 *
 * The directory loader applies the defaults to the very objects the collection
 * files export, so a module the loader has already been over would report the
 * loader's work rather than the index's. Each path under test gets its own
 * copy, and so its own module instances.
 */
const copies: string[] = [];
function freshTemplate(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "rebase-template-collections-"));
    for (const file of readdirSync(templateRoot).filter(f => f.endsWith(".ts"))) {
        cpSync(path.join(templateRoot, file), path.join(dir, file));
    }
    copies.push(dir);
    return dir;
}
afterAll(() => {
    while (copies.length) rmSync(copies.pop()!, { recursive: true, force: true });
});

/** Each collection's rules, by slug, as plain data. */
const rulesBySlug = (collections: readonly CollectionConfig[]): Record<string, unknown> =>
    Object.fromEntries(collections.map(c => [c.slug, JSON.parse(JSON.stringify((c as { securityRules?: SecurityRule[] }).securityRules ?? null))]));

interface IndexModule {
    collections: CollectionConfig[];
    defaultSecurityRules: SecurityRule[];
}

const importIndex = async (dir: string) => await import(path.join(dir, "index.ts")) as IndexModule;

describe("the scaffold's collections array", () => {
    it("carries defaultSecurityRules on every collection that declares no rules of its own", async () => {
        const index = await importIndex(freshTemplate());
        const fromIndex = rulesBySlug(index.collections);
        const defaults = JSON.parse(JSON.stringify(index.defaultSecurityRules));
        expect(defaults.length).toBeGreaterThan(0);
        expect(fromIndex.posts).toEqual(defaults);
        expect(fromIndex.authors).toEqual(defaults);
        expect(fromIndex.tags).toEqual(defaults);
        // Its own rules, untouched.
        expect(fromIndex.users).not.toEqual(defaults);
    });

    it("gives every collection the rules the directory loader gives it", async () => {
        const fromIndex = rulesBySlug((await importIndex(freshTemplate())).collections);
        const fromDirectory = rulesBySlug(await loadCollectionsFromDirectory(freshTemplate()));
        expect(fromIndex).toEqual(fromDirectory);
    });
});

// ── Through a backend ────────────────────────────────────────────────────

function driver(): DataDriver {
    const scoped = () => ({
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        countCollection: async () => 0
    });
    return { ...scoped(), withAuth: async () => scoped() as unknown as DataDriver } as unknown as DataDriver;
}

/** A bootstrapper that records the rules of the collections it is asked to provision policies for. */
function recordingBootstrapper(provisioned: CollectionConfig[][]): BackendBootstrapper {
    return {
        type: "postgres",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver: driver(), collections: undefined, internals: {}, realtimeProvider: {} } as unknown as InitializedDriver;
        },
        async ensureCollectionSchema() {
            return { applied: 0 };
        },
        async ensureCollectionPolicies(collections: unknown[]) {
            provisioned.push(collections as CollectionConfig[]);
            return { applied: 0 };
        }
    } as unknown as BackendBootstrapper;
}

const built: RebaseBackend[] = [];
afterEach(async () => {
    while (built.length) await built.pop()!.shutdown(0);
    _resetRebaseMock();
});

async function provisionedRules(source: { collections: CollectionConfig[] } | { collectionsDir: string }): Promise<Record<string, unknown>> {
    const provisioned: CollectionConfig[][] = [];
    const backend = await createRebaseBackend({
        ...source,
        bootstrappers: [recordingBootstrapper(provisioned)],
        cronPersistence: false,
        provision: true
    } as never);
    built.push(backend);
    expect(provisioned).toHaveLength(1);
    return rulesBySlug(provisioned[0]);
}

describe("a backend provisioning the scaffold's collections", () => {
    it("provisions the same rules from the exported array as from the directory", async () => {
        const index = await importIndex(freshTemplate());
        const fromArray = await provisionedRules({ collections: index.collections });
        const fromDirectory = await provisionedRules({ collectionsDir: freshTemplate() });
        expect(fromArray).toEqual(fromDirectory);
        expect(fromArray.posts).toEqual(JSON.parse(JSON.stringify(index.defaultSecurityRules)));
    });
});
