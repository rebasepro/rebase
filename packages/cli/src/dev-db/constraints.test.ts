/**
 * The extension bundle list is only as good as the module paths in it.
 *
 * PGlite resolves extensions from bundles handed to its constructor, so a name
 * that is on the list but cannot be imported fails at migration time with
 * `extension "…" is not available` — which reads like a broken database rather
 * than a missing import. The list used to be names alone, with the module path
 * derived as `@electric-sql/pglite/contrib/<name>`; pgvector does not live
 * there, so it could not be on the list at all and `rebase dev` could not host
 * a `{ type: "vector" }` property.
 *
 * These import the real packages rather than mocking them. A mock would agree
 * with whatever the list says, which is the one thing worth checking.
 */
import { describe, expect, it } from "vitest";

import { PGLITE_EXTENSIONS } from "./constraints";

describe("PGLITE_EXTENSIONS", () => {
    it("covers every extension the schema generator emits a CREATE EXTENSION for", () => {
        // `searchExtensionStatements` emits pg_trgm and unaccent;
        // `vectorExtensionStatement` emits vector. A managed dev database that
        // is missing one cannot run the project's own migrations.
        expect(PGLITE_EXTENSIONS.map(e => e.name).sort()).toEqual(["pg_trgm", "unaccent", "vector"]);
    });

    it.each(PGLITE_EXTENSIONS.map(e => [e.name, e] as const))(
        "resolves a real bundle for %s",
        async (_name, extension) => {
            const module = (await import(/* @vite-ignore */ extension.module)) as Record<string, unknown>;
            expect(module[extension.export]).toBeDefined();
        }
    );

    it("names the bundle's own export, which is not always the extension name", () => {
        // pgvector's package exports `vector`, and the extension is `vector`;
        // they agree today. The field exists because the module path already
        // diverged once, and a second derivation is a second thing to be wrong.
        for (const extension of PGLITE_EXTENSIONS) {
            expect(extension.export).toBeTruthy();
            expect(extension.module).toBeTruthy();
        }
    });
});
