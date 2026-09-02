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
        "alt.tool.rebase.desc",
    licence: "alt.tool.rebase.licence",
    hosting: "alt.tool.rebase.hosting",
    isUs: true
});

const SUPABASE: Alternative = {
    name: "Supabase",
    href: "https://supabase.com",
    bestFor: "alt.tool.supabase.bestFor",
    description:
        "alt.tool.supabase.desc",
    licence: "alt.tool.supabase.licence",
    hosting: "alt.tool.supabase.hosting",
    compare: "/rebase-vs-supabase"
};

const POCKETBASE: Alternative = {
    name: "PocketBase",
    href: "https://pocketbase.io",
    bestFor: "alt.tool.pocketbase.bestFor",
    description:
        "alt.tool.pocketbase.desc",
    licence: "alt.tool.pocketbase.licence",
    hosting: "alt.tool.pocketbase.hosting"
};

const APPWRITE: Alternative = {
    name: "Appwrite",
    href: "https://appwrite.io",
    bestFor: "alt.tool.appwrite.bestFor",
    description:
        "alt.tool.appwrite.desc",
    licence: "alt.tool.appwrite.licence",
    hosting: "alt.tool.appwrite.hosting"
};

const DIRECTUS: Alternative = {
    name: "Directus",
    href: "https://directus.io",
    bestFor: "alt.tool.directus.bestFor",
    description:
        "alt.tool.directus.desc",
    // Left MIT for the BSL in 2023, and moved again with v12 to the Monospace
    // Sustainable Core License: source-available, free under a revenue and
    // headcount threshold, GPL-3.0 four years after each release. Verified
    // against directus/directus, 2026-09-02.
    licence: "alt.tool.directus.licence",
    hosting: "alt.tool.directus.hosting",
    compare: "/rebase-vs-directus"
};

const HASURA: Alternative = {
    name: "Hasura",
    href: "https://hasura.io",
    bestFor: "alt.tool.hasura.bestFor",
    description:
        "alt.tool.hasura.desc",
    // graphql-engine is Apache-2.0. Verified 2026-09-02. Hasura's newer DDN
    // product is a separate offering under separate terms; this row is the engine.
    licence: "alt.tool.hasura.licence",
    hosting: "alt.tool.hasura.hosting",
    compare: "/rebase-vs-hasura"
};

const NOCODB: Alternative = {
    name: "NocoDB",
    href: "https://nocodb.com",
    bestFor: "alt.tool.nocodb.bestFor",
    description:
        "alt.tool.nocodb.desc",
    licence: "alt.tool.nocodb.licence",
    hosting: "alt.tool.nocodb.hosting"
};

const BUDIBASE: Alternative = {
    name: "Budibase",
    href: "https://budibase.com",
    bestFor: "alt.tool.budibase.bestFor",
    description:
        "alt.tool.budibase.desc",
    licence: "alt.tool.budibase.licence",
    hosting: "alt.tool.budibase.hosting"
};

const APPSMITH: Alternative = {
    name: "Appsmith",
    href: "https://appsmith.com",
    bestFor: "alt.tool.appsmith.bestFor",
    description:
        "alt.tool.appsmith.desc",
    licence: "alt.tool.appsmith.licence",
    hosting: "alt.tool.appsmith.hosting"
};

const RETOOL: Alternative = {
    name: "Retool",
    href: "https://retool.com",
    bestFor: "alt.tool.retool.bestFor",
    description:
        "alt.tool.retool.desc",
    licence: "alt.tool.retool.licence",
    hosting: "alt.tool.retool.hosting",
    compare: "/rebase-vs-retool"
};

const STRAPI: Alternative = {
    name: "Strapi",
    href: "https://strapi.io",
    bestFor: "alt.tool.strapi.bestFor",
    description:
        "alt.tool.strapi.desc",
    // Community Edition is MIT Expat; only the `ee/` directory carries a
    // separate enterprise licence. Verified against strapi/strapi, 2026-09-02.
    licence: "alt.tool.strapi.licence",
    hosting: "alt.tool.strapi.hosting",
    compare: "/rebase-vs-strapi"
};

const PAYLOAD: Alternative = {
    name: "Payload",
    href: "https://payloadcms.com",
    bestFor: "alt.tool.payload.bestFor",
    description:
        "alt.tool.payload.desc",
    licence: "alt.tool.payload.licence",
    hosting: "alt.tool.payload.hosting",
    compare: "/rebase-vs-payload"
};

