import type { StudioSchemaEditing } from "@rebasepro/app";

import { saveSecurityRulesToCodebase } from "./saveSecurityRules";

/**
 * Where a collection's security rules go when the RLS editor saves them.
 *
 * There are two doors onto one file. The collection editor's save is planned,
 * shown as SQL, confirmed, and applied to the database. The RLS editor's save
 * POSTed the rules to `/schema-editor/collection/save` and stopped there: the
 * source changed, nothing said what the change implied, and the database was
 * left to a later `db push`. A policy declared and not enforced is the worst
 * outcome this editor can produce, and it was the default one.
 *
 * So a mapped-table write goes through the admin's plan/apply flow when there
 * is one. Studio cannot call `useLiveSchemaEditing` — `@rebasepro/cms` is a
 * *peer* of `@rebasepro/studio`, which has to run without it — so it arrives
 * over the Studio bridge as {@link StudioSchemaEditing}, and `available` is
 * false in the hosted console, where there is no source to edit and the direct
 * write is the only thing there is.
 *
 * A separate module from the component for the same reason `saveSecurityRules`
 * is: the decision can be asserted without a database and a rendered editor.
 */
export async function saveRules(
    schemaEditing: StudioSchemaEditing,
    transport: { apiBase: string; getAuthToken?: () => Promise<string | null | undefined> },
    collectionId: string,
    securityRules: unknown[]
): Promise<void> {
    if (schemaEditing.available) {
        await schemaEditing.updateCollection(collectionId, { securityRules });
        return;
    }
    await saveSecurityRulesToCodebase({
        apiBase: transport.apiBase,
        collectionId,
        securityRules,
        getAuthToken: transport.getAuthToken
    });
}

/**
 * Was this rejection the person closing the plan dialog?
 *
 * Closing it is an answer, not a failure, and a caller that treats every
 * rejection as an error reports someone's own choice back to them in red — as
 * the collection editor once did, with "Error persisting collection: The schema
 * change was not applied."
 *
 * Matched by name rather than `instanceof`: `SchemaChangeCancelled` is declared
 * in `@rebasepro/cms`, which this package cannot import, and two copies of a
 * class in one bundle make `instanceof` silently false anyway.
 */
export function isCancellation(err: unknown): boolean {
    return err instanceof Error && err.name === "SchemaChangeCancelled";
}
