/**
 * Render the per-page Open Graph images.
 *
 * Every route shared the same `teaser.png`, so a link to /pricing, /docs and
 * /rls-check all previewed identically — the one place a reader decides whether
 * to click, saying nothing about what they would be clicking.
 *
 * The card is a still of the page's own hero: the glow `HeroBackdrop.astro`
 * draws, seated where that route's hero opens, under the drafting grid and
 * rails, with the hero's mono eyebrow, Instrument Sans for the headline and
 * Inter for the rest — the same files `Layout.astro` ships — and the actual
 * logo. The template is `og/card.html`; the glow, the seat and the renderer are
 * `og/neat.mjs`, shared with the blog cards and the GitHub social preview.
 *
 * The images are **committed**, not built on demand: they change a few times a
 * year, `astro build` should not depend on a browser, and a preview that fails
 * to generate must not be able to fail a deploy. Re-run this by hand after
 * editing `CARDS` below:
 *
 *     node website/scripts/generate_og_images.mjs
 *
 * Playwright renders them because the alternative — hand-authoring SVG — puts
 * text layout in a file nobody can see the result of, and OG images are read at
 * 1200×630 in a preview card where a single wrapped line is the difference
 * between legible and not.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The same derivation the llms.txt generator and the count gate use. A number
// baked into a PNG is the hardest kind to notice going stale: this card kept
// the previous count for as long as nobody re-rendered it.
import { countPackageChecks } from "../../tooling/scripts/docs-verify/check-rls-check-count.mjs";
import { openCardRenderer } from "./og/neat.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, "..");
const OUT = path.join(SITE, "public", "img", "og");

const RLS_CHECK_COUNT = countPackageChecks(path.resolve(SITE, ".."));
if (!RLS_CHECK_COUNT) {
    throw new Error(
        "Could not read the rls-check CHECKS array — refusing to render a count into a card."
    );
}

/**
 * One card per route worth sharing.
 *
 * `eyebrow` is the section, `title` the thing itself, `sub` the one line that
 * makes it worth a click. Kept short deliberately: a preview card crops, and
 * every platform crops differently. The slug is the route (`home` is "/"):
 * Layout.astro picks `og/<route>.png`, and the glow is seated off the same
 * path the live hero is.
 */
