/**
 * SDK usage from a BaaS project — isomorphic client, no UI packages.
 */
import { createRebaseClient } from "@rebasepro/client";

import type { Post } from "./collection";

const rebase = createRebaseClient({ baseUrl: "https://api.example.com" });

export async function readAndWrite(): Promise<void> {
    const posts = rebase.data.collection<Post>("posts");

    // `where` takes [op, value] tuples — a bare string is passed straight
    // through to PostgREST and silently builds a malformed query.
    const published = await posts.find({
        where: { status: ["==", "published"], views: [">=", 100] },
        orderBy: ["published_at", "desc"],
        limit: 20
    });

    for (const post of published.data) {
        // Rows are flat — `post.title`, never `post.values.title`.
        console.log(post.title, post.views);
    }

    await posts.create({ title: "Hello", status: "draft" });

    // The fluent builder hangs directly off the collection client.
    const drafts = await posts.where("status", "==", "draft").limit(5).find();
    console.log(drafts.data.length);

    await rebase.auth.signOut();
}

/**
 * Query parameters are checked against the row type.
 *
 * `FindParams` used to be non-generic, so `where` and `orderBy` were keyed by
 * plain `string`: a column that did not exist compiled fine and failed as a 400
 * from the API at runtime — or, worse, silently matched nothing. The parameter
 * now carries the row type, and the assertions below are the `@ts-expect-error`
 * comments: this file failing to compile means the check came back off.
 *
 * The chain that has to stay intact is `createRebaseClient<DB>` ->
 * `SDKCollectionClient<M>` -> `FindParams<M>` -> `FilterValues<FieldPath<M>>`.
 * A non-generic alias anywhere along it flattens `M` to its default and every
 * assertion here goes quiet — which is exactly how the alias in
 * `client/src/transport.ts` hid this for as long as it did.
 */
export async function queryParamsAreChecked(): Promise<void> {
    const posts = rebase.data.collection<Post>("posts");

    // Legitimate: real columns only.
    // (The dotted-path arm — `"profile.city"` into a `map` column — is asserted in
    // packages/admin-types/test/admin_collection.test.ts, which has a map property
    // to point at. Its root must exist too, which is the point of the check.)
    await posts.find({
        where: { status: ["==", "published"], views: [">=", 10] },
        orderBy: ["published_at", "desc"]
    });

    await posts.find({
        // @ts-expect-error — "titel" is not a column of Post
        where: { titel: ["==", "x"] }
    });

    await posts.find({
        // @ts-expect-error — "publish_at" is not a column of Post
        orderBy: ["publish_at", "desc"]
    });
}