const FIREBASE: Alternative = {
    name: "Firebase",
    href: "https://firebase.google.com",
    bestFor: "alt.tool.firebase.bestFor",
    description:
        "alt.tool.firebase.desc",
    licence: "alt.tool.firebase.licence",
    hosting: "alt.tool.firebase.hosting",
    compare: "/rebase-vs-firebase"
};

const NEON: Alternative = {
    name: "Neon",
    href: "https://neon.tech",
    bestFor: "alt.tool.neon.bestFor",
    description:
        "alt.tool.neon.desc",
    licence: "alt.tool.neon.licence",
    hosting: "alt.tool.neon.hosting"
};

const CONVEX: Alternative = {
    name: "Convex",
    href: "https://convex.dev",
    bestFor: "alt.tool.convex.bestFor",
    description:
        "alt.tool.convex.desc",
    licence: "alt.tool.convex.licence",
    hosting: "alt.tool.convex.hosting"
};

const NHOST: Alternative = {
    name: "Nhost",
    href: "https://nhost.io",
    bestFor: "alt.tool.nhost.bestFor",
    description:
        "alt.tool.nhost.desc",
    licence: "alt.tool.nhost.licence",
    hosting: "alt.tool.nhost.hosting"
};

const METABASE: Alternative = {
    name: "Metabase",
    href: "https://metabase.com",
    bestFor: "alt.tool.metabase.bestFor",
    description:
        "alt.tool.metabase.desc",
    licence: "alt.tool.metabase.licence",
    hosting: "alt.tool.metabase.hosting"
};

const DJANGO: Alternative = {
    name: "Django admin",
    href: "https://www.djangoproject.com",
    bestFor: "alt.tool.django.bestFor",
    description:
        "alt.tool.django.desc",
    licence: "alt.tool.django.licence",
    hosting: "alt.tool.django.hosting",
    compare: "/rebase-vs-django"
};

/* ── The pages ─────────────────────────────────────────────────────────────── */

