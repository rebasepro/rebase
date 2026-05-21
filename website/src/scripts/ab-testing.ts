/**
 * A/B Testing Engine for Rebase Landing Page
 *
 * Lightweight, cookie-based, GA4-integrated A/B testing.
 * Zero dependencies. No flicker (inline head script assigns before paint).
 *
 * Supports two experiment types:
 * - **Content variants**: Show/hide elements via `<ABVariant>` component.
 * - **Section reordering**: Reorder page sections via CSS `order` on a flex
 *   container. Each variant defines a map of `#section-id → order` values.
 *   The control variant uses natural HTML order (no CSS injected).
 *
 * How to use:
 * 1. Define experiments in the EXPERIMENTS array below.
 * 2. For content tests, wrap variant content with <ABVariant>.
 * 3. For reorder tests, add `sectionOrders` to the experiment definition.
 * 4. Results are automatically tracked in GA4 as custom events.
 *
 * Cookie: rb_ab (functional — determines UI state, no consent needed)
 * GA4 events: experiment_impression, experiment_conversion
 */

// ─── Types ───────────────────────────────────────────────────

export interface Experiment {
    /** Unique identifier (use kebab-case, e.g. "hero-cta") */
    id: string;
    /** Variant names. First should always be "control". */
    variants: string[];
    /** Traffic split percentages. Must sum to 100. Defaults to equal split. */
    weights?: number[];
    /** ISO date string. Experiment auto-deactivates after this date. */
    expires?: string;
    /**
     * For section-reorder experiments: map of variant name → { sectionId: order }.
     * Only applies to non-control variants. Section IDs should match the `id`
     * attribute on the target elements (e.g. "s-social-proof", "s-demo-terminal").
     * Omitted sections keep their natural HTML order.
     */
    sectionOrders?: Record<string, Record<string, number>>;
}

// ─── Active Experiments ──────────────────────────────────────
// Add, modify, or remove experiments here.
// Changes take effect on next deploy.
// ─────────────────────────────────────────────────────────────

/**
 * Landing page section IDs (for reference when defining reorder experiments):
 *
 *  s-hero             — Hero (should always stay first)
 *  s-social-proof     — Client logos
 *  s-demo-terminal    — Terminal demo + init command
 *  s-demo-carousel    — Admin panel carousel
 *  s-how-it-works     — 3-step explainer
 *  s-power-features   — Feature video grid
 *  s-collection-power — "One Collection" section
 *  s-mosaic-showcase  — Visual Mosaic Showcase
 *  s-case-study       — SustenTalent showcase
 *  s-scroll-sync      — Scroll-sync feature showcase
 *  s-security         — Security & open-source punches
 *  s-faq              — FAQ accordion
 *  s-roadmap          — Roadmap timeline
 *  s-final-cta        — Bottom CTA (should always stay last)
 */

