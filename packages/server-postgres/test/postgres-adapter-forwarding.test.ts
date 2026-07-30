import { createPostgresAdapter } from "../src/PostgresAdapter";
import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";

/**
 * `createPostgresAdapter` must surface the boot-time schema/RLS provisioning the
 * bootstrapper implements. The adapter wraps the bootstrapper and re-declares
 * the methods it exposes; when it omitted `ensureCollectionSchema` /
 * `ensureCollectionPolicies`, the runtime booted a managed tenant with no tables
 * (500 on every data route) or no policies (401 on every read). The bootstrapper
 * has always implemented both — this pins that the adapter does not drop them.
 */
describe("createPostgresAdapter forwards the schema-provisioning methods", () => {
    // No connection is made at construction — the methods are only invoked at
    // boot — so a placeholder config is enough to assert the surface.
    const config = { connection: {}, connectionString: "postgres://localhost/x" } as never;

    it("exposes ensureCollectionSchema when the bootstrapper does", () => {
        expect(typeof createPostgresBootstrapper(config).ensureCollectionSchema).toBe("function");
        expect(typeof createPostgresAdapter(config).ensureCollectionSchema).toBe("function");
    });

    it("exposes ensureCollectionPolicies when the bootstrapper does", () => {
        expect(typeof createPostgresBootstrapper(config).ensureCollectionPolicies).toBe("function");
        expect(typeof createPostgresAdapter(config).ensureCollectionPolicies).toBe("function");
    });
});
