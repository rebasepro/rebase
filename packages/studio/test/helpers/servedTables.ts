import type { AnyTableDef, AnyViewDef, TableDescriptor } from "@rebasepro/types";
import { compileTables, lowerTables } from "@rebasepro/common";
// The server's own serializer: what `GET /api/schema/tables` answers is
// exactly this, so the Studio is tested against the wire rather than a
// hand-written imitation of it.
import { compileServedPolicies, schemaViewFor, serializeTables, type SchemaCaller } from "../../../server/src/api/schema-tables";

/** An administrator, a `schema:read` holder: served compiled policies and raw SQL. */
export const ADMIN: SchemaCaller = { kind: "person", roles: ["admin"], scopes: ["schema:read"] };

/** A signed-in person without `schema:read`: raw SQL redacted, no policies. */
export const EDITOR: SchemaCaller = { kind: "person", roles: ["editor"], scopes: ["data:read"] };

/**
 * The tables a backend declaring `defs` serves `caller` — compiled with
 * `compileTables`, their policies compiled by the server, redacted for the
 * caller by the server's serializer.
 */
export function servedTables(defs: readonly (AnyTableDef | AnyViewDef)[], caller: SchemaCaller = ADMIN): TableDescriptor[] {
    const descriptors = compileTables(defs);
    const bySlug = new Map(descriptors.map(descriptor => [descriptor.slug, descriptor]));
    const collections = lowerTables(defs, { describe: slug => bySlug.get(slug) });
    const policies = compileServedPolicies(collections, new Set(descriptors.map(descriptor => descriptor.slug)));
    const view = schemaViewFor(caller);
    if ("refused" in view) throw new Error(view.message);
    return serializeTables(descriptors, view, policies);
}