export const ALTERNATIVES_PAGES: AlternativesPage[] = [
    {
        slug: "supabase",
        name: "Supabase",
        title: "alt.page.supabase.title",
        description:
            "alt.page.supabase.description",
        what:
            "alt.page.supabase.what",
        reasons: [
            {
                reason: "alt.page.supabase.r0.reason",
                answer: "Rebase",
                why: "alt.page.supabase.r0.why"
            },
            {
                reason: "alt.page.supabase.r1.reason",
                answer: "Rebase",
                why: "alt.page.supabase.r1.why"
            },
            {
                reason: "alt.page.supabase.r2.reason",
                answer: "PocketBase",
                why: "alt.page.supabase.r2.why"
            },
            {
                reason: "alt.page.supabase.r3.reason",
                answer: "Appwrite",
                why: "alt.page.supabase.r3.why"
            },
            {
                reason: "alt.page.supabase.r4.reason",
                answer: "Hasura or Nhost",
                why: "alt.page.supabase.r4.why"
            },
            {
                reason: "alt.page.supabase.r5.reason",
                answer: "Neon",
                why: "alt.page.supabase.r5.why"
            }
        ],
        alternatives: [
            REBASE("alt.rebase.supabase.bestFor"),
            APPWRITE, POCKETBASE, NHOST, HASURA, DIRECTUS, NEON, CONVEX, FIREBASE
        ],
        faqs: [
            {
                q: "alt.page.supabase.f0.q",
                a: "alt.page.supabase.f0.a"
            },
            {
                q: "alt.page.supabase.f1.q",
                a: "alt.page.supabase.f1.a"
            },
            {
                q: "alt.page.supabase.f2.q",
                a: "alt.page.supabase.f2.a"
            },
            {
                q: "alt.page.supabase.f3.q",
                a: "alt.page.supabase.f3.a"
            },
            {
                q: "alt.page.supabase.f4.q",
                a: "alt.page.supabase.f4.a"
            }
        ]
    },

    {
        slug: "firebase",
        name: "Firebase",
        title: "alt.page.firebase.title",
        description:
            "alt.page.firebase.description",
        what:
            "alt.page.firebase.what",
        reasons: [
            {
                reason: "alt.page.firebase.r0.reason",
                answer: "Supabase or Rebase",
                why: "alt.page.firebase.r0.why"
            },
            {
                reason: "alt.page.firebase.r1.reason",
                answer: "alt.answer.selfhostable",
                why: "alt.page.firebase.r1.why"
            },
            {
                reason: "alt.page.firebase.r2.reason",
                answer: "Appwrite",
                why: "alt.page.firebase.r2.why"
            },
            {
                reason: "alt.page.firebase.r3.reason",
                answer: "Convex",
                why: "alt.page.firebase.r3.why"
            },
            {
                reason: "alt.page.firebase.r4.reason",
                answer: "Rebase",
                why: "alt.page.firebase.r4.why"
            },
            {
                reason: "alt.page.firebase.r5.reason",
                answer: "PocketBase",
                why: "alt.page.firebase.r5.why"
            }
        ],
        alternatives: [
            SUPABASE, APPWRITE,
            REBASE("alt.rebase.firebase.bestFor"),
            POCKETBASE, CONVEX, NHOST, NEON, HASURA, DIRECTUS
        ],
        faqs: [
            {
                q: "alt.page.firebase.f0.q",
                a: "alt.page.firebase.f0.a"
            },
            {
                q: "alt.page.firebase.f1.q",
                a: "alt.page.firebase.f1.a"
            },
            {
                q: "alt.page.firebase.f2.q",
                a: "alt.page.firebase.f2.a"
            },
            {
                q: "alt.page.firebase.f3.q",
                a: "alt.page.firebase.f3.a"
            },
            {
                q: "alt.page.firebase.f4.q",
                a: "alt.page.firebase.f4.a"
            }
        ]
    },

    {
        slug: "retool",
        name: "Retool",
        title: "alt.page.retool.title",
        description:
            "alt.page.retool.description",
        what:
            "alt.page.retool.what",
        reasons: [
            {
                reason: "alt.page.retool.r0.reason",
                answer: "Rebase, Budibase or Appsmith",
                why: "alt.page.retool.r0.why"
            },
            {
                reason: "alt.page.retool.r1.reason",
                answer: "alt.answer.selfhosted",
                why: "alt.page.retool.r1.why"
            },
            {
                reason: "alt.page.retool.r2.reason",
                answer: "Rebase",
                why: "alt.page.retool.r2.why"
            },
            {
                reason: "alt.page.retool.r3.reason",
                answer: "NocoDB",
                why: "alt.page.retool.r3.why"
            },
            {
                reason: "alt.page.retool.r4.reason",
                answer: "Metabase",
                why: "alt.page.retool.r4.why"
            },
            {
                reason: "alt.page.retool.r5.reason",
                answer: "Retool",
                why: "alt.page.retool.r5.why"
            }
        ],
        alternatives: [
            REBASE("alt.rebase.retool.bestFor"),
            BUDIBASE, APPSMITH, NOCODB, DIRECTUS, METABASE, DJANGO, RETOOL
        ],
        faqs: [
            {
                q: "alt.page.retool.f0.q",
                a: "alt.page.retool.f0.a"
            },
            {
                q: "alt.page.retool.f1.q",
                a: "alt.page.retool.f1.a"
            },
            {
                q: "alt.page.retool.f2.q",
                a: "alt.page.retool.f2.a"
            },
            {
                q: "alt.page.retool.f3.q",
                a: "alt.page.retool.f3.a"
            },
            {
                q: "alt.page.retool.f4.q",
                a: "alt.page.retool.f4.a"
            }
        ]
    },

    {
        slug: "directus",
        name: "Directus",
        title: "alt.page.directus.title",
        description:
            "alt.page.directus.description",
        what:
            "alt.page.directus.what",
        reasons: [
            {
                reason: "alt.page.directus.r0.reason",
                answer: "Rebase, NocoDB or Payload",
                why: "alt.page.directus.r0.why"
            },
            {
                reason: "alt.page.directus.r1.reason",
                answer: "Rebase",
                why: "alt.page.directus.r1.why"
            },
            {
                reason: "alt.page.directus.r2.reason",
                answer: "Rebase or Payload",
                why: "alt.page.directus.r2.why"
            },
            {
                reason: "alt.page.directus.r3.reason",
                answer: "Strapi",
                why: "alt.page.directus.r3.why"
            },
            {
                reason: "alt.page.directus.r4.reason",
                answer: "Directus",
                why: "alt.page.directus.r4.why"
            },
            {
                reason: "alt.page.directus.r5.reason",
                answer: "NocoDB",
                why: "alt.page.directus.r5.why"
            }
        ],
        alternatives: [
            REBASE("alt.rebase.directus.bestFor"),
            STRAPI, PAYLOAD, NOCODB, HASURA, SUPABASE, BUDIBASE, DIRECTUS
        ],
        faqs: [
            {
                q: "alt.page.directus.f0.q",
                a: "alt.page.directus.f0.a"
            },
            {
                q: "alt.page.directus.f1.q",
                a: "alt.page.directus.f1.a"
            },
            {
                q: "alt.page.directus.f2.q",
                a: "alt.page.directus.f2.a"
            },
            {
                q: "alt.page.directus.f3.q",
                a: "alt.page.directus.f3.a"
            },
            {
                q: "alt.page.directus.f4.q",
                a: "alt.page.directus.f4.a"
            }
        ]
    },

    {
        slug: "strapi",
        name: "Strapi",
        title: "alt.page.strapi.title",
        description:
            "alt.page.strapi.description",
        what:
            "alt.page.strapi.what",
        reasons: [
            {
                reason: "alt.page.strapi.r0.reason",
                answer: "Payload or Rebase",
                why: "alt.page.strapi.r0.why"
            },
            {
                reason: "alt.page.strapi.r1.reason",
                answer: "Rebase or Directus",
                why: "alt.page.strapi.r1.why"
            },
            {
                reason: "alt.page.strapi.r2.reason",
                answer: "Rebase",
                why: "alt.page.strapi.r2.why"
            },
            {
                reason: "alt.page.strapi.r3.reason",
                answer: "Payload",
                why: "alt.page.strapi.r3.why"
            },
            {
                reason: "alt.page.strapi.r4.reason",
                answer: "Strapi",
                why: "alt.page.strapi.r4.why"
            },
            {
                reason: "alt.page.strapi.r5.reason",
                answer: "Strapi",
                why: "alt.page.strapi.r5.why"
            }
        ],
        alternatives: [
            PAYLOAD, DIRECTUS,
            REBASE("alt.rebase.strapi.bestFor"),
            SUPABASE, NOCODB, HASURA, POCKETBASE, STRAPI
        ],
        faqs: [
            {
                q: "alt.page.strapi.f0.q",
                a: "alt.page.strapi.f0.a"
            },
            {
                q: "alt.page.strapi.f1.q",
                a: "alt.page.strapi.f1.a"
            },
            {
                q: "alt.page.strapi.f2.q",
                a: "alt.page.strapi.f2.a"
            },
            {
                q: "alt.page.strapi.f3.q",
                a: "alt.page.strapi.f3.a"
            },
            {
                q: "alt.page.strapi.f4.q",
                a: "alt.page.strapi.f4.a"
            }
        ]
    },

    {
        slug: "hasura",
        name: "Hasura",
        title: "alt.page.hasura.title",
        description:
            "alt.page.hasura.description",
        what:
            "alt.page.hasura.what",
        reasons: [
            {
                reason: "alt.page.hasura.r0.reason",
                answer: "Rebase or Supabase",
                why: "alt.page.hasura.r0.why"
            },
            {
                reason: "alt.page.hasura.r1.reason",
                answer: "Rebase",
                why: "alt.page.hasura.r1.why"
            },
            {
                reason: "alt.page.hasura.r2.reason",
                answer: "PostgREST or Supabase",
                why: "alt.page.hasura.r2.why"
            },
            {
                reason: "alt.page.hasura.r3.reason",
                answer: "Nhost",
                why: "alt.page.hasura.r3.why"
            },
            {
                reason: "alt.page.hasura.r4.reason",
                answer: "Hasura",
                why: "alt.page.hasura.r4.why"
            }
        ],
        alternatives: [
            REBASE("alt.rebase.hasura.bestFor"),
            SUPABASE, NHOST,
            {
                name: "PostgREST",
                href: "https://postgrest.org",
                bestFor: "alt.tool.postgrest.bestFor",
                description:
                    "alt.tool.postgrest.desc",
                licence: "alt.tool.postgrest.licence",
                hosting: "alt.tool.postgrest.hosting"
            },
            DIRECTUS, NEON, HASURA
        ],
        faqs: [
            {
                q: "alt.page.hasura.f0.q",
                a: "alt.page.hasura.f0.a"
            },
            {
                q: "alt.page.hasura.f1.q",
                a: "alt.page.hasura.f1.a"
            },
            {
                q: "alt.page.hasura.f2.q",
                a: "alt.page.hasura.f2.a"
            },
            {
                q: "alt.page.hasura.f3.q",
                a: "alt.page.hasura.f3.a"
            },
            {
                q: "alt.page.hasura.f4.q",
                a: "alt.page.hasura.f4.a"
            }
        ]
    }
];

export const ALTERNATIVES_BY_SLUG = Object.fromEntries(
    ALTERNATIVES_PAGES.map((page) => [page.slug, page])
);
