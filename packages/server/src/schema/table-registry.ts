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
 * Empty for a backend that introspects the database: nothing was declared, so
 * there is nothing compiled to describe.
 *
 * @group Schema
 */
export class TableRegistry {
    private readonly bySlug = new Map<string, TableDescriptor>();

    /** Replace the registry's contents with these descriptors, in this order. */
    replaceAll(descriptors: readonly TableDescriptor[]): void {
        this.bySlug.clear();
        for (const descriptor of descriptors) this.bySlug.set(descriptor.slug, descriptor);
    }

    /** Every descriptor, in the order they were compiled. */
    list(): readonly TableDescriptor[] {
        return [...this.bySlug.values()];
    }

    /** The descriptor of the table served at `/api/data/<slug>`, if there is one. */
    get(slug: string): TableDescriptor | undefined {
        return this.bySlug.get(slug);
    }
}
