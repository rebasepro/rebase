/**
 * Render the per-post social cards.
 *
 * Every post shared one static `og/blog.png` when shared, so seven posts
 * previewed as the same link.
 *
 * The card is a still of the post's own hero: the glow `HeroBackdrop.astro`
 * draws behind every drafted hero, seated off `/blog/<slug>` exactly as the
 * live page seats it, under the drafting grid and rails, with the post date as
 * the hero's mono eyebrow and the title in the display face. The template is
 * `og/card.html`; the glow, the seat and the renderer are `og/neat.mjs`, shared
 * with the route cards and the GitHub social preview.
 *
 *     node website/scripts/generate_blog_images.mjs            # only what is missing
 *     node website/scripts/generate_blog_images.mjs --force    # re-render everything
 *     node website/scripts/generate_blog_images.mjs --only <slug>
 *     node website/scripts/generate_blog_images.mjs --check   # CI: nothing missing
 *
 * One file per post: `img/blog/og/<slug>.png`, 1200×630.
 *
 * On the site itself the hero and the /blog cards mount `NeatBackground`
 * directly, so nothing there needs a picture. The social card is the one place
 * that cannot: a crawler runs no WebGL and reads no HTML, so that half has to
 * be pixels.
 *
 * They are **committed**, following `generate_og_images.mjs`: `astro build`
 * must not depend on a browser, and a card that fails to render must not be
 * able to fail a deploy. The images are a pure function of the slug and the
 * title, so re-running rewrites the same bytes.
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openCardRenderer } from "./og/neat.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, "..");

const POSTS = path.join(SITE, "src", "content", "blog");
const OUT_OG = path.join(SITE, "public", "img", "blog", "og");

/** `---` frontmatter, enough of it to read a title and a date. */
function frontmatter(source) {
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
    if (!block) return null;
    const out = {};
    for (const line of block[1].split("\n")) {
        const m = /^([A-Za-z_][\w]*):\s*(.*)$/.exec(line);
        if (!m) continue;
        out[m[1]] = m[2].trim().replace(/^["'](.*)["']$/s, "$1");
    }
    return out;
}

const args = process.argv.slice(2);
const force = args.includes("--force");
// Guarded, because `indexOf` returns -1 when the flag is absent and `args[0]`
// is then whatever else was passed: a bare `--force` set `only` to "--force"
// and filtered every post out. The empty-run check below is what caught it.
const onlyAt = args.indexOf("--only");
const only = onlyAt === -1 ? null : args[onlyAt + 1];

const files = (await readdir(POSTS)).filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));
const posts = [];
for (const file of files) {
    const slug = file.replace(/\.mdx?$/, "");
    if (only && slug !== only) continue;
    const data = frontmatter(await readFile(path.join(POSTS, file), "utf8"));
    if (!data?.title) {
        console.warn(`! ${file}: no title in frontmatter, skipped`);
        continue;
    }
    // A parked post gets no artwork: it has no URL to share and may never.
    if (data.draft === "true") continue;
    posts.push({ slug, title: data.title, pubDate: data.pubDate });
}
posts.sort((a, b) => a.slug.localeCompare(b.slug));

if (!posts.length) {
    console.error("No posts found — refusing to report success over an empty run.");
    process.exit(1);
}

/**
 * `--check`: every publishable post has both files, and nothing else.
 *
 * Needs no browser and no build, so it can run in any pipeline. Without it the
 * failure mode is silent and remote: a post is written, merged, published on
 * its `pubDate` by a scheduled build nobody is watching, and the hero and the
 * social card are both 404s — visible to every reader and to nobody on the
 * team, because the page itself renders fine.
 */
if (args.includes("--check")) {
    const missing = [];
    for (const post of posts) {
        const file = path.join(OUT_OG, `${post.slug}.png`);
        if (!existsSync(file)) missing.push(path.relative(SITE, file));
    }
    if (missing.length) {
        console.error(`✗ ${missing.length} blog image(s) missing:`);
        for (const m of missing) console.error(`  ${m}`);
        console.error("\nRun: node website/scripts/generate_blog_images.mjs");
        process.exit(1);
    }
    console.log(`✓ All ${posts.length} post(s) have artwork and a social card.`);
    process.exit(0);
}

await mkdir(OUT_OG, { recursive: true });

let written = 0;
let skipped = 0;
const failures = [];

const renderer = await openCardRenderer();
try {
    for (const post of posts) {
        const ogFile = path.join(OUT_OG, `${post.slug}.png`);
        if (!force && existsSync(ogFile)) {
            skipped++;
            continue;
        }

        const eyebrow = post.pubDate
            ? new Date(post.pubDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
            : "Blog";

        const result = await renderer.render({ route: `/blog/${post.slug}`, eyebrow, title: post.title });
        if (!result.buffer) {
            failures.push(`${post.slug}: ${result.why}`);
            continue;
        }
        await writeFile(ogFile, result.buffer);
        written++;
        console.log(`✓ ${post.slug}`);
    }
} finally {
    await renderer.close();
}

if (failures.length) {
    console.error(`\n✗ ${failures.length} render(s) failed:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
}

console.log(
    `\n${written} image(s) written, ${skipped} post(s) already had a card.` +
    `\nIn website/public/img/blog/og/. Commit them.`
);
