/**
 * A/B Testing Engine for Rebase Landing Page
 *
 * Lightweight, cookie-based, GA4-integrated A/B testing.
 * Zero dependencies. No flicker (inline head script assigns before paint).
 *
 * Supports content-variant experiments: show/hide elements via `<ABVariant>` component.
 *
 * How to use:
 * 1. Define experiments in the EXPERIMENTS array below.
 * 2. Wrap variant content with <ABVariant>.
 * 3. Results are automatically tracked in GA4 as custom events.
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
}

// ─── Active Experiments ──────────────────────────────────────
// Add, modify, or remove experiments here.
// Changes take effect on next deploy.
// ─────────────────────────────────────────────────────────────

export const EXPERIMENTS: Experiment[] = [
    {
        id: "navigation-structure",
        variants: ["control", "flat-nav"],
        // Live 50/50. The mega-nav teaches the backend / admin-panel split the rest
        // of the site is built around and the flat variant hides it, which is why
        // this sat parked — so the split is the thing under test, not a detail.
        // Dial the exposure here (e.g. [90, 10]) rather than switching it off.
        weights: [50, 50],
        expires: "2027-09-30",
    }
];

// ─── Client-side Helpers ─────────────────────────────────────

/**
 * Get the assigned variant for an experiment.
 * Returns the variant string, or null if the experiment isn't active.
 */
function getVariant(experimentId: string): string | null {
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

// Bind to window for inline scripts accessibility
if (typeof window !== "undefined") {
    (window as any).getVariant = getVariant;
    (window as any).trackConversion = trackConversion;
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

