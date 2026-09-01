/**
 * "Alternatives to X" pages.
 *
 * ── Why this format, and why now ─────────────────────────────────────────────
 * A `rebase-vs-supabase` page only works on somebody who already knows our
 * name. Nobody does yet — that is the actual problem — and the query with the
 * volume behind it is "supabase alternatives", typed by a person who has never
 * heard of us and is about to be handed a list by a search engine or an
 * assistant. A head-to-head page cannot appear in that list. A page that *is*
 * the list can.
 *
 * ── The thing that makes it worth reading ────────────────────────────────────
 * The genre is almost entirely worthless: ten entries, the publisher at number
 * one, every rival described in a sentence that damns it. Anyone can tell, and
 * so can a model — which is why so few of those pages get quoted and why the
 * ones that do are the ones that actually help you choose.
 *
 * So three rules here, and they are load-bearing rather than decorative:
 *
 *  1. **Order by reason, not by rank.** Each page opens with the real reasons
 *     people leave the incumbent, and each reason names the tool that best
 *     answers it. Rebase is named where it is genuinely the answer and absent
 *     where it is not. On the Firebase page the first reason — "we need SQL" —
 *     does not point at us.
 *  2. **Every entry gets its best case, including the incumbent.** The
 *     description says what a tool is good at and who should pick it. A page
 *     that only lists weaknesses tells the reader nothing they can act on.
 *  3. **Say who wrote it.** There is a disclosure line on every page. Not for
 *     virtue — for credibility, which is the only currency this format has.
 *
 * No prices. Competitor pricing changes quarterly and a stale number is a lie
 * with a date on it; the pricing *model* (per seat, per project, open source)
 * is stable and is what actually decides anything.
 */

import type { Faq } from "./comparison-faqs";

export interface Alternative {
    name: string;
    /** The tool's own site. Outbound links are the price of being believed. */
    href: string;
    /** One line. The reader is scanning for this and nothing else. */
    bestFor: string;
    description: string;
    /** Short label: "Open source", "Source-available", "Proprietary". */
    licence: string;
    /** Short label: "Self-host", "Hosted", "Both". */
    hosting: string;
    /** Set on our own entry so the page can mark it honestly. */
    isUs?: boolean;
    /** Internal link to the head-to-head, when one exists. */
    compare?: string;
}

export interface Reason {
    /** The reason someone is on this page, in their words. */
    reason: string;
    /** The tool that best answers it — sometimes us, often not. */
    answer: string;
    why: string;
}

export interface AlternativesPage {
    slug: string;
    name: string;
    /** `<title>`. Written as the query, because that is what it has to match. */
    title: string;
    description: string;
    /** What the incumbent is, said fairly. Nobody trusts a page that opens with an attack. */
    what: string;
    reasons: Reason[];
    alternatives: Alternative[];
    faqs: Faq[];
}

/* ── Entries reused across pages, so their descriptions cannot drift ───────── */

const REBASE = (bestFor: string): Alternative => ({
    name: "Rebase",
    href: "https://rebase.pro",
    bestFor,
    description:
        "A Postgres backend — REST API, typed SDK, auth, realtime, storage, functions, cron — plus an admin panel "
        + "generated from the same TypeScript collection definitions. Row-level security is written in code and "
        + "compiled to real Postgres policies, so authorization is enforced by the database rather than by the "
        + "layer in front of it. Connects to a Postgres database that already exists.",
    licence: "Open source",
    hosting: "Both",
    isUs: true
});

const SUPABASE: Alternative = {
    name: "Supabase",
    href: "https://supabase.com",
    bestFor: "The largest ecosystem, and getting started fastest",
    description:
        "Postgres with auth, storage, realtime and edge functions, and by a distance the most documented product "
        + "in this category. The dashboard is a table editor rather than an admin panel, and RLS is written as SQL "
        + "in that dashboard, which is the two things people most often go looking to replace.",
    licence: "Open source",
    hosting: "Both",
    compare: "/rebase-vs-supabase"
};

const POCKETBASE: Alternative = {
    name: "PocketBase",
    href: "https://pocketbase.io",
    bestFor: "One binary, one file, no infrastructure",
    description:
        "A single Go executable with an embedded SQLite database, auth, file storage, realtime and an admin UI. "
        + "Genuinely delightful for a small app or a prototype. The constraint is the same as the appeal: SQLite "
        + "and one process, so horizontal scale and Postgres-specific features are not on the table.",
    licence: "Open source",
    hosting: "Self-host"
};

