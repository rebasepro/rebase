/**
 * Lightweight GA4-only analytics for the Rebase website.
 * All events are sent via window.gtag. No custom API endpoint.
 */

import { EXPERIMENTS, trackConversion } from "./ab-testing";

function gtag(...args: any[]) {
    if (typeof (window as any).gtag === "function") {
        (window as any).gtag(...args);
    }
}

class Analytics {
    private maxScroll = 0;
    private pageLoadTime = Date.now();

    constructor() {
        this.initGlobalListeners();
    }

    private trackAllExperimentConversions(action: string) {
        for (const exp of EXPERIMENTS) {
            if (exp.expires && new Date(exp.expires).getTime() < Date.now()) continue;
            trackConversion(exp.id, action);
        }
    }

    private initGlobalListeners() {
        // Click tracking
        document.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;

            // Generic button tracking via data-track attribute
            const trackedElement = target.closest("[data-track]");
            if (trackedElement) {
                gtag("event", "button_click", {
                    element_id: trackedElement.id,
                    element_text: trackedElement.textContent?.trim(),
                });
            }

            // Copy command tracking (e.g. "pnpm dlx @rebasepro/cli init")
            const copyBtn = target.closest("[data-track-copy]") as HTMLElement | null;
            if (copyBtn) {
                const section = copyBtn.getAttribute("data-track-copy");
                const command = copyBtn.getAttribute("data-command") || "unknown";
                gtag("event", "copy_command", {
                    event_category: "engagement",
                    event_label: section,
                    command,
                });
                this.trackAllExperimentConversions("command_copied");
            }

            // Demo CTA tracking — every link to demo.rebase.pro
            const demoLink = target.closest('a[href*="demo.rebase.pro"]') as HTMLAnchorElement | null;
            if (demoLink) {
                let section = "unknown";
                if (demoLink.closest("header")) {
                    section = demoLink.id?.includes("mobile") ? "header-mobile" : "header-desktop";
                } else if (demoLink.closest("footer")) {
                    section = "footer";
                } else {
                    const sectionEl = demoLink.closest("section");
                    const heading = sectionEl?.querySelector("h1, h2");
                    section = heading?.textContent?.trim().slice(0, 60) || "page-cta";
                }
                gtag("event", "demo_cta_click", {
                    event_category: "engagement",
                    event_label: section,
                    page: window.location.pathname,
                    link_text: demoLink.textContent?.trim(),
                });
                this.trackAllExperimentConversions("demo_click");
            }

            // Outbound link tracking (including GitHub outbound clicks)
            const link = target.closest('a[href^="http"]') as HTMLAnchorElement | null;
            if (link) {
                const url = link.href;
                if (!url.includes(window.location.hostname)) {
                    gtag("event", "outbound_link", {
                        event_category: "engagement",
                        destination_url: url,
                    });

                    if (url.includes("github.com/rebasepro/rebase") || url.includes("github.com/rebasepro")) {
                        this.trackAllExperimentConversions("github_click");
                    }
                }
            }
        });

        // Scroll depth tracking
        // rAF-coalesced: `document.body.scrollHeight` forces layout, and this ran
        // on every scroll event alongside the gradient handlers.
        let depthTicking = false;
        window.addEventListener("scroll", () => {
            if (depthTicking) return;
            depthTicking = true;
            requestAnimationFrame(() => {
                depthTicking = false;
                const scrollPercent = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
                if (scrollPercent > this.maxScroll) {
                    this.maxScroll = Math.floor(scrollPercent / 25) * 25;
                }
            });
        });

        // Send exit metrics on navigation / close
        window.addEventListener("beforeunload", () => this.sendExitEvents());
        document.addEventListener("astro:before-swap", () => this.sendExitEvents());

        // Reset on Astro page load
        document.addEventListener("astro:page-load", () => {
            this.maxScroll = 0;
            this.pageLoadTime = Date.now();
            gtag("event", "page_view", {
                page_path: window.location.pathname,
                page_title: document.title,
            });
        });
    }

    private sendExitEvents() {
        const timeOnPage = Math.floor((Date.now() - this.pageLoadTime) / 1000);

        if (this.maxScroll > 0) {
            gtag("event", "scroll_depth", { scroll_percentage: this.maxScroll });
        }
        gtag("event", "time_on_page", { duration_seconds: timeOnPage });
    }
}

// Initialize singleton
if (!(window as any).__rb_analytics) {
    (window as any).__rb_analytics = new Analytics();
}
