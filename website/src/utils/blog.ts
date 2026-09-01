import { getCollection, type CollectionEntry } from "astro:content";

/**
 * The blog posts this build is allowed to publish, newest first.
 *
 * A post whose `pubDate` is in the future is a scheduled post: it is neither
 * listed on /blog nor built as a page, so its URL 404s until a build runs on or
 * after its date. That is the scheduling mechanism.
 *
 * `draft: true` is the different thing next to it: parked, not scheduled. It
 * never publishes on its own, whatever the date says. A post parked with a
 * far-future `pubDate` instead would publish itself the moment that date
 * arrived, which is the surprise this separation exists to prevent.
 *
 * Two consequences worth stating, because both have bitten static sites before:
 *
 *  - This is evaluated at BUILD time, not at request time. A scheduled post does
 *    not appear on its own; something has to rebuild and redeploy the site after
 *    the date passes. `.github/workflows/publish-website.yml` is what does that.
 *  - The filter has to run in `getStaticPaths` too, not only on the index. A
 *    post that is merely unlinked is still served at its URL, which is a
 *    published post nobody can find rather than an unpublished one.
 *
 * Set `SHOW_SCHEDULED_POSTS=1` to preview scheduled posts locally. It is
 * deliberately an env var and not a config default: a default that shows them
 * would make the production build the exception.
 */
export async function publishedPosts(
	now: Date = new Date(),
): Promise<CollectionEntry<"blog">[]> {
	const showScheduled = process.env.SHOW_SCHEDULED_POSTS === "1";
	return (await getCollection("blog"))
		.filter((post) => !post.data.draft)
		.filter((post) => showScheduled || post.data.pubDate.valueOf() <= now.valueOf())
		.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}