const APPWRITE: Alternative = {
    name: "Appwrite",
    href: "https://appwrite.io",
    bestFor: "A Firebase-shaped API you can self-host",
    description:
        "A batteries-included backend with auth, databases, storage, functions and messaging, and client SDKs for "
        + "most platforms. Closer to Firebase's shape than to a SQL backend — the database is document-oriented, "
        + "which is the right call if that is what you wanted and the wrong one if you came for joins.",
    licence: "Open source",
    hosting: "Both"
};

const DIRECTUS: Alternative = {
    name: "Directus",
    href: "https://directus.io",
    bestFor: "A mature editorial interface over an existing database",
    description:
        "Wraps a SQL database in a REST and GraphQL API and a well-built admin app, and it will work with a schema "
        + "you already have. Permissions are enforced in the Directus layer rather than in the database, and the "
        + "app owns a set of its own tables.",
    // Left MIT for the BSL in 2023, and moved again with v12 to the Monospace
    // Sustainable Core License: source-available, free under a revenue and
    // headcount threshold, GPL-3.0 four years after each release. Verified
    // against directus/directus, 2026-09-02.
    licence: "Source-available (MSCL)",
    hosting: "Both",
    compare: "/rebase-vs-directus"
};

const HASURA: Alternative = {
    name: "Hasura",
    href: "https://hasura.io",
    bestFor: "GraphQL, especially federated across several sources",
    description:
        "Generates a GraphQL API over Postgres and other sources with a permission system defined in metadata. "
        + "The strongest option here if GraphQL is a product decision rather than a preference. It gives you an API "
        + "and a console, not a back office for non-developers.",
    // graphql-engine is Apache-2.0. Verified 2026-09-02. Hasura's newer DDN
    // product is a separate offering under separate terms; this row is the engine.
    licence: "Open source (Apache-2.0)",
    hosting: "Both",
    compare: "/rebase-vs-hasura"
};

const NOCODB: Alternative = {
    name: "NocoDB",
    href: "https://nocodb.com",
    bestFor: "A spreadsheet view over a database, for non-technical users",
    description:
        "Turns a SQL database into an Airtable-like grid, with views, forms and automations. Excellent when the "
        + "requirement is genuinely 'let the ops team edit rows'. Less suited to being the backend of an "
        + "application, which is a different job.",
    licence: "Open source",
    hosting: "Both"
};

const BUDIBASE: Alternative = {
    name: "Budibase",
    href: "https://budibase.com",
    bestFor: "Self-hosted internal tools, built by dragging",
    description:
        "A low-code builder for internal apps over a database or an API, self-hostable and open source. The nearest "
        + "open equivalent to Retool's model — you draw screens, and they stay drawn, which is fine until a schema "
        + "change means visiting all of them.",
    licence: "Open source",
    hosting: "Both"
};

const APPSMITH: Alternative = {
    name: "Appsmith",
    href: "https://appsmith.com",
    bestFor: "Internal tools with a lot of custom JavaScript",
    description:
        "A drag-and-drop internal-tool builder with a wide set of data connectors and JavaScript everywhere. "
        + "Self-hostable. Same trade as every canvas builder: fast to a first screen, linear cost per screen after "
        + "that.",
    licence: "Open source",
    hosting: "Both"
};

const RETOOL: Alternative = {
    name: "Retool",
    href: "https://retool.com",
    bestFor: "Joining many data sources quickly",
    description:
        "The most complete integration catalogue in this category — databases, Stripe, Salesforce, S3, arbitrary "
        + "REST — and a very fast path to an internal screen across several of them. Priced per user, which is what "
        + "makes an internal tool expensive precisely as it succeeds.",
    licence: "Proprietary",
    hosting: "Both",
    compare: "/rebase-vs-retool"
};

const STRAPI: Alternative = {
    name: "Strapi",
    href: "https://strapi.io",
    bestFor: "Content editors, and a large plugin marketplace",
    description:
        "The best-known open-source headless CMS, with a polished editorial interface and years of plugins behind "
        + "it. It owns the schema — content types are defined through Strapi, in Strapi's tables — which is the "
        + "trade you are making.",
    // Community Edition is MIT Expat; only the `ee/` directory carries a
    // separate enterprise licence. Verified against strapi/strapi, 2026-09-02.
    licence: "MIT (enterprise directory excepted)",
    hosting: "Both",
    compare: "/rebase-vs-strapi"
};