const CARDS = [
    {
        slug: "home",
        eyebrow: "Open source · MIT",
        // The home page's own H1 (`hero.title.part1` / `part2`, one line each,
        // as the hero sets them). This card kept the retired headline for
        // eleven days after the hero changed, and had gone stale again by
        // 2026-11-10, so every shared link to the home page promised something
        // the page no longer said.
        title: "The Postgres you already have.\nNow it’s a backend and an admin panel.",
        sub: "REST, typed SDK, auth, realtime."
    },
    {
        slug: "docs",
        eyebrow: "Documentation",
        title: "Build on Rebase",
        sub: "Quickstart, collections, row-level security, deployment — in six languages."
    },
    {
        slug: "pricing",
        eyebrow: "Pricing",
        title: "Free and open source. Always.",
        sub: "MIT-licensed and self-hostable. Rebase Cloud runs it for you."
    },
    {
        slug: "rls-check",
        eyebrow: "Free tool",
        // Not the command as the title: `@rebasepro/rls-check` has no break
        // opportunity and wrapped mid-word at this size.
        title: "Find the tables anyone can read",
        // The command as the tool documents it: it reads `DATABASE_URL` from the
        // environment. Spelling `$DATABASE_URL` on a shared card teaches people
        // to put a connection string with a password into their shell history.
        sub: `npx @rebasepro/rls-check — ${RLS_CHECK_COUNT} checks, no signup.`
    },
    {
        slug: "backend",
        eyebrow: "Backend",
        title: "Postgres, with the boring parts done",
        sub: "Auth, storage, realtime, backups and a typed SDK generated from your schema."
    },
    {
        slug: "compare",
        eyebrow: "Compare",
        title: "Rebase vs the alternatives",
        sub: "Where it fits against Supabase, Firebase, Payload, Directus and Hasura."
    },
    {
        slug: "blog",
        eyebrow: "Blog",
        title: "Notes from building Rebase",
        sub: "What we shipped, what broke, and what it taught us."
    },
    {
        slug: "product",
        eyebrow: "Product",
        title: "One definition. Everything it produces.",
        sub: "REST, a typed SDK, realtime, auth, storage and an admin panel, from one TypeScript file."
    },
    {
        slug: "security",
        eyebrow: "Security",
        title: "Secured by the database. Not by middleware.",
        sub: "Access rules compile to Postgres row-level security. A table with no policy is refused."
    },
    {
        slug: "ai",
        eyebrow: "AI & agents",
        title: "A key permission is not a policy.",
        sub: "An MCP server with scoped keys, and row-level security underneath it."
    },
    {
        slug: "cms",
        eyebrow: "Rebase CMS",
        title: "The same definition, rendered for people.",
        sub: "Spreadsheet editing, media, relations and roles, generated from your collections."
    },
    {
        slug: "studio",
        eyebrow: "Rebase Studio",
        title: "Run your database from the same panel.",
        sub: "SQL editor, schema builder, RLS policies, branches and logs."
    },
    {
        slug: "ui",
        eyebrow: "Component library",
        title: "The components the panel is built from.",
        sub: "The React components behind the admin panel, yours to build with."
    },
    {
        slug: "developers",
        eyebrow: "Developers",
        title: "Schema as code. Everything else follows.",
        sub: "Scaffold, generate the typed SDK, extend in React, deploy."
    },
    {
        slug: "sdk",
        eyebrow: "Typed SDK",
        title: "One client. Typed from your schema.",
        sub: "Queries, auth, storage and realtime, checked at compile time."
    },
    {
        slug: "cli",
        eyebrow: "CLI",
        title: "One CLI for the whole lifecycle.",
        sub: "Scaffold, generate, migrate and deploy from one command line."
    },
    {
        slug: "europe",
        eyebrow: "Sovereignty",
        title: "Sovereignty is not a region setting.",
        sub: "Run it yourself and there is no second party. Or let a Spanish company run it."
    },
    {
        slug: "about",
        eyebrow: "About",
        title: "Authorization belongs in the database.",
        sub: "Why Rebase exists, and what is next on the roadmap."
    },
    {
        slug: "manifesto",
        eyebrow: "Manifesto",
        title: "Why we're building Rebase",
        sub: "Your schema stays yours, and the database enforces the rules."
    },
    {
        slug: "agencies",
        eyebrow: "For agencies",
        title: "The client keeps the database. You keep the code.",
        sub: "A backend and a back office on the client's own Postgres."
    },
    {
        slug: "startups",
        eyebrow: "For startups",
        title: "The backend first. The back office when you need it.",
        sub: "REST, a typed SDK and auth today; the admin panel when a human needs it."
    },
    {
        slug: "contact",
        eyebrow: "Contact",
        title: "Talk to the people building it.",
        sub: "Book a call, or find us on Discord and GitHub."
    },
    {
        slug: "kit-digital",
        eyebrow: "Kit Digital",
        title: "Kit Digital programme",
        sub: "Rebase is a registered digitalising agent in Spain."
    },
    {
        slug: "rebase-vs-supabase",
        eyebrow: "Compare",
        title: "Rebase vs Supabase",
        sub: "Both run on Postgres. Where the access rules live, and the local developer loop."
    },
    {
        slug: "rebase-vs-firebase",
        eyebrow: "Compare",
        title: "Rebase vs Firebase",
        sub: "Relational data you own, instead of documents in someone else's store."
    },
    {
        slug: "rebase-vs-appwrite",
        eyebrow: "Compare",
        title: "Rebase vs Appwrite",
        sub: "A Postgres you own, or a database behind the platform's API."
    },
    {
        slug: "rebase-vs-payload",
        eyebrow: "Compare",
        title: "Rebase vs Payload",
        sub: "A backend with an admin panel, or a headless CMS, both on Postgres."
    },
    {
        slug: "rebase-vs-directus",
        eyebrow: "Compare",
        title: "Rebase vs Directus",
        sub: "A schema written as code, or one the admin app owns."
    },
    {
        slug: "rebase-vs-strapi",
        eyebrow: "Compare",
        title: "Rebase vs Strapi",
        sub: "Your Postgres introspected, or a schema the CMS owns."
    },
    {
        slug: "rebase-vs-retool",
        eyebrow: "Compare",
        title: "Rebase vs Retool",
        sub: "An open-source admin panel generated from your schema, or screens drawn by hand."
    },
    {
        slug: "rebase-vs-hasura",
        eyebrow: "Compare",
        title: "Rebase vs Hasura",
        sub: "REST, a typed SDK and an admin panel, or a GraphQL API."
    },
    {
        slug: "rebase-vs-django",
        eyebrow: "Compare",
        title: "Rebase vs Django",
        sub: "A React admin panel over your Postgres, or the Django admin."
    }
];

/** The one-line command a card can carry under its subtitle, where the page has one. */
const COMMANDS = {
    home: "pnpm dlx @rebasepro/cli init",
};

await mkdir(OUT, { recursive: true });

// `--only <slug>` re-renders one card.
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt === -1 ? null : process.argv[onlyAt + 1];

const renderer = await openCardRenderer();
const failures = [];
let written = 0;
try {
    for (const card of CARDS) {
        if (only && card.slug !== only) continue;
        const route = card.slug === "home" ? "/" : `/${card.slug}`;
        const result = await renderer.render({ ...card, route, cmd: COMMANDS[card.slug] });
        if (!result.buffer) {
            failures.push(`${card.slug}: ${result.why}`);
            continue;
        }
        await writeFile(path.join(OUT, `${card.slug}.png`), result.buffer);
        written++;
        console.log(`✓ og/${card.slug}.png  (seated at ${route})`);
    }
} finally {
    await renderer.close();
}

if (failures.length) {
    console.error(`\n✗ ${failures.length} card(s) not written:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
}
console.log(`\n${written} image(s) in website/public/img/og/. Commit them.`);
