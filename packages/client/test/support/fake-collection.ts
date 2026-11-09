import { createCollectionClient, type CollectionClient } from "../../src/collection";
import { fakeTransport } from "./fake-transport";

/**
 * A whole `CollectionClient` whose members are `members`.
 *
 * The rest are a real client's, over a transport that refuses every request,
 * so a member the fake does not serve fails loudly when something calls it —
 * as a missing member would have — and the fake is still the full type the
 * offline layer takes, not a few methods cast into it.
 */
export function fakeCollectionClient<M extends Record<string, unknown>>(
    members: Partial<CollectionClient<M>>,
    slug = "posts"
): CollectionClient<M> {
    const base = createCollectionClient<M>(fakeTransport(async (path) => {
        throw new Error(`the fake "${slug}" collection does not serve ${path}`);
    }), slug);
    return { ...base, ...members };
}