const PAYLOAD: Alternative = {
    name: "Payload",
    href: "https://payloadcms.com",
    bestFor: "A CMS that lives inside your Next.js app",
    description:
        "Config-as-code, TypeScript throughout, and it deploys as part of the Next.js application rather than "
        + "beside it. Deep content modelling — nested blocks, localisation, versioning. The tighter the Next.js "
        + "coupling suits you, the better this is. Part of Figma since June 2025; the repository is still MIT, and "
        + "Payload Cloud stopped taking new sign-ups after the acquisition.",
    licence: "Open source (MIT)",
    hosting: "Self-host, or Payload Cloud for existing customers",
    compare: "/rebase-vs-payload"
};

const FIREBASE: Alternative = {
    name: "Firebase",
    href: "https://firebase.google.com",
    bestFor: "Mobile apps that must work offline",
    description:
        "Client SDKs with offline persistence that remain the best in the category, on Google's operational scale. "
        + "The database is a document store, so joins, transactions across collections and ad-hoc queries are the "
        + "things you give up.",
    licence: "Proprietary",
    hosting: "Hosted",
    compare: "/rebase-vs-firebase"
};

const NEON: Alternative = {
    name: "Neon",
    href: "https://neon.tech",
    bestFor: "Serverless Postgres with branching, and nothing else",
    description:
        "Managed Postgres with database branching and scale-to-zero. Deliberately not a backend — no auth, no API, "
        + "no admin panel — which makes it a good foundation to put one of the other tools here on top of, "
        + "including Rebase.",
    licence: "Open source (core)",
    hosting: "Hosted"
};

const CONVEX: Alternative = {
    name: "Convex",
    href: "https://convex.dev",
    bestFor: "Reactive apps where queries are code, not SQL",
    description:
        "A backend where queries and mutations are TypeScript functions and the client re-renders when their "
        + "results change. A genuinely different model, and a pleasant one. It is not Postgres, so the reasons to "
        + "want Postgres do not apply.",
    licence: "Open source",
    hosting: "Both"
};

const NHOST: Alternative = {
    name: "Nhost",
    href: "https://nhost.io",
    bestFor: "Postgres and GraphQL with auth already wired up",
    description:
        "Bundles Postgres, Hasura, auth, storage and functions into one platform, so you get the GraphQL model "
        + "without assembling it. A good fit if Hasura is what you wanted plus the parts around it.",
    licence: "Open source",
    hosting: "Both"
};

const METABASE: Alternative = {
    name: "Metabase",
    href: "https://metabase.com",
    bestFor: "Asking questions of the data, not editing it",
    description:
        "Dashboards, exploration and reporting over a SQL database, usable by people who do not write SQL. Worth "
        + "naming here because a good share of 'we need an admin panel' turns out to be 'we need to look at the "
        + "numbers'. It is read-oriented and not a place to run operations.",
    licence: "Open source",
    hosting: "Both"
};

const DJANGO: Alternative = {
    name: "Django admin",
    href: "https://www.djangoproject.com",
    bestFor: "Teams already writing Python",
    description:
        "The original batteries-included admin, and still one of the best if your backend is Python. It is tied to "
        + "Django's ORM and to server-rendered templates, so a separate frontend still needs an API you write and "
        + "maintain yourself.",
    licence: "Open source",
    hosting: "Self-host",
    compare: "/rebase-vs-django"
};

/* ── The pages ─────────────────────────────────────────────────────────────── */

