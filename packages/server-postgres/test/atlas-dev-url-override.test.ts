/**
 * `REBASE_ATLAS_DEV_URL`: the empty database Atlas plans against, named
 * rather than derived.
 *
 * The derived `<db>_dev_diff` is made with CREATE DATABASE beside the real
 * one. PGlite — the managed development database — serves exactly one
 * database, so that CREATE is a no-op there and Atlas compared the project
 * against itself. The CLI now starts a second, throwaway PGlite and names it
 * here; anyone else can name their own empty database the same way.
 */
import { atlasDevDatabaseUrl, ATLAS_DEV_URL_ENV } from "../src/cli-helpers";

describe("atlasDevDatabaseUrl", () => {
    const url = "postgresql://app:secret@localhost:5432/shop";

    it("derives <db>_dev_diff, made by the CLI, when nothing names one", () => {
        expect(atlasDevDatabaseUrl(url, {})).toEqual({
            url: "postgresql://app:secret@localhost:5432/shop_dev_diff",
            named: false
        });
    });

    it("uses the database REBASE_ATLAS_DEV_URL names, which the CLI must not create or drop", () => {
        const dev = "postgresql://postgres@127.0.0.1:61234/postgres?sslmode=disable";
        expect(ATLAS_DEV_URL_ENV).toBe("REBASE_ATLAS_DEV_URL");
        expect(atlasDevDatabaseUrl(url, { REBASE_ATLAS_DEV_URL: dev })).toEqual({ url: dev, named: true });
    });

    it("ignores an empty value", () => {
        expect(atlasDevDatabaseUrl(url, { REBASE_ATLAS_DEV_URL: "  " }).named).toBe(false);
    });

    it("refuses to plan against the database it is changing", () => {
        expect(() => atlasDevDatabaseUrl(url, { REBASE_ATLAS_DEV_URL: url })).toThrow(/same database/);
    });
});