export const EXPERIMENTS: Experiment[] = [
    {
        id: "hero-headline",
        variants: ["control", "benefit", "action"],
        weights: [34, 33, 33],
        expires: "2026-08-01",
    },
    {
        id: "navigation-structure",
        variants: ["control", "flat-nav"],
        weights: [50, 50],
        expires: "2026-08-01",
    },
    {
        id: "homepage-section-order",
        variants: [
            "control",
            "demo-first",
            "social-first",
            "explain-first",
            "features-focus",
            "roadmap-first",
            "high-velocity"
        ],
        weights: [16, 14, 14, 14, 14, 14, 14],
        expires: "2026-09-01",
        sectionOrders: {
            "demo-first": {
                "s-hero": 1,
                "s-demo-terminal": 2,
                "s-demo-carousel": 3,
                "s-power-features": 4,
                "s-scroll-sync": 5,
                "s-mosaic-showcase": 6,
                "s-collection-power": 7,
                "s-social-proof": 8,
                "s-how-it-works": 9,
                "s-case-study": 10,
                "s-security": 11,
                "s-faq": 12,
                "s-roadmap": 13,
                "s-final-cta": 14
            },
            "social-first": {
                "s-hero": 1,
                "s-social-proof": 2,
                "s-case-study": 3,
                "s-security": 4,
                "s-how-it-works": 5,
                "s-collection-power": 6,
                "s-mosaic-showcase": 7,
                "s-demo-terminal": 8,
                "s-demo-carousel": 9,
                "s-power-features": 10,
                "s-scroll-sync": 11,
                "s-faq": 12,
                "s-roadmap": 13,
                "s-final-cta": 14
            },
            "explain-first": {
                "s-hero": 1,
                "s-how-it-works": 2,
                "s-collection-power": 3,
                "s-mosaic-showcase": 4,
                "s-demo-terminal": 5,
                "s-demo-carousel": 6,
                "s-power-features": 7,
                "s-scroll-sync": 8,
                "s-case-study": 9,
                "s-social-proof": 10,
                "s-security": 11,
                "s-faq": 12,
                "s-roadmap": 13,
                "s-final-cta": 14
            },
            "features-focus": {
                "s-hero": 1,
                "s-power-features": 2,
                "s-scroll-sync": 3,
                "s-mosaic-showcase": 4,
                "s-collection-power": 5,
                "s-demo-terminal": 6,
                "s-demo-carousel": 7,
                "s-social-proof": 8,
                "s-how-it-works": 9,
                "s-case-study": 10,
                "s-security": 11,
                "s-faq": 12,
                "s-roadmap": 13,
                "s-final-cta": 14
            },
            "roadmap-first": {
                "s-hero": 1,
                "s-roadmap": 2,
                "s-security": 3,
                "s-faq": 4,
                "s-social-proof": 5,
                "s-how-it-works": 6,
                "s-collection-power": 7,
                "s-case-study": 8,
                "s-demo-terminal": 9,
                "s-demo-carousel": 10,
                "s-power-features": 11,
                "s-scroll-sync": 12,
                "s-mosaic-showcase": 13,
                "s-final-cta": 14
            },
            "high-velocity": {
                "s-hero": 1,
                "s-demo-terminal": 2,
                "s-how-it-works": 3,
                "s-case-study": 4,
                "s-social-proof": 5,
                "s-demo-carousel": 6,
                "s-power-features": 7,
                "s-scroll-sync": 8,
                "s-collection-power": 9,
                "s-mosaic-showcase": 10,
                "s-security": 11,
                "s-faq": 12,
                "s-roadmap": 13,
                "s-final-cta": 14
            }
        }
    }
];

// ─── Client-side Helpers ─────────────────────────────────────

/**
 * Get the assigned variant for an experiment.
 * Returns the variant string, or null if the experiment isn't active.
 */
export function getVariant(experimentId: string): string | null {
    if (typeof document === "undefined") return null;
    return document.documentElement.getAttribute(`data-ab-${experimentId}`);
}

/**
 * Track a conversion event for an experiment.
 * Call this when the user performs a desired action (click CTA, sign up, etc.)
 *
 * @example
 * import { trackConversion } from '../scripts/ab-testing';
 * button.addEventListener('click', () => trackConversion('hero-cta', 'cta_click'));
 */
export function trackConversion(experimentId: string, action: string): void {
    const variant = getVariant(experimentId);
    if (!variant) return;

    const payload = {
        experiment_id: experimentId,
        variant_id: variant,
        conversion_action: action,
    };

    if (typeof (window as any).gtag === "function") {
        (window as any).gtag("event", "experiment_conversion", payload);
    }
}

// ─── Impression Tracking (auto-called on page load) ──────────

function trackImpressions(): void {
    for (const exp of EXPERIMENTS) {
        if (exp.expires && new Date(exp.expires).getTime() < Date.now()) continue;

        const variant = getVariant(exp.id);
        if (!variant) continue;

        const payload = {
            experiment_id: exp.id,
            variant_id: variant,
        };

        if (typeof (window as any).gtag === "function") {
            (window as any).gtag("event", "experiment_impression", payload);
        }
    }
}

// Auto-track on Astro page transitions (fires on initial load too)
if (typeof document !== "undefined") {
    document.addEventListener("astro:page-load", trackImpressions);
}