export const ALTERNATIVES_PAGES: AlternativesPage[] = [
    {
        slug: "supabase",
        name: "Supabase",
        title: "Supabase alternatives in 2026 — 9 options, and how to pick",
        description:
            "An honest comparison of the alternatives to Supabase: Appwrite, PocketBase, Directus, Nhost, Neon, "
            + "Convex, Hasura and Rebase. Ordered by the reason you are leaving, not by who paid.",
        what:
            "Supabase is Postgres with auth, storage, realtime and edge functions on top, and it is the most "
            + "documented product in this category by a wide margin. Most people looking for an alternative are not "
            + "unhappy with Postgres — they are hitting one specific edge of the product around it.",
        reasons: [
            {
                reason: "The dashboard is a table editor, and my team needs a real admin panel",
                answer: "Rebase",
                why: "Generates a full back office — forms, roles, media, kanban, your own React components — from the same collection definitions that produce the API, so it stays in step with the schema instead of being maintained beside it."
            },
            {
                reason: "Writing and debugging RLS in a dashboard is painful",
                answer: "Rebase",
                why: "Security rules are part of the TypeScript collection definition and compile to real Postgres policies, so a policy is reviewable in a pull request and visible in a diff. Enforcement is identical — it is Postgres either way."
            },
            {
                reason: "I want one binary and no infrastructure at all",
                answer: "PocketBase",
                why: "A single executable with SQLite, auth, storage and an admin UI. Nothing here is simpler to run."
            },
            {
                reason: "I want the Firebase shape, but self-hosted",
                answer: "Appwrite",
                why: "Closest to Firebase's developer experience of anything you can run yourself, with SDKs across most platforms."
            },
            {
                reason: "I need GraphQL",
                answer: "Hasura or Nhost",
                why: "Hasura if you are assembling the rest yourself or federating several sources; Nhost if you want Hasura with auth, storage and functions already wired together."
            },
            {
                reason: "I only ever wanted managed Postgres",
                answer: "Neon",
                why: "Postgres with branching and scale-to-zero, and none of the platform around it. Put whatever you like on top."
            }
        ],
        alternatives: [
            REBASE("Postgres plus an admin panel your whole team can use"),
            APPWRITE, POCKETBASE, NHOST, HASURA, DIRECTUS, NEON, CONVEX, FIREBASE
        ],
        faqs: [
            {
                q: "What is the closest alternative to Supabase?",
                a: "It depends which part you are replacing. Appwrite is the closest in shape — a self-hostable, batteries-included backend with client SDKs — though its database is document-oriented rather than relational. If it is specifically Postgres-with-a-platform you want, Nhost and Rebase are the nearest; Nhost leans GraphQL, Rebase leans REST plus a generated admin panel."
            },
            {
                q: "Is there a self-hosted Supabase alternative?",
                a: "Several, and Supabase itself is self-hostable — it is open source, and running it yourself is a supported path, if an involved one. If the reason you are looking is that self-hosting Supabase is heavier than you wanted, PocketBase is the lightest option here and Rebase, Appwrite and Directus all run as a normal application next to a normal Postgres."
            },
            {
                q: "Do I have to migrate my database to switch?",
                a: "Usually not, if you are moving to something Postgres-based. Your data is already in Postgres, and Rebase, Directus, Hasura and Nhost all connect to a database that already exists. What has to be rewritten is the client layer and anything using Supabase-specific services — their auth schema, storage buckets and edge functions are their implementations, not Postgres features."
            },
            {
                q: "Which alternative is best for row-level security?",
                a: "Anything that leaves enforcement in Postgres, because a policy in the database applies to every client rather than only to the ones that go through the tool. Supabase and Rebase both do this. The difference is where the policy is written: Supabase in the dashboard as SQL, Rebase in the collection definition as code that compiles to the same policy."
            },
            {
                q: "Is Supabase still the right choice for some projects?",
                a: "Often, yes. If you want the biggest community and the most third-party material, if the free tier matters while you are starting, or if you want edge functions at the CDN, Supabase is ahead. Nothing on this page beats it on ecosystem — the reasons to look elsewhere are specific ones, and if none of them is yours, you already have your answer."
            }
        ]
    },

    {
        slug: "firebase",
        name: "Firebase",
        title: "Firebase alternatives in 2026 — 9 options for teams leaving Firestore",
        description:
            "The real alternatives to Firebase, ordered by why people leave: Supabase, Appwrite, PocketBase, Convex, "
            + "Rebase and more. Including where Firebase is still the better answer.",
        what:
            "Firebase is a hosted platform built around Firestore, a document database, with authentication, "
            + "storage, functions and client SDKs whose offline support is still the best in the business. Most "
            + "teams leaving are not leaving the platform — they are leaving the document model.",
        reasons: [
            {
                reason: "We need SQL — joins, transactions, ad-hoc queries",
                answer: "Supabase or Rebase",
                why: "Both are Postgres. Supabase is the more mature platform with the larger ecosystem; Rebase adds an admin panel generated from the same schema, which matters if people outside engineering need to work with the data."
            },
            {
                reason: "The bill scales in a way we cannot predict",
                answer: "Anything self-hostable",
                why: "Per-read pricing is what makes a Firestore bill move without the product changing. A self-hosted Postgres and an application next to it costs what the machine costs."
            },
            {
                reason: "We want to keep a document model, but self-hosted",
                answer: "Appwrite",
                why: "The closest thing to Firebase's shape and developer experience that you can run on your own infrastructure."
            },
            {
                reason: "We want reactive queries without giving up a real backend",
                answer: "Convex",
                why: "Queries are TypeScript functions and the client re-renders when their results change — the part of Firestore people miss most, done deliberately."
            },
            {
                reason: "Our ops team needs to see and edit the data",
                answer: "Rebase",
                why: "The Firebase console is a developer tool. A generated admin panel with roles, forms and media is a different thing, and it is what usually gets built by hand after a Firebase project grows up."
            },
            {
                reason: "It is a small app and we want one thing to run",
                answer: "PocketBase",
                why: "One binary with auth, storage, realtime and an admin UI. It is the smallest complete answer here."
            }
        ],
        alternatives: [
            SUPABASE, APPWRITE,
            REBASE("Moving to Postgres and needing a back office on day one"),
            POCKETBASE, CONVEX, NHOST, NEON, HASURA, DIRECTUS
        ],
        faqs: [
            {
                q: "What is the best open-source alternative to Firebase?",
                a: "Supabase and Appwrite are the two usual answers, and they answer different questions. Supabase if you want to move to Postgres and SQL; Appwrite if you liked Firebase's shape and want to self-host something similar. If part of why you are leaving is that the Firebase console is not usable by your non-engineering colleagues, Rebase adds a generated admin panel to the Postgres side of that choice."
            },
            {
                q: "How hard is it to migrate from Firestore to Postgres?",
                a: "The modelling is the work, not the copying. Collections of nested documents have to become tables and foreign keys, and decisions Firestore let you defer — what is a relation, what is required, what is unique — all have to be made. Expect it to take as long as the data model is complicated, and expect to get back joins, transactions and constraints for the trouble."
            },
            {
                q: "Is there a Firebase alternative with offline support?",
                a: "Not an equal one, and it is worth being blunt about that. Firebase's offline persistence is exceptional and nothing in this list matches it. If your app has to work on a bad connection, that is a genuine reason to stay, or to keep Firebase for the client and move only the parts that need SQL."
            },
            {
                q: "Which is cheaper than Firebase?",
                a: "Almost anything self-hosted, once you are past a small scale — not because the software is cheaper but because the pricing model is different. Firestore charges per read, so cost tracks usage in a way that is hard to forecast; a Postgres instance charges for the instance. Below a certain size Firebase's free tier is very hard to beat."
            },
            {
                q: "Can I move gradually instead of all at once?",
                a: "Usually, and it is usually the better plan. Firebase Auth can stay while the data moves, or one feature's data can move first while the rest stays. A full cutover on a live product is a much larger risk than the migration itself warrants."
            }
        ]
    },

    {
        slug: "retool",
        name: "Retool",
        title: "Retool alternatives in 2026 — 8 options, including self-hosted",
        description:
            "Self-hosted and open-source alternatives to Retool: Budibase, Appsmith, NocoDB, Directus, Rebase and "
            + "more. Ordered by why teams leave, with the per-seat pricing problem addressed directly.",
        what:
            "Retool is a hosted canvas for building internal tools over your data, with the widest integration "
            + "catalogue in the category. Teams leave for two reasons, and they are almost always the same two: the "
            + "per-user price as the tool succeeds, and handing a third party a credential to the production "
            + "database.",
        reasons: [
            {
                reason: "The per-seat bill grows every time someone new needs access",
                answer: "Rebase, Budibase or Appsmith",
                why: "All three are open source and self-hostable, so the eleventh person who needs read access does not change the bill. Rebase's hosted option is priced per resource rather than per seat."
            },
            {
                reason: "We cannot give an outside service database credentials",
                answer: "Anything self-hosted",
                why: "Self-hosted means the tool sits with the database instead of reaching into it, and no credential leaves your network."
            },
            {
                reason: "Rebuilding every screen after a schema change",
                answer: "Rebase",
                why: "Screens are generated from the collection definitions, so a new column appears in the table, the form and the API at once. A canvas builder keeps whatever you drew."
            },
            {
                reason: "We mostly need people to edit rows in a grid",
                answer: "NocoDB",
                why: "A spreadsheet interface over the database, which is often the whole actual requirement and takes an afternoon."
            },
            {
                reason: "We mostly need people to read numbers",
                answer: "Metabase",
                why: "A surprising share of internal-tool requests are reporting requests. Metabase answers those directly and does not pretend to be an operations surface."
            },
            {
                reason: "We need to join Stripe, Salesforce and three databases",
                answer: "Retool",
                why: "Honestly, stay. The integration catalogue is the product and nothing open source is close to it."
            }
        ],
        alternatives: [
            REBASE("A back office generated from your Postgres schema, with no per-seat cost"),
            BUDIBASE, APPSMITH, NOCODB, DIRECTUS, METABASE, DJANGO, RETOOL
        ],
        faqs: [
            {
                q: "What is the best open-source alternative to Retool?",
                a: "Budibase and Appsmith are the closest in kind — both are self-hostable drag-and-drop builders with a similar model. If your data is mostly in Postgres and you would rather the interface followed the schema than be drawn screen by screen, Rebase is a different answer to the same problem: the panel is generated from collection definitions, and the API comes with it."
            },
            {
                q: "Why is Retool so expensive?",
                a: "Because it is priced per user, and internal tools succeed by being used. The cost lands exactly when the tool starts working — the tenth colleague who wants read access to a dashboard is a line item. Self-hosted alternatives remove the per-seat dimension; that is usually the entire reason a team moves."
            },
            {
                q: "Can I self-host Retool?",
                a: "Yes, and if the concern is only where the software runs, that is the smallest possible change. It does not remove per-user pricing, so if the bill is the reason you are looking, self-hosting Retool does not address it."
            },
            {
                q: "What is the difference between a low-code builder and a generated admin panel?",
                a: "Where the screens come from. A builder gives you a canvas: you place components and bind them to queries, once per screen, and they stay as you left them. A generated panel derives the screens from the schema, so a new field shows up everywhere at once — less control over any single screen, far less maintenance across all of them."
            },
            {
                q: "Do I need a separate backend as well?",
                a: "With a builder, usually yes — it draws the interface and something still has to serve your application. Rebase is both: the same collection definitions produce the REST API and typed SDK your app uses and the admin panel your team uses, against one database with one set of policies."
            }
        ]
    },

    {
        slug: "directus",
        name: "Directus",
        title: "Directus alternatives in 2026 — 8 options for a backend over your own database",
        description:
            "Alternatives to Directus for teams who want an API and an admin UI over an existing SQL database: "
            + "Strapi, Payload, NocoDB, Hasura, Rebase and others, compared honestly.",
        what:
            "Directus wraps an existing SQL database in a REST and GraphQL API and a well-built admin application, "
            + "without demanding that you start from its schema. That last property is rare and is why people choose "
            + "it. The usual reasons to look elsewhere are its licence — source-available, and since v12 the "
            + "Monospace Sustainable Core License rather than the BSL it used before — and permissions being "
            + "enforced in the application rather than in the database.",
        reasons: [
            {
                reason: "The licence is a problem for us",
                answer: "Rebase, NocoDB or Payload",
                why: "All three carry conventional open-source licences, which matters if your legal review has an opinion or you intend to offer the thing as a service."
            },
            {
                reason: "We need authorization enforced in the database",
                answer: "Rebase",
                why: "Security rules compile to Postgres row-level security, so the rules hold for psql, a reporting tool and another service — not only for requests that arrive through the application."
            },
            {
                reason: "We want the schema defined in code and reviewed",
                answer: "Rebase or Payload",
                why: "Both define collections in TypeScript in your repository rather than through a UI, so a schema change is a pull request."
            },
            {
                reason: "We mainly need editors managing content",
                answer: "Strapi",
                why: "The most mature editorial experience among the open CMSes, with the largest plugin marketplace behind it."
            },
            {
                reason: "We need a database that is not Postgres or MySQL",
                answer: "Directus",
                why: "Stay. Its multi-engine support is broader than most of this list, and Rebase in particular is PostgreSQL only, deliberately."
            },
            {
                reason: "We really just want a grid over the tables",
                answer: "NocoDB",
                why: "Less product to run, and a spreadsheet is what a lot of teams actually meant."
            }
        ],
        alternatives: [
            REBASE("An API and an admin panel over your existing Postgres, with RLS in code"),
            STRAPI, PAYLOAD, NOCODB, HASURA, SUPABASE, BUDIBASE, DIRECTUS
        ],
        faqs: [
            {
                q: "What is the best alternative to Directus?",
                a: "It turns on which Directus property you were relying on. For an admin UI over a database you already have, Rebase is the closest in intent — it also reads an existing schema rather than owning one. For editorial content management, Strapi is more mature. For a grid over tables, NocoDB is less product to run."
            },
            {
                q: "Is Directus open source?",
                a: "Not by the OSI definition, and the terms have moved twice. It left MIT for the Business Source License in 2023, and with v12 it moved again to the Monospace Sustainable Core License: source-available, free below a revenue and headcount threshold, and converting to GPL-3.0 four years after each release. Whether that is a problem is a question for your legal review rather than for us. Rebase, NocoDB, Payload and Budibase carry conventional open-source licences."
            },
            {
                q: "Which alternatives work with an existing database?",
                a: "Rebase, Hasura and NocoDB all connect to a schema that already exists, as Directus does. Strapi and Payload prefer to own the schema and define content types themselves, which is a genuine difference in kind rather than a feature gap."
            },
            {
                q: "What is the difference between Directus and a backend-as-a-service?",
                a: "Mostly scope. Directus gives you an API and an admin app over your database. A backend-as-a-service also brings authentication, storage, realtime, scheduled jobs and functions as first-class parts of the platform. If you were going to assemble those anyway, that is the difference worth pricing."
            },
            {
                q: "Where should authorization live?",
                a: "In the database, if you can manage it. A permission engine in front of the database — which is how Directus and most CMSes work — is expressive and easy to reason about, and it stops being in force the moment anything reaches the data another way. Postgres row-level security applies to every client, which is why Rebase compiles to it."
            }
        ]
    },

    {
        slug: "strapi",
        name: "Strapi",
        title: "Strapi alternatives in 2026 — 8 headless CMS and backend options",
        description:
            "Alternatives to Strapi for content and application backends: Payload, Directus, Rebase, Supabase and "
            + "more — including when Strapi is still the right answer.",
        what:
            "Strapi is the best-known open-source headless CMS: a polished editorial interface, a large plugin "
            + "marketplace, and content types defined through its own UI in its own tables. That last part — Strapi "
            + "owning the schema — is what most people are reacting to when they start looking.",
        reasons: [
            {
                reason: "We want the schema in code, not clicked into a UI",
                answer: "Payload or Rebase",
                why: "Both define collections as TypeScript in your repository, so a schema change goes through review and appears in a diff."
            },
            {
                reason: "We have a database already and Strapi wants its own",
                answer: "Rebase or Directus",
                why: "Both read an existing SQL schema instead of generating one. Rebase is Postgres only; Directus supports more engines."
            },
            {
                reason: "The CMS is only part of it — we need a real backend",
                answer: "Rebase",
                why: "Auth, realtime, storage, functions, cron and a typed SDK come from the same definitions as the admin panel, rather than being plugins around a CMS."
            },
            {
                reason: "It is a Next.js site and we want the CMS inside it",
                answer: "Payload",
                why: "Deploys as part of the Next.js app rather than beside it, which is one fewer thing to run and one fewer network hop."
            },
            {
                reason: "Our editors are the primary users and they are happy",
                answer: "Strapi",
                why: "Stay. Nothing here has a more finished editorial experience, and switching would be paid for by the people the product is for."
            },
            {
                reason: "We need a specific plugin from the marketplace",
                answer: "Strapi",
                why: "The marketplace is genuinely a moat. Rebase extends by writing React components, which suits a different team."
            }
        ],
        alternatives: [
            PAYLOAD, DIRECTUS,
            REBASE("A backend and an admin panel from one schema, on your own Postgres"),
            SUPABASE, NOCODB, HASURA, POCKETBASE, STRAPI
        ],
        faqs: [
            {
                q: "What is the best alternative to Strapi?",
                a: "Payload is the closest like-for-like for a code-first CMS, especially inside Next.js. Directus is closest if you want an admin app over a database you already own. Rebase is the answer when what you actually needed was a backend — auth, API, realtime, policies — that happens to include content management, rather than a CMS you then extend into a backend."
            },
            {
                q: "Is Strapi still open source?",
                a: "The Community Edition is MIT. What is not MIT is the `ee/` directory — the enterprise features — which carries its own licence, and the cloud offering has its own terms on top. So: yes for the product most people run, with a boundary inside the repository worth reading if you plan to build on the enterprise side. Payload, Rebase and NocoDB are MIT throughout."
            },
            {
                q: "Can I use a headless CMS with an existing database?",
                a: "Rarely, and this is the sharpest split in this list. Most headless CMSes want to create and own their tables, because the content model is the product. Directus and Rebase are the exceptions here: both point at a schema that already exists and work with the tables they find."
            },
            {
                q: "Do I need a CMS at all?",
                a: "Only if people who are not developers change content on a schedule. If the actual need is an operations team editing application data — orders, users, inventory — a CMS is the wrong shape, and an admin panel generated from your schema fits better and stays in step with it."
            },
            {
                q: "How do I migrate content out of Strapi?",
                a: "Through its API rather than the database, in general. Strapi models relations through its own join tables and metadata, so reading the tables directly means reverse-engineering that. Exporting through the content API gives you the shape you were actually working with."
            }
        ]
    },

    {
        slug: "hasura",
        name: "Hasura",
        title: "Hasura alternatives in 2026 — 7 options for an instant API over Postgres",
        description:
            "Alternatives to Hasura for an instant API over Postgres: Supabase, PostgREST, Rebase, Nhost, Directus "
            + "and more — GraphQL and REST compared honestly.",
        what:
            "Hasura generates a GraphQL API over Postgres and other sources, with a permission system defined in "
            + "metadata and applied as it builds each query. It is very good at that. People look elsewhere when "
            + "GraphQL turns out not to have been the requirement, or when they need a back office that the console "
            + "is not.",
        reasons: [
            {
                reason: "We did not actually need GraphQL",
                answer: "Rebase or Supabase",
                why: "Both give you a REST API and a typed client over Postgres with much less machinery between you and the database."
            },
            {
                reason: "We need an admin panel, not a developer console",
                answer: "Rebase",
                why: "The Hasura console is for building and inspecting the graph. A generated back office with roles, forms and media is the piece teams usually end up building on top of Hasura by hand."
            },
            {
                reason: "We need to know exactly what we are licensing",
                answer: "PostgREST or Supabase",
                why: "graphql-engine is Apache-2.0, but Hasura's newer DDN product is a separate offering under separate terms, and the two do get confused. PostgREST is a small, permissively licensed piece of infrastructure that does one job; Supabase builds on it and is Apache-2.0."
            },
            {
                reason: "We want GraphQL with auth and storage already attached",
                answer: "Nhost",
                why: "Hasura plus the parts around it, assembled and maintained together."
            },
            {
                reason: "We are federating several data sources behind one graph",
                answer: "Hasura",
                why: "Stay. That is its home ground and nothing else here comes close."
            }
        ],
        alternatives: [
            REBASE("A typed REST API plus an admin panel, from one schema"),
            SUPABASE, NHOST,
            {
                name: "PostgREST",
                href: "https://postgrest.org",
                bestFor: "One small binary that turns Postgres into a REST API",
                description:
                    "Serves your schema as REST and delegates authorization entirely to Postgres roles and "
                    + "row-level security. Does one thing, does it well, and leaves auth, storage and an admin UI "
                    + "to you — which is either the appeal or the problem.",
                licence: "Open source",
                hosting: "Self-host"
            },
            DIRECTUS, NEON, HASURA
        ],
        faqs: [
            {
                q: "What is the best alternative to Hasura?",
                a: "For GraphQL specifically, Nhost is the nearest — it is Hasura with auth, storage and functions assembled around it. If GraphQL was not the point, Supabase and Rebase both give you an instant API over Postgres with less between you and the database; Rebase also generates an admin panel from the same definitions."
            },
            {
                q: "Is there a REST alternative to Hasura?",
                a: "PostgREST is the minimal one — a single binary that exposes your schema as REST and leaves authorization to Postgres roles and RLS. Supabase builds on it. Rebase generates REST plus a typed TypeScript SDK plus a panel, which is more product for the cases where you wanted more than an API."
            },
            {
                q: "Do I need GraphQL for a Postgres API?",
                a: "Usually not. GraphQL earns its complexity when many clients need differently-shaped data from many sources, or when a schema is a contract across teams. For one application over one database, a typed REST client gets you the same safety with far less to operate."
            },
            {
                q: "How do Hasura permissions compare to row-level security?",
                a: "Hasura's permissions live in its metadata and are applied by the engine as it builds each query — expressive and well-designed, and in force for requests that go through Hasura. Postgres row-level security is enforced by the database for every client. The trade is expressiveness against reach, and which one matters depends on how many things touch your database."
            },
            {
                q: "Can I run Hasura and something else on the same database?",
                a: "Yes, and it is the sensible way to evaluate. Hasura, Rebase and Directus all point at an existing Postgres rather than owning it, and each keeps its own bookkeeping in its own schema. Run them side by side on a copy before committing to anything."
            }
        ]
    }
];

export const ALTERNATIVES_BY_SLUG = Object.fromEntries(
    ALTERNATIVES_PAGES.map((page) => [page.slug, page])
);
