import { getTableExcludes, ExcludeIntrospectionError } from "../src/cli-helpers";

// The exclude list is the ONLY thing shielding non-collection (user/system)
// tables from `db push`'s auto-approved declarative apply. If introspection
// fails we must abort — never fall back to a partial list that lets Atlas
// drop every unmanaged table.
describe("getTableExcludes fail-closed behaviour", () => {
    const includes = ["public.users", "public.posts"];
    const getIncludes = async () => includes;

    it("throws ExcludeIntrospectionError when introspection fails", async () => {
        const queryExistingTables = async () => {
            throw new Error("connection terminated unexpectedly");
        };

        await expect(
            getTableExcludes("postgres://x/db", "/collections", { getIncludes, queryExistingTables })
        ).rejects.toBeInstanceOf(ExcludeIntrospectionError);
    });

    it("surfaces the underlying cause on the error", async () => {
        const cause = new Error("ECONNREFUSED 127.0.0.1:5432");
        const queryExistingTables = async () => {
            throw cause;
        };

        await expect(
            getTableExcludes("postgres://x/db", "/collections", { getIncludes, queryExistingTables })
        ).rejects.toMatchObject({ cause, message: expect.stringContaining("ECONNREFUSED") });
    });

    it("excludes unmapped tables but keeps managed ones out of the list", async () => {
        const queryExistingTables = async () => [
            "public.users", // managed → NOT excluded
            "public.posts", // managed → NOT excluded
            "public.legacy_orders", // unmapped → excluded
            "public.stripe_webhooks" // unmapped → excluded
        ];

        const excludes = await getTableExcludes("postgres://x/db", "/collections", {
            getIncludes,
            queryExistingTables
        });

        // Always-present system excludes (framework-owned schemas).
        expect(excludes).toContain("atlas_schema_revisions.*");
        expect(excludes).toContain("auth.*");
        expect(excludes).toContain("rebase");
        expect(excludes).toContain("rebase.*");
        // Unmapped tables are protected.
        expect(excludes).toContain("public.legacy_orders");
        expect(excludes).toContain("public.stripe_webhooks");
        // Managed tables must NOT be excluded (they are what push manages).
        expect(excludes).not.toContain("public.users");
        expect(excludes).not.toContain("public.posts");
    });

    it("does not throw when introspection returns an empty database", async () => {
        const excludes = await getTableExcludes("postgres://x/db", "/collections", {
            getIncludes,
            queryExistingTables: async () => []
        });
        expect(excludes).toEqual(["atlas_schema_revisions.*", "auth", "auth.*", "rebase", "rebase.*"]);
    });
});
