import type { TableDescriptor } from "@rebasepro/types";

/**
 * The compiled descriptors of the tables one backend serves, by slug.
 *
 * Beside the collection registry, not instead of it: the request-time code —
 * REST, OpenAPI, realtime, MCP, the drivers — still reads the collections the
 * definitions were lowered into, while everything built on the table model
 * (`GET /api/schema/tables`, the schema version, hooks' `table` argument)
 * reads these. Both are filled from the same compile at boot, so they cannot
 * disagree about which tables exist.
 *
 * For a backend that introspects the database, the descriptors of the tables
 * introspection found (those that could be described; see
 * `describeIntrospectedTables`).
 *
 * It may change after boot: every {@link replaceAll} bumps {@link revision},
 * and what is derived from it — the schema version, the bodies
 * `GET /api/schema/tables` and `/api/meta/contract` serve — is cached per
 * revision, so it is recomputed rather than served stale.
 *
 * @group Schema
 */
export class TableRegistry {
    private readonly bySlug = new Map<string, TableDescriptor>();
    private changes = 0;

    /** Replace the registry's contents with these descriptors, in this order. */
    replaceAll(descriptors: readonly TableDescriptor[]): void {
        this.bySlug.clear();
        for (const descriptor of descriptors) this.bySlug.set(descriptor.slug, descriptor);
        this.changes++;
    }

    /** Every descriptor, in the order they were compiled. */
    list(): readonly TableDescriptor[] {
        return [...this.bySlug.values()];
    }

    /** The descriptor of the table served at `/api/data/<slug>`, if there is one. */
    get(slug: string): TableDescriptor | undefined {
        return this.bySlug.get(slug);
    }

    /**
     * How many times the contents were replaced. A cache of anything derived
     * from the registry is valid for exactly one revision.
     */
    get revision(): number {
        return this.changes;
    }
}
