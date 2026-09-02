/**
 * The six questions a buyer actually asks on each comparison page.
 *
 * ── Why this is data and not markup ──────────────────────────────────────────
 * Each comparison page is several hundred lines of hand-built layout, and that
 * is why there are eight of them rather than eighty: adding one is a design
 * job. The questions are not. Keeping them here means a new competitor page
 * needs one array and one component, and it means all eight blocks stay in the
 * same voice instead of drifting apart one edit at a time.
 *
 * ── The rules these answers follow ───────────────────────────────────────────
 *  1. **Every set concedes something.** There is a "when is X the better
 *     choice?" question on every page, and its answer is real. A comparison
 *     that never gives ground reads as a brochure, and a brochure is not
 *     quoted by anyone — not by a reader deciding, and not by a model
 *     assembling an answer from the pages it trusts.
 *  2. **No numbers we cannot stand behind.** No benchmarks, no competitor
 *     prices (they change, and a stale price is a lie with a date on it), no
 *     "10x faster". Every claim here is about architecture, which is checkable.
 *  3. **Answer the question asked.** The first sentence answers it; the rest
 *     explains. An answer that opens with three sentences of positioning is an
 *     answer a reader skips and a model truncates.
 *  4. **The migration question comes first**, because it is the one that
 *     actually blocks a decision.
 */

export interface Faq {
    q: string;
    a: string;
}

/** Repeated verbatim wherever hosting comes up, so the story cannot drift. */
const HOSTING: Faq = { q: "cfaq.hosting.q", a: "cfaq.hosting.a" };

export const COMPARISON_FAQS: Record<string, Faq[]> = {
    supabase: [
        {
            q: "cfaq.supabase.0.q",
            a: "cfaq.supabase.0.a"
        },
        {
            q: "cfaq.supabase.1.q",
            a: "cfaq.supabase.1.a"
        },
        {
            q: "cfaq.supabase.2.q",
            a: "cfaq.supabase.2.a"
        },
        {
            q: "cfaq.supabase.3.q",
            a: "cfaq.supabase.3.a"
        },
        {
            q: "cfaq.supabase.4.q",
            a: "cfaq.supabase.4.a"
        },
        HOSTING
    ],

    firebase: [
        {
            q: "cfaq.firebase.0.q",
            a: "cfaq.firebase.0.a"
        },
        {
            q: "cfaq.firebase.1.q",
            a: "cfaq.firebase.1.a"
        },
        {
            q: "cfaq.firebase.2.q",
            a: "cfaq.firebase.2.a"
        },
        {
            q: "cfaq.firebase.3.q",
            a: "cfaq.firebase.3.a"
        },
        {
            q: "cfaq.firebase.4.q",
            a: "cfaq.firebase.4.a"
        },
        HOSTING
    ],

    directus: [
        {
            q: "cfaq.directus.0.q",
            a: "cfaq.directus.0.a"
        },
        {
            q: "cfaq.directus.1.q",
            a: "cfaq.directus.1.a"
        },
        {
            q: "cfaq.directus.2.q",
            a: "cfaq.directus.2.a"
        },
        {
            q: "cfaq.directus.3.q",
            a: "cfaq.directus.3.a"
        },
        {
            q: "cfaq.directus.4.q",
            a: "cfaq.directus.4.a"
        },
        HOSTING
    ],

    strapi: [
        {
            q: "cfaq.strapi.0.q",
            a: "cfaq.strapi.0.a"
        },
        {
            q: "cfaq.strapi.1.q",
            a: "cfaq.strapi.1.a"
        },
        {
            q: "cfaq.strapi.2.q",
            a: "cfaq.strapi.2.a"
        },
        {
            q: "cfaq.strapi.3.q",
            a: "cfaq.strapi.3.a"
        },
        {
            q: "cfaq.strapi.4.q",
            a: "cfaq.strapi.4.a"
        },
        HOSTING
    ],

    payload: [
        {
            q: "cfaq.payload.0.q",
            a: "cfaq.payload.0.a"
        },
        {
            q: "cfaq.payload.1.q",
            a: "cfaq.payload.1.a"
        },
        {
            q: "cfaq.payload.2.q",
            a: "cfaq.payload.2.a"
        },
        {
            q: "cfaq.payload.3.q",
            a: "cfaq.payload.3.a"
        },
        {
            q: "cfaq.payload.4.q",
            a: "cfaq.payload.4.a"
        },
        HOSTING
    ],

    retool: [
        {
            q: "cfaq.retool.0.q",
            a: "cfaq.retool.0.a"
        },
        {
            q: "cfaq.retool.1.q",
            a: "cfaq.retool.1.a"
        },
        {
            q: "cfaq.retool.2.q",
            a: "cfaq.retool.2.a"
        },
        {
            q: "cfaq.retool.3.q",
            a: "cfaq.retool.3.a"
        },
        {
            q: "cfaq.retool.4.q",
            a: "cfaq.retool.4.a"
        },
        HOSTING
    ],

    hasura: [
        {
            q: "cfaq.hasura.0.q",
            a: "cfaq.hasura.0.a"
        },
        {
            q: "cfaq.hasura.1.q",
            a: "cfaq.hasura.1.a"
        },
        {
            q: "cfaq.hasura.2.q",
            a: "cfaq.hasura.2.a"
        },
        {
            q: "cfaq.hasura.3.q",
            a: "cfaq.hasura.3.a"
        },
        {
            q: "cfaq.hasura.4.q",
            a: "cfaq.hasura.4.a"
        },
        HOSTING
    ],

    django: [
        {
            q: "cfaq.django.0.q",
            a: "cfaq.django.0.a"
        },
        {
            q: "cfaq.django.1.q",
            a: "cfaq.django.1.a"
        },
        {
            q: "cfaq.django.2.q",
            a: "cfaq.django.2.a"
        },
        {
            q: "cfaq.django.3.q",
            a: "cfaq.django.3.a"
        },
        {
            q: "cfaq.django.4.q",
            a: "cfaq.django.4.a"
        },
        HOSTING
    ]
};
