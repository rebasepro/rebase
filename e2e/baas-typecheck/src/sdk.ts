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
