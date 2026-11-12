import { createTableClient, type TableClient } from "../../src/table";
import { fakeTransport } from "./fake-transport";

/**
 * A whole `TableClient` whose members are `members`.
 *
 * The rest are a real client's, over a transport that refuses every request,
 * so a member the fake does not serve fails loudly when something calls it —
 * as a missing member would have — and the fake is still the full type the
 * offline layer takes, not a few methods cast into it.
 */
export function fakeTableClient<M extends Record<string, unknown>>(
    members: Partial<TableClient<M>>,
    slug = "posts"
): TableClient<M> {
    const base = createTableClient<M>(fakeTransport(async (path) => {
        throw new Error(`the fake "${slug}" collection does not serve ${path}`);
    }), slug);
    return { ...base, ...members };
}
